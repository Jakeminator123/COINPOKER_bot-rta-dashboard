"""
Configuration Reader
====================
Helper functions for reading config.txt and parsing settings.
"""

import contextlib
import os
import sys
from typing import Any, Dict, Optional


def read_config(config_path: str = None) -> dict[str, Any]:
    """Reads simple key=value from ./config.txt (if it exists)."""
    if config_path is None:
        # Handle both script and .exe execution
        if getattr(sys, "frozen", False):
            # Running as .exe - config should be next to the executable
            config_path = os.path.join(os.path.dirname(sys.executable), "config.txt")
        else:
            # Running as script - config is in project root (one level up from utils/)
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            config_path = os.path.join(project_root, "config.txt")

    cfg = {
        "ENV": "TEST",
        "HEARTBEAT_SECONDS": 30,  # 0 = off
    }
    try:
        if os.path.exists(config_path):
            with open(config_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip()
                    # Remove inline comments
                    if "#" in v:
                        v = v.split("#")[0].strip()
                    if k == "HEARTBEAT_SECONDS":
                        with contextlib.suppress(ValueError):
                            cfg[k] = int(v)
                    else:
                        cfg[k] = v
    except Exception:
        pass
    # Environment variables can override
    cfg["ENV"] = os.environ.get("ENV", cfg["ENV"])
    return cfg


def get_web_url(env: str, cfg: dict[str, Any]) -> str:
    """Get correct web URL based on ENV setting."""
    if env == "DEV":
        # Check environment variable first, then config
        url = os.environ.get("WEB_URL_DEV") or cfg.get("WEB_URL_DEV")
        if url:
            return url
    elif env == "PROD":
        # Check environment variable first, then config
        url = os.environ.get("WEB_URL_PROD") or cfg.get("WEB_URL_PROD")
        if url:
            return url

    # Fallback to old WEB_URL or default
    return os.environ.get("WEB_URL") or cfg.get("WEB_URL") or "http://127.0.0.1:3001/api/signal"


def get_signal_token(cfg: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """
    Resolve SIGNAL_TOKEN with consistent precedence:
    1. Environment variable
    2. Provided cfg dict (typically read_config output)
    3. Fresh config load (only if cfg not provided)
    """
    token = os.environ.get("SIGNAL_TOKEN")
    if token:
        return token

    if cfg is not None:
        token = cfg.get("SIGNAL_TOKEN")
        if token:
            return token

    # As a last resort, read config lazily so callers without cfg can still resolve it.
    fallback_cfg = read_config() if cfg is None else None
    if fallback_cfg:
        token = fallback_cfg.get("SIGNAL_TOKEN")
        if token:
            return token
    return None
