"""Runtime feature flags and global tuning helpers."""

from __future__ import annotations

import os
from functools import lru_cache

from utils.config_reader import read_config


@lru_cache(maxsize=1)
def _load_txt_config() -> dict[str, str]:
    """Read config.txt once (best-effort)."""
    try:
        return read_config()
    except Exception:
        return {}


def _get_setting(name: str) -> str | None:
    """Return setting from env or config.txt."""
    env_val = os.environ.get(name)
    if env_val is not None:
        return env_val
    cfg = _load_txt_config()
    return cfg.get(name)


def get_cooldown_multiplier(default: float = 1.0) -> float:
    """
    Global multiplier applied to per-segment cooldowns and caches.

    Set COOLDOWN_MULTIPLIER=0 in config.txt or env to disable throttling,
    or any positive float (e.g. 0.25) to scale values proportionally.
    """
    raw = _get_setting("COOLDOWN_MULTIPLIER")
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return max(0.0, value)


def apply_cooldown(base_value: float, *, minimum: float | None = None, allow_zero: bool = True) -> float:
    """
    Scale a cooldown/cache duration using the global multiplier.

    Args:
        base_value: Original cooldown value.
        minimum: Optional floor for scaled values (used when zero is undesirable).
        allow_zero: If False, returns `minimum` or `base_value` when multiplier hits zero.
    """
    multiplier = get_cooldown_multiplier()
    scaled = base_value * multiplier

    if scaled <= 0.0:
        if not allow_zero:
            if minimum is not None:
                return minimum
            return base_value
        return 0.0

    if minimum is not None and scaled < minimum:
        return minimum

    return scaled


def sync_segments_enabled(default: bool = False) -> bool:
    """
    Returns True when all segments should tick simultaneously (no staggering).

    Controlled via SYNC_SEGMENTS=Y in config.txt or environment.
    """
    raw = _get_setting("SYNC_SEGMENTS")
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "y", "yes", "on"}

