"""Explicit, opt-in local benchmark. Does not include or publish test footage.

python backend/smoke.py --input /path/to/video.mp4 --output-dir /scratch \
    --model image-small --input-size 280 --seconds 1
"""
import argparse
import json
from pathlib import Path
import time
import uuid
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from engine import DEFAULTS, Engine, Job, probe


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--model', choices=['image-small', 'video-small'], default='image-small')
    parser.add_argument('--input-size', type=int, choices=[280, 392, 518, 700], default=280)
    parser.add_argument('--seconds', type=float, default=1)
    parser.add_argument('--device', choices=['auto', 'cpu', 'cuda'], default='auto')
    parser.add_argument('--preview-only', action='store_true')
    args = parser.parse_args()
    options = {**DEFAULTS, 'model': args.model, 'inputSize': args.input_size, 'device': args.device}
    engine = Engine()
    print(json.dumps({'system': engine.system()}, ensure_ascii=False), flush=True)
    info = probe(str(args.input))
    job = Job('benchmark', lambda event: print(json.dumps(event), flush=True))
    preview_request = dict(path=str(args.input), time=0.5, options=options)
    preview = engine.preview(preview_request, job)
    print(json.dumps({'preview': {key: value for key, value in preview.items() if key not in ('image', 'source', 'images')}}), flush=True)
    repeated = engine.preview({**preview_request, 'options': {**options, 'gamma': 1.2}}, job)
    print(json.dumps({'cachedPreviewSeconds': repeated['elapsed']}), flush=True)
    if args.preview_only:
        return
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output_dir / f'smoke_{args.model}_{args.input_size}_{uuid.uuid4().hex[:8]}.mp4'
    result = engine.render(dict(path=str(args.input), trimStart=0,
                                trimEnd=min(args.seconds, info['duration']), outputPath=str(output), options=options), job)
    rendered = probe(str(output))
    expected = round(min(args.seconds, info['duration']) * info['fps'])
    assert rendered['frames'] == expected, (rendered['frames'], expected)
    assert rendered['width'] == info['width'] and rendered['height'] == info['height']
    assert abs(rendered['fps'] - info['fps']) < 0.001
    assert output.stat().st_size > 0
    print(json.dumps({'benchmark': result, 'verified': rendered}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
