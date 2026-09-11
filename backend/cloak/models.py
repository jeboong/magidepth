"""Pinned YuNet download; local model paths compatible with MagiMagic runtime."""
from __future__ import annotations

import hashlib
import os
import urllib.request
from pathlib import Path

YUNET_NAME = "face_detection_yunet_2023mar.onnx"
YUNET_REVISION = "47534e27c9851bb1128ccc0102f1145e27f23f98"
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
YUNET_URL = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{YUNET_REVISION}/models/face_detection_yunet/{YUNET_NAME}"


def cache_dir() -> Path:
    configured = os.environ.get("DEPTHDESK_MODELS_DIR")
    base = Path(configured) if configured else Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "MagiMagic" / "models"
    return base / "cloak"


def resource_path(*parts: str) -> Path:
    # Optional legacy res10 files can be provided explicitly in this local
    # model directory. No Caffe model or unverified executable is downloaded.
    return cache_dir().joinpath(*parts[1:] if parts and parts[0] == "models" else parts)


def _valid(path: Path) -> bool:
    try:
        return path.stat().st_size == 232589 and hashlib.sha256(path.read_bytes()).hexdigest() == YUNET_SHA256
    except OSError:
        return False


def find_yunet() -> Path | None:
    candidates = [cache_dir() / YUNET_NAME]
    for root in (os.environ.get("LOCALAPPDATA"), os.environ.get("APPDATA")):
        if root:
            candidates.append(Path(root) / "SeedanceCloak" / "models" / YUNET_NAME)
    return next((path for path in candidates if _valid(path)), None)


def ensure_yunet(progress=None, check=lambda: None) -> Path | None:
    found = find_yunet()
    if found:
        return found
    if os.environ.get("MAGICLOAK_OFFLINE") == "1":
        return None
    destination = cache_dir() / YUNET_NAME
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(".onnx.part")
    try:
        check()
        if progress:
            progress("YuNet 얼굴 검출 모델 다운로드 (MIT, 233 KB)", 0)
        request = urllib.request.Request(YUNET_URL, headers={"User-Agent": "MagiMagic-MagiCloak/0.2"})
        with urllib.request.urlopen(request, timeout=30) as response, partial.open("wb") as output:
            total = 0
            while chunk := response.read(65536):
                check()
                total += len(chunk)
                if total > 232589:
                    raise ValueError("Unexpected YuNet download size")
                output.write(chunk)
                if progress:
                    progress("YuNet 다운로드 · SHA-256 검증 전", total / 232589)
        check()
        if not _valid(partial):
            raise ValueError("YuNet SHA-256 verification failed")
        partial.replace(destination)
        return destination
    except (OSError, ValueError):
        # Upstream detector behavior: explicit res10/Haar fallback remains
        # available if offline or a verified YuNet model cannot be obtained.
        return None
    finally:
        partial.unlink(missing_ok=True)
