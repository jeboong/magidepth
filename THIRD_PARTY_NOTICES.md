# Third-party notices

MagiDepth application code is MIT licensed. Third-party components retain their own licenses. No model weights or FFmpeg executables are redistributed inside the installer.

## Desktop application

- Electron: MIT; Chromium and bundled components have separate notices included with Electron. https://github.com/electron/electron
- React, Radix UI, shadcn/ui, Tailwind CSS, Vite, electron-updater, fflate: MIT. Lucide icons: ISC. Exact dependency versions are in package-lock.json.
- Embedded CPython 3.13.14: Python Software Foundation License and included third-party notices. The original official archive, including LICENSE.txt, is preserved. https://www.python.org/ftp/python/3.13.14/
- pip 25.3: MIT. Its wheel includes pip-25.3.dist-info/licenses/LICENSE.txt and vendored component notices.

## Downloaded local AI engine

On first use, the application downloads Python libraries from PyPI and PyTorch's official CUDA 12.8 index. Their original license files remain installed in their package distributions. Torch/torchvision use BSD-style licenses; NumPy uses BSD; OpenCV uses Apache-2.0; Transformers, Diffusers, Accelerate and huggingface_hub use Apache-2.0. Consult installed package notices for complete transitive dependency terms.

The installer does not include NVIDIA CUDA wheels. These are downloaded from https://download.pytorch.org/whl/cu128 and retain their NVIDIA and component-specific terms. Installing MagiDepth does not grant rights beyond those upstream licenses.

## FFmpeg (downloaded separately)

The runtime downloads the matching FFmpeg / ffprobe 8.1.2 essentials archive directly from Gyan's published upstream distribution, checks its pinned SHA-256, and retains its original LICENSE and README next to the local tools. These executables are separate command-line programs; they are **not included in MagiDepth's installer or GitHub assets**.

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
