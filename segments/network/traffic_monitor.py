# segments/network/traffic_monitor.py
"""
Network traffic monitoring segment for detecting suspicious patterns.
Detects RTA/bot communication patterns during poker play.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Any

import psutil  # type: ignore

from core.api import BaseSegment, post_signal
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown


class TrafficMonitor(BaseSegment):
    """
    Monitors network traffic for suspicious patterns:
    - Periodic upstream spikes (screenshot uploads)
    - Telegram/Discord communication during play
    - STUN/WebRTC traffic (screen sharing)
    - Suspicious connection patterns
    """

    name = "TrafficMonitor"
    category = "network"
    interval_s = 92.0  # Synchronized with unified batch interval

    def __init__(self):
        super().__init__()

        # Load configuration
        self.config = self._load_config()
        self.shared_config = self._load_shared_config()

        self._last_connections = set()
        self._traffic_history = defaultdict(lambda: deque(maxlen=15))
        self._last_alert = defaultdict(float)
        self._alert_cooldown = apply_cooldown(self.config["traffic_monitoring"]["alert_cooldown"])

        # Cache for net_connections to reduce CPU
        self._connections_cache = []
        self._connections_cache_time = 0
        self._connections_cache_ttl = apply_cooldown(
            self.config["traffic_monitoring"]["connections_cache_ttl"]
        )

        # Grouped signal tracking
        self._grouped_alerts: dict[str, float] = {}  # group_key -> last_alert_time
        self._group_window = apply_cooldown(30.0)  # Group similar alerts within scaled window

        # Suspicious ports and services from config
        # Handle both old format (string) and new format (dict with label/description)
        raw_ports = self.config["traffic_monitoring"]["suspicious_ports"]
        self.suspicious_ports = {}
        for k, v in raw_ports.items():
            port = int(k)
            if isinstance(v, dict):
                # New format: {"label": "RTMP", "description": "Streaming protocol"}
                self.suspicious_ports[port] = v.get("label", str(port))
            else:
                # Old format: "RTMP (Streaming)"
                self.suspicious_ports[port] = v

        # Suspicious domains from config - check multiple locations for backwards compatibility
        # New structure: web_monitoring.suspicious_domains, communication_patterns, remote_access_patterns
        # Old structure: traffic_monitoring.suspicious_domains
        self.suspicious_domains = {}
        
        # Try new structure first (web_monitoring section)
        web_mon = self.config.get("web_monitoring", {})
        if web_mon.get("suspicious_domains"):
            self.suspicious_domains.update(web_mon["suspicious_domains"])
        if web_mon.get("communication_patterns"):
            self.suspicious_domains.update(web_mon["communication_patterns"])
        if web_mon.get("remote_access_patterns"):
            self.suspicious_domains.update(web_mon["remote_access_patterns"])
        
        # Fallback to old structure if nothing found
        if not self.suspicious_domains:
            self.suspicious_domains = self.config["traffic_monitoring"].get("suspicious_domains", {})

        # Load poker sites from shared config
        poker_config = self.shared_config.get("poker_sites", {})
        protected = poker_config.get("protected", {})
        self.protected_poker_process = protected.get("process", "game.exe")
        self.other_poker_processes = poker_config.get("other", [])

        keepalive_seconds = float(
            self.config["traffic_monitoring"].get("keepalive_seconds", 45.0)
        )
        keepalive_seconds = max(15.0, min(keepalive_seconds, 60.0))
        active_timeout = float(
            self.config["traffic_monitoring"].get("keepalive_active_timeout", 150.0)
        )
        if active_timeout < keepalive_seconds * 2:
            active_timeout = keepalive_seconds * 2
        self._keepalive = DetectionKeepalive(
            "network",
            keepalive_interval=keepalive_seconds,
            active_timeout=active_timeout,
        )

    def _load_config(self) -> dict[str, Any]:
        """Load configuration from config_loader (dashboard/cache/local)"""
        try:
            from utils.config_loader import get_config

            config = get_config("network_config")
            if config:
                return config
        except Exception as e:
            print(f"[TrafficMonitor] WARNING: Config load failed: {e}")

        # Return default config matching new structure
        return {
            "traffic_monitoring": {
                "interval_s": 92.0,
                "alert_cooldown": 30.0,
                "connections_cache_ttl": 3.0,
                "suspicious_ports": {
                    "1935": {"label": "RTMP", "description": "Streaming protocol"},
                    "3389": {"label": "RDP", "description": "Remote Desktop Protocol"},
                    "3478": {"label": "STUN/WebRTC", "description": "WebRTC signaling"},
                    "5900": {"label": "VNC", "description": "Virtual Network Computing"},
                    "5960": {"label": "NDI", "description": "Network Device Interface video"},
                    "5961": {"label": "NDI", "description": "Network Device Interface video"},
                    "7070": {"label": "AnyDesk", "description": "AnyDesk remote access"},
                    "8291": {"label": "TeamViewer", "description": "TeamViewer remote access"},
                },
                "communication_apps": {
                    "telegram.exe": {
                        "label": "Telegram",
                        "status": "WARN",
                        "points": 5,
                        "description": "Potential bot control channel",
                    },
                    "discord.exe": {
                        "label": "Discord",
                        "status": "INFO",
                        "points": 0,
                        "description": "Communication app",
                    },
                },
            }
        }

    def _load_shared_config(self) -> dict[str, Any]:
        """Load shared configuration from config_loader"""
        try:
            from utils.config_loader import get_config

            config = get_config("shared_config")
            if config:
                return config
        except Exception as e:
            print(f"[TrafficMonitor] WARNING: Shared config load failed: {e}")

        return {}

    def tick(self):
        """Main monitoring loop"""
        # Check poker status - distinguish between protected and others
        coinpoker_active, other_poker_active = self._is_poker_active()

        # Get current network connections
        connections = self._get_connections()

        # Analyze traffic patterns
        for conn in connections:
            self._analyze_connection(conn, coinpoker_active, other_poker_active)

        # Detect suspicious patterns
        self._detect_patterns(coinpoker_active, other_poker_active)

        # Update connection history
        self._last_connections = set(connections)

        self._keepalive.emit_keepalives()

    def _is_poker_active(self) -> tuple:
        """Check if poker is active - returns (is_protected, is_other)"""
        protected_active = False
        other_active = False

        try:
            for proc in psutil.process_iter(["name", "exe"]):
                proc_name = (proc.info.get("name") or "").lower()
                proc_path = (proc.info.get("exe") or "").lower()

                # Check for PROTECTED poker (CoinPoker/game.exe)
                if proc_name == self.protected_poker_process:
                    if "coinpoker" in proc_path:
                        protected_active = True

                # Check for other poker sites
                if any(poker in proc_name for poker in self.other_poker_processes):
                    other_active = True

        except Exception:
            pass
        return protected_active, other_active

    def _get_connections(self) -> list[tuple]:
        """Get current network connections (cached)"""
        now = time.time()

        # Use cache if available
        if now - self._connections_cache_time < self._connections_cache_ttl:
            return self._connections_cache

        connections = []
        try:
            for conn in psutil.net_connections(kind="inet"):
                if conn.status == "ESTABLISHED":
                    # Format: (local_addr, remote_addr, pid, status)
                    connections.append((conn.laddr, conn.raddr, conn.pid, conn.status))
        except Exception:
            pass

        # Update cache
        self._connections_cache = connections
        self._connections_cache_time = now
        return connections

    def _analyze_connection(self, conn: tuple, coinpoker_active: bool, other_poker_active: bool):
        """Analyze individual connection for suspicious activity"""
        local_addr, remote_addr, pid, status = conn

        if not remote_addr:
            return

        remote_ip = remote_addr.ip
        remote_port = remote_addr.port

        # Skip local connections (IPv4 and IPv6)
        if (
            remote_ip.startswith("127.")
            or remote_ip.startswith("192.168.")
            or remote_ip == "::1"
            or remote_ip.startswith("fe80:")  # Link-local IPv6
            or remote_ip.startswith("fc00:")  # Unique local IPv6
            or remote_ip.startswith("fd00:")
        ):  # Private IPv6
            return

        # Group suspicious ports by category
        if remote_port in self.suspicious_ports:
            service_name = self.suspicious_ports[remote_port]

            # Determine port category for grouping
            if "Remote Desktop" in service_name or "RDP" in service_name or "VNC" in service_name:
                category = "Remote Access"
            elif "TeamViewer" in service_name or "AnyDesk" in service_name:
                category = "Remote Control Tools"
            elif "STUN" in service_name or "WebRTC" in service_name:
                category = "Screen Sharing"
            elif "RTMP" in service_name or "NDI" in service_name:
                category = "Streaming"
            else:
                category = "Suspicious Service"

            # Build grouped alert - use 4 levels based on poker context
            if coinpoker_active:
                # Remote access during CoinPoker is critical
                if category in ("Remote Access", "Remote Control Tools"):
                    alert_status = "CRITICAL"
                else:
                    alert_status = "ALERT"
                name = f"{category} During CoinPoker"
            elif other_poker_active:
                alert_status = "WARN"
                name = f"{category} During Other Poker"
            else:
                alert_status = "INFO"
                name = f"{category}"

            self._emit_grouped_alert(
                name,
                alert_status,
                f"{service_name} on {remote_ip}:{remote_port}",
                category,
            )

        # Skip DNS lookups - they are slow and block execution
        # Instead check IP patterns directly
        for domain, service in self.suspicious_domains.items():
            # Check for known IP ranges if needed (e.g., Telegram, Discord)
            # For now, rely on port-based detection which is faster
            pass

        # Track traffic for pattern detection
        if pid:
            try:
                proc = psutil.Process(pid)
                proc_name = proc.name()

                # Skip our own scanner to avoid false positives
                if proc_name.lower() == "coinpokerscanner.exe":
                    return

                # Record traffic pattern
                key = f"{proc_name}:{remote_ip}:{remote_port}"
                self._traffic_history[key].append(time.time())

                # Detect rapid connections (bot behavior)
                recent = [t for t in self._traffic_history[key] if time.time() - t < 10]
                if len(recent) >= 5:  # 5+ connections in 10 seconds
                    # Only alert during poker context to avoid dev/watch noise
                    if coinpoker_active or other_poker_active:
                        self._emit_alert(
                            f"Rapid Connections: {proc_name}",
                            "ALERT",
                            f"Multiple connections to {remote_ip}:{remote_port}",
                        )
            except Exception:
                pass

    def _detect_patterns(self, coinpoker_active: bool, other_poker_active: bool):
        """Detect suspicious traffic patterns"""

        # Check for communication apps (Telegram is high risk for bot control)
        comm_apps = self.config["traffic_monitoring"]["communication_apps"]

        # Group communication apps together
        active_comm_apps = []

        for proc in psutil.process_iter(["name"]):
            try:
                proc_name = proc.info.get("name", "").lower()
                if proc_name in comm_apps:
                    active_comm_apps.append((proc_name, comm_apps[proc_name]))
            except Exception:
                pass

        # Emit grouped communication app alert if any found
        if active_comm_apps:
            # Avoid duplicate Telegram reporting (handled by TelegramDetector)
            has_telegram = any(name == "telegram.exe" for name, _ in active_comm_apps)
            if has_telegram:
                # Filter out Telegram; if nothing else remains, skip
                active_comm_apps = [(n, app) for (n, app) in active_comm_apps if n != "telegram.exe"]

            if active_comm_apps:
                if coinpoker_active:
                    status = "ALERT"
                    desc = "Communication apps during CoinPoker"
                elif other_poker_active:
                    status = "WARN"
                    desc = "Communication apps during other poker"
                else:
                    status = "INFO"
                    desc = "Communication apps detected"

                app_names = ", ".join(app.get("label", app.get("name", "Unknown")) for _, app in active_comm_apps)
                self._emit_grouped_alert(
                    "Communication Apps", status, f"{app_names} | {desc}", "communication"
                )

        if not (coinpoker_active or other_poker_active):
            return

        # Check for multiple suspicious connections simultaneously
        current_suspicious = 0
        for conn in self._last_connections:
            if len(conn) >= 2 and conn[1]:  # Has remote address
                remote_port = conn[1].port
                if remote_port in self.suspicious_ports:
                    current_suspicious += 1

        if current_suspicious >= 2:
            self._emit_alert(
                "Multiple Suspicious Connections",
                "CRITICAL" if coinpoker_active else "ALERT",
                f"{current_suspicious} suspicious services active during poker",
            )

    def _emit_alert(self, name: str, status: str, details: str):
        """Emit alert with cooldown to prevent spam"""
        now = time.time()
        if now - self._last_alert[name] >= self._alert_cooldown:
            post_signal("network", name, status, details)
            self._last_alert[name] = now
            detection_key = f"alert:{name}:{status}"
            self._keepalive.mark_active(
                detection_key,
                name,
                status,
                details,
                alias=name,
            )
        else:
            self._keepalive.refresh_alias(name)

    def _emit_grouped_alert(self, name: str, status: str, details: str, group: str):
        """Emit grouped alert to reduce similar signals"""
        now = time.time()
        group_key = f"{group}:{status}"

        # Check group cooldown
        if now - self._grouped_alerts.get(group_key, 0) >= self._group_window:
            post_signal("network", name, status, details)
            self._grouped_alerts[group_key] = now
            detection_key = f"group:{group_key}:{name}"
            self._keepalive.mark_active(
                detection_key,
                name,
                status,
                details,
                alias=group_key,
            )
        else:
            self._keepalive.refresh_alias(group_key)
