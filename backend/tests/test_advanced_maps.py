"""CPU-only behavioral tests. No checkpoints, network or torch inference."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import advanced_maps as maps


class AdvancedMapTests(unittest.TestCase):
    def setUp(self):
        self.rgb = np.full((8, 10, 3), 128, dtype=np.uint8)

    def test_no_model_for_source(self):
        with patch.object(maps, "_run_diffusion") as run, patch.object(maps, "_run_alpha") as alpha:
            result = maps.infer(self.rgb, ["source", "depth"], {}, "cpu")
        np.testing.assert_array_equal(result["source"], self.rgb)
        self.assertFalse(run.called)
        self.assertFalse(alpha.called)

    def test_only_selected_pipeline(self):
        prediction = np.zeros((1, *self.rgb.shape), dtype=np.float32)
        prediction[..., 2] = 1
        with patch.object(maps, "_run_diffusion", return_value=prediction) as run:
            result = maps.infer(self.rgb, ["normal"], {"normalStrength": 1}, "cpu")
        self.assertEqual(run.call_args.args[0], "normal")
        self.assertEqual(set(result), {"normal"})
        np.testing.assert_array_equal(result["normal"][0, 0], [128, 128, 255])

    def test_appearance_channels_not_swapped(self):
        prediction = np.zeros((2, *self.rgb.shape), dtype=np.float32)
        prediction[0] = .5
        prediction[1, ..., 0] = .25
        prediction[1, ..., 1] = .75
        with patch.object(maps, "_run_diffusion", return_value=prediction) as run:
            result = maps.infer(self.rgb, ["basecolor", "metallic", "roughness"], {}, "cpu")
        self.assertEqual(run.call_count, 1)
        self.assertEqual(result["basecolor"][0, 0, 0], 128)
        self.assertEqual(result["roughness"][0, 0], 64)
        self.assertEqual(result["metallic"][0, 0], 191)

    def test_specular_is_documented_f0_not_highlight(self):
        white = np.ones((2, 2, 3), dtype=np.float32)
        zero_metal = np.zeros((2, 2), dtype=np.float32)
        full_metal = np.ones((2, 2), dtype=np.float32)
        self.assertTrue(np.all(maps.specular_f0(white, zero_metal) == 10))
        self.assertTrue(np.all(maps.specular_f0(white, full_metal) == 255))

    def test_alpha_does_not_use_diffusion(self):
        mask = np.full(self.rgb.shape[:2], 99, dtype=np.uint8)
        with patch.object(maps, "_run_diffusion") as run, patch.object(maps, "_run_alpha", return_value=mask) as alpha:
            result = maps.infer(self.rgb, ["alpha"], {"processingMode": "fast"}, "cpu")
        self.assertFalse(run.called)
        self.assertTrue(alpha.called)
        self.assertEqual(result["alpha"].shape, self.rgb.shape[:2])

    def test_cancel_propagates(self):
        def cancel():
            raise InterruptedError("cancelled")
        with self.assertRaises(InterruptedError), patch.object(maps, "_run_diffusion") as run:
            maps.infer(self.rgb, ["normal"], {}, "cpu", check=cancel)
        self.assertFalse(run.called)

    def test_invalid_data_is_not_silently_masked(self):
        with self.assertRaises(RuntimeError):
            maps.normal_rgb(np.full((2, 2, 3), np.nan))
        with self.assertRaises(ValueError):
            maps.infer(self.rgb.astype(np.float32), ["normal"], {}, "cpu")
        with self.assertRaises(ValueError):
            maps.infer(self.rgb, ["fictional"], {}, "cpu")

    def test_provenance_has_complete_immutable_revisions_and_hashes(self):
        for entry in maps.provenance().values():
            self.assertEqual(len(entry["revision"]), 40)
            self.assertTrue(entry["license"])
            for digest in {**entry["weights"], **entry.get("code", {})}.values():
                self.assertEqual(len(digest), 64)

    def test_offload_uses_storage_only_diffusers_flag(self):
        normal = Mock(device="cuda:0")
        alpha = Mock(device="cuda:0")
        already_cpu = Mock(device="cpu")
        fake_torch = Mock()
        fake_torch.cuda.is_available.return_value = False
        cache = {("normal", "fp16"): normal, ("alpha-fast", "fp16"): alpha,
                 ("appearance", "fp16"): already_cpu}
        with patch.object(maps, "_CACHE", cache), patch.dict(sys.modules, {"torch": fake_torch}):
            maps.release()
        normal.to.assert_called_once_with("cpu", silence_dtype_warnings=True)
        alpha.to.assert_called_once_with("cpu")
        already_cpu.to.assert_not_called()


if __name__ == "__main__":
    unittest.main()
