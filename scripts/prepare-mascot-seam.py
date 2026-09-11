"""Prepare an optical-flow seam for the finite onboarding pose bank.

Run with an existing local Python containing numpy/opencv-python. This is a
deterministic, offline image warp of two supplied video frames, not a model run.
Default: write inspection previews only. --publish appends a seam atlas/manifest.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "brand" / "onboarding-mascot"
OUTPUT = ROOT / ".test-output" / "mascot-analysis" / "seam"


def read_image(path: Path) -> np.ndarray:
    image = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None or image.ndim != 3 or image.shape[2] != 4:
        raise ValueError(f"Expected RGBA asset: {path.name}")
    return image


def write_image(path: Path, image: np.ndarray) -> None:
    args = [cv2.IMWRITE_WEBP_QUALITY, 94] if path.suffix == ".webp" else []
    ok, encoded = cv2.imencode(path.suffix, image, args)
    if not ok:
        raise RuntimeError(f"Unable to encode {path.name}")
    encoded.tofile(str(path))


def flatten(image: np.ndarray, background=(24, 19, 16)) -> np.ndarray:
    alpha = image[..., 3:4].astype(np.float32) / 255
    return np.clip(image[..., :3].astype(np.float32) * alpha + np.asarray(background, np.float32) * (1 - alpha), 0, 255).astype(np.uint8)


def flow(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    # Composite onto a dark background before finding correspondence; invisible
    # RGB is irrelevant. Alpha boundaries remain features alongside facial detail.
    ga = cv2.cvtColor(flatten(a), cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(flatten(b), cv2.COLOR_BGR2GRAY)
    solver = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    solver.setFinestScale(0)
    solver.setGradientDescentIterations(40)
    solver.setVariationalRefinementIterations(40)
    solver.setPatchSize(8)
    solver.setPatchStride(3)
    return solver.calc(ga, gb, None)


def warp(image: np.ndarray, forward_flow: np.ndarray, fraction: float) -> np.ndarray:
    """Invert x+t*flow(x) to sample the source at intermediate coordinates."""
    height, width = image.shape[:2]
    gy, gx = np.mgrid[0:height, 0:width].astype(np.float32)
    mx, my = gx.copy(), gy.copy()
    for _ in range(8):
        f = cv2.remap(forward_flow, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        mx = gx - fraction * f[..., 0]
        my = gy - fraction * f[..., 1]
    premultiplied = image.astype(np.float32) / 255
    premultiplied[..., :3] *= premultiplied[..., 3:4]
    return cv2.remap(premultiplied, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def morph(a: np.ndarray, b: np.ndarray, ab: np.ndarray, ba: np.ndarray, t: float) -> np.ndarray:
    if t <= 0:
        return a.copy()
    if t >= 1:
        return b.copy()
    aa = warp(a, ab, t)
    bb = warp(b, ba, 1 - t)
    aligned = aa * (1 - t) + bb * t
    alpha = aligned[..., 3:4]
    aligned[..., :3] = np.divide(aligned[..., :3], alpha, out=np.zeros_like(aligned[..., :3]), where=alpha > 1e-6)
    return np.clip(np.rint(aligned * 255), 0, 255).astype(np.uint8)


def main() -> None:
    args = argparse.ArgumentParser()
    args.add_argument("--publish", action="store_true")
    options = args.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ASSETS / "manifest.json").read_text(encoding="utf8"))
    width, height = manifest["width"], manifest["height"]

    def reference(source_frame: int) -> dict:
        return next(frame for frame in manifest["frames"] if frame["sourceFrame"] == source_frame)

    def tile(ref: dict) -> np.ndarray:
        atlas = read_image(ASSETS / manifest["sheets"][ref["sheet"]]["file"])
        return atlas[ref["y"]:ref["y"] + height, ref["x"]:ref["x"] + width].copy()

    from_ref, to_ref = reference(120), reference(24)
    a, b = tile(from_ref), tile(to_ref)
    ab, ba = flow(a, b), flow(b, a)
    intermediates = [morph(a, b, ab, ba, i / 12) for i in range(13)]
    for i, image in enumerate(intermediates):
        write_image(OUTPUT / f"morph-{i:02d}.png", image)
    raw = cv2.addWeighted(flatten(a), .5, flatten(b), .5, 0)
    comparison = np.concatenate([flatten(a), raw, flatten(intermediates[6]), flatten(b)], axis=1)
    comparison = cv2.copyMakeBorder(comparison, 32, 0, 0, 0, cv2.BORDER_CONSTANT, value=(24, 19, 16))
    for i, label in enumerate(["F120", "RAW 50/50 CROSSFADE", "FLOW-ALIGNED MIDPOINT", "F24"]):
        cv2.putText(comparison, label, (i * width + 12, 22), cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 255, 255), 1, cv2.LINE_AA)
    write_image(OUTPUT / "midpoint-comparison.png", comparison)
    print(json.dumps({"preview": str(OUTPUT / "midpoint-comparison.png"), "flowDisplacementMedian": float(np.median(np.linalg.norm(ab, axis=2))), "count": len(intermediates)}, indent=2))

    if options.publish:
        file = "seam-0.webp"
        columns = 4
        generated = intermediates[1:-1]
        rows = (len(generated) + columns - 1) // columns
        atlas = np.zeros((rows * height, columns * width, 4), np.uint8)
        # Updating the same seam is repeatable and never modifies source sheets.
        sheet = next((index for index, item in enumerate(manifest["sheets"]) if item["file"] == file), len(manifest["sheets"]))
        frames = [{key: from_ref[key] for key in ("sheet", "x", "y")}]
        for index, image in enumerate(generated):
            x, y = index % columns * width, index // columns * height
            atlas[y:y + height, x:x + width] = image
            frames.append({"sheet": sheet, "x": x, "y": y})
        frames.append({key: to_ref[key] for key in ("sheet", "x", "y")})
        write_image(ASSETS / file, atlas)
        metadata = {"file": file, "width": columns * width, "height": rows * height}
        if sheet == len(manifest["sheets"]):
            manifest["sheets"].append(metadata)
        else:
            manifest["sheets"][sheet] = metadata
        manifest["seam"] = {"fromSourceFrame": 120, "toSourceFrame": 24, "method": "bidirectional-dis-optical-flow", "frames": frames}
        # The idle pose and reduced-motion poster use the seam's aligned middle,
        # not the original F16 which would jump when the cursor returns to center.
        manifest["idleSeamIndex"] = len(frames) // 2
        manifest["poster"] = "poster.webp"
        write_image(ASSETS / manifest["poster"], intermediates[manifest["idleSeamIndex"]])
        (ASSETS / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
        print(json.dumps({"published": file, "bytes": (ASSETS / file).stat().st_size, "decodedBytes": int(atlas.size), "frames": len(frames)}, indent=2))


if __name__ == "__main__":
    main()
