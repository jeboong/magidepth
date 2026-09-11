# Ported from jeboong/seedance-cloak @ 6f0e670f056c5ede87c0b0c390613ed6c499a455.
# See docs/CLOAK_PROVENANCE.md. Upstream effect claims are not effectiveness guarantees.
"""
경량 다중 얼굴 트래커.

- IOU 그리디 매칭으로 프레임 간 얼굴에 '안정적 ID' 부여
- 박스/랜드마크를 EMA 스무딩 → 그리드·클로킹 떨림(플리커) 제거
- 잠깐 검출을 놓쳐도(occlusion) 몇 프레임 유지(coasting)

tracking=False 로 쓰면 스무딩 없이 매 프레임 원시 검출을 그대로 통과시킨다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np

from .detector import Detection, _angle_from_landmarks


def iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    return inter / float(area_a + area_b - inter + 1e-6)


@dataclass
class Track:
    id: int
    box: np.ndarray                       # float [x1,y1,x2,y2] (스무딩됨)
    score: float = 1.0
    landmarks: Optional[np.ndarray] = None
    angle: float = 0.0
    misses: int = 0
    hits: int = 1
    age: int = 0

    def as_detection(self) -> Detection:
        b = self.box.astype(int)
        return Detection((int(b[0]), int(b[1]), int(b[2]), int(b[3])),
                         self.score, self.landmarks, self.angle)


class FaceTracker:
    def __init__(self, iou_thresh: float = 0.3, max_age: int = 8,
                 smooth: float = 0.5, min_hits: int = 1):
        self.iou_thresh = iou_thresh
        self.max_age = max_age
        self.smooth = smooth          # 새 값 가중치(작을수록 더 부드럽고 느림)
        self.min_hits = min_hits
        self._tracks: List[Track] = []
        self._next_id = 1

    def reset(self):
        self._tracks.clear()
        self._next_id = 1

    def update(self, detections: List[Detection], tracking: bool = True) -> List[Track]:
        if not tracking:
            # 스무딩/유지 없이 검출을 그대로 트랙 형태로 반환(ID는 순번)
            out = []
            for i, d in enumerate(detections):
                out.append(Track(i, np.array(d.box, np.float32), d.score,
                                 d.landmarks, d.angle, 0, 1, 0))
            return out

        for t in self._tracks:
            t.age += 1

        unmatched = set(range(len(detections)))
        # (iou, track_idx, det_idx) 내림차순 그리디 매칭
        pairs = []
        for ti, t in enumerate(self._tracks):
            for di, d in enumerate(detections):
                v = iou(t.box, d.box)
                if v >= self.iou_thresh:
                    pairs.append((v, ti, di))
        pairs.sort(reverse=True)

        used_t, used_d = set(), set()
        for v, ti, di in pairs:
            if ti in used_t or di in used_d:
                continue
            used_t.add(ti); used_d.add(di)
            unmatched.discard(di)
            self._smooth_update(self._tracks[ti], detections[di])

        # 매칭 안 된 트랙 → miss 증가
        for ti, t in enumerate(self._tracks):
            if ti not in used_t:
                t.misses += 1

        # 새 검출 → 신규 트랙
        for di in unmatched:
            d = detections[di]
            self._tracks.append(Track(
                self._next_id, np.array(d.box, np.float32), d.score,
                d.landmarks, d.angle, 0, 1, 0))
            self._next_id += 1

        # 오래 놓친 트랙 제거
        self._tracks = [t for t in self._tracks if t.misses <= self.max_age]

        return [t for t in self._tracks if t.misses == 0 and t.hits >= self.min_hits]

    def _smooth_update(self, t: Track, d: Detection):
        a = self.smooth
        nb = np.array(d.box, np.float32)
        t.box = a * nb + (1 - a) * t.box
        t.score = d.score
        t.misses = 0
        t.hits += 1
        if d.landmarks is not None:
            if t.landmarks is not None and t.landmarks.shape == d.landmarks.shape:
                t.landmarks = a * d.landmarks + (1 - a) * t.landmarks
            else:
                t.landmarks = d.landmarks.copy()
            t.angle = _angle_from_landmarks(t.landmarks)
        else:
            t.angle = d.angle

