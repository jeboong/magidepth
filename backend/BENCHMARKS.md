# Local verification — 2026-09-10

These are actual local smoke measurements, not universal performance claims.
The private input video and generated outputs are deliberately excluded from
this repository. First-use model downloads are not included in export timings.

## Shipping runtime

- GPU: NVIDIA GeForce RTX 5070 Ti, 15.92 GiB reported VRAM.
- Python: isolated Windows embeddable 3.13.14.
- PyTorch: 2.7.1+cu128, CUDA 12.8; FP16 for CUDA inference.
- Source/output: 1720 × 922, 30 fps; input size 280; H.264, source dimensions.
- Video Depth Anything: 32-frame temporal head, image backbone chunks of two,
  SDPA spatial/temporal attention, global depth normalization.

| Test | Measured wall time | Notes |
| --- | ---: | --- |
| Depth Anything V2 Small, first preview | 5.696 s | Includes model/import startup |
| V2 Small, cached tone-change preview | 0.207 s | No new model inference |
| V2 Small, 30-frame export | 1.349 s | 22.24 output frames/s end to end |
| Video Depth Anything Small, first preview | 1.624 s | Runtime imports already warm from previous test |
| VDA Small, cached tone-change preview | 0.220 s | No new model inference |
| VDA Small, 30-frame export | 1.066 s | 28.13 output frames/s end to end |
| Seven Fast maps, ten-frame video trim | 5.294 s | Seven separate full-resolution MP4 encoders |
| Seven Fast maps, one image | 0.449 s | Seven lossless PNG files; model warm |
| V2 Small CPU first preview | 4.602 s | Explicit CPU/FP32, includes load/import |
| CPU cached tone-change preview | 0.182 s | No new model inference |

Seven-map tests cover Source, Depth, Normal, Basecolor, Metallic, Roughness and
Specular. Alpha and Advanced models have separate measurements below; do not
interpret the table above as Marigold/BiRefNet performance. Fast material maps are
documented approximations. Increasing resolution or selecting more maps costs
additional time; startup dominates very short clips.

## Earlier development-runtime cross-check

Python 3.11.0, same GPU/PyTorch/CUDA and inference settings:

- V2 Small 30-frame export: 1.047 s, 28.65 output fps.
- VDA Small full 118-frame export: 2.593 s, 45.51 output fps.
- VDA rolling windows: approximately 60–64 new frames/s after first window,
  excluding the final normalization/encoding pass.

Different Python environments, warm state and test lengths make these results
non-interchangeable. The shipping-runtime numbers above are the primary checks.

## Verification performed

`python -m unittest discover -s backend/tests -v`: 25 tests passed on the fresh
shipping runtime, including nine advanced adapter mocked tests, temporal
window counts of 1–257 frames, global normalization, option validation, Unicode
paths, PNG formats, output collision safety, and real FFmpeg synthetic trims.

`python backend/integration_smoke.py --input LOCAL_VIDEO --output-dir SCRATCH`:

- Real CUDA inference with both Small models.
- Exact 30-frame/source-FPS/source-dimension exports.
- Seven synchronized video maps: source frames 5 through 14 inclusive → ten
  output frames in every MP4.
- Seven PNG image maps with preserved geometry.
- Six-frame HEVC output verified with FFprobe.
- JSON-lines daemon cancellation: acknowledgement received, render stopped,
  no partially published file.
- No residual scratch folders; source SHA-256 unchanged after all operations.
- All wire progress values stayed in [0, 1].
- Accurate keyframe-assisted preview seeking matched exact sequentially
  decoded frame 10 in the synthetic 30-fps fixture.
- Depth preview visually inspected: near-white/far-black relative depth, not a
  luminance conversion. Fast normal derivation was upgraded to use float depth
  before 8-bit quantization to avoid artificial contour bands.

The standalone runtime import path was also tested and corrected explicitly
for Windows embeddable Python's isolated `._pth` behavior.

## Advanced AI — real model tests

Shipping Python 3.13.14 / RTX 5070 Ti / FP16. Individual pipelines tested at
maximum-side input size 392, one Marigold step, with a 960 × 515 test frame.
Timings include checkpoint verification, model loading and inference, not
network download. All outputs were finite, nonconstant uint8 maps; visual QA
confirmed expected channel types. Peak allocated GPU memory in this sequential
test did not exceed 2.63 GiB (not a universal VRAM guarantee).

| Pipeline | Cold load + inference |
| --- | ---: |
| Marigold Normals | 7.980 s |
| Marigold IID Appearance, four material outputs | 3.890 s |
| BiRefNet Lite alpha | 2.009 s |
| BiRefNet Matting alpha | 1.466 s |

Full Engine integration at input size 280, one step, 1720 × 922 source/output:

- All eight maps, one PNG image set: 16.259 s including cold model startup.
- All eight maps, two-frame MP4 set: 5.805 s with models already cached.
- Fast-mode AI alpha PNG: 0.765 s, confirming Fast alpha is BiRefNet inference
  rather than a threshold/luminance approximation.
- Every video map contained two frames; all PNGs and MP4s retained source
  dimensions. Source SHA-256 was unchanged.
- Depth and auxiliary model GPU ownership switched successfully during the
  same persistent Engine session, avoiding simultaneous GPU model residency.

Actual first-use Video Depth Anything Small download from an empty cache and
SHA-256 verification also passed (6.46 s for the entire Python process on this
connection). Download speeds vary substantially across networks.

Reproduce the full advanced export integration with:
`python backend/integration_smoke.py --input LOCAL_VIDEO --output-dir SCRATCH --advanced-only`.
Advanced maps are independent-frame inverse estimates, not temporally trained
video PBR ground truth. More steps, higher resolution and all-map selection are
significantly slower than depth-only rendering.
