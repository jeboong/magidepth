# Ported core, unchanged pixel processing. See docs/CLOAK_PROVENANCE.md.
"""
원본의 프레임 처리 코어를 UI와 분리한 포트.

FrameProcessor: 검출→트래킹→엔진 A/B/C→그리드. 픽셀 수학과 순서는 보존.
미디어 I/O, 배치, 오디오, 패딩과 취소는 cloak.engine에서 처리한다.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from dataclasses import dataclass, field

import cv2
import numpy as np


from . import ffmpeg_utils as ff
from .cloak import adversarial_cloak
from .common import blend_into, feather_mask
from .detector import FaceDetector
from .frequency import freq_perturb
from .grid import GridParams, draw_face_grid
from .semantic import semantic_evade
from .tracker import FaceTracker

_CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".wmv", ".flv"}


def is_image(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in IMAGE_EXTS


def is_video(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in VIDEO_EXTS


@dataclass
class RenderConfig:
    methods: dict = field(default_factory=lambda: {"A": True, "B": False, "C": False})
    eps: float = 6.0
    strength: float = 0.05
    use_grid: bool = False
    grid: GridParams = field(default_factory=GridParams)
    tracking: bool = True
    quality: str = ff.DEFAULT_PRESET
    pad_enabled: bool = False
    pad_seconds: float = 4.0
    pad_position: str = "after"
    roi_shape: str = "ellipse"
    detect_score: float = 0.6
    # 수동 그리드(트래킹 OFF + 그리드 ON): 정규화 중심/크기 (0~1)
    man_cx: float = 0.5
    man_cy: float = 0.5
    man_w: float = 0.35
    man_h: float = 0.45


# ============================================================
#  프레임 처리 코어
# ============================================================
class FrameProcessor:
    def __init__(self, cfg: RenderConfig, detector: FaceDetector):
        self.cfg = cfg
        self.detector = detector
        self.tracker = FaceTracker(smooth=0.5, max_age=8)
        self.prev_gray = None
        self.prev_noise: dict[int, np.ndarray] = {}
        self.last_count = 0

    def reset(self):
        self.tracker.reset()
        self.prev_gray = None
        self.prev_noise.clear()

    def process(self, frame: np.ndarray, temporal: bool = True) -> np.ndarray:
        cfg = self.cfg
        H, W = frame.shape[:2]
        auto_grid = cfg.use_grid and cfg.tracking          # 얼굴 추적 그리드
        manual_grid = cfg.use_grid and not cfg.tracking     # 수동 고정 그리드
        any_engine = any(cfg.methods.values())
        need_detect = any_engine or auto_grid

        if need_detect:
            dets = self.detector.detect(frame)
            tracks = self.tracker.update(dets, tracking=cfg.tracking)
            self.last_count = len(tracks)

            cur_gray = None
            use_flow = temporal and cfg.tracking and cfg.methods.get("A")
            if use_flow:
                cur_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            for t in tracks:
                x1, y1, x2, y2 = [int(v) for v in t.box]
                x1 = max(0, min(W - 1, x1)); y1 = max(0, min(H - 1, y1))
                x2 = max(x1 + 1, min(W, x2)); y2 = max(y1 + 1, min(H, y2))
                if x2 - x1 < 8 or y2 - y1 < 8:
                    continue
                box = (x1, y1, x2, y2)
                roi = frame[y1:y2, x1:x2].copy()
                changed = False

                if cfg.methods.get("A"):
                    base_noise = None
                    pn = self.prev_noise.get(t.id) if cfg.tracking else None
                    if (use_flow and pn is not None and pn.shape == roi.shape[:2]
                            and self.prev_gray is not None
                            and self.prev_gray.shape == cur_gray.shape):
                        try:
                            flow = cv2.calcOpticalFlowFarneback(
                                self.prev_gray[y1:y2, x1:x2], cur_gray[y1:y2, x1:x2],
                                None, 0.5, 3, 15, 3, 5, 1.2, 0)
                            rh, rw = roi.shape[:2]
                            gx, gy = np.meshgrid(np.arange(rw, dtype=np.float32),
                                                 np.arange(rh, dtype=np.float32))
                            mx = (gx + flow[..., 0]).astype(np.float32)
                            my = (gy + flow[..., 1]).astype(np.float32)
                            base_noise = cv2.remap(pn, mx, my, cv2.INTER_LINEAR)
                        except Exception:
                            base_noise = None
                    mod, noise = adversarial_cloak(roi, cfg.eps, base_noise)
                    if cfg.tracking:
                        self.prev_noise[t.id] = noise
                    roi = mod
                    changed = True

                if cfg.methods.get("B"):
                    roi = freq_perturb(roi, cfg.strength)
                    changed = True
                if cfg.methods.get("C"):
                    roi = semantic_evade(roi, cfg.strength)
                    changed = True

                if changed:
                    mask = feather_mask(y2 - y1, x2 - x1, cfg.roi_shape, 0.18)
                    blend_into(frame, roi, box, mask)

                if auto_grid:
                    draw_face_grid(frame, box, cfg.grid, t.angle)

            if use_flow:
                self.prev_gray = cur_gray
        else:
            self.last_count = 0

        # 수동 그리드: 사용자가 지정한 위치·크기에 항상 표시(검출 무관)
        if manual_grid:
            bw = max(6.0, cfg.man_w * W)
            bh = max(6.0, cfg.man_h * H)
            cx = cfg.man_cx * W
            cy = cfg.man_cy * H
            box = (int(cx - bw / 2), int(cy - bh / 2),
                   int(cx + bw / 2), int(cy + bh / 2))
            draw_face_grid(frame, box, cfg.grid, 0.0)

        return frame
