"""Upstream Unicode image I/O and exact image quality mappings."""
import os
import cv2
import numpy as np

def _imread_unicode(path: str):
    """한글/유니코드 경로 안전 로드."""
    try:
        buf = np.fromfile(path, dtype=np.uint8)
        if buf.size == 0:
            return None
        return cv2.imdecode(buf, cv2.IMREAD_UNCHANGED)
    except Exception:
        return cv2.imread(path, cv2.IMREAD_UNCHANGED)


def _imwrite_unicode(path: str, img, params) -> bool:
    ext = os.path.splitext(path)[1].lower() or ".png"
    try:
        ok, buf = cv2.imencode(ext, img, params)
        if not ok:
            return False
        buf.tofile(path)
        return True
    except Exception:
        try:
            return cv2.imwrite(path, img, params)
        except Exception:
            return False


def _imwrite_params(preset: str, out_path: str) -> list[int]:
    ext = os.path.splitext(out_path)[1].lower()
    if ext in (".jpg", ".jpeg", ".webp"):
        q = {"visually_lossless": 98, "lossless": 100, "high": 95,
             "balanced": 92, "small": 82, "hevc_high": 95}.get(preset, 95)
        flag = cv2.IMWRITE_JPEG_QUALITY if ext in (".jpg", ".jpeg") \
            else cv2.IMWRITE_WEBP_QUALITY
        return [flag, q]
    if ext == ".png":
        return [cv2.IMWRITE_PNG_COMPRESSION, 3]
    return []


def _ffmpeg_error(stderr_file) -> str:
    try:
        if stderr_file is None:
            return "(로그 없음)"
        stderr_file.seek(0)
        data = stderr_file.read()
        if isinstance(data, bytes):
            data = data.decode("utf-8", "ignore")
        lines = [l for l in data.splitlines() if l.strip()
                 and not l.lstrip().startswith("frame=")
                 and "bitrate=" not in l]
        return "\n".join(lines[-6:]) or "(추가 정보 없음)"
    except Exception:
        return "(로그 읽기 실패)"


def _cleanup(cap, proc, writer, stderr_file, kill=False):
    try:
        cap.release()
    except Exception:
        pass
    if proc is not None:
        try:
            proc.kill() if kill else proc.stdin.close()
        except Exception:
            pass
    if writer is not None:
        try:
            writer.release()
        except Exception:
            pass
    if stderr_file is not None:
        try:
            stderr_file.close()
        except Exception:
            pass


def _downscale(frame, max_w):
    h, w = frame.shape[:2]
    if w <= max_w:
        return frame
    s = max_w / float(w)
    return cv2.resize(frame, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
