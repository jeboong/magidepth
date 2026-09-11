"""Upstream codec options, using the application's verified external FFmpeg.
No PySide6 or independent FFmpeg updater/downloader is used here."""
from __future__ import annotations
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Optional

_CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

def _find(name: str) -> Optional[str]:
    supplied = os.environ.get(name.upper() + "_PATH")
    candidate = supplied or shutil.which(name)
    return candidate if candidate and os.path.isfile(candidate) else None

def find_ffmpeg():
    return _find("ffmpeg")

def find_ffprobe():
    return _find("ffprobe")

def ensure_ffmpeg(progress=None):
    return find_ffmpeg()

def _run(command):
    return subprocess.run(command, capture_output=True, text=True, timeout=45,
                          creationflags=_CREATE_NO_WINDOW)

def ffmpeg_version(path=None):
    executable = path or find_ffmpeg()
    if not executable:
        return "unavailable"
    try:
        result = _run([executable, "-version"])
        match = re.search(r"ffmpeg version (\S+)", result.stdout)
        return match.group(1) if match else "unknown"
    except Exception:
        return "unknown"

def has_audio(video):
    executable = find_ffprobe()
    if not executable:
        return True
    try:
        result = _run([executable, "-v", "error", "-select_streams", "a",
                       "-show_entries", "stream=index", "-of", "csv=p=0", video])
        return bool(result.stdout.strip())
    except Exception:
        return True

def probe_duration(video):
    executable = find_ffprobe()
    if not executable:
        return None
    try:
        result = _run([executable, "-v", "error", "-show_entries",
                       "format=duration", "-of", "csv=p=0", video])
        return float(result.stdout.strip())
    except Exception:
        return None

@dataclass(frozen=True)
class QualityPreset:
    key: str
    label: str
    desc: str
    args: tuple = field(default_factory=tuple)


QUALITY_PRESETS: dict[str, QualityPreset] = {
    "visually_lossless": QualityPreset(
        "visually_lossless", "원본 품질 유지 (권장)",
        "육안상 무손실. H.264 CRF14 · slow",
        ("-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p"),
    ),
    "high": QualityPreset(
        "high", "고품질",
        "H.264 CRF18 · medium. 품질/용량 균형 상급",
        ("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"),
    ),
    "balanced": QualityPreset(
        "balanced", "표준",
        "H.264 CRF20 · fast. 빠른 인코딩",
        ("-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p"),
    ),
    "small": QualityPreset(
        "small", "저용량 (저화질)",
        "H.264 CRF28 · veryfast. 파일 작게",
        ("-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p"),
    ),
    "lossless": QualityPreset(
        "lossless", "완전 무손실 (용량 매우 큼)",
        "H.264 QP0 · yuv444p. 검증/보관용",
        ("-c:v", "libx264", "-preset", "medium", "-qp", "0", "-pix_fmt", "yuv444p"),
    ),
    "hevc_high": QualityPreset(
        "hevc_high", "HEVC 고품질 (H.265)",
        "H.265 CRF20 · medium. 같은 품질에 용량↓ (호환성 주의)",
        ("-c:v", "libx265", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
         "-tag:v", "hvc1"),
    ),
}

DEFAULT_PRESET = "visually_lossless"


def build_render_cmd(
    ffmpeg: str,
    width: int,
    height: int,
    fps: float,
    out_path: str,
    preset_key: str = DEFAULT_PRESET,
    audio_src: Optional[str] = None,
    pad_to_seconds: Optional[float] = None,
    simple: bool = False,
    audio_delay_seconds: float = 0.0,
) -> list[str]:
    """
    stdin(rawvideo bgr24) 을 읽어 인코딩하는 ffmpeg 명령을 구성.

    audio_src   : 오디오를 가져올 원본(있을 때만). None 이면 무음 출력.
    pad_to_seconds: 검은화면 패딩으로 최소 길이 보장 시, 오디오도 무음 패딩.
    simple      : 실패 후 재시도용(부가 옵션 제거).
    audio_delay_seconds: 앞쪽 검은 프레임 수/FPS만큼 모든 채널을 무음 지연.
    """
    preset = QUALITY_PRESETS.get(preset_key, QUALITY_PRESETS[DEFAULT_PRESET])

    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    cmd += ["-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", f"{width}x{height}", "-r", f"{fps:.6f}", "-i", "-"]

    use_audio = bool(audio_src)
    if use_audio:
        cmd += ["-i", audio_src]

    cmd += ["-map", "0:v:0"]
    if use_audio:
        cmd += ["-map", "1:a:0?"]

    video_args = list(preset.args)
    if (width % 2 or height % 2) and "-pix_fmt" in video_args:
        # YUV420 cannot represent odd source dimensions. Preserve geometry and
        # CRF/preset by using YUV444 rather than cropping, resizing or failing.
        video_args[video_args.index("-pix_fmt") + 1] = "yuv444p"
    cmd += video_args

    if use_audio:
        # 오디오 길이가 영상과 달라도(예: 슬로우모션은 영상만 늘어남) 항상
        # 무음 패딩(apad) 후 영상 길이에 맞춤(-shortest).
        # → 출력 길이 = 우리가 보낸 프레임 수. (-shortest 단독은 짧은 오디오에
        #   맞춰 영상을 잘라버려 렌더가 조기 종료되는 문제가 있었음)
        audio_filter = "apad"
        if audio_delay_seconds > 0:
            # Fractional milliseconds preserve the frame-rounded prefix duration;
            # all=1 delays every channel, not only the first stereo channel.
            audio_filter = f"asetpts=PTS-STARTPTS,adelay={audio_delay_seconds * 1000:.9f}:all=1,apad"
        cmd += ["-c:a", "aac", "-b:a", "192k", "-af", audio_filter, "-shortest"]

    ext = os.path.splitext(out_path)[1].lower()
    if not simple and ext in (".mp4", ".mov", ".m4v"):
        cmd += ["-movflags", "+faststart"]

    cmd += [out_path]
    return cmd
