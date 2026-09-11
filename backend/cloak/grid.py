# Ported from jeboong/seedance-cloak @ 6f0e670f056c5ede87c0b0c390613ed6c499a455.
# See docs/CLOAK_PROVENANCE.md. Upstream effect claims are not effectiveness guarantees.
"""
D. Face Grid Overlay — 얼굴 자동 인식 후 크기·위치에 맞춰 격자(그리드)를 씌운다.

상세 파라미터:
    rows, cols   : 격자 칸 수(가로/세로)
    thickness    : 선 두께(px). auto_thickness 시 얼굴 크기에 비례
    color        : 선 색 (B, G, R)
    opacity      : 0.0~1.0 (투명도)
    margin       : 얼굴 박스 대비 확장 비율(0.0~)
    shape        : 'rect' | 'ellipse'  (타원이면 얼굴형으로 클리핑)
    align_angle  : 얼굴 기울기에 맞춰 격자 회전
    dots         : 교차점에 점 표시
    dot_radius   : 점 반지름(px)
    line_aa      : 안티에일리어싱

트래킹 on/off 는 파이프라인의 트래커가 담당(격자 위치 안정화).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class GridParams:
    rows: int = 6
    cols: int = 6
    thickness: int = 2
    auto_thickness: bool = True
    color: tuple = (255, 255, 255)    # BGR (흰색 기본, 사용자 변경 가능)
    opacity: float = 0.6
    margin: float = 0.06
    shape: str = "ellipse"            # 'rect' | 'ellipse'
    align_angle: bool = True
    dots: bool = False
    dot_radius: int = 3
    line_aa: bool = True


def _expand(box, margin: float, H: int, W: int):
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    mx, my = int(round(w * margin)), int(round(h * margin))
    return (max(0, x1 - mx), max(0, y1 - my),
            min(W, x2 + mx), min(H, y2 + my))


def draw_face_grid(frame: np.ndarray, box, p: GridParams, angle: float = 0.0) -> None:
    """frame 에 얼굴 격자를 in-place 합성."""
    H, W = frame.shape[:2]
    x1, y1, x2, y2 = _expand(box, p.margin, H, W)
    w, h = x2 - x1, y2 - y1
    if w < 6 or h < 6:
        return

    region = frame[y1:y2, x1:x2]
    mask = np.zeros((h, w), np.float32)

    if p.auto_thickness:
        th = max(1, int(round(min(w, h) / 140.0 * p.thickness)))
    else:
        th = max(1, int(round(p.thickness)))
    line_type = cv2.LINE_AA if p.line_aa else cv2.LINE_8

    theta = math.radians(angle if p.align_angle else 0.0)
    cx, cy = w / 2.0, h / 2.0
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    ext = int(math.hypot(w, h))  # 회전 시 영역을 덮도록 선을 연장

    def rot(px, py):
        dx, dy = px - cx, py - cy
        return (int(round(cx + dx * cos_t - dy * sin_t)),
                int(round(cy + dx * sin_t + dy * cos_t)))

    cols = max(1, int(p.cols))
    rows = max(1, int(p.rows))

    for i in range(cols + 1):
        fx = w * i / cols
        cv2.line(mask, rot(fx, -ext), rot(fx, h + ext), 1.0, th, line_type)
    for j in range(rows + 1):
        fy = h * j / rows
        cv2.line(mask, rot(-ext, fy), rot(w + ext, fy), 1.0, th, line_type)

    if p.dots:
        r = max(1, int(p.dot_radius))
        for i in range(cols + 1):
            for j in range(rows + 1):
                cv2.circle(mask, rot(w * i / cols, h * j / rows), r, 1.0, -1,
                           line_type)

    if p.shape == "ellipse":
        em = np.zeros((h, w), np.float32)
        cv2.ellipse(em, (int(cx), int(cy)),
                    (max(1, int(w * 0.5)), max(1, int(h * 0.5))),
                    math.degrees(theta), 0, 360, 1.0, -1)
        mask *= em

    m = (mask * float(np.clip(p.opacity, 0.0, 1.0)))[..., None]
    color = np.array(p.color, np.float32).reshape(1, 1, 3)
    frame[y1:y2, x1:x2] = np.clip(
        region.astype(np.float32) * (1 - m) + color * m, 0, 255).astype(np.uint8)

