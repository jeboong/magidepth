"""Pinned model metadata shared by status checks and inference.

Keep this module standard-library-only. Catalog workers must never import the
NumPy/PyTorch inference stack to learn filenames, revisions or checksums.
"""
from __future__ import annotations
from typing import Any

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

