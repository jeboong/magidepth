"""DepthDesk JSON-lines subprocess protocol. stdout is reserved for JSON."""
from __future__ import annotations

import concurrent.futures
import json
import os
from pathlib import Path
import sys
import threading
import traceback

# Windows embeddable Python runs with isolated sys.path; explicitly add only
# this shipped backend directory, never the working directory/user-site.
sys.path.insert(0, str(Path(__file__).resolve().parent))

protocol = sys.stdout
sys.stdout = sys.stderr  # Upstream diagnostic prints never corrupt JSON-lines.
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('DO_NOT_TRACK', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8')
if hasattr(protocol, 'reconfigure'):
    protocol.reconfigure(encoding='utf-8', line_buffering=True)

from engine import Engine, Job, Cancelled, probe


def main():
    write_lock, jobs_lock = threading.Lock(), threading.Lock()
    jobs = {}
    engine = Engine()
    worker = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix='depth-inference')

    def reply(identifier, kind, value):
        message = {'id': identifier, 'type': kind, 'error' if kind == 'error' else 'data': value}
        with write_lock:
            protocol.write(json.dumps(message, ensure_ascii=False, allow_nan=False) + '\n')
            protocol.flush()

    def execute(identifier, command, payload, job):
        try:
            job.check()
            if command == 'system':
                result = engine.system()
            elif command == 'probe':
                result = probe(payload.get('path'))
            elif command == 'preview':
                result = engine.preview(payload, job)
            elif command == 'render':
                result = engine.render(payload, job)
            else:
                raise ValueError('Unknown command.')
            reply(identifier, 'result', result)
        except Exception as error:
            text = str(error)
            if not isinstance(error, Cancelled):
                traceback.print_exc(file=sys.stderr)
            if 'out of memory' in text.lower():
                engine.models.clear()
                text = 'GPU memory is full. Close other GPU apps, choose input size 280 or 392 / FP16, or switch to Fast mode. ' + text[:240]
            if job.cancelled.is_set():
                text = 'Cancelled. The original video has not been changed.'
            reply(identifier, 'error', text)
        finally:
            with jobs_lock:
                jobs.pop(identifier, None)

    try:
        for line in sys.stdin:
            identifier = None
            try:
                if len(line) > 1024 * 1024:
                    raise ValueError('Request exceeds the protocol limit.')
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ValueError('Request must be an object.')
                identifier = request.get('id')
                if not isinstance(identifier, (str, int)) or isinstance(identifier, bool):
                    raise ValueError('A string or numeric request id is required.')
                command, payload = request.get('command'), request.get('payload', {})
                if not isinstance(payload, dict):
                    raise ValueError('Payload must be an object.')
                if command == 'cancel':
                    target = payload.get('jobId')
                    with jobs_lock:
                        job = jobs.get(target)
                    if job:
                        job.cancel()
                    reply(identifier, 'result', {'cancelled': bool(job)})
                    continue
                with jobs_lock:
                    if identifier in jobs:
                        raise ValueError('A job with this id is already active.')
                    if len(jobs) >= 16:
                        raise ValueError('Too many queued jobs. Wait or cancel pending work.')
                    job = Job(identifier, lambda data, ident=identifier: reply(ident, 'progress', data))
                    jobs[identifier] = job
                worker.submit(execute, identifier, command, payload, job)
            except Exception as error:
                reply(identifier, 'error', str(error))
    finally:
        with jobs_lock:
            for job in jobs.values():
                job.cancel()
        worker.shutdown(wait=True, cancel_futures=True)


if __name__ == '__main__':
    main()
