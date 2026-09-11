"""Separate cancellable model-only JSON worker. No Engine/GPU initialization."""
from __future__ import annotations
import concurrent.futures
import json
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_catalog import catalog, download_model
protocol = sys.stdout
sys.stdout = sys.stderr
if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8')
if hasattr(protocol, 'reconfigure'):
    protocol.reconfigure(encoding='utf-8', line_buffering=True)


def main():
    jobs, lock, write_lock = {}, threading.Lock(), threading.Lock()
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)

    def reply(identifier, kind, value):
        with write_lock:
            protocol.write(json.dumps({'id': identifier, 'type': kind,
                                       'error' if kind == 'error' else 'data': value}, ensure_ascii=False) + '\n')
            protocol.flush()

    def execute(identifier, command, payload, cancelled):
        def check():
            if cancelled.is_set():
                raise RuntimeError('모델 다운로드가 취소되었습니다. 기존 모델은 유지됩니다.')
        try:
            check()
            if command == 'catalog':
                result = catalog(check)
            elif command == 'download':
                model_id = payload.get('modelId')
                def progress(stage, value, message):
                    reply(identifier, 'progress', dict(modelId=model_id, stage=stage,
                          progress=max(0, min(1, value)), message=message))
                result = download_model(model_id, progress, check)
            else:
                raise ValueError('Unknown model command.')
            reply(identifier, 'result', result)
        except Exception as error:
            reply(identifier, 'error', str(error))
        finally:
            with lock:
                jobs.pop(identifier, None)

    try:
        for line in sys.stdin:
            identifier = None
            try:
                if len(line) > 16384:
                    raise ValueError('Model request too large.')
                request = json.loads(line)
                identifier, command, payload = request.get('id'), request.get('command'), request.get('payload', {})
                if not isinstance(identifier, str) or not identifier or len(identifier) > 100 or not isinstance(payload, dict):
                    raise ValueError('Invalid model request.')
                if command == 'cancel':
                    with lock:
                        event = jobs.get(payload.get('jobId'))
                    if event:
                        event.set()
                    reply(identifier, 'result', {'cancelled': bool(event)})
                    continue
                with lock:
                    if identifier in jobs or len(jobs) >= 16:
                        raise ValueError('Model worker busy.')
                    event = jobs[identifier] = threading.Event()
                pool.submit(execute, identifier, command, payload, event)
            except Exception as error:
                reply(identifier, 'error', str(error))
    finally:
        with lock:
            for event in jobs.values():
                event.set()
        pool.shutdown(wait=True, cancel_futures=True)


if __name__ == '__main__':
    main()
