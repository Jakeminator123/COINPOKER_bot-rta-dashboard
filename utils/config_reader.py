"""
Configuration Reader
====================
Helper functions for reading config.txt and parsing settings.
"""

import contextlib
import os
import sys
from typing import Any, Dict, Optional

try:
    from core.runtime_config_embedded import CONFIG_TEXT as EMBEDDED_CONFIG_TEXT
except ImportError:
    EMBEDDED_CONFIG_TEXT = None


DEFAULT_CONFIG_TEXT = """# ====================================
# Bot Detection System Configuration
# ====================================

# --- Environment ---
ENV=PROD                              # DEV eller PROD
INPUT_DEBUG=1                        # Debug logging (0=off, 1=on)

# --- Batch System ---
BATCH_INTERVAL_HEAVY=92              # Batch-rapporter skickas var 92:e sekund
NEW_BATCHES_LOG=n                     # Spara batch-loggar lokalt (debugging)
BATCH_LOG_DIR=jay                    # Mapp där batch-loggar sparas (default: batch_logs)

# --- Forwarder-läge (väljer hur batchar skickas) ---
# OPTION 1 – Direkt till Redis (snabbast, bypass HTTP)
#   • Ange REDIS_URL
#   • Sätt FORWARDER_MODE=redis (eller auto för fallback)
#   • WEB kan vara n
#
# OPTION 2 – Via webb-API (dashboard postar vidare till Redis)
#   • Lämna REDIS_URL kommenterad
#   • Sätt WEB=y och ange WEB_URL_*
#   • FORWARDER_MODE=web (eller auto om du vill kunna falla tillbaka)
#
# All metadata (nickname, device_id, device_name, IP osv) följer alltid med.

# --- HTTP Dashboard (Option 2) ---
WEB=n                                # y=Skicka batchar till dashboardens HTTP-endpoint
TESTING_JSON=y                       # Lägg till metadata i batches (förklarar systemflödet)

# Dashboard URL för att hämta detection configs (alltid aktiv)
DASHBOARD_URL=https://bot-rta-dashboard-2.onrender.com/api

# Web forwarder settings (endast om WEB=y)
#WEB_URL_DEV=http://localhost:3001/api/signal
WEB_URL_PROD=https://bot-rta-dashboard-2.onrender.com/api/signal
SIGNAL_TOKEN=detector-secret-token-2024
WEB_FORWARDER_TIMEOUT=10             # Timeout för HTTP requests när batchar skickas

# --- Direkt Redis (Option 1) ---
REDIS_URL=redis://default:RmJmzvxtcg4PpDPCEly7ap7sHdpgQhmR@redis-12756.c44.us-east-1-2.ec2.redns.redis-cloud.com:12756
REDIS_TTL_SECONDS=604800                      # TTL för Redis-keys (default: 7 dagar)

FORWARDER_MODE=redis                  # web=HTTP, redis=Redis, auto=försök Redis → HTTP fallback

# --- Detection Features ---
ENABLEHASHLOOKUP=true                # Hash database lookups
ENABLEONLINELOOKUPS=true             # Online API calls (VirusTotal)
CHECKSIGNATURES=true                 # Digital signature verification
VirusTotalAPIKey=3dc67831fd53e5691fe568944041d9cb4894221be33ed06cf5221cea20b7686b

# --- Runtime Tweaks ---
# IMPORTANT (English):
# SYNC_SEGMENTS ensures every detection segment starts and ticks at the same time (no staggered delay).
# COOLDOWN_MULTIPLIER scales EVERY per-segment cooldown/cache globally: 1.0 = default behaviour,
# values <1 speed up detections (e.g. 0 = no throttling, warnings fire immediately),
# values >1 slow things down (useful if signals are too noisy). Change once here instead of per file.
SYNC_SEGMENTS=Y                      # Sprid ut segment-start över första 92s perioden
COOLDOWN_MULTIPLIER=0                # Standard cooldowns (0=av, 1=normal, 2=dubbel)

# --- Detection Segments (intervall i sekunder för varje segment) ---
PROGRAMS=92                          # ProcessScanner - intervall mellan skanningar
AUTO=92                              # AutomationDetector - intervall mellan skanningar
NETWORK=92                           # WebMonitor/TrafficMonitor - intervall mellan skanningar
BEHAVIOUR=92                         # BehaviourDetector - intervall mellan skanningar
VM=92                                # VMDetector - intervall mellan skanningar
SCREEN=92                            # ScreenDetector - intervall mellan skanningar

# --- Security ---
RAM_CONFIG=n                         # n=använd disk-cache, y=endast RAM (tamper-proof)
"""

_runtime_override: dict[str, Any] | None = None


def _apply_config_line(cfg: dict[str, Any], line: str) -> None:
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        return
    key, value = line.split("=", 1)
    key = key.strip()
    value = value.strip()
    if "#" in value:
        value = value.split("#")[0].strip()
    if not key:
        return
    if key == "HEARTBEAT_SECONDS":
        with contextlib.suppress(ValueError):
            cfg[key] = int(value)
    else:
        cfg[key] = value


def get_default_config() -> dict[str, Any]:
    """Return embedded default config values."""
    cfg = {
        "ENV": "TEST",
        "HEARTBEAT_SECONDS": 30,
    }
    config_text = EMBEDDED_CONFIG_TEXT or DEFAULT_CONFIG_TEXT
    for line in config_text.splitlines():
        _apply_config_line(cfg, line)
    return cfg


def set_config_override(config: dict[str, Any] | None) -> None:
    """Override config values for current runtime (e.g., GUI edits)."""
    global _runtime_override
    _runtime_override = dict(config) if config else None


def read_config(config_path: str = None) -> dict[str, Any]:
    """Reads simple key=value settings."""
    if config_path is None:
        if getattr(sys, "frozen", False):
            config_path = os.path.join(os.path.dirname(sys.executable), "config.txt")
        else:
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            config_path = os.path.join(project_root, "config.txt")

    cfg = get_default_config()
    try:
        if os.path.exists(config_path):
            with open(config_path, encoding="utf-8") as f:
                for line in f:
                    _apply_config_line(cfg, line)
    except Exception:
        pass

    if _runtime_override:
        cfg.update(_runtime_override)

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
