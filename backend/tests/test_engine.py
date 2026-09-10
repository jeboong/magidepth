"""No model downloads, GPU or private fixtures are needed for unit tests."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import (DEFAULTS, Job, Cancelled, align_scale, fraction_fps, global_range,
                    normalize_depth, output_size, temporal_predictions, trim_bounds,
                    validate_options)


class OptionsTests(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual(validate_options({}), DEFAULTS)

    def test_rejects_invalid_values(self):
        for entry in [{'model': 'unknown'}, {'nearWhite': 1}, {'gamma': float('nan')},
                      {'gamma': 0}, {'contrast': 1.1}, {'inputSize': 400}, {'unknown': True}]:
            with self.subTest(entry=entry), self.assertRaises(ValueError):
                validate_options(entry)

    def test_trim(self):
        info = {'fps': 30, 'duration': 4, 'frames': 120}
        self.assertEqual(trim_bounds(info, 0.5, 1.5), (15, 45))
        self.assertEqual(trim_bounds(info, 0, 4), (0, 120))
        for start, end in [(-1, 1), (2, 1), (0, 9), (float('nan'), 4)]:
            with self.assertRaises(ValueError):
                trim_bounds(info, start, end)

    def test_fractional_fps_and_dimensions(self):
        self.assertAlmostEqual(float(fraction_fps('30000/1001')), 29.97002997)
        with self.assertRaises(ValueError):
            fraction_fps('0/0')
        self.assertEqual(output_size({'width': 1720, 'height': 922}, 'source'), (1720, 922))
        self.assertEqual(output_size({'width': 3840, 'height': 2160}, '1080'), (1920, 1080))
        self.assertEqual(output_size({'width': 2160, 'height': 3840}, '720'), (720, 1280))


class DepthTests(unittest.TestCase):
    def test_orientation_gamma(self):
        depth = np.array([[0, 0.5, 1]], np.float32)
        result = normalize_depth(depth, 0, 1, DEFAULTS)
        np.testing.assert_array_equal(result, [[0, 128, 255]])
        result = normalize_depth(depth, 0, 1, {**DEFAULTS, 'nearWhite': False})
        np.testing.assert_array_equal(result, [[255, 128, 0]])
        self.assertGreater(normalize_depth(depth, 0, 1, {**DEFAULTS, 'gamma': 2})[0, 1], 128)

    def test_constant_depth_safe(self):
        result = normalize_depth(np.ones((2, 3)), 1, 1, DEFAULTS)
        self.assertEqual(result.sum(), 0)

    def test_alignment(self):
        values = np.arange(40, dtype=np.float32).reshape(2, 4, 5)
        scale, shift = align_scale(values, values * 3 + 7)
        self.assertAlmostEqual(scale, 3)
        self.assertAlmostEqual(shift, 7)

    def test_global_normalization(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'depth.bin'
            np.linspace(0, 100, 20000, dtype=np.float32).tofile(path)
            low, high = global_range(path, (100, 100), 2, 0, 100, 0.5, Job('test'))
            self.assertGreaterEqual(low, 0)
            self.assertLess(low, 2)
            self.assertGreater(high, 98)
            self.assertLessEqual(high, 100)

    def test_cancel(self):
        job = Job('x')
        job.cancel()
        with self.assertRaises(Cancelled):
            job.check()


class TemporalTests(unittest.TestCase):
    class Decoder:
        def __init__(self, count):
            self.count, self.current = count, 0
        def read(self):
            if self.current >= self.count:
                return None
            frame = np.full((2, 3), self.current, dtype=np.float32)
            self.current += 1
            return frame

    class Predictor:
        def prepare(self, frame, size):
            return frame
        def temporal(self, prepared):
            return np.stack(prepared)

    def test_bounded_windows_emit_every_frame_once(self):
        for count in [1, 8, 22, 24, 31, 32, 33, 40, 53, 54, 55, 76, 95, 118, 257]:
            with self.subTest(frames=count):
                result = list(temporal_predictions(self.Decoder(count), self.Predictor(), 280, count, Job('x')))
                self.assertEqual(len(result), count)
                np.testing.assert_allclose([frame.mean() for frame in result], np.arange(count), atol=0.001)


if __name__ == '__main__':
    unittest.main()
