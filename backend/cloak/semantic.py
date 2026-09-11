# Ported from jeboong/seedance-cloak @ 6f0e670f056c5ede87c0b0c390613ed6c499a455.
# See docs/CLOAK_PROVENANCE.md. Upstream effect claims are not effectiveness guarantees.
"""
C. Semantic Evade — 검출/정렬 자체를 방해하는 미세 오버레이.

- 저강도 필름 그레인(검출 특징 희석)
- 얼굴 경계 소프트닝(박스 confidence 저하)
- 미세 국소 워프(랜드마크 기하 교란) — 서브픽셀~1px 수준이라 육안상 자연스러움
"""

from __future__ import annotations

import cv2
import numpy as np


def semantic_evade(face_roi: np.ndarray, strength: float = 0.08) -> np.ndarray:
    h, w = face_roi.shape[:2]
    if h < 8 or w < 8:
        return face_roi
    out = face_roi.astype(np.float32)

    # 1) 필름 그레인
    grain = np.random.randn(h, w, 1).astype(np.float32) * (strength * 40.0)
    out = out + grain

    # 2) 미세 국소 워프 (부드러운 랜덤 플로우)
    amp = strength * 2.2  # 최대 변위(px) 수준
    if amp > 0.05:
        fx = np.random.randn(max(2, h // 16), max(2, w // 16)).astype(np.float32)
        fy = np.random.randn(max(2, h // 16), max(2, w // 16)).astype(np.float32)
        fx = cv2.resize(fx, (w, h), interpolation=cv2.INTER_CUBIC)
        fy = cv2.resize(fy, (w, h), interpolation=cv2.INTER_CUBIC)
        fx = cv2.GaussianBlur(fx, (0, 0), 3) * amp
        fy = cv2.GaussianBlur(fy, (0, 0), 3) * amp
        gx, gy = np.meshgrid(np.arange(w, dtype=np.float32),
                             np.arange(h, dtype=np.float32))
        map_x = (gx + fx).astype(np.float32)
        map_y = (gy + fy).astype(np.float32)
        out = cv2.remap(out, map_x, map_y, cv2.INTER_LINEAR,
                        borderMode=cv2.BORDER_REFLECT)

    # 3) 경계 소프트닝
    edge = np.zeros((h, w), np.float32)
    b = max(2, int(min(h, w) * 0.06))
    edge[:b, :] = 1; edge[-b:, :] = 1
    edge[:, :b] = 1; edge[:, -b:] = 1
    edge = cv2.GaussianBlur(edge, (0, 0), b)[..., None]
    blurred = cv2.GaussianBlur(out, (0, 0), 1.2)
    out = out * (1 - edge) + blurred * edge

    return np.clip(out, 0, 255).astype(np.uint8)

