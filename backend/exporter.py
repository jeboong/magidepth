"""Image and multi-map video export orchestration.

Fast material outputs are explicitly documented approximations. AI alpha and
advanced maps are lazy, separately loaded adapters; media remains local.
"""
from __future__ import annotations

import contextlib
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

import cv2
import numpy as np

from engine import (CREATE_NO_WINDOW, Decoder, data_url, executable, normalize_depth,
                    output_size, probe, read_image, trim_bounds, validate_options)
from maps import fast_maps


def needs_depth(options, kinds):
    return 'depth' in kinds or ('normal' in kinds and options['processingMode'] == 'fast')


def advanced_kinds(options, kinds):
    return [kind for kind in kinds if kind == 'alpha' or
            (options['processingMode'] == 'advanced' and kind not in ('source', 'depth'))]


def maps_for_frame(engine, source, linear, options, kinds, job):
    advanced = advanced_kinds(options, kinds)
    simple = [kind for kind in kinds if kind not in advanced]
    output = fast_maps(source, linear, simple, options)
    if 'depth' in kinds:
        output['depth'] = normalize_depth(linear, 0, 255 if linear.dtype == np.uint8 else 1, options)
    if advanced:
        import torch
        from advanced_maps import infer
        if engine.models.predictor is not None:
            engine.models.clear()
        device = options['device']
        if device == 'auto':
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        # Material models own the GPU while estimating auxiliary maps.
        output.update(infer(source, advanced, options, device, job.progress, job.check))
    for kind in kinds:
        if kind not in output:
            raise RuntimeError(f'{kind} map was not returned by the model.')
        image = output[kind]
        if image.dtype != np.uint8:
            raise RuntimeError(f'{kind} map has an unsupported pixel format.')
        if image.shape[:2] != source.shape[:2]:
            output[kind] = cv2.resize(image, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_CUBIC)
    return output


def source_preview(info, frame, job):
    if info['kind'] == 'image':
        return read_image(info['path'], 1280)
    scale = min(1, 1280 / max(info['width'], info['height']))
    decoder = Decoder(info['path'], frame, frame + 1,
                      (round(info['width'] * scale), round(info['height'] * scale)), job, seek_fps=info['fps'])
    try:
        source = decoder.read()
        if source is None:
            raise RuntimeError('Unable to read preview frame.')
        return source
    finally:
        decoder.close()


def preview_project(engine, payload, job):
    started = time.monotonic()
    options = validate_options(payload.get('options', {}))
    kinds = list(dict.fromkeys(options['maps'] + [options['previewMap']]))
    info = probe(payload.get('path'))
    position = payload.get('time', 0)
    if isinstance(position, bool) or not isinstance(position, (int, float)) or not math.isfinite(position) or not 0 <= position <= info['duration']:
        raise ValueError('Preview time must lie inside the source.')
    selected = 0 if info['kind'] == 'image' else min(info['frames'] - 1, max(0, round(position * info['fps'])))
    if needs_depth(options, kinds):
        # Keep raw normalized depth linear for geometry; display gamma/polarity
        # are applied only to the final depth layer, not to normal geometry.
        base_options = {**options, 'gamma': 1.0, 'nearWhite': True}
        prediction = engine.preview_depth({**payload, 'options': base_options}, job, internal=True)
        source, linear = prediction.pop('_source'), prediction.pop('_linear_depth')
        prediction.pop('_depth')
        selected = prediction['frame']
    else:
        source = source_preview(info, selected, job)
        linear = np.zeros(source.shape[:2], np.uint8)
    job.check()
    outputs = maps_for_frame(engine, source, linear, options, kinds, job)
    images = {kind: data_url(image, '.jpg' if kind == 'source' else '.png') for kind, image in outputs.items()}
    result = dict(image=images[options['previewMap']], source=data_url(source, '.jpg'), images=images,
                  frame=selected, width=info['width'], height=info['height'], elapsed=round(time.monotonic() - started, 3))
    job.progress('complete', 100, 'Preview ready — Fast material maps are approximations; export depth uses the full clip range')
    return result


def paths_for_output(raw, info, kinds):
    if not isinstance(raw, str) or not raw or '\x00' in raw:
        raise ValueError('Choose an output file name.')
    base = Path(raw).expanduser().resolve()
    extension = '.png' if info['kind'] == 'image' else '.mp4'
    if base.suffix.lower() != extension:
        raise ValueError(f'{info["kind"].title()} output must use {extension}.')
    if not base.parent.is_dir():
        raise ValueError('Choose an existing output folder.')
    if base == Path(info['path']):
        raise FileExistsError('Output cannot replace the original input.')
    outputs = {kind: base if len(kinds) == 1 else base.with_name(f'{base.stem}_{kind}{extension}') for kind in kinds}
    for path in outputs.values():
        if path.exists() or path == Path(info['path']):
            raise FileExistsError(f'{path.name} already exists. Choose a new output name.')
    return outputs


def publish(temporary, destinations):
    reservations, published = [], []
    try:
        # Reserve every final name before publishing any result. Existing files
        # are never opened for writing, even if created after initial validation.
        for path in destinations.values():
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
            reservations.append(path)
        for kind, target in destinations.items():
            os.replace(temporary[kind], target)
            published.append(target)
    except Exception:
        for path in reservations:
            path.unlink(missing_ok=True)
        raise


class VideoWriter:
    def __init__(self, path, size, fps, codec, color, job):
        from fractions import Fraction
        width, height = size
        self.job = job
        self.errors = tempfile.TemporaryFile()
        self.closed = False
        self.path = path
        command = [executable('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
                   '-f', 'rawvideo', '-pixel_format', 'rgb24' if color else 'gray',
                   '-video_size', f'{width}x{height}', '-framerate', str(Fraction(fps).limit_denominator(100000)),
                   '-i', 'pipe:0', '-an', '-c:v', 'libx264' if codec == 'h264' else 'libx265',
                   '-threads', '2', '-preset', 'veryfast', '-crf', '16',
                   '-pix_fmt', 'yuv444p' if width % 2 or height % 2 else 'yuv420p', '-movflags', '+faststart']
        if codec == 'hevc':
            command += ['-tag:v', 'hvc1', '-x265-params', 'log-level=error:pools=2']
        command += ['-f', 'mp4', str(path)]
        self.process = job.track(subprocess.Popen(command, stdin=subprocess.PIPE, stderr=self.errors,
                                                  creationflags=CREATE_NO_WINDOW))

    def write(self, frame):
        self.job.check()
        try:
            self.process.stdin.write(frame.tobytes())
        except BrokenPipeError:
            self.job.check()
            self.errors.seek(0)
            raise RuntimeError('Map encoder failed: ' + self.errors.read().decode('utf-8', 'replace')[-1200:])

    def finish(self):
        if not self.process.stdin.closed:
            self.process.stdin.close()
        code = self.process.wait()
        self.job.check()
        if code:
            self.errors.seek(0)
            raise RuntimeError('Map encoder failed: ' + self.errors.read().decode('utf-8', 'replace')[-1200:])

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.process.poll() is None:
            self.process.terminate()
        with contextlib.suppress(BrokenPipeError, OSError):
            if not self.process.stdin.closed:
                self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.job.untrack(self.process)
        self.errors.close()


def render_project(engine, payload, job):
    started = time.monotonic()
    options = validate_options(payload.get('options', {}))
    info = probe(payload.get('path'))
    kinds = options['maps']
    destinations = paths_for_output(payload.get('outputPath'), info, kinds)
    if info['kind'] == 'video' and kinds == ['depth']:
        result = engine.render_depth_video(payload, job)
        result['outputPaths'] = {'depth': result['outputPath']}
        return result
    first, last = (0, 1) if info['kind'] == 'image' else trim_bounds(info, payload.get('trimStart', 0), payload.get('trimEnd', info['duration']))
    size = output_size(info, options['outputSize'])
    parent = next(iter(destinations.values())).parent
    count = 0
    with tempfile.TemporaryDirectory(prefix='.depthdesk-maps-', dir=parent) as scratch_name:
        scratch = Path(scratch_name)
        temporary = {kind: scratch / f'{kind}{path.suffix}' for kind, path in destinations.items()}
        if info['kind'] == 'image':
            source = read_image(info['path'])
            source = cv2.resize(source, size, interpolation=cv2.INTER_AREA)
            if needs_depth(options, kinds):
                prediction = engine.preview_depth({**payload, 'time': 0, 'options': {**options, 'gamma': 1, 'nearWhite': True}}, job, internal=True)
                linear = cv2.resize(prediction['_linear_depth'], size, interpolation=cv2.INTER_CUBIC)
            else:
                linear = np.zeros(source.shape[:2], np.uint8)
            maps = maps_for_frame(engine, source, linear, options, kinds, job)
            for kind, frame in maps.items():
                job.check()
                pixels = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR) if frame.ndim == 3 else frame
                okay, encoded = cv2.imencode('.png', pixels)
                if not okay:
                    raise RuntimeError(f'Unable to encode {kind} PNG.')
                with temporary[kind].open('xb') as stream:
                    stream.write(encoded.tobytes())
            count = 1
        else:
            def encode_maps(spool=None, shape=None, predicted_count=None, low=0, high=1):
                nonlocal count
                source_decoder = Decoder(info['path'], first, last, size, job)
                writers = {}
                stream = spool.open('rb') if spool else None
                try:
                    while True:
                        job.check()
                        source = source_decoder.read()
                        if source is None:
                            break
                        if stream:
                            depth = np.fromfile(stream, dtype=np.float32, count=shape[0] * shape[1])
                            if depth.size != shape[0] * shape[1]:
                                raise RuntimeError('Depth/source frame alignment was lost.')
                            linear = np.clip((depth.reshape(shape) - low) / max(high - low, 1e-8), 0, 1)
                            linear = cv2.resize(linear, size, interpolation=cv2.INTER_CUBIC)
                        else:
                            linear = np.zeros(source.shape[:2], np.uint8)
                        maps = maps_for_frame(engine, source, linear, options, kinds, job)
                        for kind, frame in maps.items():
                            if kind not in writers:
                                writers[kind] = VideoWriter(temporary[kind], size, info['fps'], options['codec'], frame.ndim == 3, job)
                            writers[kind].write(frame)
                        count += 1
                        elapsed = max(0.001, time.monotonic() - started)
                        job.progress('maps', 100 * count / (last - first), f'Rendering {len(kinds)} maps: {count} / {last - first}',
                                     frame=count, totalFrames=last - first, fps=round(count / elapsed, 2),
                                     eta=round(max(0, last - first - count) * elapsed / count, 1))
                    if count == 0 or (predicted_count is not None and count != predicted_count):
                        raise RuntimeError('Missing or misaligned map frames.')
                    for writer in writers.values():
                        writer.finish()
                finally:
                    source_decoder.close()
                    if stream:
                        stream.close()
                    for writer in writers.values():
                        writer.close()
            if needs_depth(options, kinds):
                engine.render_depth_video({**payload, 'outputPath': str(scratch / 'unused.mp4'),
                                           'options': {**options, 'gamma': 1, 'nearWhite': True}}, job, encode_maps)
            else:
                encode_maps()
        job.check()
        publish(temporary, destinations)
    elapsed = time.monotonic() - started
    primary = options['previewMap'] if options['previewMap'] in destinations else kinds[0]
    job.progress('complete', 100, f'Saved {len(kinds)} map file(s)', frame=count, totalFrames=count)
    return dict(outputPath=str(destinations[primary]), outputPaths={kind: str(path) for kind, path in destinations.items()},
                frames=count, elapsed=round(elapsed, 3), fps=round(count / max(elapsed, 0.001), 2))
