"""Opt-in local Cloak parity timing / media smoke. Not run by unittest discovery.

Usage: python backend/tests/test_cloak_smoke.py --output IGNORED_DIRECTORY
Requires the optional .test-upstream-cloak checkout for the timing comparison.
"""
import argparse
import json
from pathlib import Path
import statistics
import subprocess
import sys
import time
import types
from unittest.mock import patch

import cv2
import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from cloak.processor import FrameProcessor, RenderConfig
from cloak.engine import CloakEngine, probe
from cloak.detector import Detection, FaceDetector
from cloak import ffmpeg_utils as ff
from engine import Job


class DetectorFixture:
    mode_label = "deterministic box fixture (not detector timing)"
    def detect(self, frame):
        h, w = frame.shape[:2]
        return [Detection((w // 3, h // 4, 2 * w // 3, 3 * h // 4), .9)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    rng = np.random.RandomState(127)
    frame = rng.randint(0, 256, (540, 960, 3), dtype=np.uint8)
    options = dict(methods={"A": True, "B": True, "C": True}, use_grid=True, tracking=True)
    source = (BACKEND.parent / ".test-upstream-cloak/app/engines/pipeline.py").read_text(encoding="utf-8")
    source = source[:source.index("#  배치 워커")].replace("from PySide6.QtCore import QThread, Signal", "")
    source = source.replace("from app.engines import ffmpeg_utils as ff", "from cloak import ffmpeg_utils as ff").replace("from app.engines.", "from cloak.")
    reference = types.ModuleType("cloak_reference_timing")
    sys.modules[reference.__name__] = reference
    exec(compile(source, "upstream-pipeline", "exec"), reference.__dict__)
    timings = {"upstream": [], "port": []}
    for repeat in range(9):
        order = ["upstream", "port"] if repeat % 2 == 0 else ["port", "upstream"]
        for name in order:
            processor = (reference.FrameProcessor(reference.RenderConfig(**options), DetectorFixture()) if name == "upstream"
                         else FrameProcessor(RenderConfig(**options), DetectorFixture()))
            np.random.seed(42)
            start = time.perf_counter()
            for _ in range(20):
                result = processor.process(frame.copy())
            elapsed = time.perf_counter() - start
            if repeat:
                timings[name].append(elapsed / 20)
    medians = {key: statistics.median(value) for key, value in timings.items()}
    summary = {"opencv": cv2.__version__, "numpy": np.__version__, "frame": [960, 540],
               "conditions": "CPU deterministic face box, all ABC+grid, temporal20-frame runs; first pair warmup excluded; no decode/encode/UI/detection",
               "samplesSecondsPerFrame": timings, "medianSecondsPerFrame": medians,
               "portVsUpstreamRatio": medians["port"] / medians["upstream"]}
    cv2.imencode(".png", result)[1].tofile(output / "frame-all-effects.png")
    detector = FaceDetector()
    start = time.perf_counter()
    detections = detector.detect(frame)
    summary["realDetector"] = {"mode": detector.mode_label, "seconds": time.perf_counter() - start,
                               "faces": len(detections), "fixture": "random synthetic frame, no expected faces"}
    video = output / "source-audio.mp4"
    subprocess.run([ff.find_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "testsrc2=size=320x180:rate=24:duration=0.5", "-f", "lavfi", "-i",
                    "sine=frequency=440:sample_rate=48000:duration=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", str(video)], check=True, capture_output=True, creationflags=ff._CREATE_NO_WINDOW)
    engine = CloakEngine()
    summary["codecs"] = []
    for quality in ff.QUALITY_PRESETS:
        target = output / ("output-" + quality + ".mp4")
        events = []
        result = engine.render({"jobs": [{"path": str(video), "outputPath": str(target)}],
                                "options": {"tracking": False, "quality": quality,
                                            "pad_enabled": True, "pad_seconds": 1}}, Job(quality, events.append))
        info = probe(str(target), thumbnail=False)
        assert info["frames"] == 24 and info["hasAudio"] and result["frames"] == 24
        summary["codecs"].append({"quality": quality, "seconds": result["elapsed"],
                                  "frames": info["frames"], "duration": info["duration"], "hasAudio": info["hasAudio"]})
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
