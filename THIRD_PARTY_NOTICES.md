# Third-party notices

Original MagiMagic application code is MIT licensed. Third-party and owner-supplied ported components retain their own rights and conditions. No model weights or FFmpeg executables are redistributed inside the installer.

## Owner-requested MagiCloak port

`backend/cloak` derives from https://github.com/jeboong/seedance-cloak at commit `6f0e670f056c5ede87c0b0c390613ed6c499a455`, integrated at the repository owner's request. Upstream did not publish a LICENSE file at that revision. Do not infer an MIT grant for this copied code merely from this application's top-level license. Provenance and adaptations are documented in `docs/CLOAK_PROVENANCE.md`, with parity checks in `docs/CLOAK_VERIFICATION.md`.

YuNet's ONNX model is downloaded separately from a pinned OpenCV Zoo revision with a SHA-256 check; its MIT model license is retained at `backend/cloak/YuNet-LICENSE.txt`. No face images or biometric templates are uploaded or stored by the detector.

## Desktop application

- Electron: MIT; Chromium and bundled components have separate notices included with Electron. https://github.com/electron/electron
- React, Radix UI, shadcn/ui, Tailwind CSS, Vite, electron-updater, fflate: MIT. Lucide icons: ISC. Exact dependency versions are in package-lock.json.
- Embedded CPython 3.13.14: Python Software Foundation License and included third-party notices. The original official archive, including LICENSE.txt, is preserved. https://www.python.org/ftp/python/3.13.14/
- pip 25.3: MIT. Its wheel includes pip-25.3.dist-info/licenses/LICENSE.txt and vendored component notices.

## Downloaded local AI engine

On first use, the application downloads Python libraries from PyPI and PyTorch's official CUDA 12.8 index. Their original license files remain installed in their package distributions. Torch/torchvision use BSD-style licenses; NumPy uses BSD; OpenCV uses Apache-2.0; Transformers, Diffusers, Accelerate and huggingface_hub use Apache-2.0. Consult installed package notices for complete transitive dependency terms.

The installer does not include NVIDIA CUDA wheels. These are downloaded from https://download.pytorch.org/whl/cu128 and retain their NVIDIA and component-specific terms. Installing MagiDepth does not grant rights beyond those upstream licenses.

## FFmpeg (downloaded separately)

The runtime first validates and reuses installed FFmpeg / ffprobe. Only if no compatible pair is found does it download the matching 8.1.2 essentials archive directly from Gyan's published upstream distribution, check its pinned SHA-256, and retain its original LICENSE and README next to the local tools. These executables are separate command-line programs; they are **not included in MagiMagic's installer or GitHub assets**. Reused system installations keep their existing distribution and notices.

- Build and download provider: https://www.gyan.dev/ffmpeg/builds/
- Exact archive: https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip
- Published checksum: https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip.sha256
- FFmpeg source: https://github.com/FFmpeg/FFmpeg
- License: GPLv3, with component details and configuration in the downloaded README.

If you redistribute the downloaded tools independently, you must satisfy their applicable license and corresponding-source obligations. MagiDepth's MIT license does not relicense FFmpeg.

## Model code and weights

See [model selection](docs/MODELS.md), [material maps](docs/MATERIAL_MAPS.md), and backend/licenses for exact upstream licenses and pinned model references. Video Depth Anything Small and Depth Anything V2 Small use Apache-2.0 weights; Base/Large non-commercial checkpoints are not silently substituted. Advanced Marigold weights are subject to CreativeML OpenRAIL++-M use restrictions, not Apache-2.0. BiRefNet weights/code use MIT terms. Model weights download on demand and are never included in the source repository or installer.

## Brand artwork

The MagiDepth character icon was supplied by the project owner for this application's branding. It is not covered by the source-code MIT license. Do not imply permission for unrelated commercial reuse of the character.
