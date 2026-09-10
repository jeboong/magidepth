# Vendored inference source

`video_depth_anything/` contains only Python inference modules, `utils/util.py`,
and the upstream LICENSE from https://github.com/DepthAnything/Video-Depth-Anything
at commit `4f5ae23172ba60fd7bc11ef671cca678842c7072`.

The upstream files are unmodified. A DepthDesk `utils/__init__.py` namespace
marker prevents collisions with unrelated installed packages. Original copyright notices are retained.
The upstream repository license is Apache-2.0; its full text is included in
`video_depth_anything/LICENSE`. DINOv2-derived files retain Meta's notices;
motion attention modules retain Hugging Face's notices.

DepthDesk's adapter in `models.py` replaces attention with equivalent PyTorch
scaled-dot-product attention at runtime, chunks only the independent image
backbone into batches of two, and keeps the complete 32-frame temporal head.
It does not require xFormers, decord, external executables from this repository,
or any upstream demo dependencies.

No checkpoints, Git metadata, personal videos, or generated media are vendored.
Only Apache-2.0 Small checkpoints are offered. Weights are fetched from pinned
official Hugging Face revisions on first use and verified against SHA-256.
