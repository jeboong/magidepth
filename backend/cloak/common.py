# Ported from jeboong/seedance-cloak @ 6f0e670f056c5ede87c0b0c390613ed6c499a455.
# See docs/CLOAK_PROVENANCE.md. Upstream effect claims are not effectiveness guarantees.
"""엔진 공통 유틸 — 페더 마스크 & ROI 블렌딩(경계 이음새/플리커 방지)."""

from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np


@lru_cache(maxsize=256)
def _feather_mask(h: int, w: int, mode: str, feather_i: int) -> np.ndarray:
    m = np.zeros((h, w), np.float32)
    if mode == "ellipse":
        cv2.ellipse(m, (w // 2, h // 2),
                    (max(1, int(w * 0.48)), max(1, int(h * 0.48))),
                    0, 0, 360, 1.0, -1)
    else:  # rect
        pad = max(1, int(min(h, w) * 0.04))
        m[pad:h - pad, pad:w - pad] = 1.0
    k = feather_i
    if k >= 1:
        k = k * 2 + 1
        m = cv2.GaussianBlur(m, (k, k), 0)
    return m


def feather_mask(h: int, w: int, mode: str = "ellipse",
                 feather: float = 0.18) -> np.ndarray:
    feather_i = max(1, int(min(h, w) * feather * 0.5))
    return _feather_mask(int(h), int(w), mode, feather_i)


def blend_into(frame: np.ndarray, modified: np.ndarray, box, mask: np.ndarray) -> None:
    """frame[box] 에 modified 를 mask(0~1) 가중으로 합성(in-place)."""
    x1, y1, x2, y2 = box
    dst = frame[y1:y2, x1:x2]
    if dst.shape[:2] != modified.shape[:2]:
        modified = cv2.resize(modified, (dst.shape[1], dst.shape[0]))
    if mask.shape[:2] != dst.shape[:2]:
        mask = cv2.resize(mask, (dst.shape[1], dst.shape[0]))
    m = mask[..., None]
    frame[y1:y2, x1:x2] = np.clip(
        dst.astype(np.float32) * (1 - m) + modified.astype(np.float32) * m,
        0, 255).astype(np.uint8)

