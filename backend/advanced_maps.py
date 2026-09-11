"""Optional, local AI material/normal/alpha estimators.

Only selected pipelines are downloaded. Heavy libraries are deliberately imported
inside call paths so source/depth/fast approximations do not require diffusers.
Model source revisions and SHA-256 values were verified against the publishers'
Hugging Face trees on 2026-09-10. See docs/MATERIAL_MAPS.md for licenses and limits.
"""
from __future__ import annotations

import gc
import hashlib
import json
import math
import threading
from pathlib import Path
from typing import Any, Callable, Iterable

import numpy as np

Progress = Callable[[str, float, str], None]
Check = Callable[[], None]

_TEXT = "bc1827c465450322616f06dea41596eac7d493f4e95904dcb51f0fc745c4e13f"
_VAE = "3e4c08995484ee61270175e9e7a072b66a6e4eeb5f0c266667fe1f45b90daf9a"
MODEL_SPECS: dict[str, dict[str, Any]] = {
    "normal": {
        "repo": "prs-eth/marigold-normals-v1-1",
        "revision": "09cfdd258cb281fa006cf1afcd2284376d16687d",
        "license": "OpenRAIL++-M",
        "licenseUrl": "https://github.com/prs-eth/Marigold/blob/main/LICENSE-MODEL.txt",
        "weights": {
            "text_encoder/model.fp16.safetensors": _TEXT,
            "unet/diffusion_pytorch_model.fp16.safetensors": "e90ff52ea6b56275a633cab0138ef8448fb5cffc9c1f283fb13520233b46d947",
            "vae/diffusion_pytorch_model.fp16.safetensors": _VAE,
        },
    },
    "appearance": {
        "repo": "prs-eth/marigold-iid-appearance-v1-1",
        "revision": "e7280a0a0fc5a0df0b36050882b3d8b77da22fd9",
        "license": "OpenRAIL++-M",
        "licenseUrl": "https://github.com/prs-eth/Marigold/blob/main/LICENSE-MODEL.txt",
        "weights": {
            "text_encoder/model.fp16.safetensors": _TEXT,
            "unet/diffusion_pytorch_model.fp16.safetensors": "6c7ab00d751edc8ac26a56d6d5bdcef600f2577b7ec708bea9cbac3fb12eda39",
            "vae/diffusion_pytorch_model.fp16.safetensors": _VAE,
        },
    },
    "alpha-fast": {
        "repo": "ZhengPeng7/BiRefNet_lite",
        "revision": "aa62cd87eafb9cc43056d08ef3615a14628b831d",
        "license": "MIT",
        "licenseUrl": "https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE",
        "weights": {"model.safetensors": "4417d89795250e698c3cb0ae8df15743810065f646f48a694fdfa7ca052d0815"},
        "code": {
            "birefnet.py": "af8568b5be406bf4d2a68a7ed6d72e40f73b37a1fb6fc9ebd71b5b3cbcd069c9",
            "BiRefNet_config.py": "e7b8c2a74f6cea6a59553d517f71d47f2c1d90e670a13416af17c25fe2f3dc52",
            "config.json": "9dc8614fccddd40c601aeadc69b9db6dd820598179b2a2198492e6ffa016a824",
        },
    },
    "alpha-advanced": {
        "repo": "ZhengPeng7/BiRefNet-matting",
        "revision": "eccde0a8cbdce7ac5fecfeb06340fe7b949e85d9",
        "license": "MIT",
        "licenseUrl": "https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE",
        "weights": {"model.safetensors": "a9875de5b1e6c8eb5fdaa8c727a82927ce442cdc87ba3abee6a77e6fa46c25bb"},
        "code": {
            "birefnet.py": "2a45b4e0ece72d7c4212bca1a988e7d7e52bfe9f98ec59c58b8809c8a8b7a831",
            "BiRefNet_config.py": "e7b8c2a74f6cea6a59553d517f71d47f2c1d90e670a13416af17c25fe2f3dc52",
            "config.json": "b2b235983b80fbff325976ca517bb7eda25e915b84a97b150eca41266cf8a13b",
        },
    },
}

_LOCK = threading.RLock()
_CACHE: dict[tuple[str, str], Any] = {}
_VERIFIED: set[tuple[str, str]] = set()


def provenance() -> dict[str, Any]:
    """Return serializable model/provenance information without loading models."""
    return json.loads(json.dumps(MODEL_SPECS))


def _unit(value: Any) -> np.ndarray:
    arr = np.asarray(value, dtype=np.float32)
    if not np.all(np.isfinite(arr)):
        raise RuntimeError("AI 결과에 유효하지 않은 값이 있습니다. FP32 또는 낮은 입력 크기로 다시 시도하세요.")
    return np.clip(arr, 0.0, 1.0)


def _u8(value: Any) -> np.ndarray:
    return np.rint(_unit(value) * 255.0).astype(np.uint8)


def specular_f0(albedo_srgb: np.ndarray, metallic: np.ndarray) -> np.ndarray:
    """Approximate grayscale F0, NOT observed highlights or a recovered BRDF.

    Assumes dielectric F0=0.04 and the common metallic workflow. Metal F0 uses
    linear albedo. RGB reflectance is reduced to Rec.709 luminance for the app's
    grayscale Specular channel. Roughness does not determine F0.
    """
    color = _unit(albedo_srgb)
    if color.ndim != 3 or color.shape[-1] != 3:
        raise ValueError("albedo must have shape H x W x 3")
    metal = _unit(metallic)
    if metal.shape != color.shape[:2]:
        raise ValueError("metallic must have shape H x W")
    linear = np.where(color <= 0.04045, color / 12.92, ((color + 0.055) / 1.055) ** 2.4)
    f0_rgb = 0.04 * (1.0 - metal[..., None]) + linear * metal[..., None]
    return _u8(f0_rgb @ np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32))


def normal_rgb(prediction: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """Encode camera-space unit normals [-1,1] to RGB; no tangent-space claim."""
    normal = np.asarray(prediction, dtype=np.float32).copy()
    if normal.ndim != 3 or normal.shape[-1] != 3 or not np.all(np.isfinite(normal)):
        raise RuntimeError("Normal 예측의 크기 또는 값이 올바르지 않습니다.")
    if not math.isfinite(strength) or not 0 <= strength <= 10:
        raise ValueError("normalStrength must be between 0 and 10")
    normal[..., :2] *= strength
    norm = np.linalg.norm(normal, axis=-1, keepdims=True)
    invalid = norm[..., 0] < 1e-8
    normal /= np.maximum(norm, 1e-8)
    normal[invalid] = [0, 0, 1]
    return _u8(normal * 0.5 + 0.5)


def _sha256(file: Path, check: Check) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            check()
            digest.update(chunk)
    return digest.hexdigest()


def _snapshot(key: str, progress: Progress, check: Check) -> str:
    from model_catalog import require_model
    progress('model', 3, '준비된 로컬 모델의 무결성을 확인합니다.')
    return str(require_model(key, check))


def _precision(options: dict[str, Any], device: str) -> str:
    return "fp16" if device == "cuda" and options.get("precision", "auto") != "fp32" else "fp32"


def _offload_except(keep: Any = None) -> None:
    for (key, _precision_name), instance in _CACHE.items():
        if instance is keep or str(getattr(instance, "device", "")) == "cpu":
            continue
        if key.startswith("alpha-"):
            instance.to("cpu")
        else:
            # Storage-only offload: inference will move the pipeline back to
            # CUDA first. Diffusers otherwise warns as though CPU FP16 inference
            # were requested, which is not what this memory-management step does.
            instance.to("cpu", silence_dtype_warnings=True)
    # Importing this module alone never imports torch.
    if _CACHE:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def release() -> None:
    """Free accelerator memory while retaining CPU model objects for reuse."""
    with _LOCK:
        _offload_except()


def clear_cache() -> None:
    """Drop all model objects (e.g. before a large depth-only export)."""
    with _LOCK:
        _offload_except()
        _CACHE.clear()
        gc.collect()


def _load(key: str, device: str, options: dict[str, Any], progress: Progress, check: Check) -> Any:
    import torch

    precision = _precision(options, device)
    cache_key = (key, precision)
    instance = _CACHE.get(cache_key)
    _offload_except(instance)
    if instance is None:
        folder = _snapshot(key, progress, check)
        dtype = torch.float16 if precision == "fp16" else torch.float32
        progress("model", 13, f"{MODEL_SPECS[key]['repo']} · AI 모델 로드")
        if key.startswith("alpha-"):
            from transformers import AutoModelForImageSegmentation
            # `folder` is local and immutable-revision pinned. Code/config and
            # safetensors were SHA-256 checked above before remote-code opt-in.
            instance = AutoModelForImageSegmentation.from_pretrained(
                folder, trust_remote_code=True, local_files_only=True,
                use_safetensors=True, torch_dtype=dtype,
            ).eval()
        else:
            try:
                from diffusers import MarigoldIntrinsicsPipeline, MarigoldNormalsPipeline
            except ImportError as error:
                raise RuntimeError("Advanced AI 모듈이 없습니다. 설정에서 AI 엔진 업데이트를 실행하세요.") from error
            pipeline = MarigoldNormalsPipeline if key == "normal" else MarigoldIntrinsicsPipeline
            instance = pipeline.from_pretrained(folder, variant="fp16", torch_dtype=dtype,
                                                use_safetensors=True, local_files_only=True)
            instance.set_progress_bar_config(disable=True)
            instance.vae.enable_slicing()
        _CACHE[cache_key] = instance
    check()
    instance.to(device)
    return instance


def _run_diffusion(key: str, rgb: np.ndarray, options: dict[str, Any], device: str,
                   progress: Progress, check: Check) -> np.ndarray:
    import torch
    from PIL import Image

    pipe = _load(key, device, options, progress, check)
    steps = int(options.get("steps", 4))
    resolution = int(options.get("inputSize", 518))
    if steps not in (1, 2, 4, 8) or not 128 <= resolution <= 1024:
        raise ValueError("Advanced steps/inputSize 범위를 확인하세요.")
    check()
    progress("advanced", 18, f"{key} AI 추정 · {steps} steps · 영상은 프레임별 처리됩니다.")
    completed = 0

    def before_step(_module: Any, _args: Any) -> None:
        nonlocal completed
        check()
        completed += 1
        progress("advanced", 20 + 70 * min(completed, steps) / steps, f"{key} · diffusion {min(completed, steps)}/{steps}")

    hook = pipe.unet.register_forward_pre_hook(before_step)
    try:
        # Same seed reduces random variation; it is not a temporal-video model.
        generator = torch.Generator(device="cpu").manual_seed(42)
        with torch.inference_mode():
            result = pipe(Image.fromarray(rgb, mode="RGB"), num_inference_steps=steps,
                          ensemble_size=1, batch_size=1, processing_resolution=resolution,
                          match_input_resolution=True, generator=generator, output_type="np")
        check()
        return np.asarray(result.prediction, dtype=np.float32)
    finally:
        hook.remove()


def _run_alpha(rgb: np.ndarray, options: dict[str, Any], device: str,
               progress: Progress, check: Check) -> np.ndarray:
    import torch
    import torch.nn.functional as functional

    key = "alpha-advanced" if options.get("processingMode") == "advanced" else "alpha-fast"
    model = _load(key, device, options, progress, check)
    height, width = rgb.shape[:2]
    size = int(math.ceil(max(256, min(1024, int(options.get("inputSize", 518)))) / 32) * 32)
    dtype = torch.float16 if _precision(options, device) == "fp16" else torch.float32
    tensor = torch.from_numpy(np.ascontiguousarray(rgb)).permute(2, 0, 1).unsqueeze(0).to(device=device, dtype=dtype) / 255.0
    tensor = functional.interpolate(tensor, size=(size, size), mode="bilinear", align_corners=False)
    mean = torch.tensor([0.485, 0.456, 0.406], device=device, dtype=dtype).view(1, 3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225], device=device, dtype=dtype).view(1, 3, 1, 1)
    check()
    progress("alpha", 20, f"BiRefNet {'matting' if key.endswith('advanced') else 'lite'} · {size} × {size}")
    with torch.inference_mode():
        outputs = model((tensor - mean) / std)
        logits = outputs[-1] if isinstance(outputs, (list, tuple)) else outputs.logits
        mask = functional.interpolate(logits.float().sigmoid(), size=(height, width), mode="bilinear", align_corners=False)
    check()
    return _u8(mask[0, 0].cpu().numpy())


def infer(rgb_uint8: np.ndarray, requested_maps: Iterable[str], options: dict[str, Any],
          device: str, progress: Progress | None = None, check: Check | None = None) -> dict[str, np.ndarray]:
    """Estimate selected maps; depth remains the caller's dedicated engine.

    Returns H×W×3 RGB uint8 for normal/basecolor/source and H×W grayscale uint8
    for alpha/metallic/roughness/specular. Raises errors rather than silently
    substituting heuristic maps when a requested advanced model fails.
    """
    rgb = np.asarray(rgb_uint8)
    if rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] != 3 or min(rgb.shape[:2]) < 1:
        raise ValueError("입력은 H×W×3 uint8 RGB 이미지여야 합니다.")
    if device not in ("cpu", "cuda"):
        raise ValueError("device must be cpu or cuda")
    requested = set(requested_maps)
    unknown = requested - {"source", "depth", "normal", "alpha", "basecolor", "roughness", "metallic", "specular"}
    if unknown:
        raise ValueError(f"지원하지 않는 맵: {', '.join(sorted(unknown))}")
    emit = progress or (lambda *_args: None)
    cancel = check or (lambda: None)
    result: dict[str, np.ndarray] = {}
    with _LOCK:
        cancel()
        if "source" in requested:
            result["source"] = rgb.copy()
        if "normal" in requested:
            normal = _run_diffusion("normal", rgb, options, device, emit, cancel)
            if normal.shape != (1, *rgb.shape):
                raise RuntimeError(f"Normal 모델 결과 크기가 예상과 다릅니다: {normal.shape}")
            result["normal"] = normal_rgb(normal[0], float(options.get("normalStrength", 1)))
        appearance = requested & {"basecolor", "roughness", "metallic", "specular"}
        if appearance:
            prediction = _run_diffusion("appearance", rgb, options, device, emit, cancel)
            # Pinned model_index: target_names=[albedo,material], material RGB
            # channels=[roughness,metallicity,unused]. No per-image stretching.
            if prediction.shape != (2, *rgb.shape):
                raise RuntimeError(f"Appearance 모델 결과 크기가 예상과 다릅니다: {prediction.shape}")
            albedo, material = _unit(prediction[0]), _unit(prediction[1])
            if "basecolor" in appearance:
                result["basecolor"] = _u8(albedo)
            if "roughness" in appearance:
                result["roughness"] = _u8(material[..., 0])
            if "metallic" in appearance:
                result["metallic"] = _u8(material[..., 1])
            if "specular" in appearance:
                result["specular"] = specular_f0(albedo, material[..., 1])
        if "alpha" in requested:
            result["alpha"] = _run_alpha(rgb, options, device, emit, cancel)
        cancel()
        emit("advanced", 100, "선택한 맵의 AI 추정 완료")
    return result
