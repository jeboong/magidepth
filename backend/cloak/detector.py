# Ported from jeboong/seedance-cloak @ 6f0e670f056c5ede87c0b0c390613ed6c499a455.
# See docs/CLOAK_PROVENANCE.md. Upstream effect claims are not effectiveness guarantees.
"""
얼굴 검출기 — 정확도/속도 우선순위:
  1) YuNet (cv2.FaceDetectorYN)  : 랜드마크(눈·코·입) 제공, 회전/측면 강함
  2) res10 SSD (OpenCV DNN)      : caffemodel 이 있을 때만
  3) Haar Cascade                : 항상 가능한 최후 폴백

큰 프레임은 검출용으로 다운스케일 후 좌표를 원본 스케일로 복원한다.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from typing import List, Optional

import cv2
import numpy as np

from .models import ensure_yunet
from .models import resource_path


@dataclass
class Detection:
    box: tuple                      # (x1, y1, x2, y2) 원본 좌표
    score: float = 1.0
    landmarks: Optional[np.ndarray] = None   # (5,2): 우안,좌안,코,우입꼬리,좌입꼬리
    angle: float = 0.0              # 눈 기준 얼굴 기울기(도)

    @property
    def wh(self):
        x1, y1, x2, y2 = self.box
        return (x2 - x1, y2 - y1)


class FaceDetector:
    def __init__(self, det_size: int = 640, score_threshold: float = 0.6,
                 progress=None, check=lambda: None):
        self.mode: str = "none"
        self.det_size = det_size
        self.score_threshold = score_threshold
        self._yunet = None
        self._net = None
        self._haar = None
        self._last_input_wh = None
        self._progress, self._check = progress, check

        if not self._init_yunet():
            if not self._init_dnn():
                self._init_haar()

    # ---------- 초기화 ----------
    def _init_yunet(self) -> bool:
        if not hasattr(cv2, "FaceDetectorYN"):
            return False
        model = ensure_yunet(self._progress, self._check)
        if not model:
            return False
        try:
            self._yunet = cv2.FaceDetectorYN.create(
                str(model), "", (self.det_size, self.det_size),
                self.score_threshold, 0.3, 5000,
            )
            self.mode = "yunet"
            return True
        except Exception:
            self._yunet = None
            return False

    def _init_dnn(self) -> bool:
        try:
            proto = resource_path("models", "deploy.prototxt")
            model = resource_path("models", "res10_300x300_ssd_iter_140000.caffemodel")
            if os.path.exists(proto) and os.path.exists(model):
                self._net = cv2.dnn.readNetFromCaffe(str(proto), str(model))
                self.mode = "dnn"
                return True
        except Exception:
            pass
        return False

    def _init_haar(self) -> bool:
        cascade = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self._haar = cv2.CascadeClassifier(cascade)
        self.mode = "haar"
        return True

    @property
    def mode_label(self) -> str:
        return {
            "yunet": "YuNet (고정밀·랜드마크)",
            "dnn": "res10 SSD (DNN)",
            "haar": "Haar Cascade (기본)",
        }.get(self.mode, self.mode)

    # ---------- 검출 ----------
    def _scale_for(self, w: int, h: int) -> float:
        m = max(w, h)
        if m <= self.det_size:
            return 1.0
        return self.det_size / float(m)

    def detect(self, frame: np.ndarray) -> List[Detection]:
        h, w = frame.shape[:2]
        s = self._scale_for(w, h)
        if s != 1.0:
            small = cv2.resize(frame, (max(1, int(w * s)), max(1, int(h * s))),
                               interpolation=cv2.INTER_AREA)
        else:
            small = frame

        if self.mode == "yunet":
            dets = self._detect_yunet(small)
        elif self.mode == "dnn":
            dets = self._detect_dnn(small)
        else:
            dets = self._detect_haar(small)

        inv = 1.0 / s
        out: List[Detection] = []
        for d in dets:
            x1, y1, x2, y2 = d.box
            x1 = int(round(x1 * inv)); y1 = int(round(y1 * inv))
            x2 = int(round(x2 * inv)); y2 = int(round(y2 * inv))
            x1 = max(0, min(w - 1, x1)); x2 = max(0, min(w, x2))
            y1 = max(0, min(h - 1, y1)); y2 = max(0, min(h, y2))
            if x2 - x1 < 6 or y2 - y1 < 6:
                continue
            lm = None
            if d.landmarks is not None:
                lm = d.landmarks * inv
            out.append(Detection((x1, y1, x2, y2), d.score, lm,
                                  _angle_from_landmarks(lm)))
        return out

    def _detect_yunet(self, img: np.ndarray) -> List[Detection]:
        h, w = img.shape[:2]
        if self._last_input_wh != (w, h):
            self._yunet.setInputSize((w, h))
            self._last_input_wh = (w, h)
        try:
            _, faces = self._yunet.detect(img)
        except Exception:
            return []
        res: List[Detection] = []
        if faces is None:
            return res
        for f in faces:
            x, y, fw, fh = f[0:4]
            score = float(f[14]) if len(f) > 14 else 1.0
            lms = np.array(f[4:14], dtype=np.float32).reshape(5, 2)
            res.append(Detection((x, y, x + fw, y + fh), score, lms))
        return res

    def _detect_dnn(self, img: np.ndarray) -> List[Detection]:
        h, w = img.shape[:2]
        blob = cv2.dnn.blobFromImage(cv2.resize(img, (300, 300)), 1.0,
                                     (300, 300), (104.0, 177.0, 123.0))
        self._net.setInput(blob)
        det = self._net.forward()
        res: List[Detection] = []
        for i in range(det.shape[2]):
            conf = float(det[0, 0, i, 2])
            if conf > self.score_threshold:
                box = det[0, 0, i, 3:7] * np.array([w, h, w, h])
                x1, y1, x2, y2 = box
                res.append(Detection((x1, y1, x2, y2), conf))
        return res

    def _detect_haar(self, img: np.ndarray) -> List[Detection]:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = self._haar.detectMultiScale(gray, 1.1, 5, minSize=(32, 32))
        return [Detection((x, y, x + fw, y + fh), 1.0) for (x, y, fw, fh) in faces]


def _angle_from_landmarks(lm: Optional[np.ndarray]) -> float:
    """우안(0)·좌안(1) 랜드마크로 얼굴 기울기(도) 추정."""
    if lm is None or len(lm) < 2:
        return 0.0
    (rx, ry), (lx, ly) = lm[0], lm[1]
    return math.degrees(math.atan2(ly - ry, lx - rx))
