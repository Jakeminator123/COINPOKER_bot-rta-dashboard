"""
Device identity helpers shared across scanner components.

Mirrors dashboard logic via config/redis_identity.json.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional


DEFAULT_PRIORITY = [
    "batch.nickname",
    "batch.device",
    "batch.system.host",
    "batch.device.hostname",
    "batch.meta.hostname",
    "signal.device_name",
    "device_id",
]


def _default_config_path() -> Path:
    override = os.getenv("REDIS_IDENTITY_PATH")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / "config" / "redis_identity.json"


def _load_priority() -> list[str]:
    config_path = _default_config_path()
    try:
        with config_path.open(encoding="utf-8") as fp:
            data = json.load(fp)
        priority = data.get("name_priority")
        if isinstance(priority, list) and priority:
            return priority
    except Exception:
        pass
    return DEFAULT_PRIORITY


NAME_PRIORITY = _load_priority()


def _looks_like_device_id(value: Optional[str]) -> bool:
    if not value:
        return False
    stripped = value.strip()
    if len(stripped) >= 32 and all(ch in "0123456789abcdefABCDEF" for ch in stripped):
        return True
    if "_" in stripped:
        parts = stripped.split("_")
        if len(parts) == 2 and all(
            len(p) >= 16 and all(ch in "0123456789abcdefABCDEF" for ch in p) for p in parts
        ):
            return True
    return False


def _sanitize(candidate: Optional[str], device_id: str) -> Optional[str]:
    if not candidate:
        return None
    trimmed = candidate.strip()
    if not trimmed or trimmed == device_id:
        return None
    if _looks_like_device_id(trimmed):
        return None
    return trimmed


def resolve_device_name(device_id: str, sources: dict[str, Optional[str]]) -> str:
    mapping = {
        "batch.nickname": sources.get("batchNickname"),
        "batch.device": sources.get("batchDevice"),
        "batch.system.host": sources.get("batchHost"),
        "batch.device.hostname": sources.get("batchDeviceHostname"),
        "batch.meta.hostname": sources.get("batchMetaHostname"),
        "signal.device_name": sources.get("signalDeviceName"),
        "device_id": device_id,
    }
    for key in NAME_PRIORITY:
        sanitized = _sanitize(mapping.get(key), device_id)
        if sanitized:
            return sanitized
    return device_id


