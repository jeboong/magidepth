"""Cloak contract, algorithm and synthetic media tests; no GPU/network needed."""
import base64
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

import cv2
import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from engine import Job, Cancelled
from cloak.cloak import adversarial_cloak
from cloak.frequency import freq_perturb
from cloak.semantic import semantic_evade
from cloak.grid import GridParams, draw_face_grid
from cloak.common import feather_mask, blend_into
from cloak.detector import Detection
from cloak.tracker import FaceTracker
from cloak.processor import FrameProcessor, RenderConfig
from cloak.options import defaults, validate_options
from cloak.engine import CloakEngine, probe, data_url, _remove_temporary
from cloak import ffmpeg_utils as ff


class FakeDetector:
    mode_label = "fixture detector"
    def detect(self, frame):
        height, width = frame.shape[:2]
        return [Detection((width // 4, height // 4, 3 * width // 4, 3 * height // 4), .95)]


def synthetic(height=96, width=128):
    y, x = np.mgrid[:height, :width]
    return np.stack(((x * 3 + y) % 256, (y * 5) % 256, (x + y * 2) % 256), axis=2).astype(np.uint8)


class CloakTests(unittest.TestCase):
    def test_defaults_match_actual_upstream_ui(self):
        config = validate_options({})
        self.assertEqual(config.methods, {"A": False, "B": False, "C": False})
        self.assertTrue(config.use_grid)
        self.assertEqual(config.grid.color, (255, 255, 255))
        self.assertEqual(config.quality, "visually_lossless")
        self.assertEqual(config.pad_position, "after")
        self.assertEqual(validate_options({"pad_position": "before"}).pad_position, "before")

    def test_invalid_options_rejected(self):
        for value in ({"bogus": 1}, {"eps": float("nan")}, {"methods": {"A": True}},
                      {"tracking": "yes"}, {"grid": {"rows": 0}}, {"grid": {"color": [1, 2, 999]}},
                      {"quality": "shell-argument"}, {"grid": {"thickness": 2.2}},
                      {"pad_position": "both"}, {"pad_position": None}, {"pad_position": 0}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_options(value)

    def test_algorithms_preserve_geometry_and_uint8(self):
        frame = synthetic()
        for fn in (lambda f: adversarial_cloak(f)[0], freq_perturb, semantic_evade):
            result = fn(frame.copy())
            self.assertEqual(result.shape, frame.shape)
            self.assertEqual(result.dtype, np.uint8)
            self.assertGreater(np.abs(result.astype(float) - frame).sum(), 0)

    def test_tracker_exact_ema_and_no_coasting_output(self):
        tracker = FaceTracker()
        first = tracker.update([Detection((10, 10, 40, 40))])[0]
        second = tracker.update([Detection((14, 12, 44, 42))])[0]
        self.assertEqual(first.id, second.id)
        np.testing.assert_array_equal(second.box, [12, 11, 42, 41])
        self.assertEqual(tracker.update([]), [])

    def test_manual_grid_does_not_require_detection(self):
        config = validate_options({"tracking": False})
        detector = FakeDetector()
        with patch.object(detector, "detect", side_effect=AssertionError("must not detect")):
            processor = FrameProcessor(config, detector)
            source = synthetic()
            result = processor.process(source.copy())
        self.assertFalse(np.array_equal(result, source))
        self.assertEqual(processor.last_count, 0)

    def test_manual_engine_does_not_download_detector(self):
        config = validate_options({"tracking": False})
        with patch("cloak.engine.FaceDetector", side_effect=AssertionError("unnecessary model download")):
            detector = CloakEngine()._detector(config, Job("manual"))
        self.assertEqual(detector.detect(synthetic()), [])

    def test_roi_feather_leaves_distant_background_unchanged(self):
        config = validate_options({"methods": {"A": True, "B": True, "C": True}, "use_grid": False})
        source = synthetic()
        result = FrameProcessor(config, FakeDetector()).process(source.copy(), temporal=False)
        np.testing.assert_array_equal(result[:20], source[:20])
        self.assertFalse(np.array_equal(result, source))

    def test_quality_and_audio_mapping(self):
        expected = {"visually_lossless": ("14", "slow"), "high": ("18", "medium"),
                    "balanced": ("20", "fast"), "small": ("28", "veryfast"), "hevc_high": ("20", "medium")}
        for key, (crf, speed) in expected.items():
            args = ff.build_render_cmd("ffmpeg", 128, 96, 30, "out.mp4", key, "in.mp4", 4)
            self.assertEqual(args[args.index("-crf") + 1], crf)
            self.assertEqual(args[args.index("-preset") + 1], speed)
            self.assertEqual(args[args.index("-af") + 1], "apad")
            self.assertIn("-shortest", args)
        args = ff.build_render_cmd("ffmpeg", 128, 96, 30, "out.mp4", "lossless")
        self.assertIn("yuv444p", args)
        self.assertEqual(args[args.index("-qp") + 1], "0")

    def test_prefix_audio_filter_delays_all_channels_only_when_needed(self):
        args = ff.build_render_cmd("ffmpeg", 128, 96, 30, "out.mp4", audio_src="in.mp4",
                                   audio_delay_seconds=.6006)
        self.assertEqual(args[args.index("-af") + 1],
                         "asetpts=PTS-STARTPTS,adelay=600.600000000:all=1,apad")
        args = ff.build_render_cmd("ffmpeg", 128, 96, 30, "out.mp4", audio_delay_seconds=.5)
        self.assertNotIn("-af", args)

    def test_png_alpha_and_atomic_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, output = root / "입력.png", root / "결과.png"
            rgba = cv2.cvtColor(synthetic(), cv2.COLOR_BGR2BGRA)
            rgba[..., 3] = np.arange(rgba.shape[1], dtype=np.uint8)
            cv2.imencode(".png", rgba)[1].tofile(source)
            events = []
            engine = CloakEngine()
            with patch.object(engine, "_detector", return_value=FakeDetector()):
                result = engine.render({"jobs": [{"path": str(source), "outputPath": str(output)}],
                                        "options": {"tracking": False}}, Job("image", events.append))
                with self.assertRaises(FileExistsError):
                    engine.render({"jobs": [{"path": str(source), "outputPath": str(output)}], "options": {}}, Job("collision"))
            decoded = cv2.imdecode(np.fromfile(output, np.uint8), cv2.IMREAD_UNCHANGED)
            np.testing.assert_array_equal(decoded[..., 3], rgba[..., 3])
            self.assertEqual(result["frames"], 1)
            self.assertEqual(result["outputs"], [str(output)])
            self.assertTrue(any(e.get("outputPath") == str(output) for e in events))
            self.assertFalse(list(root.glob(".magicloak-*")))

    def test_preview_and_probe_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "sample.png"
            cv2.imencode(".png", synthetic())[1].tofile(path)
            info = probe(str(path))
            self.assertTrue(info["thumbnail"].startswith("data:image/png;base64,"))
            engine = CloakEngine()
            with patch.object(engine, "_detector", return_value=FakeDetector()):
                result = engine.preview({"path": str(path), "time": 0, "options": {}}, Job("preview"))
            self.assertEqual(result["frame"], 0)
            self.assertEqual(result["faceCount"], 1)
            for key in ("source", "image"):
                decoded = cv2.imdecode(np.frombuffer(base64.b64decode(result[key].split(",", 1)[1]), np.uint8), 1)
                self.assertEqual(decoded.shape, synthetic().shape)

    def test_jpeg_webp_presets_export(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "input.png"
            cv2.imencode(".png", synthetic())[1].tofile(source)
            engine = CloakEngine()
            for extension in (".jpg", ".webp"):
                output = Path(folder) / ("output" + extension)
                engine.render({"jobs": [{"path": str(source), "outputPath": str(output)}],
                               "options": {"tracking": False, "quality": "high"}}, Job(extension))
                decoded = cv2.imdecode(np.fromfile(output, np.uint8), 1)
                self.assertEqual(decoded.shape, synthetic().shape)

    def test_cancel_preserves_input_and_no_output(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "in.png", Path(folder) / "out.png"
            cv2.imencode(".png", synthetic())[1].tofile(source)
            before = source.read_bytes()
            job = Job("cancel"); job.cancel()
            engine = CloakEngine()
            with patch.object(engine, "_detector", return_value=FakeDetector()), self.assertRaises(Cancelled):
                engine.render({"jobs": [{"path": str(source), "outputPath": str(output)}], "options": {}}, job)
            self.assertEqual(source.read_bytes(), before)
            self.assertFalse(output.exists())
        with patch.object(Path, "unlink", side_effect=[PermissionError("Windows temporary lock"), None]) as unlink, \
                patch("cloak.engine.time.sleep") as sleep:
            _remove_temporary(Path("job-owned-temp.mp4"))
            self.assertEqual(unlink.call_count, 2)
            sleep.assert_called_once_with(.025)


class UpstreamPixelParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = BACKEND.parent / ".test-upstream-cloak" / "app" / "engines"
        if not cls.upstream.is_dir():
            raise unittest.SkipTest("Optional upstream checkout unavailable; contract/regression tests still run")

    def reference(self, name):
        path = self.upstream / (name + ".py")
        source = path.read_text(encoding="utf-8")
        if name == "pipeline":
            source = source[:source.index("#  배치 워커")]
            source = source.replace("from PySide6.QtCore import QThread, Signal", "")
        source = source.replace("from app.engines import ffmpeg_utils as ff", "from cloak import ffmpeg_utils as ff")
        source = source.replace("from app.engines.", "from cloak.")
        source = source.replace("from app.paths import resource_path", "from cloak.models import resource_path")
        module = types.ModuleType("_cloak_reference_" + name)
        with patch.dict(sys.modules, {module.__name__: module}):
            exec(compile(source, str(path), "exec"), module.__dict__)
        return module

    def test_abc_exact_pixels_and_noise(self):
        for name, function in (("cloak", "adversarial_cloak"), ("frequency", "freq_perturb"), ("semantic", "semantic_evade")):
            reference = getattr(self.reference(name), function)
            actual = globals()[function]
            for h, w in ((96, 128), (41, 57), (8, 8)):
                frame = synthetic(h, w)
                np.random.seed(1234); expected = reference(frame.copy())
                np.random.seed(1234); result = actual(frame.copy())
                if isinstance(result, tuple):
                    for a, b in zip(result, expected):
                        np.testing.assert_array_equal(a, b)
                else:
                    np.testing.assert_array_equal(result, expected)

    def test_grid_exact_pixels_all_features(self):
        reference = self.reference("grid")
        for shape in ("ellipse", "rect"):
            for angle in (-34, 0, 26):
                args = dict(rows=9, cols=5, thickness=3, opacity=.72, margin=.13,
                            color=(29, 181, 244), dots=True, dot_radius=4, shape=shape)
                expected, result = synthetic(), synthetic()
                reference.draw_face_grid(expected, (15, 20, 105, 82), reference.GridParams(**args), angle)
                draw_face_grid(result, (15, 20, 105, 82), GridParams(**args), angle)
                np.testing.assert_array_equal(result, expected)

    def test_full_frame_temporal_sequence_exact(self):
        reference = self.reference("pipeline")
        args = dict(methods={"A": True, "B": True, "C": True}, eps=12, strength=.14,
                    use_grid=True, tracking=True)
        ref = reference.FrameProcessor(reference.RenderConfig(**args), FakeDetector())
        actual = FrameProcessor(RenderConfig(**args), FakeDetector())
        frames = [np.roll(synthetic(), i, axis=1) for i in range(5)]
        np.random.seed(42); expected = [ref.process(f.copy()) for f in frames]
        np.random.seed(42); results = [actual.process(f.copy()) for f in frames]
        for a, b in zip(results, expected):
            np.testing.assert_array_equal(a, b)

    def test_tracker_matches_upstream_with_misses_and_landmarks(self):
        reference = self.reference("tracker").FaceTracker()
        actual = FaceTracker()
        sequence = [[Detection((10 + i, 15, 50 + i, 60), .8,
                                np.array([[20+i,25],[40+i,29],[30,35],[24,48],[38,49]], np.float32))]
                    if i not in (2, 4, 5) else [] for i in range(10)]
        for detections in sequence:
            expected, result = reference.update(detections), actual.update(detections)
            self.assertEqual(len(result), len(expected))
            for a, b in zip(result, expected):
                self.assertEqual(a.id, b.id)
                self.assertEqual(a.angle, b.angle)
                np.testing.assert_array_equal(a.box, b.box)
                np.testing.assert_array_equal(a.landmarks, b.landmarks)


@unittest.skipUnless(ff.find_ffmpeg() and ff.find_ffprobe(), "FFmpeg not available")
class CloakVideoTests(unittest.TestCase):
    def make_padding_fixture(self, root, fps="12", count=6):
        from fractions import Fraction
        duration = count / float(Fraction(fps))
        source = root / "padding-source.mkv"
        subprocess.run([ff.find_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
                        "-f", "lavfi", "-i", f"color=c=red:size=128x96:rate={fps}",
                        "-f", "lavfi", "-i",
                        f"aevalsrc=0.25*sin(2*PI*440*t)|0.25*sin(2*PI*880*t):s=48000:d={duration:.12f}",
                        "-frames:v", str(count), "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source)],
                       check=True, capture_output=True, creationflags=ff._CREATE_NO_WINDOW)
        return source

    def decoded_frames(self, path):
        cap = cv2.VideoCapture(str(path))
        frames = []
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    return frames
                frames.append(frame)
        finally:
            cap.release()

    def decoded_stereo(self, path):
        result = subprocess.run([ff.find_ffmpeg(), "-hide_banner", "-loglevel", "error",
                                 "-i", str(path), "-map", "0:a:0", "-ar", "48000", "-ac", "2",
                                 "-f", "f32le", "pipe:1"], check=True, capture_output=True,
                                creationflags=ff._CREATE_NO_WINDOW)
        return np.frombuffer(result.stdout, dtype="<f4").reshape(-1, 2)

    def test_before_after_frame_and_stereo_audio_boundaries(self):
        from fractions import Fraction
        # Fractional FPS checks delay against actual prefix frames, not simply
        # target seconds minus a rounded container duration.
        for rate, count in (("12", 6), ("30000/1001", 12)):
            with self.subTest(rate=rate), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                source = self.make_padding_fixture(root, rate, count)
                fps = float(Fraction(rate))
                target = round(fps)
                padding = target - count
                self.assertEqual(len(self.decoded_frames(source)), count)
                for position, extension in (("after", "mp4"), ("before", "mp4"),
                                            ("before", "mov"), ("before", "mkv"), ("before", "m4v")):
                    output = root / f"{position}.{extension}"
                    result = CloakEngine().render({"jobs": [{"path": str(source), "outputPath": str(output)}],
                        "options": {"use_grid": False, "pad_enabled": True, "pad_seconds": 1,
                                    "pad_position": position, "quality": "lossless"}}, Job(position))
                    frames = self.decoded_frames(output)
                    info = probe(str(output), thumbnail=False)
                    self.assertTrue(info["hasAudio"], extension)
                    self.assertAlmostEqual(info["duration"], target / fps, delta=.06, msg=extension)
                    self.assertEqual(result["frames"], target)
                    self.assertEqual(len(frames), target)
                    black = [int(frame.max()) < 5 for frame in frames]
                    self.assertEqual(black, ([True] * padding + [False] * count) if position == "before"
                                     else ([False] * count + [True] * padding))
                    audio = self.decoded_stereo(output)
                    # Stay clear of AAC's short transform/filter transition.
                    if position == "before":
                        boundary = padding / fps
                        silent = audio[int(.05 * 48000):int((boundary - .05) * 48000)]
                        active = audio[int((boundary + .05) * 48000):int((target / fps - .05) * 48000)]
                    else:
                        boundary = count / fps
                        active = audio[int(.05 * 48000):int((boundary - .05) * 48000)]
                        silent = audio[int((boundary + .05) * 48000):int((target / fps - .05) * 48000)]
                    self.assertTrue(np.all(np.sqrt(np.mean(silent ** 2, axis=0)) < .002))
                    self.assertTrue(np.all(np.sqrt(np.mean(active ** 2, axis=0)) > .05))
                    self.assertFalse(list(root.glob(".magicloak-*")))

    def test_long_or_disabled_padding_does_not_shift_original(self):
        for count, enabled in ((18, True), (6, False)):
            with self.subTest(count=count, enabled=enabled), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                source = self.make_padding_fixture(root, "12", count)
                for position in ("before", "after"):
                    output = root / f"{position}.mp4"
                    result = CloakEngine().render({"jobs": [{"path": str(source), "outputPath": str(output)}],
                        "options": {"use_grid": False, "pad_enabled": enabled, "pad_seconds": 1,
                                    "pad_position": position, "quality": "lossless"}}, Job(position))
                    frames = self.decoded_frames(output)
                    self.assertEqual(result["frames"], count)
                    self.assertEqual(len(frames), count)
                    self.assertTrue(all(frame.max() > 100 for frame in frames))
                    audio = self.decoded_stereo(output)[2400:7200]
                    self.assertTrue(np.all(np.sqrt(np.mean(audio ** 2, axis=0)) > .05))

    def test_cancel_during_before_padding_preserves_original(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = self.make_padding_fixture(root)
            output = root / "cancelled.mp4"
            before = source.read_bytes()
            job = Job("cancel-prefix")
            job.emit = lambda event: job.cancel() if event["message"] == "앞쪽 검은 화면 패딩" else None
            with self.assertRaises(Cancelled):
                CloakEngine().render({"jobs": [{"path": str(source), "outputPath": str(output)}],
                    "options": {"use_grid": False, "pad_enabled": True, "pad_seconds": 2,
                                "pad_position": "before"}}, job)
            self.assertEqual(source.read_bytes(), before)
            self.assertFalse(output.exists())
            self.assertFalse(list(root.glob(".magicloak-*")))

    def test_json_daemon_preview_and_active_cancel(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, output = root / "input.mp4", root / "cancelled.mp4"
            subprocess.run([ff.find_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                            "testsrc2=size=320x180:rate=24:duration=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                            str(source)], check=True, capture_output=True, creationflags=ff._CREATE_NO_WINDOW)
            env = {**os.environ, "PYTHONUTF8": "1", "MAGICLOAK_OFFLINE": "1"}
            process = subprocess.Popen([sys.executable, "-u", str(BACKEND / "cloak_daemon.py")],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                       text=True, encoding="utf-8", env=env, creationflags=ff._CREATE_NO_WINDOW)
            received, pending = queue.Queue(), []
            def reader():
                for line in process.stdout:
                    received.put(json.loads(line))
            thread = threading.Thread(target=reader, daemon=True); thread.start()
            def send(identifier, command, payload):
                process.stdin.write(json.dumps({"id": identifier, "command": command, "payload": payload}) + "\n")
                process.stdin.flush()
            def receive(identifier, kind):
                for index, message in enumerate(pending):
                    if message["id"] == identifier and message["type"] == kind:
                        return pending.pop(index)
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    message = received.get(timeout=max(.01, deadline - time.monotonic()))
                    if message["id"] == identifier and message["type"] == kind:
                        return message
                    pending.append(message)
                raise AssertionError("Timed out waiting for Cloak protocol")
            try:
                send("system", "system", {})
                self.assertEqual(receive("system", "result")["data"]["module"], "MagiCloak")
                send("probe", "probe", {"path": str(source)})
                self.assertIn("thumbnail", receive("probe", "result")["data"])
                send("preview", "preview", {"path": str(source), "time": .125, "options": {"tracking": False}})
                preview = receive("preview", "result")["data"]
                self.assertEqual(preview["frame"], 3)
                self.assertTrue(preview["image"].startswith("data:image/png;base64,"))
                send("render", "render", {"jobs": [{"path": str(source), "outputPath": str(output)}],
                                           "options": {"tracking": False, "pad_enabled": True, "pad_seconds": 15}})
                receive("render", "progress")
                send("cancel", "cancel", {"jobId": "render"})
                self.assertTrue(receive("cancel", "result")["data"]["cancelled"])
                self.assertIn("Cancelled", receive("render", "error")["error"])
                self.assertFalse(output.exists())
                self.assertFalse(list(root.glob(".magicloak-*")))
            finally:
                process.stdin.close()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
                thread.join(timeout=2)
                process.stdout.close()

    def test_audio_padding_and_batch(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, output = root / "short.mp4", root / "padded.mp4"
            command = [ff.find_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                       "testsrc2=size=128x96:rate=12:duration=0.5", "-f", "lavfi", "-i",
                       "sine=frequency=440:sample_rate=48000:duration=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                       "-c:a", "aac", "-shortest", str(source)]
            subprocess.run(command, check=True, capture_output=True, creationflags=ff._CREATE_NO_WINDOW)
            png, png_out = root / "still.png", root / "still_cloaked.png"
            cv2.imencode(".png", synthetic())[1].tofile(png)
            engine = CloakEngine()
            with patch.object(engine, "_detector", return_value=FakeDetector()):
                result = engine.render({"jobs": [{"path": str(source), "outputPath": str(output)},
                                                  {"path": str(png), "outputPath": str(png_out)}],
                                        "options": {"tracking": False, "quality": "balanced", "pad_enabled": True, "pad_seconds": 1}}, Job("batch"))
            info = probe(str(output), thumbnail=False)
            self.assertEqual(info["frames"], 12)
            self.assertTrue(info["hasAudio"])
            self.assertAlmostEqual(info["duration"], 1, delta=.12)
            self.assertEqual(result["frames"], 13)
            cap = cv2.VideoCapture(str(output)); cap.set(cv2.CAP_PROP_POS_FRAMES, 10)
            ok, black = cap.read(); cap.release()
            self.assertTrue(ok)
            self.assertLess(float(black.max()), 5)
            self.assertEqual(len(result["outputs"]), 2)
            self.assertFalse(list(root.glob(".magicloak-*")))


if __name__ == "__main__":
    unittest.main()
