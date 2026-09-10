"""Explicitly approximate fast material maps, plus true AI depth-derived normals.

These are convenient compositor starting points, NOT inverse-rendered PBR
ground truth. Advanced mode calls separately licensed neural predictors.
"""
import cv2
import numpy as np

FAST_DESCRIPTIONS = {
    'source': 'Original RGB pixels',
    'depth': 'AI relative inverse depth',
    'normal': 'Approximate view-space normals derived from AI depth (not a tangent-space UV bake)',
    'basecolor': 'Approximate illumination-flattened source color, not measured albedo',
    'roughness': 'Approximate local-contrast roughness, not measured PBR',
    'metallic': 'Approximate color/highlight metallic heuristic, not measured PBR',
    'specular': 'Approximate image-highlight mask, not measured reflectance',
    'alpha': 'AI foreground segmentation (not manually refined production matting)',
}


def fast_maps(rgb, depth, requested, options):
    result = {}
    if 'source' in requested:
        result['source'] = rgb
    if 'depth' in requested:
        result['depth'] = depth if depth.dtype == np.uint8 else np.rint(np.clip(depth, 0, 1) * 255).astype(np.uint8)
    if 'normal' in requested:
        # Differentiate float depth before 8-bit export to avoid contour bands.
        linear = depth.astype(np.float32) / (255 if depth.dtype == np.uint8 else 1)
        linear = cv2.GaussianBlur(linear, (0, 0), 0.65)
        # Image-right = +X, image-up = +Y, toward camera = +Z.
        strength = options['normalStrength'] * min(rgb.shape[:2]) / 32
        dx = cv2.Sobel(linear, cv2.CV_32F, 1, 0, ksize=3) * strength
        dy = cv2.Sobel(linear, cv2.CV_32F, 0, 1, ksize=3) * strength
        normal = np.stack((-dx, dy, np.ones_like(dx)), axis=-1)
        normal /= np.maximum(np.linalg.norm(normal, axis=-1, keepdims=True), 1e-6)
        result['normal'] = np.rint((normal * 0.5 + 0.5) * 255).astype(np.uint8)
    if any(kind in requested for kind in ('basecolor', 'metallic', 'roughness', 'specular')):
        color = rgb.astype(np.float32) / 255
        luma = cv2.cvtColor(color, cv2.COLOR_RGB2GRAY)
        # Estimate broad illumination at reduced resolution, then reconstruct
        # the smooth field. Keep full-resolution source details for output.
        scale = min(1, 512 / max(rgb.shape[:2]))
        small = cv2.resize(luma, (max(2, round(luma.shape[1] * scale)), max(2, round(luma.shape[0] * scale))),
                           interpolation=cv2.INTER_AREA)
        sigma = max(2.0, min(small.shape[:2]) / 24)
        illumination = cv2.resize(cv2.GaussianBlur(small, (0, 0), sigma), (luma.shape[1], luma.shape[0]),
                                  interpolation=cv2.INTER_LINEAR)
        local = np.abs(luma - cv2.GaussianBlur(luma, (0, 0), 2.0))
        highlight = np.clip((luma - illumination) * 3.5, 0, 1)
        if 'basecolor' in requested:
            base = color * np.clip((float(illumination.mean()) + 0.1) / (illumination + 0.1), 0.55, 1.6)[..., None]
            result['basecolor'] = np.rint(np.clip(base, 0, 1) * 255).astype(np.uint8)
        if 'specular' in requested:
            result['specular'] = np.rint(highlight * 255).astype(np.uint8)
        if 'roughness' in requested:
            roughness = np.clip(0.8 - highlight * 0.6 + local * 1.5, 0.08, 1)
            result['roughness'] = np.rint(roughness * 255).astype(np.uint8)
        if 'metallic' in requested:
            saturation = color.max(axis=-1) - color.min(axis=-1)
            metallic = np.clip(saturation * 0.4 + highlight * 0.7 - 0.1, 0, 1)
            result['metallic'] = np.rint(metallic * 255).astype(np.uint8)
    return result
