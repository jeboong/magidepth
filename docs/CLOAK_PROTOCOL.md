# MagiCloak subprocess API

`python backend/cloak_daemon.py` reads one JSON object per stdin line. stdout is JSON only; diagnostics go to stderr. No server port, Qt event loop, GPU model or media upload is involved.

Request: `{id: string, command: string, payload: object}`. Responses follow the existing MagiMagic worker protocol: `{id,type:'result',data}`, `{id,type:'error',error}`, `{id,type:'progress',data}`. Progress values are 0–1. A single worker thread serializes processing while the input thread can receive cancellation.

| command | payload | result |
| --- | --- | --- |
| system | `{}` | module, upstream revision, OpenCV, detector API support, FFmpeg, defaults, quality presets |
| probe | `{path}` | kind/path/name/width/height/fps/frames/duration/hasAudio, first-frame `thumbnail` PNG data URL |
| preview | `{path,time,options,findFace?:true}` | source/image PNG data URLs, elapsed seconds, zero-based frame, width/height, faceCount, detector |
| render | `{jobs:[{path,outputPath}],options}` | outputs, total processed/padded frames, elapsed seconds, end-to-end frames/s |
| cancel | `{jobId}` | `{cancelled:boolean}` |

`findFace` searches at most14 evenly-spaced video frames, selecting the first detected-face frame or falling back to the first decodable frame. Use only for initial attachment; normal seek sends time in seconds. The preview cache keeps three decoded/resized frames, not processed effects. Options are always applied anew. Upstream UI debounce values were 220ms for settings and60ms for seeking.

Progress includes stage/progress/message and optional frame/totalFrames/fileIndex/totalFiles/preview/outputPath. `fileIndex` is zero-based. Completed batch files emit stage `file-complete` with `outputPath` immediately; earlier complete files remain valid if a later file fails or the user cancels.

Options exactly follow `shared/cloak.ts`; original defaults follow the upstream UI. The added `pad_position` defaults to `after`, preserving existing output placement:

```json
{
  "methods": {"A": false, "B": false, "C": false},
  "eps": 6, "strength": 0.05, "use_grid": true, "tracking": true,
  "quality": "visually_lossless", "pad_enabled": false, "pad_seconds": 4, "pad_position": "after",
  "roi_shape": "ellipse", "detect_score": 0.6,
  "man_cx": 0.5, "man_cy": 0.5, "man_w": 0.35, "man_h": 0.45,
  "grid": {
    "rows": 6, "cols": 6, "thickness": 2, "auto_thickness": true,
    "color": [255,255,255], "opacity": 0.6, "margin": 0.06,
    "shape": "ellipse", "align_angle": true, "dots": false,
    "dot_radius": 3, "line_aa": true
  }
}
```

`grid.color` is BGR, not RGB. Allowed ranges: eps2–30, strength.01–.20, pad1–15 seconds, detect_score.05–.99, manual center0–1 and size.05–1, rows/cols1–20, thickness/dot_radius1–8, opacity.05–1, margin0–.4. Shape is ellipse/rect. There is no shell-command or arbitrary FFmpeg-argument field.

`pad_position` accepts only `before` or `after`. Padding is applied only when enabled and the original is shorter than the target; `pad_seconds` is the target total length, not an amount to add. The existing frame rule remains `round(pad_seconds × FPS)`. Before padding counts actual decodable frames (up to the target) and prepends the missing black frames; every audio channel receives the same frame-count/FPS silent delay. After padding appends black frames and silence as before. Long sources are never shortened or shifted. Images ignore video padding. Only short before-padded clips require the extra counting pass; processing math and the normal/after path are unchanged.

UI labels and wire keys intentionally differ: displayed **A = grid** (`use_grid`), **B = original A** (`methods.A`, `eps`), **C = original B** (`methods.B`, `strength`), **D = original C** (`methods.C`, `strength`). Never rename the internal A/B/C keys or reinterpret saved preferences as the new display labels.

Input: JPG/JPEG/PNG/BMP/WebP/TIF/TIFF, MP4/MOV/AVI/MKV/WebM/M4V/WMV/FLV. Image output supports the image extensions; video output is MP4/MOV/MKV/M4V. One batch may contain1–500 jobs. Sources, existing outputs and duplicate batch destinations cannot be overwritten. Files are rendered at original geometry and source FPS; preview width may be limited to960.

Environment: `FFMPEG_PATH`, `FFPROBE_PATH`, `DEPTHDESK_MODELS_DIR`. `MAGICLOAK_OFFLINE=1` disables the optional YuNet download and allows verified cache/local res10/Haar fallback. No new Python dependencies beyond the existing MagiMagic engine are required.
