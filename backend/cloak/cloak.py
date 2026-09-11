# Ported from jeboong/seedance-cloak @ 6f0e670f056c5ede87c0b0c390613ed6c499a455.
# See docs/CLOAK_PROVENANCE.md. Upstream effect claims are not effectiveness guarantees.
"""
A. Adversarial Cloak — 얼굴 검출기 교란 미세 노이즈 (black-box).

그래디언트 없이도 검출기가 의존하는 엣지/고주파 텍스처 특징을 다중 스케일
구조 노이즈로 파괴한다. 눈에는 필름 그레인처럼 거의 안 보이는 강도(eps)로,
얼굴 특징이 강한 엣지 영역을 집중 공격한다.

반환:
    out       : 교란된 ROI (uint8)
    noise_map : (H,W) float — 다음 프레임에 optical-flow 로 warp 해서
                시간 일관성(깜빡임 방지)을 유지하기 위한 노이즈 지도
"""

from __future__ import annotations

import cv2
import numpy as np


def adversarial_cloak(face_roi: np.ndarray, eps: float = 6.0,
                      noise_map: np.ndarray | None = None):
    roi = face_roi.astype(np.float32)
    h, w = roi.shape[:2]

    if noise_map is None or noise_map.shape != (h, w):
        noise = np.zeros((h, w), np.float32)
        for scale in (2, 4, 8, 16):
            sh, sw = max(1, h // scale), max(1, w // scale)
            small = np.random.randn(sh, sw).astype(np.float32)
            noise += cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
        noise /= (np.abs(noise).max() + 1e-8)

        # 검출기가 보는 엣지에 가중
        gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
        edges = np.abs(cv2.Laplacian(gray, cv2.CV_32F))
        edges /= (edges.max() + 1e-8)
        weight = 0.35 + 0.65 * edges
        noise_map = noise * weight
    # eps 스케일 적용
    nm = noise_map * eps

    out = roi + nm[..., None]

    # 채널별 미세 색 지터(임베딩 교란, 시각적으로는 거의 무해)
    if eps > 0:
        chroma = (np.random.randn(h, w, 3).astype(np.float32)) * (eps * 0.12)
        out += chroma

    out = np.clip(out, 0, 255).astype(np.uint8)
    return out, noise_map

