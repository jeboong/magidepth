"""Bounded-memory local video decoding, temporal inference and atomic export."""
from __future__ import annotations

import base64
from collections import OrderedDict
from fractions import Fraction
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

import cv2
import numpy as np

CREATE_NO_WINDOW = 0x08000000 if os.name == 'nt' else 0
DEFAULTS = dict(model='video-small', inputSize=392, nearWhite=True, gamma=1.0,
                contrast=0.5, device='auto', precision='auto', outputSize='source', codec='h264',
                maps=['depth'], processingMode='fast', previewMap='depth', normalStrength=1.0, steps=4)
MAP_KINDS = ('source', 'depth', 'normal', 'alpha', 'basecolor', 'metallic', 'roughness', 'specular')
KEYFRAMES = [0, 12, 24, 25, 26, 27, 28, 29, 30, 31]


class Cancelled(RuntimeError):
    pass


class Job:
    def __init__(self, job_id, emit=lambda data: None):
        self.id = job_id
        self.cancelled = threading.Event()
        self.emit = emit
        self.processes = set()
        self.lock = threading.Lock()

    def check(self):
        if self.cancelled.is_set():
            raise Cancelled('Cancelled. The original video has not been changed.')

    def cancel(self):
        self.cancelled.set()
        with self.lock:
            for process in self.processes:
                if process.poll() is None:
                    try:
                        process.terminate()
                    except OSError:
                        pass

    def track(self, process):
        with self.lock:
            self.processes.add(process)
            if self.cancelled.is_set():
                process.terminate()
        return process

    def untrack(self, process):
        with self.lock:
            self.processes.discard(process)

    def progress(self, stage, progress, message, **extra):
        self.check()
        self.emit(dict(jobId=self.id, stage=stage, progress=max(0, min(100, progress)) / 100, message=message, **extra))


def validate_options(value):
    if not isinstance(value, dict):
        raise ValueError('Options must be an object.')
    if set(value) - set(DEFAULTS):
        raise ValueError('Unknown rendering option.')
    result = {**DEFAULTS, **value}
    enums = {'model': ('video-small', 'image-small'), 'inputSize': (280, 392, 518, 700),
             'device': ('auto', 'cuda', 'cpu'), 'precision': ('auto', 'fp16', 'fp32'),
             'outputSize': ('source', '1080', '720'), 'codec': ('h264', 'hevc'),
             'processingMode': ('fast', 'advanced'), 'previewMap': MAP_KINDS, 'steps': (1, 2, 4, 8)}
    for field, choices in enums.items():
        if isinstance(result[field], bool) or result[field] not in choices:
            raise ValueError(f'Invalid {field}.')
    for field, low, high in [('gamma', 0.2, 3.0), ('contrast', 0.0, 1.0), ('normalStrength', 0.1, 10.0)]:
        number = result[field]
        if isinstance(number, bool) or not isinstance(number, (float, int)) or not math.isfinite(number) or not low <= number <= high:
            raise ValueError(f'{field} must be between {low} and {high}.')
    if not isinstance(result['nearWhite'], bool):
        raise ValueError('nearWhite must be true or false.')
    if not isinstance(result['maps'], list) or not result['maps'] or any(kind not in MAP_KINDS for kind in result['maps']):
        raise ValueError('Select at least one supported output map.')
    result['maps'] = list(dict.fromkeys(result['maps']))
    return result


def executable(name):
    supplied = os.environ.get(f'{name.upper()}_PATH')
    result = supplied or shutil.which(name)
    if not result or not Path(result).is_file():
        raise RuntimeError(f'{name} is missing. Repair the DepthDesk runtime.')
    return str(Path(result).resolve())


def source_path(raw):
    if not isinstance(raw, str) or not raw.strip() or '\x00' in raw:
        raise ValueError('Choose a local video file.')
    path = Path(raw).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError('The source video does not exist.')
    return path


def fraction_fps(value):
    try:
        result = Fraction(value)
        if 0 < float(result) <= 240:
            return result
    except (ValueError, ZeroDivisionError, TypeError):
        pass
    raise ValueError('Unsupported or invalid video frame rate (supported: up to 240 fps).')


def probe(path):
    path = source_path(path)
    if path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'):
        from PIL import Image, ImageOps
        with Image.open(path) as source:
            if getattr(source, 'n_frames', 1) > 1:
                raise ValueError('Animated images are not supported. Convert this input to a video first.')
            image = ImageOps.exif_transpose(source)
            width, height = image.size
        if min(width, height) < 2 or max(width, height) > 16384:
            raise ValueError('Unsupported image dimensions (maximum 16,384 pixels on either side).')
        return dict(kind='image', path=str(path), name=path.name, width=width, height=height,
                    fps=1.0, frames=1, duration=1.0, hasAudio=False)
    command = [executable('ffprobe'), '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)]
    result = subprocess.run(command, capture_output=True, timeout=45, creationflags=CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError('Unable to read this video. ' + result.stderr.decode('utf-8', 'replace')[-1200:])
    meta = json.loads(result.stdout)
    streams = meta.get('streams', [])
    video = next((stream for stream in streams if stream.get('codec_type') == 'video'
                  and not stream.get('disposition', {}).get('attached_pic')), None)
    if not video:
        raise ValueError('No playable video stream found.')
    fps = fraction_fps(video.get('avg_frame_rate') or video.get('r_frame_rate'))
    width, height = int(video['width']), int(video['height'])
    rotation = next((float(side.get('rotation', 0)) for side in video.get('side_data_list', [])
                     if 'rotation' in side), float(video.get('tags', {}).get('rotate', 0)))
    if round(rotation) % 180 != 0:
        width, height = height, width
    duration = float(video.get('duration') or meta.get('format', {}).get('duration') or 0)
    if min(width, height) < 2 or max(width, height) > 16384 or not math.isfinite(duration) or duration <= 0:
        raise ValueError('Unsupported dimensions or video duration.')
    frames = int(video.get('nb_frames') or max(1, round(duration * float(fps))))
    return dict(kind='video', path=str(path), name=path.name, width=width, height=height, fps=float(fps),
                frames=frames, duration=duration,
                hasAudio=any(stream.get('codec_type') == 'audio' for stream in streams))


def trim_bounds(info, start, end):
    for value in (start, end):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError('Trim boundaries must be finite seconds.')
    if start < 0 or end <= start or end > info['duration'] + 1 / info['fps']:
        raise ValueError('Trim must satisfy 0 ≤ start < end ≤ video duration.')
    # Start is inclusive, end exclusive. Snap to the nearest source-frame boundary.
    first = min(info['frames'] - 1, max(0, round(start * info['fps'])))
    last = min(info['frames'], max(first + 1, round(min(end, info['duration']) * info['fps'])))
    if last - first > 300000:
        raise ValueError('This trim exceeds 300,000 frames. Split the video into shorter jobs.')
    return first, last


def scaled_size(width, height, maximum):
    ratio = min(1, maximum / max(width, height))
    return max(2, round(width * ratio)), max(2, round(height * ratio))


def output_size(info, mode):
    if mode == 'source':
        return info['width'], info['height']
    return scaled_size(info['width'], info['height'], 1920 if mode == '1080' else 1280)


class Decoder:
    def __init__(self, path, first, last, size, job, seek_fps=None):
        self.job, self.width, self.height = job, *size
        self.error_file = tempfile.TemporaryFile()
        # Preview uses FFmpeg's accurate input seek: jump to a nearby keyframe,
        # decode forward to the requested timestamp, then return the small
        # window. Full exports keep exact source frame-index trimming.
        seek = []
        decode_first, decode_last = first, last
        if seek_fps and first:
            seek = ['-ss', f'{first / seek_fps:.12f}']
            decode_first, decode_last = 0, last - first
        filters = f'trim=start_frame={decode_first}:end_frame={decode_last},setpts=PTS-STARTPTS,scale={self.width}:{self.height}:flags=area'
        command = [executable('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-nostdin',
                   *seek, '-i', str(path), '-map', '0:v:0', '-vf', filters, '-an', '-sn', '-dn',
                   '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
        self.process = job.track(subprocess.Popen(command, stdout=subprocess.PIPE, stderr=self.error_file,
                                                  creationflags=CREATE_NO_WINDOW))

    def read(self):
        self.job.check()
        needed = self.width * self.height * 3
        buffer = bytearray()
        while len(buffer) < needed:
            chunk = self.process.stdout.read(needed - len(buffer))
            if not chunk:
                break
            buffer.extend(chunk)
            self.job.check()
        self.job.check()
        if not buffer:
            code = self.process.wait()
            if code:
                self.error_file.seek(0)
                raise RuntimeError('Video decoding failed: ' + self.error_file.read().decode('utf-8', 'replace')[-1200:])
            return None
        if len(buffer) != needed:
            raise RuntimeError('Video decoder returned an incomplete frame.')
        return np.frombuffer(buffer, dtype=np.uint8).reshape(self.height, self.width, 3)

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
        self.process.stdout.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.job.untrack(self.process)
        self.error_file.close()


def align_scale(current, reference):
    # Float64 accumulation avoids cancellation on nearly constant frames.
    a = np.asarray(current, np.float64).ravel()
    b = np.asarray(reference, np.float64).ravel()
    am, bm = float(a.mean()), float(b.mean())
    centered = a - am
    denominator = float(centered @ centered)
    if denominator < 1e-10:
        return 1.0, bm - am
    scale = float(centered @ (b - bm)) / denominator
    if not math.isfinite(scale) or scale <= 0:
        return 1.0, bm - am
    return scale, bm - scale * am


def temporal_predictions(decoder, predictor, size, total, job):
    """Official 32-frame/10-context alignment, retaining only 8 pending outputs.

    Initial 32 decoded frames are followed by 22 new frames per inference.
    The two scale anchors and eight overlapping frames are carried forward.
    This emits final aligned outputs in order without storing the full video.
    """
    first = []
    while len(first) < 32:
        frame = decoder.read()
        if frame is None:
            break
        first.append(predictor.prepare(frame, size))
    if not first:
        raise RuntimeError('The selected trim contains no decodable frames.')
    consumed = len(first)
    prepared = first + [first[-1]] * (32 - len(first))
    depth = predictor.temporal(prepared)
    if not np.isfinite(depth).all():
        raise RuntimeError('The model produced non-finite depth. Try FP32 or a smaller input size.')
    job.progress('inference', 5 + 72 * min(1, consumed / total), f'Estimated {consumed} / {total} frames',
                 frame=consumed, totalFrames=total)
    if len(first) < 32 or consumed >= total:
        yield from depth[:len(first)]
        return
    yield from depth[:24]
    pending = depth[24:32].copy()
    references = [depth[0].copy(), depth[12].copy()]
    keys = [prepared[index] for index in KEYFRAMES]
    del first, prepared, depth
    started = time.monotonic()
    while True:
        job.check()
        fresh = []
        while len(fresh) < 22:
            frame = decoder.read()
            if frame is None:
                break
            fresh.append(predictor.prepare(frame, size))
        if not fresh:
            yield from pending
            return
        consumed += len(fresh)
        prepared = keys + fresh + [fresh[-1]] * (22 - len(fresh))
        depths = predictor.temporal(prepared)
        scale, shift = align_scale(depths[:2], references)
        depths = np.maximum(depths * scale + shift, 0)
        if not np.isfinite(depths).all():
            raise RuntimeError('Temporal depth alignment failed. Try FP32 or the Fast model.')
        weights = np.linspace(0, 1, 8, dtype=np.float32)[:, None, None]
        blended = pending * (1 - weights) + depths[2:10] * weights
        yield from blended
        valid = depths[10:10 + len(fresh)]
        elapsed = max(0.001, time.monotonic() - started)
        speed = max(0, consumed - 32) / elapsed
        job.progress('inference', 5 + 72 * min(1, consumed / total), f'Estimated {consumed} / {total} frames',
                     frame=consumed, totalFrames=total, fps=round(speed, 2),
                     eta=round(max(0, total - consumed) / max(0.01, speed), 1))
        if len(fresh) < 22 or consumed >= total:
            yield from valid
            return
        yield from valid[:-8]
        pending = valid[-8:].copy()
        references = [references[0], depths[12].copy()]
        keys = [prepared[index] for index in KEYFRAMES]


def normalize_depth(depth, low, high, options):
    normal = np.clip((depth.astype(np.float32) - low) / max(high - low, 1e-8), 0, 1)
    if not options['nearWhite']:
        normal = 1 - normal
    normal = np.power(normal, 1 / options['gamma'])
    return np.rint(normal * 255).astype(np.uint8)


def data_url(frame, extension='.png'):
    if frame.ndim == 3:
        frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
    okay, image = cv2.imencode(extension, frame, [cv2.IMWRITE_JPEG_QUALITY, 92] if extension == '.jpg' else [])
    if not okay:
        raise RuntimeError('Preview image encoding failed.')
    mime = 'image/jpeg' if extension == '.jpg' else 'image/png'
    return f'data:{mime};base64,' + base64.b64encode(image).decode('ascii')


def read_image(path, maximum=None):
    from PIL import Image, ImageOps
    with Image.open(path) as source:
        result = np.asarray(ImageOps.exif_transpose(source).convert('RGB')).copy()
    if maximum:
        width, height = scaled_size(result.shape[1], result.shape[0], maximum)
        result = cv2.resize(result, (width, height), interpolation=cv2.INTER_AREA)
    return result


def global_range(spool, shape, count, low, high, contrast, job):
    if high - low < 1e-8 or contrast == 0:
        return low, high
    histogram = np.zeros(8192, dtype=np.int64)
    with spool.open('rb') as source:
        for index in range(count):
            job.check()
            depth = np.fromfile(source, dtype=np.float32, count=shape[0] * shape[1])
            histogram += np.histogram(depth[index % 16::16], bins=8192, range=(low, high))[0]
            if index % 100 == 0:
                job.progress('normalize', 77 + 3 * index / count, 'Computing one global contrast range')
    cumulative = np.cumsum(histogram)
    if cumulative[-1] == 0:
        return low, high
    # Slider value is a percentage clipped from both tails, not independent
    # per-frame auto exposure. Every frame receives exactly this same mapping.
    first = np.searchsorted(cumulative, cumulative[-1] * contrast / 100)
    last = np.searchsorted(cumulative, cumulative[-1] * (1 - contrast / 100))
    span = (high - low) / 8192
    return low + first * span, low + (last + 1) * span


class Engine:
    def __init__(self):
        from models import ModelCache
        self.models = ModelCache()
        self.previews = OrderedDict()
        cv2.setNumThreads(4)
        import torch
        torch.set_num_threads(min(8, os.cpu_count() or 4))
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

    def system(self):
        import torch
        cuda = torch.cuda.is_available()
        total, free = 0, 0
        if cuda:
            free, total = torch.cuda.mem_get_info()
        return dict(cuda=cuda, gpu=torch.cuda.get_device_name(0) if cuda else 'CPU',
                    vramGB=round(total / 2**30, 2), freeVramGB=round(free / 2**30, 2),
                    torch=torch.__version__, python='.'.join(map(str, __import__('sys').version_info[:3])),
                    ffmpeg=bool((os.environ.get('FFMPEG_PATH') and Path(os.environ['FFMPEG_PATH']).is_file()) or shutil.which('ffmpeg')))

    def preview(self, payload, job):
        from exporter import preview_project
        return preview_project(self, payload, job)

    def preview_depth(self, payload, job, internal=False):
        started = time.monotonic()
        options = validate_options(payload.get('options', {}))
        info = probe(payload.get('path'))
        position = payload.get('time', 0)
        if isinstance(position, bool) or not isinstance(position, (int, float)) or not math.isfinite(position) or not 0 <= position <= info['duration']:
            raise ValueError('Preview time must lie inside the video.')
        selected = min(info['frames'] - 1, max(0, round(position * info['fps'])))
        path = Path(info['path'])
        key = (str(path), path.stat().st_mtime_ns, path.stat().st_size, selected,
               options['model'], options['inputSize'], options['device'], options['precision'])
        cached = self.previews.get(key)
        if cached is None:
            if 'advanced_maps' in sys.modules:
                sys.modules['advanced_maps'].release()
            predictor = self.models.get(options, job.progress, job.check)
            work = scaled_size(info['width'], info['height'], max(1280, options['inputSize'] * 2))
            first = selected if options['model'] == 'image-small' else max(0, min(selected - 15, info['frames'] - 32))
            last = min(info['frames'], first + (1 if options['model'] == 'image-small' else 32))
            if info['kind'] == 'image':
                frames = [read_image(path, max(work))]
            else:
                decoder = Decoder(path, first, last, work, job, seek_fps=info['fps'])
                try:
                    frames = []
                    while len(frames) < last - first:
                        frame = decoder.read()
                        if frame is None:
                            break
                        frames.append(frame)
                finally:
                    decoder.close()
            if not frames:
                raise RuntimeError('Unable to decode the selected frame.')
            offset = min(selected - first, len(frames) - 1)
            source = frames[offset].copy()
            job.progress('preview', 35, 'Rendering the selected frame' if options['model'] == 'image-small' else 'Rendering a 32-frame temporal preview')
            if options['model'] == 'image-small':
                depth = predictor.image(source, options['inputSize'])
                low, high = float(depth.min()), float(depth.max())
                sample = depth.ravel()[::8].copy()
            else:
                frames += [frames[-1]] * (32 - len(frames))
                depths = predictor.temporal([predictor.prepare(frame, options['inputSize']) for frame in frames])
                depth = depths[offset].copy()
                low, high = float(depths.min()), float(depths.max())
                sample = depths.ravel()[::64].copy()
            if not np.isfinite(depth).all():
                raise RuntimeError('The model produced invalid depth. Try FP32.')
            cached = (source, depth, sample, low, high)
            self.previews[key] = cached
            while len(self.previews) > 4:
                self.previews.popitem(last=False)
        source, depth, sample, low, high = cached
        self.previews.move_to_end(key)
        if options['contrast'] > 0:
            low, high = np.percentile(sample, [options['contrast'], 100 - options['contrast']])
        gray = normalize_depth(depth, low, high, options)
        gray = cv2.resize(gray, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_CUBIC)
        job.check()
        result = dict(image=data_url(gray), source=data_url(source, '.jpg'), elapsed=round(time.monotonic() - started, 3),
                      frame=selected, width=info['width'], height=info['height'])
        if internal:
            result['_source'] = source
            result['_depth'] = gray
            linear = np.clip((depth.astype(np.float32) - low) / max(high - low, 1e-8), 0, 1)
            result['_linear_depth'] = cv2.resize(linear, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_CUBIC)
        return result

    def render(self, payload, job):
        from exporter import render_project
        return render_project(self, payload, job)

    def render_depth_video(self, payload, job, spool_callback=None):
        started = time.monotonic()
        options = validate_options(payload.get('options', {}))
        info = probe(payload.get('path'))
        first, last = trim_bounds(info, payload.get('trimStart', 0), payload.get('trimEnd', info['duration']))
        output_raw = payload.get('outputPath')
        if not isinstance(output_raw, str) or not output_raw or '\x00' in output_raw:
            raise ValueError('Choose an MP4 output path.')
        output = Path(output_raw).expanduser().resolve()
        if output.suffix.lower() != '.mp4':
            raise ValueError('Output must have an .mp4 extension.')
        if output == Path(info['path']) or output.exists():
            raise FileExistsError('The output already exists. Choose a new file name; DepthDesk never overwrites your source.')
        if not output.parent.is_dir():
            raise ValueError('The output folder does not exist. Choose an existing folder.')
        if 'advanced_maps' in sys.modules:
            sys.modules['advanced_maps'].release()
        predictor = self.models.get(options, job.progress, job.check)
        work = scaled_size(info['width'], info['height'], max(1024, options['inputSize'] * 2))
        temporary = output.parent / f'.{output.stem}.{uuid.uuid4().hex}.part.mp4'
        count, shape, min_depth, max_depth = 0, None, math.inf, -math.inf
        job.progress('inference', 5, 'Starting local depth estimation')
        try:
            with tempfile.TemporaryDirectory(prefix='.depthdesk-', dir=output.parent) as scratch:
                spool = Path(scratch) / 'depth.float32'
                decoder = Decoder(info['path'], first, last, work, job)
                try:
                    if options['model'] == 'video-small':
                        predictions = temporal_predictions(decoder, predictor, options['inputSize'], last - first, job)
                    else:
                        def image_predictions():
                            while True:
                                frame = decoder.read()
                                if frame is None:
                                    break
                                yield predictor.image(frame, options['inputSize'])
                        predictions = image_predictions()
                    with spool.open('xb') as stream:
                        for depth in predictions:
                            job.check()
                            if not np.isfinite(depth).all():
                                raise RuntimeError('Invalid depth prediction. Try FP32 precision.')
                            if shape is None:
                                shape = depth.shape
                                needed = int(np.prod(shape)) * 4 * (last - first) + info['width'] * info['height'] * (last - first) // 3
                                if shutil.disk_usage(output.parent).free < needed + 256 * 1024**2:
                                    raise RuntimeError(f'Not enough temporary disk space (about {needed / 1024**3:.1f} GB needed). Shorten the trim, lower input resolution, or choose another drive.')
                            depth.astype(np.float32).tofile(stream)
                            min_depth = min(min_depth, float(depth.min()))
                            max_depth = max(max_depth, float(depth.max()))
                            count += 1
                            if options['model'] == 'image-small':
                                elapsed = max(0.001, time.monotonic() - started)
                                job.progress('inference', 5 + 72 * count / (last - first), f'Estimated {count} / {last - first} frames',
                                             frame=count, totalFrames=last - first, fps=round(count / elapsed, 2),
                                             eta=round((last - first - count) * elapsed / count, 1))
                finally:
                    decoder.close()
                if count == 0 or shape is None:
                    raise RuntimeError('No depth frames were generated.')
                low, high = global_range(spool, shape, count, min_depth, max_depth, options['contrast'], job)
                if spool_callback is not None:
                    # Auxiliary map generation reads the original float depth,
                    # never a lossy, already encoded intermediate depth video.
                    del predictions, predictor
                    return spool_callback(spool, shape, count, low, high)
                self.encode(spool, shape, count, output_size(info, options['outputSize']), info['fps'],
                            options, low, high, temporary, job)
                job.check()
                # Exclusive reservation closes the race after the initial exists check.
                descriptor = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(descriptor)
                try:
                    os.replace(temporary, output)
                except Exception:
                    output.unlink(missing_ok=True)
                    raise
            elapsed = time.monotonic() - started
            job.progress('complete', 100, 'Depth video saved', frame=count, totalFrames=count)
            return dict(outputPath=str(output), frames=count, elapsed=round(elapsed, 3), fps=round(count / max(elapsed, 0.001), 2))
        finally:
            temporary.unlink(missing_ok=True)

    def encode(self, spool, shape, count, size, fps, options, low, high, temporary, job):
        width, height = size
        # Odd source dimensions cannot use 4:2:0. Preserve exact dimensions with
        # 4:4:4 instead of silently cropping a row/column from the user's video.
        pixel_format = 'yuv444p' if width % 2 or height % 2 else 'yuv420p'
        codec = 'libx264' if options['codec'] == 'h264' else 'libx265'
        command = [executable('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
                   '-f', 'rawvideo', '-pixel_format', 'gray', '-video_size', f'{width}x{height}',
                   '-framerate', str(Fraction(fps).limit_denominator(100000)), '-i', 'pipe:0',
                   '-an', '-c:v', codec, '-preset', 'veryfast', '-crf', '16', '-pix_fmt', pixel_format,
                   '-movflags', '+faststart', '-f', 'mp4']
        if codec == 'libx265':
            command += ['-tag:v', 'hvc1', '-x265-params', 'log-level=error']
        command.append(str(temporary))
        with tempfile.TemporaryFile() as errors:
            process = job.track(subprocess.Popen(command, stdin=subprocess.PIPE, stderr=errors,
                                                  creationflags=CREATE_NO_WINDOW))
            try:
                with spool.open('rb') as stream:
                    for index in range(count):
                        job.check()
                        depth = np.fromfile(stream, dtype=np.float32, count=shape[0] * shape[1]).reshape(shape)
                        gray = normalize_depth(depth, low, high, options)
                        gray = cv2.resize(gray, (width, height), interpolation=cv2.INTER_CUBIC)
                        process.stdin.write(gray.tobytes())
                        if index % 5 == 0 or index == count - 1:
                            job.progress('encode', 80 + 19 * (index + 1) / count, f'Encoding {index + 1} / {count} frames',
                                         frame=index + 1, totalFrames=count)
                process.stdin.close()
                code = process.wait()
                job.check()
                if code:
                    errors.seek(0)
                    raise RuntimeError('Video encoding failed: ' + errors.read().decode('utf-8', 'replace')[-1500:])
            except BrokenPipeError:
                job.check()
                errors.seek(0)
                raise RuntimeError('Encoder stopped: ' + errors.read().decode('utf-8', 'replace')[-1500:])
            finally:
                if process.poll() is None:
                    process.terminate()
                if process.stdin and not process.stdin.closed:
                    process.stdin.close()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                job.untrack(process)
