"""Opt-in local model smoke test; never uploads the supplied media.

Not collected by unittest. Output belongs in an ignored/private directory.
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import advanced_maps


def report(stage, percent, message):
    print(json.dumps({"stage": stage, "progress": percent, "message": message}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--only", choices=["normal", "appearance", "alpha-fast", "alpha-advanced"])
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--size", type=int, default=392)
    parser.add_argument("--steps", type=int, default=1)
    args = parser.parse_args()
    keys = [args.only] if args.only else list(advanced_maps.MODEL_SPECS)
    if args.download_only:
        for key in keys:
            folder = advanced_maps._snapshot(key, report, lambda: None)
            print(json.dumps({"model": key, "verified": folder}), flush=True)
        return
    if not args.input or not args.output:
        parser.error("--input and --output are required for inference")
    import cv2
    import numpy as np
    import torch
    from PIL import Image
    source = Path(args.input)
    image = cv2.imread(str(source))
    if image is None:
        capture = cv2.VideoCapture(str(source))
        ok, image = capture.read()
        capture.release()
        if not ok:
            raise RuntimeError("Cannot decode test media")
    scale = min(1.0, 960.0 / max(image.shape[:2]))
    image = cv2.resize(image, (round(image.shape[1] * scale), round(image.shape[0] * scale)))
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).save(out / "source.png")
    summary = {"torch": torch.__version__, "cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name() if torch.cuda.is_available() else "CPU", "inputShape": list(rgb.shape), "inputSize": args.size, "steps": args.steps, "tests": []}
    for key in keys:
        requested = {"normal": ["normal"], "appearance": ["basecolor", "roughness", "metallic", "specular"], "alpha-fast": ["alpha"], "alpha-advanced": ["alpha"]}[key]
        options = {"processingMode": "fast" if key == "alpha-fast" else "advanced", "inputSize": args.size, "steps": args.steps, "normalStrength": 1, "precision": "auto"}
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        started = time.perf_counter()
        results = advanced_maps.infer(rgb, requested, options, args.device, report)
        elapsed = time.perf_counter() - started
        rows = {}
        for name, array in results.items():
            Image.fromarray(array).save(out / f"{key}-{name}.png")
            rows[name] = {"shape": list(array.shape), "dtype": str(array.dtype), "min": int(array.min()), "max": int(array.max()), "std": float(np.std(array))}
        entry = {"model": key, "secondsIncludingLoad": elapsed, "peakAllocatedGB": torch.cuda.max_memory_allocated() / 1024**3 if torch.cuda.is_available() else None, "maps": rows}
        summary["tests"].append(entry)
        print(json.dumps(entry), flush=True)
        (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    advanced_maps.release()


if __name__ == "__main__":
    main()
