"""Explicit model preparation and offline readiness; never imports Torch.

Status and inference resolve only local immutable-revision files. Network access
exists exclusively in download_model, called by the explicit model/setup action.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request
from model_specs import MODEL_SPECS

DEPTH_SPECS = {
    'video-small': {
        'repo': 'depth-anything/Video-Depth-Anything-Small',
        'revision': '256875362cff76724b920335dfb4b29dd611f66e',
        'files': {'video_depth_anything_vits.pth': '13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609'},
    },
    'image-small': {
        'repo': 'depth-anything/Depth-Anything-V2-Small-hf',
        'revision': '5426e4f0f36572d16453bbda7a8389317b1bef99',
        'files': {'config.json': None, 'preprocessor_config.json': None,
                  'model.safetensors': '3152477ce0d8d6978d76b995120de97cb5b928701fd0f817769f59e249a16b70'},
    },
}
NAMES = {'image-small': 'Depth Anything V2 Small', 'video-small': 'Video Depth Anything Small',
         'alpha-fast': 'BiRefNet Lite · 빠른 Alpha', 'alpha-advanced': 'BiRefNet Matting · 고급 Alpha',
         'normal': 'Marigold Normals · 고급 Normal', 'appearance': 'Marigold Appearance · 고급 재질 맵'}
DIFFUSION_CONFIGS = ['model_index.json', 'scheduler/scheduler_config.json',
                     'text_encoder/config.json', 'unet/config.json', 'vae/config.json',
                     'tokenizer/special_tokens_map.json', 'tokenizer/tokenizer_config.json',
                     'tokenizer/vocab.json', 'tokenizer/merges.txt']
_verified = {}


def specs():
    # Metadata only: never import advanced_maps/NumPy on the catalog thread.
    return {**DEPTH_SPECS, **MODEL_SPECS}


def model_root():
    return Path(os.environ.get('DEPTHDESK_MODELS_DIR') or
                str(Path(os.environ.get('LOCALAPPDATA', Path.home() / '.cache')) / 'DepthDesk' / 'models')).resolve()


def primary_destination(model_id):
    spec = specs()[model_id]
    if model_id in DEPTH_SPECS:
        return model_root() / model_id / spec['revision']
    # Match the old huggingface_hub snapshot cache, including explicit overrides.
    hub = Path(os.environ.get('HF_HUB_CACHE') or os.environ.get('HUGGINGFACE_HUB_CACHE') or
               str(Path(os.environ.get('HF_HOME') or model_root()) / 'hub'))
    return hub / ('models--' + spec['repo'].replace('/', '--')) / 'snapshots' / spec['revision']


def candidate_destinations(model_id):
    """Exact-revision cache paths only, no arbitrary directory scans/downloads."""
    spec = specs()[model_id]
    primary = primary_destination(model_id)
    hubs = [model_root() / 'hub', Path.home() / '.cache' / 'huggingface' / 'hub']
    if os.environ.get('XDG_CACHE_HOME'):
        hubs.append(Path(os.environ['XDG_CACHE_HOME']) / 'huggingface' / 'hub')
    for name in ('HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE'):
        if os.environ.get(name):
            hubs.insert(0, Path(os.environ[name]))
    if os.environ.get('HF_HOME'):
        hubs.insert(0, Path(os.environ['HF_HOME']) / 'hub')
    paths = [primary, *(hub / ('models--' + spec['repo'].replace('/', '--')) /
                         'snapshots' / spec['revision'] for hub in hubs)]
    return list(dict.fromkeys(paths))


def destination(model_id, check=lambda: None):
    # An already complete publisher cache can be used directly, without copying
    # GBs or writing model files into it. Incomplete/other revisions never count.
    files = required_files(model_id)
    for folder in candidate_destinations(model_id):
        try:
            if folder.is_dir() and all(validate_file(folder / name, checksum, check)
                                       for name, checksum in files.items()):
                return folder
        except OSError:
            continue
    # New downloads always go to the established app/configured destination,
    # never an unrelated partially downloaded fallback cache.
    return primary_destination(model_id)


def required_files(model_id):
    spec = specs()[model_id]
    if model_id in DEPTH_SPECS:
        return spec['files']
    files = {**spec['weights'], **spec.get('code', {})}
    if 'code' not in spec:
        files.update({name: None for name in DIFFUSION_CONFIGS})
    return files


def validate_file(file, checksum, check=lambda: None):
    check()
    if not file.is_file():
        return False
    stat = file.stat()
    if not stat.st_size:
        return False
    identity = (str(file.resolve()), stat.st_size, stat.st_mtime_ns, checksum)
    if identity in _verified:
        return True
    if checksum:
        digest = hashlib.sha256()
        with file.open('rb') as stream:
            while chunk := stream.read(4 * 1024 * 1024):
                check()
                digest.update(chunk)
        if digest.hexdigest() != checksum:
            return False
    elif file.suffix == '.json':
        try:
            if not isinstance(json.loads(file.read_text(encoding='utf-8')), dict):
                return False
        except (ValueError, UnicodeError):
            return False
    # Limit cached identities to avoid retaining removed revisions indefinitely.
    if len(_verified) > 512:
        _verified.clear()
    _verified[identity] = True
    return True


def readiness(model_id, check=lambda: None):
    if model_id not in NAMES:
        raise ValueError('알 수 없는 모델입니다.')
    folder = destination(model_id, check)
    for name, checksum in required_files(model_id).items():
        check()
        if not validate_file(folder / name, checksum, check):
            return False, f'다운로드 또는 무결성 재확인이 필요합니다: {name}'
    return True, ''


def catalog(check=lambda: None):
    models = []
    for model_id, name in NAMES.items():
        spec = specs()[model_id]
        try:
            ready, reason = readiness(model_id, check)
        except OSError:
            ready, reason = False, '모델 캐시를 읽을 수 없습니다. 저장 공간과 접근 권한을 확인해 주세요.'
        models.append(dict(id=model_id, name=name, ready=ready, builtin=model_id in DEPTH_SPECS,
                           repo=spec['repo'], revision=spec['revision'], license=spec.get('license', 'Apache-2.0'),
                           **({'reason': reason} if reason else {})))
    return dict(models=models, basicReady=all(item['ready'] for item in models if item['builtin']))


def require_model(model_id, check=lambda: None):
    ready, _ = readiness(model_id, check)
    if not ready:
        raise RuntimeError(f'MODEL_DOWNLOAD_REQUIRED:{model_id} · 모델 관리에서 {NAMES[model_id]} 다운로드를 먼저 완료해 주세요. 추론은 자동 다운로드하지 않습니다.')
    return destination(model_id, check)


def download_model(model_id, progress, check):
    if model_id not in NAMES:
        raise ValueError('알 수 없는 모델입니다.')
    spec, files, folder = specs()[model_id], required_files(model_id), destination(model_id, check)
    folder.mkdir(parents=True, exist_ok=True)
    for index, (name, checksum) in enumerate(files.items()):
        check()
        target = folder / name
        progress('verify', index / len(files), f'{NAMES[model_id]} · 기존 파일 확인: {name}')
        if validate_file(target, checksum, check):
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(target.suffix + '.magimagic-download')
        url = f"https://huggingface.co/{spec['repo']}/resolve/{spec['revision']}/{name}"
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'MagiMagic/0.3.4 model-setup'})
            with urllib.request.urlopen(request, timeout=20) as response, part.open('wb') as stream:
                length = int(response.headers.get('Content-Length') or 0)
                received, last_report = 0, 0.0
                while True:
                    check()
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    stream.write(chunk)
                    received += len(chunk)
                    if time.monotonic() - last_report > .15:
                        fraction = min(.99, received / length) if length else 0
                        progress('download', (index + fraction) / len(files), f'{name} · {received / 1048576:.1f} MB 다운로드')
                        last_report = time.monotonic()
            check()
            # Preserve the final suffix for JSON validation of the temporary file.
            if not part.is_file() or not part.stat().st_size:
                raise RuntimeError('다운로드한 모델 파일이 비어 있습니다.')
            if checksum and not validate_file(part, checksum, check):
                raise RuntimeError('다운로드 모델의 SHA-256이 고정된 배포본과 일치하지 않습니다.')
            if name.endswith('.json') and not isinstance(json.loads(part.read_text(encoding='utf-8')), dict):
                raise RuntimeError('다운로드한 모델 설정이 올바르지 않습니다.')
            os.replace(part, target)
        finally:
            part.unlink(missing_ok=True)
    require_model(model_id, check)
    progress('done', 1, f'{NAMES[model_id]} · 다운로드와 무결성 확인 완료')
    return catalog(check)
