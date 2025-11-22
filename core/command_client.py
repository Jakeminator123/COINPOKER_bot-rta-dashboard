"""
Dashboard Command Client
========================
Fetches remote commands queued from the web dashboard and reports results
back once executed locally on the Windows scanner.
"""

from __future__ import annotations

import hashlib
import os
import socket
import time
from typing import Any

import requests

from utils.config_loader import get_config_loader
from utils.config_reader import get_signal_token, read_config


class DashboardCommandClient:
    """Simple HTTP client for dashboard command queue."""

    def __init__(
        self,
        device_id: str | None = None,
        poll_interval: float = 2.0,
    ) -> None:
        self.session = requests.Session()
        self.poll_interval = poll_interval
        self._last_fetch = 0.0

        self.device_id = device_id or self._compute_device_id()
        self.api_base = self._resolve_api_base()
        self.commands_url = f"{self.api_base}/device-commands"
        self.results_url = f"{self.api_base}/device-commands/result"
        self.token = self._resolve_token()
        
        # Backoff state for handling 503/429 errors
        self._backoff_until = 0.0  # Timestamp when we can retry after backoff
        self._backoff_seconds = 0.0  # Current backoff duration
        self._consecutive_errors = 0  # Count of consecutive 503/429 errors
        self._last_backoff_log = 0.0  # Timestamp of last backoff log message

    def _compute_device_id(self) -> str:
        hostname = socket.gethostname()
        return hashlib.md5(hostname.encode()).hexdigest()

    def _resolve_api_base(self) -> str:
        loader = get_config_loader()
        base_url = getattr(loader, "base_url", "http://127.0.0.1:3001/api")
        return base_url.rstrip("/")

    def _resolve_token(self) -> str | None:
        cfg = read_config()
        return get_signal_token(cfg)

    def fetch_commands(self) -> list[dict[str, Any]]:
        """Poll dashboard for pending commands."""
        now = time.time()
        
        # Check if we're in backoff period
        if now < self._backoff_until:
            return []  # Skip fetch during backoff
        
        # Check normal poll interval
        if now - self._last_fetch < self.poll_interval:
            return []

        self._last_fetch = now

        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        params = {"deviceId": self.device_id, "limit": 5}

        try:
            response = self.session.get(
                self.commands_url,
                params=params,
                headers=headers,
                timeout=5,
            )
            
            # Check for rate limiting before raising for status
            if response.status_code in (503, 429):
                # Server overloaded or rate limited - apply exponential backoff
                self._consecutive_errors += 1
                # Exponential backoff: 30s, 60s, 120s, 240s, max 600s (10 min)
                self._backoff_seconds = min(30 * (2 ** (self._consecutive_errors - 1)), 600)
                self._backoff_until = now + self._backoff_seconds
                self._last_backoff_log = now
                
                error_type = "Rate limited" if response.status_code == 429 else "Service unavailable"
                print(f"[CommandClient] Dashboard returned {response.status_code} ({error_type})")
                print(f"[CommandClient] Backoff: waiting {int(self._backoff_seconds)}s before retry (attempt {self._consecutive_errors})")
                return []
            
            response.raise_for_status()
            data = response.json()

            if isinstance(data, dict) and data.get("ok") and isinstance(data.get("data"), dict):
                # Success - reset backoff
                if self._consecutive_errors > 0:
                    print("[CommandClient] Dashboard recovered - resetting backoff")
                self._consecutive_errors = 0
                self._backoff_until = 0.0
                self._backoff_seconds = 0.0
                self._last_backoff_log = 0.0
                
                commands = data["data"].get("commands", [])
                if isinstance(commands, list):
                    return commands
        except requests.exceptions.RequestException as exc:
            # Only log if not a 503/429 (those are handled above)
            if not (hasattr(exc, 'response') and exc.response and exc.response.status_code in (503, 429)):
                print(f"[CommandClient] Fetch error: {exc}")
        except Exception as exc:  # pylint: disable=broad-except
            print(f"[CommandClient] Unexpected fetch error: {exc}")

        return []

    def send_result(
        self,
        command: dict[str, Any],
        success: bool,
        output: dict[str, Any] | None = None,
        error: str | None = None,
        admin_required: bool = False,
    ) -> None:
        """Send command execution result back to dashboard."""
        payload = {
            "commandId": command.get("id"),
            "deviceId": self.device_id,
            "command": command.get("command"),
            "success": success,
            "output": output,
            "error": error,
            "adminRequired": admin_required,
            "requireAdmin": command.get("requireAdmin", False),
        }

        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        try:
            response = self.session.post(
                self.results_url,
                headers=headers,
                json=payload,
                timeout=5,
            )
            response.raise_for_status()
        except requests.exceptions.RequestException as exc:
            print(f"[CommandClient] Result error: {exc}")
