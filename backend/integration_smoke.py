"""Opt-in real runtime QA, with fixtures/results kept outside the repository."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image
import numpy as np

from engine import DEFAULTS, Engine, Job, probe, Decoder


def daemon_cancel(source, output):
    messages = queue.Queue()
    with tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen([sys.executable, '-u', str(Path(__file__).with_name('daemon.py'))],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr,
                                   text=True, encoding='utf-8', creationflags=0x08000000 if os.name == 'nt' else 0)
        def reader():
            for line in process.stdout:
                messages.put(json.loads(line))
        threading.Thread(target=reader, daemon=True).start()
        def send(value):
            process.stdin.write(json.dumps(value, ensure_ascii=False) + '\n')
            process.stdin.flush()
        try:
            info = probe(str(source))
            send(dict(id='render-test', command='render', payload=dict(path=str(source), trimStart=0,
                      trimEnd=info['duration'], outputPath=str(output), options={**DEFAULTS, 'inputSize': 518})))
            cancel_sent, cancel_confirmed, cancelled = False, False, False
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline and not (cancel_confirmed and cancelled):
                message = messages.get(timeout=30)
                if message['id'] == 'render-test' and message['type'] == 'progress' and message['data']['stage'] == 'inference' and not cancel_sent:
                    send(dict(id='cancel-request', command='cancel', payload={'jobId': 'render-test'}))
                    cancel_sent = True
                if message['id'] == 'cancel-request' and message['type'] == 'result':
                    cancel_confirmed = message['data']['cancelled']
                if message['id'] == 'render-test' and message['type'] == 'error':
                    cancelled = 'Cancelled' in message['error']
                if message['id'] == 'render-test' and message['type'] == 'result':
                    raise AssertionError('Render finished before cancellation could be tested')
            assert cancel_confirmed and cancelled
            assert not output.exists()
            return {'cancelAcknowledged': True, 'renderCancelled': True, 'partialOutputRemoved': True}
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--advanced-only', action='store_true')
    args = parser.parse_args()
    root = args.output_dir / f'integration_{uuid.uuid4().hex[:8]}'
    root.mkdir(parents=True, exist_ok=False)
    engine = Engine()
    report = {'system': engine.system(), 'runs': []}
    events = []
    job = Job('integration', events.append)
    source_info = probe(str(args.input))
    original_hash = hashlib.sha256(args.input.read_bytes()).hexdigest()
    if args.advanced_only:
        decoder = Decoder(str(args.input), 0, 1, (source_info['width'], source_info['height']), job)
        try:
            source = decoder.read()
        finally:
            decoder.close()
        image_path = root / 'advanced input.png'
        Image.fromarray(source).save(image_path)
        kinds = ['source', 'depth', 'normal', 'alpha', 'basecolor', 'metallic', 'roughness', 'specular']
        options = {**DEFAULTS, 'inputSize': 280, 'processingMode': 'advanced', 'steps': 1,
                   'maps': kinds, 'previewMap': 'normal', 'model': 'image-small'}
        image_result = engine.render(dict(path=str(image_path), outputPath=str(root / 'advanced.png'), options=options), job)
        assert len(image_result['outputPaths']) == 8
        for path in image_result['outputPaths'].values():
            assert probe(path)['kind'] == 'image'
        video_result = engine.render(dict(path=str(args.input), outputPath=str(root / 'advanced.mp4'), trimStart=0,
                                          trimEnd=2 / source_info['fps'], options=options), job)
        assert len(video_result['outputPaths']) == 8
        for path in video_result['outputPaths'].values():
            assert probe(path)['frames'] == 2
        alpha_result = engine.render(dict(path=str(image_path), outputPath=str(root / 'alpha_fast.png'),
                                          options={**options, 'processingMode': 'fast', 'maps': ['alpha'], 'previewMap': 'alpha'}), job)
        assert probe(alpha_result['outputPath'])['kind'] == 'image'
        assert hashlib.sha256(args.input.read_bytes()).hexdigest() == original_hash
        print(json.dumps({'system': engine.system(), 'eightMapImage': image_result, 'eightMapVideo': video_result,
                          'fastAlpha': alpha_result, 'originalUnchanged': True}, ensure_ascii=False, indent=2), flush=True)
        return
    for model in ['image-small', 'video-small']:
        options = {**DEFAULTS, 'model': model, 'inputSize': 280}
        request = dict(path=str(args.input), time=0.5, options=options)
        preview = engine.preview(request, job)
        repeat = engine.preview({**request, 'options': {**options, 'gamma': 1.4}}, job)
        result = engine.render(dict(path=str(args.input), trimStart=0, trimEnd=min(1, source_info['duration']),
                                    outputPath=str(root / f'{model}.mp4'), options=options), job)
        info = probe(result['outputPath'])
        assert info['frames'] == 30 and info['fps'] == 30
        assert (info['width'], info['height']) == (source_info['width'], source_info['height'])
        report['runs'].append({'model': model, 'inputSize': 280, 'coldPreview': preview['elapsed'],
                               'cachedPreview': repeat['elapsed'], **result})
    kinds = ['source', 'depth', 'normal', 'basecolor', 'metallic', 'roughness', 'specular']
    options = {**DEFAULTS, 'model': 'image-small', 'inputSize': 280, 'maps': kinds, 'previewMap': 'normal'}
    result = engine.render(dict(path=str(args.input), trimStart=5 / 30, trimEnd=15 / 30,
                                outputPath=str(root / 'seven_maps.mp4'), options=options), job)
    for path in result['outputPaths'].values():
        assert probe(path)['frames'] == 10
    report['sevenMapVideo'] = result
    decoder = Decoder(str(args.input), 0, 1, (source_info['width'], source_info['height']), job)
    try:
        image = decoder.read()
    finally:
        decoder.close()
    image_path = root / 'unicode 이미지.png'
    Image.fromarray(image).save(image_path)
    result = engine.render(dict(path=str(image_path), outputPath=str(root / 'seven_image_maps.png'), options=options), job)
    for path in result['outputPaths'].values():
        assert probe(path)['kind'] == 'image'
    report['sevenMapImage'] = result
    hevc = engine.render(dict(path=str(args.input), trimStart=0, trimEnd=0.2, outputPath=str(root / 'hevc.mp4'),
                              options={**DEFAULTS, 'maps': ['source'], 'codec': 'hevc'}), job)
    assert probe(hevc['outputPath'])['frames'] == 6
    report['hevcVerified'] = True
    engine.models.clear()
    report['cancel'] = daemon_cancel(args.input, root / 'cancelled.mp4')
    assert hashlib.sha256(args.input.read_bytes()).hexdigest() == original_hash
    assert all(0 <= event['progress'] <= 1 for event in events)
    assert not any(path.name.startswith('.depthdesk') for path in root.iterdir())
    report['originalUnchanged'] = True
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
