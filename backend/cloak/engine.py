"""Headless MagiCloak: upstream frame math, local media and safe publication."""
from __future__ import annotations

import base64
from collections import OrderedDict
from dataclasses import asdict
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

import cv2
import numpy as np

from engine import Job, Cancelled
from . import UPSTREAM_REPOSITORY, UPSTREAM_REVISION
from . import ffmpeg_utils as ff
from .detector import FaceDetector
from .image_io import _imread_unicode, _imwrite_unicode, _imwrite_params, _downscale, _ffmpeg_error
from .options import defaults, validate_options
from .processor import FrameProcessor, is_image, is_video, IMAGE_EXTS

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
VIDEO_OUTPUT_EXTS = {".mp4", ".mov", ".mkv", ".m4v"}


def _remove_temporary(path):
    """Remove only a job-owned temp, tolerating Windows' short post-exit lock."""
    for attempt in range(7):
        try:
            path.unlink(missing_ok=True)
            return
        except PermissionError:
            if attempt == 6:
                raise
            time.sleep(.025 * (2 ** attempt))


class _NoDetection:
    mode_label = "수동 그리드/패딩 · 얼굴 검출 불필요"

    def detect(self, _frame):
        return []


def local_source(value):
    if not isinstance(value, str) or not os.path.isabs(value) or "\0" in value:
        raise ValueError("로컬 미디어의 절대 경로를 선택하세요.")
    if value.startswith(("\\\\", "//")) or (os.name == "nt" and ":" in value[2:]):
        raise ValueError("네트워크/장치 경로는 지원하지 않습니다.")
    path = Path(value).resolve()
    if str(path).startswith(("\\\\", "//")) or (os.name == "nt" and ":" in str(path)[2:]):
        raise ValueError("네트워크/장치 경로는 지원하지 않습니다.")
    if not path.is_file() or not (is_image(str(path)) or is_video(str(path))):
        raise ValueError("지원되는 로컬 이미지 또는 영상 파일이 아닙니다.")
    return path


def image_bgr(data):
    if data is None:
        raise ValueError("이미지를 열 수 없습니다.")
    if data.dtype != np.uint8:
        raise ValueError("Cloak은 8-bit 이미지를 지원합니다. 16-bit 이미지는 먼저 8-bit로 변환하세요.")
    if data.ndim == 2:
        return cv2.cvtColor(data, cv2.COLOR_GRAY2BGR), None
    if data.shape[2] == 4:
        return cv2.cvtColor(data, cv2.COLOR_BGRA2BGR), data[:, :, 3].copy()
    return data[:, :, :3].copy(), None


def data_url(bgr):
    ok, encoded = cv2.imencode(".png", np.ascontiguousarray(bgr), [cv2.IMWRITE_PNG_COMPRESSION, 3])
    if not ok:
        raise RuntimeError("미리보기 인코딩 실패")
    return "data:image/png;base64," + base64.b64encode(encoded).decode("ascii")


def probe(value, thumbnail=True):
    path = local_source(value)
    if is_image(str(path)):
        frame, _ = image_bgr(_imread_unicode(str(path)))
        height, width = frame.shape[:2]
        result = dict(kind="image", path=str(path), name=path.name, width=width, height=height,
                      fps=1.0, frames=1, duration=1.0, hasAudio=False)
    else:
        cap = cv2.VideoCapture(str(path))
        try:
            if not cap.isOpened():
                raise ValueError("영상을 열 수 없습니다.")
            fps = float(cap.get(cv2.CAP_PROP_FPS))
            if not math.isfinite(fps) or fps <= 1e-3:
                fps = 30.0
            frames = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0))
            ok, frame = cap.read()
            if not ok:
                raise ValueError("첫 프레임을 읽을 수 없습니다.")
            height, width = frame.shape[:2]
            duration = ff.probe_duration(str(path)) or frames / fps
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError("영상 길이를 확인할 수 없습니다.")
            result = dict(kind="video", path=str(path), name=path.name, width=width, height=height,
                          fps=fps, frames=frames, duration=duration, hasAudio=ff.has_audio(str(path)))
        finally:
            cap.release()
    if min(width, height) < 2 or max(width, height) > 16384:
        raise ValueError("미디어 크기는 각 변 2~16,384픽셀이어야 합니다.")
    if thumbnail:
        result["thumbnail"] = data_url(_downscale(frame, 320))
    return result


class CloakEngine:
    def __init__(self):
        self._detectors = {}
        self._preview_cache = OrderedDict()

    def _detector(self, cfg, job, force=False):
        if not force and not any(cfg.methods.values()) and not (cfg.use_grid and cfg.tracking):
            return _NoDetection()
        key = cfg.detect_score
        if key not in self._detectors:
            job.progress("detector", 0, "얼굴 검출기를 준비합니다.")
            detector = FaceDetector(score_threshold=key,
                                    progress=lambda message, fraction: job.progress("model", fraction * 4, message),
                                    check=job.check)
            self._detectors = {key: detector}
        detector = self._detectors[key]
        job.progress("detector", 0, f"검출기: {detector.mode_label}")
        return detector

    def system(self):
        return dict(module="MagiCloak", upstream=UPSTREAM_REPOSITORY, revision=UPSTREAM_REVISION,
                    opencv=cv2.__version__, yunet=hasattr(cv2, "FaceDetectorYN"), ffmpeg=ff.ffmpeg_version(),
                    defaults=defaults(), qualityPresets=[asdict(p) for p in ff.QUALITY_PRESETS.values()],
                    guarantees=False)

    def preview(self, payload, job):
        started = time.perf_counter()
        cfg = validate_options(payload.get("options", {}))
        path = local_source(payload.get("path"))
        find_face = payload.get("findFace") is True
        detector = self._detector(cfg, job, force=find_face)
        moment = payload.get("time", 0)
        if isinstance(moment, bool) or not isinstance(moment, (float, int)) or not math.isfinite(moment) or moment < 0:
            raise ValueError("미리보기 시간은 0 이상의 초 값이어야 합니다.")
        key = (str(path), path.stat().st_mtime_ns, moment, find_face, cfg.detect_score)
        cached = self._preview_cache.get(key)
        if cached is not None:
            frame_index, source = cached
        elif is_image(str(path)):
            source, _ = image_bgr(_imread_unicode(str(path)))
            source = _downscale(source, 960).copy()
            frame_index = 0
        else:
            cap = cv2.VideoCapture(str(path))
            try:
                if not cap.isOpened():
                    raise ValueError("영상을 열 수 없습니다.")
                total = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0))
                fps = float(cap.get(cv2.CAP_PROP_FPS))
                if not math.isfinite(fps) or fps <= 1e-3:
                    fps = 30.0
                target = min(total - 1, max(0, round(moment * fps)))
                candidates = list(range(0, total, max(1, total // min(14, total))))[:min(14, total)] if find_face else [target]
                first = None
                for index in candidates:
                    job.check()
                    cap.set(cv2.CAP_PROP_POS_FRAMES, index)
                    ok, frame = cap.read()
                    if not ok:
                        continue
                    frame = _downscale(frame, 960).copy()
                    if first is None:
                        first = (index, frame)
                    if not find_face or detector.detect(frame):
                        first = (index, frame)
                        break
                if first is None:
                    raise ValueError("선택한 프레임을 읽을 수 없습니다.")
                frame_index, source = first
            finally:
                cap.release()
        self._preview_cache[key] = (frame_index, source)
        self._preview_cache.move_to_end(key)
        while len(self._preview_cache) > 3:
            self._preview_cache.popitem(last=False)
        job.check()
        processor = FrameProcessor(cfg, detector)
        processed = processor.process(source.copy(), temporal=False)
        job.check()
        return dict(image=data_url(processed), source=data_url(source), elapsed=time.perf_counter() - started,
                    frame=frame_index, width=source.shape[1], height=source.shape[0],
                    faceCount=processor.last_count, detector=detector.mode_label)

    def render(self, payload, job):
        started = time.perf_counter()
        cfg = validate_options(payload.get("options", {}))
        jobs = payload.get("jobs")
        if not isinstance(jobs, list) or not 1 <= len(jobs) <= 500:
            raise ValueError("1~500개 입력 파일을 선택하세요.")
        planned, used = [], set()
        for entry in jobs:
            if not isinstance(entry, dict):
                raise ValueError("잘못된 배치 항목입니다.")
            source = local_source(entry.get("path"))
            raw_output = entry.get("outputPath")
            if not isinstance(raw_output, str) or not os.path.isabs(raw_output) or "\0" in raw_output:
                raise ValueError("저장할 로컬 절대 경로를 지정하세요.")
            if raw_output.startswith(("\\\\", "//")) or (os.name == "nt" and ":" in raw_output[2:]):
                raise ValueError("네트워크/장치 경로는 지원하지 않습니다.")
            output = Path(raw_output).resolve()
            if str(output).startswith(("\\\\", "//")) or (os.name == "nt" and ":" in str(output)[2:]):
                raise ValueError("네트워크/장치 경로는 지원하지 않습니다.")
            if output.suffix.lower() not in (IMAGE_EXTS if is_image(str(source)) else VIDEO_OUTPUT_EXTS):
                raise ValueError("입력 유형에 맞는 출력 확장자를 선택하세요.")
            identity = os.path.normcase(str(output))
            if output.exists() or identity in used or output == source:
                raise FileExistsError("원본·기존 파일·같은 배치 이름을 덮어쓸 수 없습니다: " + output.name)
            used.add(identity)
            planned.append((source, output))
        detector = self._detector(cfg, job)
        processor = FrameProcessor(cfg, detector)
        outputs, total_frames = [], 0
        for index, (source, output) in enumerate(planned):
            job.check()
            output.parent.mkdir(parents=True, exist_ok=True)
            temp = output.parent / f".magicloak-{uuid.uuid4().hex}{output.suffix}"
            def progress(fraction, message, **extra):
                job.progress("render", (index + min(.99, max(0, fraction))) / len(planned) * 100,
                             message, fileIndex=index, totalFiles=len(planned), **extra)
            progress(0, f"[{index + 1}/{len(planned)}] {source.name}")
            try:
                if is_image(str(source)):
                    count = self._image(source, temp, processor, cfg, job, progress)
                else:
                    count = self._video(source, temp, processor, cfg, job, progress)
                job.check()
                # Atomic exclusive publication: hard-link fails if another app
                # creates the destination meanwhile. No existing file is replaced.
                if os.name == "nt":
                    os.rename(temp, output)  # Windows rename refuses overwrite.
                else:
                    os.link(temp, output)
                    temp.unlink()
                outputs.append(str(output))
                total_frames += count
                job.progress("file-complete", (index + 1) / len(planned) * 100,
                             f"저장 완료: {output.name}", fileIndex=index, totalFiles=len(planned),
                             outputPath=str(output), frame=count)
            finally:
                _remove_temporary(temp)
        elapsed = time.perf_counter() - started
        return dict(outputs=outputs, frames=total_frames, elapsed=elapsed,
                    fps=total_frames / elapsed if elapsed else 0)

    def _image(self, source, destination, processor, cfg, job, progress):
        bgr, alpha = image_bgr(_imread_unicode(str(source)))
        processor.reset()
        result = processor.process(bgr, temporal=False)
        job.check()
        progress(.8, f"이미지 처리 · 얼굴 {processor.last_count}명", preview=data_url(_downscale(result, 520)))
        if alpha is not None:
            result = cv2.cvtColor(result, cv2.COLOR_BGR2BGRA)
            result[:, :, 3] = alpha
        if not _imwrite_unicode(str(destination), result, _imwrite_params(cfg.quality, str(destination))):
            raise RuntimeError("이미지 저장 실패")
        return 1

    def _video(self, source, destination, processor, cfg, job, progress):
        ffmpeg = ff.find_ffmpeg()
        if not ffmpeg:
            raise RuntimeError("FFmpeg가 없습니다. 앱 설정에서 AI 엔진을 설치/복구하세요. 무음 폴백은 하지 않습니다.")
        cap = cv2.VideoCapture(str(source))
        process = None
        error_file = tempfile.TemporaryFile()
        try:
            if not cap.isOpened():
                raise ValueError("영상을 열 수 없습니다.")
            fps = float(cap.get(cv2.CAP_PROP_FPS))
            if not math.isfinite(fps) or fps <= 1e-3:
                fps = 30.0
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            ok, first = cap.read()
            if not ok:
                raise ValueError("프레임을 읽을 수 없습니다.")
            height, width = first.shape[:2]
            duration = ff.probe_duration(str(source))
            if duration is None and total > 1:
                duration = total / fps
            will_pad = bool(cfg.pad_enabled and duration is not None and duration < cfg.pad_seconds - 1e-3)
            target = int(round(cfg.pad_seconds * fps)) if will_pad else 0
            prefix_frames = 0
            if will_pad and cfg.pad_position == "before":
                # Count actual decodable frames, not a possibly inaccurate header.
                # Only short before-padded clips take this pass. Stop at the target:
                # a source already this long needs no prefix and must not be cut.
                progress(0, "앞쪽 패딩 길이를 확인합니다.")
                decoded = 1
                while decoded < target:
                    job.check()
                    if not cap.grab():
                        break
                    decoded += 1
                prefix_frames = max(0, target - decoded)
                cap.release()
                cap = cv2.VideoCapture(str(source))
                ok, first = cap.read()
                if not ok:
                    raise ValueError("패딩 길이 확인 후 원본 영상을 다시 읽을 수 없습니다.")
            estimated = max(total, target)
            command = ff.build_render_cmd(ffmpeg, width, height, fps, str(destination), cfg.quality,
                                          str(source) if ff.has_audio(str(source)) else None,
                                          cfg.pad_seconds if will_pad else None,
                                          audio_delay_seconds=prefix_frames / fps)
            # YUV420 codecs require even dimensions. Refuse rather than silently
            # resize/crop the source and alter the original algorithm's geometry.
            if cfg.quality != "lossless" and (width % 2 or height % 2):
                raise ValueError("홀수 크기 영상은 '완전 무손실(YUV444)'을 선택하거나 짝수 크기로 변환하세요.")
            process = job.track(subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                                 stderr=error_file, creationflags=CREATE_NO_WINDOW))
            processor.reset()
            index = 0
            if prefix_frames:
                black_bytes = np.zeros((height, width, 3), dtype=np.uint8).tobytes()
                progress(0, f"앞에 검은 화면 + 무음 {prefix_frames / fps:g}초를 넣습니다.")
                while index < prefix_frames:
                    job.check()
                    process.stdin.write(black_bytes)
                    index += 1
                    if index % 3 == 0:
                        progress(min(.95, index / estimated), "앞쪽 검은 화면 패딩",
                                 frame=index, totalFrames=estimated)
            frame = first
            while True:
                job.check()
                if frame.shape[:2] != (height, width):
                    frame = cv2.resize(frame, (width, height))
                result = processor.process(frame, temporal=True)
                process.stdin.write(np.ascontiguousarray(result).tobytes())
                index += 1
                if index % 3 == 0:
                    extra = {"frame": index, "totalFrames": estimated}
                    if index % 12 == 0:
                        extra["preview"] = data_url(_downscale(result, 480))
                    progress(min(.95, index / estimated) if estimated else 0,
                             f"프레임 {index}/{estimated or '?'} · 얼굴 {processor.last_count}명", **extra)
                ok, frame = cap.read()
                if not ok:
                    break
            if will_pad and cfg.pad_position == "after" and index < target:
                black = np.zeros((height, width, 3), dtype=np.uint8)
                progress(min(.95, index / target), f"검은 화면 + 무음으로 {cfg.pad_seconds:g}초까지 채웁니다.")
                while index < target:
                    job.check()
                    process.stdin.write(black.tobytes())
                    index += 1
                    if index % 3 == 0:
                        progress(min(.95, index / target), "검은 화면 패딩", frame=index, totalFrames=target)
            process.stdin.close()
            while process.poll() is None:
                job.check()
                try:
                    process.wait(timeout=.1)
                except subprocess.TimeoutExpired:
                    pass
            if process.returncode:
                raise RuntimeError(f"FFmpeg 인코딩 실패 ({process.returncode}): {_ffmpeg_error(error_file)}")
            job.check()
            if not destination.is_file() or destination.stat().st_size < 128:
                raise RuntimeError("출력 영상이 생성되지 않았습니다.")
            return index
        except (BrokenPipeError, OSError) as error:
            job.check()
            raise RuntimeError(f"FFmpeg 파이프 오류: {_ffmpeg_error(error_file)}") from error
        finally:
            cap.release()
            if process is not None:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                if process.stdin is not None and not process.stdin.closed:
                    try:
                        process.stdin.close()
                    except OSError:
                        pass  # A cancelled encoder may have already closed the pipe.
                job.untrack(process)
            error_file.close()
