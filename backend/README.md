# Local depth worker

Run `python -u backend/daemon.py` with the installed private runtime. No HTTP
server is started and no video is uploaded. Inference resolves prepared local
models only and raises `MODEL_DOWNLOAD_REQUIRED:<id>` when one is missing.
Downloads occur exclusively through the explicit model action or Depth's
initial setup, using pinned official Hugging Face URLs and SHA-256 verification.

Environment: `FFMPEG_PATH`, `FFPROBE_PATH`, `DEPTHDESK_MODELS_DIR`.
Requests are one UTF-8 JSON object per line: `{id, command, payload}`.
Commands: `system`, `probe` (`{path}`), `preview`, `render`, `cancel` (`{jobId}`).
Results: `{id,type:"result",data}`; errors: `{id,type:"error",error}`;
progress: `{id,type:"progress",data:{jobId,stage,progress,message,...}}`.
Wire progress is 0–1 within its named stage; inference never initiates downloads.
The main stdin loop can cancel jobs while the single inference worker is busy.

`backend/model_daemon.py` is a separate, standard-library-only JSON worker with `catalog`,
`download` (`{modelId}`), and `cancel` (`{jobId}`) commands. Catalog requests use
local immutable-revision files only; they never access the network. Completed
app and exact-revision Hugging Face caches are reused after integrity checks.
Partial or mismatched revisions do not count as ready. Hash checks are cached
against file path/size/mtime while the worker lives, and missing/changed files
invalidate readiness. Download cancellation removes only its partial file;
existing final cache files remain intact until a verified replacement is ready.

Depth setup explicitly prepares `image-small` and `video-small`. Optional
models are `alpha-fast`, `alpha-advanced`, `normal`, and `appearance`. Fast RGB
and material approximations require none; fast normals reuse the selected
Depth model. Engine readiness and the two basic models' readiness are distinct.

## Rendering

- Fast: Depth Anything V2 Small, independent-frame depth, lowest latency but may
  flicker. Quality: Video Depth Anything Small, full 32-frame temporal attention.
- CUDA auto selection, FP16 by default on NVIDIA; FP32 CPU fallback is supported
  but substantially slower. CUDA 12.8 PyTorch supports RTX 50-series / Blackwell.
- Only image-backbone work is chunked into pairs. The temporal head is NOT
  reduced to independent frames. SDPA removes the xFormers requirement.
- Frames stream through FFmpeg. Temporal inference carries two scale anchors,
  ten context slots and eight pending overlapping output frames. Temporary
  float32 depth data lives next to the requested output and is cleaned on
  completion/failure/cancellation. Disk needs grow with duration, RAM does not.
- One clip-wide contrast mapping avoids per-frame brightness pumping. Contrast
  0–1 clips that percentage from each tail; gamma 0.2–3 uses `x ** (1/gamma)`.
  White is near by default. A preview uses its local frame/window's range and
  may therefore differ slightly from a globally normalized final render.
- Adjusting gamma, contrast or polarity reuses cached preview depth. Up to four
  frame predictions and one model are retained, not the entire input clip.
- Output is silent 8-bit H.264 or HEVC MP4. Source FPS/aspect/dimensions are
  retained unless a smaller output size is requested. Odd source dimensions use
  YUV444; some players have less support for this than normal YUV420.
- Trim boundaries snap to nearest source-frame boundaries, start inclusive and
  end exclusive. Variable-FPS inputs export at their reported average FPS.
  For exact variable-FPS timestamp preservation, first conform the source to CFR.
- Existing paths are rejected. Atomic publication uses an exclusive reservation
  and same-directory `.part.mp4` rename; originals are never altered.

## Images and selected maps

PNG/JPEG/WebP/BMP/TIFF still images export lossless PNG maps. EXIF orientation
is respected. Videos export one MP4 per selected map. Multiple selections append
the map name to the requested stem; existing outputs are all checked/reserved
before publication. No selected map silently replaces another.

Map choices: Source, Depth, Normal, Alpha, Basecolor, Metallic, Roughness,
Specular. Fast depth is real AI; fast normals are approximate view-space normals
derived from AI depth, NOT tangent-space texture bakes. Fast appearance channels
are **image-processing approximations**, not measured material properties.
Alpha uses actual AI segmentation even in Fast mode. Advanced auxiliary maps
use the separately pinned pipelines described in `docs/MATERIAL_MAPS.md`.
Advanced single-image models are run per video frame and can flicker; only the
Video Depth Anything channel has explicit temporal attention.

Multi-map video export reuses the original temporary float-depth stream and
one clip-wide normalization, not an intermediate re-encoded depth movie.
Depth is estimated once and reused across maps. Source and depth are decoded
in frame order; all outputs preserve the same trimmed frame count.

## Tests

`python -m unittest discover -s backend/tests -v` runs offline logic tests.
`python backend/smoke.py --input VIDEO --output-dir SCRATCH --model image-small`
runs an explicit real inference/preview/cache/export benchmark. Prepare its
selected model with the explicit model action first; benchmarks do not silently
download missing weights. Never put personal test footage or generated outputs
in the public source repository.
