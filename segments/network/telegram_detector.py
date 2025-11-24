# segments/network/telegram_detector.py
"""
Telegram-based RTA/solver detection segment.
Detects active Telegram connections when CoinPoker is running.
Only reports when CoinPoker is active (relevant activity).
"""

from __future__ import annotations

import ipaddress
import time
from collections import defaultdict
from typing import Any

import psutil  # type: ignore
import requests

from core.api import BaseSegment
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown

# Windows-specific for foreground detection
try:
    import ctypes
    import ctypes.wintypes

    user32 = ctypes.windll.user32
except ImportError:
    user32 = None


class TelegramDetector(BaseSegment):
    """
    Detects active Telegram connections when CoinPoker is running.
    Only reports Telegram activity when CoinPoker is active (relevant threat).
    """

    name = "TelegramDetector"
    category = "network"
    interval_s = 92.0  # Synchronized with unified batch interval

    def __init__(self):
        super().__init__()

        # Load configuration from JSON
        self.config = self._load_config()

        # Load shared configuration
        self.shared_config = self._load_shared_config()

        # Telegram detection patterns
        self.telegram_cidr_url = "https://core.telegram.org/resources/cidr.txt"
        self.telegram_cidrs: list[ipaddress._BaseNetwork] = []
        self.last_cidr_fetch = 0
        self.cidr_fetch_interval = apply_cooldown(
            self.config["telegram_detection"]["cidr_fetch_interval"], allow_zero=False, minimum=60.0
        )

        # TDLib indicators
        self.tdlib_hints = tuple(self.config["telegram_detection"]["tdlib_hints"])

        # Known processes
        self.browser_names = set(self.config["telegram_detection"]["browser_names"])
        self.official_telegram = set(self.config["telegram_detection"]["official_telegram"])

        # Load poker sites from shared config
        poker_config = self.shared_config.get("poker_sites", {})
        protected = poker_config.get("protected", {})

        # PROTECTED poker client (the one we're securing)
        self.protected_poker = {
            "coinpoker": {
                "process": protected.get("process", "game.exe"),
                "path_hint": protected.get("path_hint", "coinpoker"),
                "class": protected.get("window_class", "Qt673QWindowIcon"),
            }
        }

        # OTHER poker sites (detected but not treated as threats)
        self.other_poker_processes = poker_config.get("other", [])

        # Tracking
        self._last_alerts: dict[str, float] = defaultdict(float)
        self._alert_cooldown = apply_cooldown(self.config["telegram_detection"]["alert_cooldown"])
        self._last_poker_fg = 0
        self._poker_fg_window = apply_cooldown(self.config["telegram_detection"]["poker_fg_window"])

        keepalive_seconds = float(self.config["telegram_detection"].get("keepalive_seconds", 45.0))
        keepalive_seconds = max(15.0, min(keepalive_seconds, 60.0))
        active_timeout = float(
            self.config["telegram_detection"].get("keepalive_active_timeout", 150.0)
        )
        if active_timeout < keepalive_seconds * 2:
            active_timeout = keepalive_seconds * 2
        self._keepalive = DetectionKeepalive(
            "network",
            keepalive_interval=keepalive_seconds,
            active_timeout=active_timeout,
        )

    def tick(self):
        """Main detection loop - only detect active Telegram connections when CoinPoker is active"""
        # Update Telegram CIDR ranges if needed
        self._update_telegram_cidrs()

        # Check if CoinPoker is active
        coinpoker_active, _ = self._check_poker_foreground()

        # Only detect Telegram when CoinPoker is active (relevant activity)
        if not coinpoker_active:
            self._keepalive.emit_keepalives()
            return

        # Get active Telegram connections
        tg_connections = self._find_telegram_connections()

        # Emit signals for active Telegram connections during CoinPoker
        if tg_connections:
            self._emit_telegram_activity(tg_connections)

        self._keepalive.emit_keepalives()

    def _load_config(self) -> dict[str, Any]:
        """Load configuration from config_loader (dashboard/cache/local)"""
        try:
            from utils.config_loader import get_config

            config = get_config("network_config")
            if config:
                return config
        except Exception as e:
            print(f"[TelegramDetector] WARNING: Config load failed: {e}")

        # Return default config (cleaned - only fields actually used)
        return {
            "telegram_detection": {
                "cidr_fetch_interval": 3600,
                "alert_cooldown": 120.0,
                "poker_fg_window": 15.0,
                "browser_names": [
                    "chrome.exe",
                    "msedge.exe",
                    "firefox.exe",
                    "brave.exe",
                    "opera.exe",
                ],
                "official_telegram": ["telegram.exe", "telegramdesktop.exe"],
                "tdlib_hints": ["tdjson.dll", "tdlib", "libtdjson"],
            }
        }

    def _load_shared_config(self):
        """Load shared configuration from config_loader"""
        try:
            from utils.config_loader import get_config

            config = get_config("shared_config")
            if config:
                return config
        except Exception as e:
            print(f"[TelegramDetector] WARNING: Shared config load failed: {e}")

        return {}

    def _get_fallback_cidrs(self) -> list[ipaddress._BaseNetwork]:
        """Get fallback Telegram CIDR ranges if fetch fails"""
        # Known Telegram IP ranges (updated periodically, but stable fallback)
        fallback_ranges = [
            "149.154.160.0/22",  # Telegram DC1
            "149.154.164.0/22",  # Telegram DC2
            "149.154.168.0/22",  # Telegram DC3
            "149.154.172.0/22",  # Telegram DC4
            "91.108.4.0/22",  # Telegram DC5
            "91.108.8.0/22",  # Telegram DC6
            "91.108.12.0/22",  # Telegram DC7
            "91.108.16.0/22",  # Telegram DC8
            "91.108.20.0/22",  # Telegram DC9
            "91.108.56.0/22",  # Telegram DC10
            "91.108.56.0/23",  # Telegram DC11
            "91.108.58.0/23",  # Telegram DC12
            "91.108.60.0/22",  # Telegram DC13
            "91.108.64.0/22",  # Telegram DC14
            "91.108.68.0/22",  # Telegram DC15
        ]

        cidrs = []
        for range_str in fallback_ranges:
            try:
                cidrs.append(ipaddress.ip_network(range_str))
            except Exception:
                continue
        return cidrs

    def _update_telegram_cidrs(self):
        """Fetch and update Telegram IP ranges"""
        now = time.time()

        # If we have CIDRs and haven't exceeded fetch interval, keep using them
        if self.telegram_cidrs and (now - self.last_cidr_fetch < self.cidr_fetch_interval):
            return

        # Try to fetch fresh CIDR ranges
        try:
            resp = requests.get(self.telegram_cidr_url, timeout=10)
            resp.raise_for_status()

            cidrs = []
            for line in resp.text.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                try:
                    cidrs.append(ipaddress.ip_network(line))
                except Exception:
                    continue

            if cidrs:
                self.telegram_cidrs = cidrs
                self.last_cidr_fetch = now
                print(f"[TelegramDetector] Loaded {len(cidrs)} Telegram CIDR ranges from network")

        except Exception as e:
            # Fetch failed - use fallback or keep existing CIDRs
            if not self.telegram_cidrs:
                # No CIDRs at all - use fallback
                fallback_cidrs = self._get_fallback_cidrs()
                if fallback_cidrs:
                    self.telegram_cidrs = fallback_cidrs
                    print(
                        f"[TelegramDetector] Using {len(fallback_cidrs)} fallback Telegram CIDR ranges (fetch failed: {e})"
                    )
                else:
                    print(
                        f"[TelegramDetector] WARNING: No Telegram CIDR ranges available (fetch failed: {e})"
                    )
            else:
                # Keep existing CIDRs if fetch fails (they're still valid)
                print(f"[TelegramDetector] Keeping existing CIDR ranges (fetch failed: {e})")

    def _check_poker_foreground(self) -> tuple:
        """Check if poker client is in foreground - returns (is_protected, is_other_poker)"""
        if not user32:
            return False, False

        try:
            # Get foreground window
            hwnd = user32.GetForegroundWindow()
            if not hwnd:
                return False, False

            # Get process ID and window info
            pid = ctypes.wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

            if pid.value:
                try:
                    proc = psutil.Process(pid.value)
                    proc_name = proc.name().lower()

                    # Check if it's PROTECTED poker (CoinPoker/game.exe)
                    if proc_name == "game.exe":
                        # Verify it's actually CoinPoker by checking window class or path
                        try:
                            class_name = ctypes.create_unicode_buffer(256)
                            user32.GetClassNameW(hwnd, class_name, 256)
                            if "qt673qwindowicon" in class_name.value.lower():
                                self._last_poker_fg = time.time()
                                return True, False  # Protected poker active
                        except Exception:
                            pass

                        # Also check process path as backup
                        try:
                            if "coinpoker" in proc.exe().lower():
                                self._last_poker_fg = time.time()
                                return True, False  # Protected poker active
                        except Exception:
                            pass

                    # Check if it's OTHER poker site
                    if any(poker in proc_name for poker in self.other_poker_processes):
                        return False, True  # Other poker site active

                except Exception:
                    pass

            # Check if protected poker was recently in foreground
            if time.time() - self._last_poker_fg <= self._poker_fg_window:
                return True, False

        except Exception:
            pass

        return False, False

    def _find_telegram_connections(self) -> list[dict[str, Any]]:
        """Find processes with active Telegram connections"""
        results = []

        # Ensure we have CIDR ranges (try to load if empty)
        if not self.telegram_cidrs:
            # Try to get fallback ranges if fetch hasn't happened yet
            fallback_cidrs = self._get_fallback_cidrs()
            if fallback_cidrs:
                self.telegram_cidrs = fallback_cidrs
                print("[TelegramDetector] Using fallback CIDR ranges for connection detection")
            else:
                # No CIDR ranges available - can't detect Telegram connections
                return results

        # Processes that should be excluded from Telegram detection
        # These are legitimate processes that may connect to Telegram IPs but aren't Telegram clients
        excluded_processes = {
            "python.exe",  # Python scripts (including our own scanner)
            "pythonw.exe",
            "pycharm64.exe",  # IDEs
            "code.exe",  # VS Code
            "cursor.exe",  # Cursor IDE
            "devenv.exe",  # Visual Studio
            "coinpokerscanner.exe",  # Our scanner
            "scanner.exe",
        }

        try:
            for proc in psutil.process_iter(["pid", "name", "exe"]):
                pid = proc.info.get("pid")
                name = (proc.info.get("name") or "").lower()
                exe = proc.info.get("exe") or ""

                # Skip excluded processes (legitimate tools that may connect to Telegram IPs)
                if name in excluded_processes:
                    continue

                # Skip if it's clearly a development/debugging tool
                exe_lower = exe.lower()
                if any(
                    skip in exe_lower
                    for skip in [
                        "python",
                        "pycharm",
                        "visual studio",
                        "microsoft visual studio",
                        "jetbrains",
                        "cursor",
                        "code",
                    ]
                ):
                    continue

                try:
                    connections = proc.connections(kind="inet")
                except Exception:
                    continue

                # Track active connections only (ESTABLISHED state)
                active_telegram_conns = []
                for conn in connections:
                    if not conn.raddr:
                        continue

                    # CRITICAL: Only count ESTABLISHED connections (active traffic)
                    # Ignore TIME_WAIT, CLOSE_WAIT, LISTEN, etc. (inactive/idle connections)
                    if conn.status != "ESTABLISHED":
                        continue

                    remote_ip = conn.raddr.ip
                    if self._ip_in_telegram_ranges(remote_ip):
                        # ESTABLISHED connection to Telegram IP = active communication
                        # No need to check I/O counters - ESTABLISHED state means active connection
                        active_telegram_conns.append(conn)

                # Only report if there are ACTIVE Telegram connections
                if active_telegram_conns:
                    # Check for TDLib
                    has_tdlib = self._process_has_tdlib(proc)

                    # Get connection details from first active connection
                    first_conn = active_telegram_conns[0]
                    results.append(
                        {
                            "pid": pid,
                            "name": name,
                            "exe": exe,
                            "local_addr": f"{first_conn.laddr.ip}:{first_conn.laddr.port}",
                            "remote_addr": f"{first_conn.raddr.ip}:{first_conn.raddr.port}",
                            "status": first_conn.status,
                            "active_connections": len(active_telegram_conns),
                            "has_tdlib": has_tdlib,
                            "is_browser": name in self.browser_names,
                            "is_official": name in self.official_telegram,
                        }
                    )

        except Exception:
            pass

        return results

    def _ip_in_telegram_ranges(self, ip: str) -> bool:
        """Check if IP is in Telegram ranges"""
        try:
            ip_addr = ipaddress.ip_address(ip)
            return any(ip_addr in net for net in self.telegram_cidrs)
        except Exception:
            return False

    def _process_has_tdlib(self, proc: psutil.Process) -> bool:
        """Check if process has TDLib loaded"""
        try:
            # Check memory maps for TDLib
            for mm in proc.memory_maps():
                path = (mm.path or "").lower()
                if any(hint in path for hint in self.tdlib_hints):
                    return True
        except Exception:
            pass

        # Check exe and cmdline as fallback
        try:
            exe = (proc.info.get("exe") or "").lower()
            if any(hint in exe for hint in self.tdlib_hints):
                return True

            cmdline = " ".join(proc.cmdline() or []).lower()
            if any(hint in cmdline for hint in self.tdlib_hints):
                return True
        except Exception:
            pass

        return False

    def _emit_telegram_activity(self, tg_connections: list[dict]):
        """Emit Telegram Activity signals when CoinPoker is active and Telegram has active traffic"""
        from core.api import post_signal

        now = time.time()

        # Consolidate Telegram connections by process
        by_pid = defaultdict(list)
        for conn in tg_connections:
            by_pid[conn["pid"]].append(conn)

        for pid, conns in by_pid.items():
            if not conns:
                continue

            proc_info = conns[0]
            alert_key = f"telegram_activity:{pid}"

            # Cooldown check
            if now - self._last_alerts[alert_key] < self._alert_cooldown:
                self._keepalive.refresh_alias(alert_key)
                continue

            # Build signal details
            name = proc_info["name"]
            active_conn_count = proc_info.get("active_connections", len(conns))
            has_tdlib = proc_info["has_tdlib"]
            is_official = proc_info["is_official"]

            # CRITICAL: Only report if there are ACTIVE connections (ESTABLISHED state)
            # This ensures we only detect when Telegram is actually being used, not just running
            if active_conn_count == 0:
                continue  # Skip - no active connections

            # Determine severity: CRITICAL for custom/unofficial clients, ALERT for official
            if has_tdlib or not is_official:
                status = "CRITICAL"  # Custom/unofficial client during CoinPoker
            else:
                status = "ALERT"  # Official Telegram during CoinPoker

            details = f"pid={pid} name={name} active_conns={active_conn_count}"
            if has_tdlib:
                details += " tdlib=yes"
            if not is_official:
                details += " unofficial=yes"
            details += " | CoinPoker active (protected site)"

            post_signal("network", "Telegram Activity", status, details)
            self._last_alerts[alert_key] = now
            detection_key = f"{alert_key}:{status}"
            self._keepalive.mark_active(
                detection_key,
                "Telegram Activity",
                status,
                details,
            alias=alert_key,
            )
