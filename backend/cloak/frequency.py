# Ported from jeboong/seedance-cloak @ 6f0e670f056c5ede87c0b0c390613ed6c499a455.
# See docs/CLOAK_PROVENANCE.md. Upstream effect claims are not effectiveness guarantees.
"""
B. Frequency Perturb — DCT 중·고주파 교란으로 얼굴 임베딩(매칭) 이동.

원본 대비 개선점:
- RGB 대신 YCrCb 로 작업 → 밝기(Y)는 강하게, 색(Cr/Cb)은 약하게 교란해
  색 변형/블록 아티팩트를 최소화하면서 매칭 회피 효과는 유지.
- 저주파(시각 구조) 보존, 작은 ROI 안전 가드.
"""

from __future__ import annotations

import cv2
import numpy as np


def _perturb_channel(ch: np.ndarray, strength: float, keep_ratio: float) -> np.ndarray:
    h, w = ch.shape
    hh, ww = h - (h % 2), w - (w % 2)
    if hh < 8 or ww < 8:
        return ch
    block = ch[:hh, :ww].copy()
    dct = cv2.dct(block)
    dh, dw = dct.shape
    mask = np.zeros_like(dct)
    ky, kx = int(dh * keep_ratio), int(dw * keep_ratio)
    mask[ky:, kx:] = 1.0                      # 저주파(좌상단) 보존
    noise = np.random.randn(dh, dw).astype(np.float32)
    dct += noise * strength * mask * (dct.std() + 1e-6)
    ch[:hh, :ww] = cv2.idct(dct)
    return ch


def freq_perturb(face_roi: np.ndarray, strength: float = 0.05) -> np.ndarray:
    if face_roi.shape[0] < 8 or face_roi.shape[1] < 8:
        return face_roi
    ycc = cv2.cvtColor(face_roi, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    ycc[..., 0] = _perturb_channel(ycc[..., 0], strength, 0.25)
    ycc[..., 1] = _perturb_channel(ycc[..., 1], strength * 0.3, 0.30)
    ycc[..., 2] = _perturb_channel(ycc[..., 2], strength * 0.3, 0.30)
    out = cv2.cvtColor(np.clip(ycc, 0, 255).astype(np.uint8), cv2.COLOR_YCrCb2BGR)
    return out

