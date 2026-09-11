"""Strict wire validation; defaults follow the upstream UI, not stale README."""
from dataclasses import asdict
import math
from .grid import GridParams
from .processor import RenderConfig
from .ffmpeg_utils import QUALITY_PRESETS


def defaults():
    value = asdict(RenderConfig(methods={"A": False, "B": False, "C": False}, use_grid=True))
    value["grid"]["color"] = list(value["grid"]["color"])
    return value


def _number(value, name, low, high, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{name}: {low}~{high} 범위의 숫자가 필요합니다.")
    if integer and int(value) != value:
        raise ValueError(f"{name}: 정수가 필요합니다.")
    return int(value) if integer else float(value)


def validate_options(raw):
    if not isinstance(raw, dict):
        raise ValueError("Cloak options must be an object.")
    value = defaults()
    if set(raw) - set(value):
        raise ValueError("Unknown Cloak option.")
    value.update(raw)
    for name in ("use_grid", "tracking", "pad_enabled"):
        if not isinstance(value[name], bool):
            raise ValueError(f"{name} must be boolean")
    if not isinstance(value["methods"], dict) or set(value["methods"]) != {"A", "B", "C"} or any(not isinstance(v, bool) for v in value["methods"].values()):
        raise ValueError("methods must contain boolean A, B and C")
    if value["quality"] not in QUALITY_PRESETS or value["roi_shape"] not in ("ellipse", "rect"):
        raise ValueError("Invalid quality or roi_shape")
    if value["pad_position"] not in ("before", "after"):
        raise ValueError("pad_position must be before or after")
    for name, lo, hi in (("eps", 2, 30), ("strength", .01, .20), ("pad_seconds", 1, 15),
                         ("detect_score", .05, .99), ("man_cx", 0, 1), ("man_cy", 0, 1),
                         ("man_w", .05, 1), ("man_h", .05, 1)):
        value[name] = _number(value[name], name, lo, hi)
    supplied = value["grid"]
    gp = asdict(GridParams())
    if not isinstance(supplied, dict) or set(supplied) - set(gp):
        raise ValueError("Invalid grid options")
    gp.update(supplied)
    for name, lo, hi in (("rows", 1, 20), ("cols", 1, 20), ("thickness", 1, 8), ("dot_radius", 1, 8)):
        gp[name] = _number(gp[name], "grid." + name, lo, hi, True)
    for name, lo, hi in (("opacity", .05, 1), ("margin", 0, .4)):
        gp[name] = _number(gp[name], "grid." + name, lo, hi)
    for name in ("auto_thickness", "align_angle", "dots", "line_aa"):
        if not isinstance(gp[name], bool):
            raise ValueError(f"grid.{name} must be boolean")
    if gp["shape"] not in ("ellipse", "rect"):
        raise ValueError("Invalid grid shape")
    if not isinstance(gp["color"], (tuple, list)) or len(gp["color"]) != 3:
        raise ValueError("grid.color must contain three BGR channels")
    gp["color"] = tuple(_number(c, "grid.color", 0, 255, True) for c in gp["color"])
    value["grid"] = GridParams(**gp)
    return RenderConfig(**value)
