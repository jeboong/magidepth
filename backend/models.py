"""Pinned local depth models; no user media leaves the machine."""
from __future__ import annotations

import contextlib
import hashlib
import os
from pathlib import Path
import sys
import time
import types
import urllib.request

import cv2
import numpy as np
import torch
import torch.nn.functional as F

VENDOR = Path(__file__).resolve().parent / 'vendor' / 'video_depth_anything'
sys.path.insert(0, str(VENDOR))

# No arbitrary Hugging Face remote code is enabled. Revisions and large-file
# SHA-256 values are pinned from each official repository's metadata.
MANIFEST = {
    'video-small': {
        'repo': 'depth-anything/Video-Depth-Anything-Small',
        'revision': '256875362cff76724b920335dfb4b29dd611f66e',
        'files': {'video_depth_anything_vits.pth':
                  '13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609'},
    },
    'image-small': {
        'repo': 'depth-anything/Depth-Anything-V2-Small-hf',
        'revision': '5426e4f0f36572d16453bbda7a8389317b1bef99',
        'files': {
            'config.json': None, 'preprocessor_config.json': None,
            'model.safetensors': '3152477ce0d8d6978d76b995120de97cb5b928701fd0f817769f59e249a16b70',
        },
    },
}


def model_root() -> Path:
    location = os.environ.get('DEPTHDESK_MODELS_DIR')
    if not location:
        location = str(Path(os.environ.get('LOCALAPPDATA', Path.home() / '.cache')) / 'DepthDesk' / 'models')
    return Path(location).resolve()


def sha256(path: Path, check=lambda: None) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(4 * 1024 * 1024):
            check()
            digest.update(chunk)
    return digest.hexdigest()


def ensure_weights(model_id, progress, check) -> Path:
    entry = MANIFEST[model_id]
    destination = model_root() / model_id / entry['revision']
    destination.mkdir(parents=True, exist_ok=True)
    for name, expected_hash in entry['files'].items():
        check()
        target = destination / name
        if target.is_file():
            if expected_hash and sha256(target, check) != expected_hash:
                raise RuntimeError(f'Model checksum failed: {target.name}. Remove this model from the model cache and retry.')
            continue
        part = target.with_suffix(target.suffix + '.download')
        url = f"https://huggingface.co/{entry['repo']}/resolve/{entry['revision']}/{name}"
        progress('download', 0, f'Downloading {model_id}: {name}')
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'DepthDesk/1.0'})
            with urllib.request.urlopen(request, timeout=30) as response, part.open('wb') as stream:
                length = int(response.headers.get('Content-Length') or 0)
                received, last_report = 0, 0.0
                while chunk := response.read(1024 * 1024):
                    check()
                    stream.write(chunk)
                    received += len(chunk)
                    if time.monotonic() - last_report > 0.2:
                        progress('download', min(99, received * 100 / length) if length else 0,
                                 f'Downloading {name}: {received / 1048576:.1f} MB')
                        last_report = time.monotonic()
            check()
            if expected_hash and sha256(part, check) != expected_hash:
                raise RuntimeError('Downloaded model checksum does not match the pinned release.')
            os.replace(part, target)
        except Exception:
            part.unlink(missing_ok=True)
            raise
    return destination


def efficient_attention(self, x):
    batch, tokens, channels = x.shape
    qkv = self.qkv(x).reshape(batch, tokens, 3, self.num_heads, channels // self.num_heads)
    q, k, v = qkv.permute(2, 0, 3, 1, 4).unbind(0)
    result = F.scaled_dot_product_attention(q, k, v, dropout_p=0.0, scale=self.scale)
    return self.proj_drop(self.proj(result.transpose(1, 2).reshape(batch, tokens, channels)))


def efficient_temporal_attention(self, query, key, value, attention_mask=None):
    # Preserve attention scale and output layout while avoiding explicit scores.
    result = F.scaled_dot_product_attention(query.unsqueeze(1), key.unsqueeze(1),
                                           value.unsqueeze(1),
                                           attn_mask=None if attention_mask is None else attention_mask.unsqueeze(1),
                                           dropout_p=0.0, scale=self.scale).squeeze(1)
    return self.reshape_batch_dim_to_heads(result)


def chunked_forward(self, x):
    batch, temporal, _, height, width = x.shape
    outputs = []
    for part in x.flatten(0, 1).split(2):
        self._depthdesk_check()
        outputs.append(self.pretrained.get_intermediate_layers(
            part, self.intermediate_layer_idx[self.encoder], return_class_token=True))
    features = [tuple(torch.cat([item[layer][element] for item in outputs], dim=0)
                      for element in range(2)) for layer in range(4)]
    del outputs
    self._depthdesk_check()
    depth = self.head(features, height // 14, width // 14, temporal)[0]
    depth = F.interpolate(depth, size=(height, width), mode='bilinear', align_corners=True)
    return F.relu(depth).squeeze(1).unflatten(0, (batch, temporal))


class Predictor:
    def __init__(self, options, progress, check):
        self.model_id = options['model']
        self.device = 'cuda' if options['device'] == 'auto' and torch.cuda.is_available() else options['device']
        if self.device == 'auto':
            self.device = 'cpu'
        if self.device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA is unavailable. Install a current NVIDIA driver or choose CPU / Auto.')
        if self.device == 'cpu' and options['precision'] == 'fp16':
            raise ValueError('FP16 requires a CUDA GPU. Choose Auto or FP32 for CPU rendering.')
        self.half = self.device == 'cuda' and options['precision'] != 'fp32'
        self.check = check
        checkpoint = ensure_weights(self.model_id, progress, check)
        progress('model', 0, f'Loading {self.model_id} on {self.device.upper()}')
        if self.model_id == 'video-small':
            from video_depth_anything.video_depth import VideoDepthAnything
            from video_depth_anything.dinov2_layers.attention import Attention
            from video_depth_anything.motion_module.attention import CrossAttention
            Attention.forward = efficient_attention
            CrossAttention._attention = efficient_temporal_attention
            self.model = VideoDepthAnything(encoder='vits', features=64, out_channels=[48, 96, 192, 384])
            self.model.load_state_dict(torch.load(checkpoint / 'video_depth_anything_vits.pth',
                                                 map_location='cpu', weights_only=True), strict=True)
            self.model.forward = types.MethodType(chunked_forward, self.model)
            self.model._depthdesk_check = check
        else:
            from transformers import AutoModelForDepthEstimation, AutoImageProcessor
            self.processor = AutoImageProcessor.from_pretrained(str(checkpoint), local_files_only=True, use_fast=False)
            self.model = AutoModelForDepthEstimation.from_pretrained(str(checkpoint), local_files_only=True,
                                                                   use_safetensors=True)
        check()
        self.model.to(self.device).eval()

    def context(self):
        return torch.autocast(device_type='cuda', dtype=torch.float16) if self.half else contextlib.nullcontext()

    def prepare(self, rgb, input_size):
        from video_depth_anything.util.transform import Resize, NormalizeImage, PrepareForNet
        ratio = max(rgb.shape[:2]) / min(rgb.shape[:2])
        if ratio > 1.78:
            input_size = max(14, round(input_size * 1.777 / ratio / 14) * 14)
        resize = Resize(input_size, input_size, resize_target=False, keep_aspect_ratio=True,
                        ensure_multiple_of=14, resize_method='lower_bound',
                        image_interpolation_method=cv2.INTER_CUBIC)
        sample = resize({'image': rgb.astype(np.float32) / 255.0})
        sample = NormalizeImage([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])(sample)
        return torch.from_numpy(PrepareForNet()(sample)['image'])

    def image(self, rgb, input_size):
        self.check()
        inputs = self.processor(images=rgb, return_tensors='pt', size={'height': input_size, 'width': input_size})
        inputs = {key: value.to(self.device) for key, value in inputs.items()}
        with torch.inference_mode(), self.context():
            depth = self.model(**inputs).predicted_depth[0].float().cpu().numpy()
        self.check()
        return depth

    def temporal(self, prepared):
        self.check()
        self.model._depthdesk_check = self.check
        tensor = torch.stack(prepared).unsqueeze(0).to(self.device)
        with torch.inference_mode(), self.context():
            depths = self.model(tensor)[0].float().cpu().numpy()
        self.check()
        return depths


class ModelCache:
    """One GPU model at a time; parameter-only preview changes reuse it."""
    def __init__(self):
        self.key = None
        self.predictor = None

    def get(self, options, progress, check):
        key = (options['model'], options['device'], options['precision'])
        if self.key != key:
            self.clear()
            self.predictor = Predictor(options, progress, check)
            self.key = key
        self.predictor.check = check
        return self.predictor

    def clear(self):
        self.predictor = None
        self.key = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
