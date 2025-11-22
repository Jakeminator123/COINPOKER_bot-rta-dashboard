# segments/network/web_monitor.py
"""
Consolidated web monitoring combining browser title scanning and DNS monitoring.
Combines functionality from browser_titles.py and dns_monitor.py.
Detects RTA/solver websites and suspicious domain lookups.
"""

from __future__ import annotations

import subprocess
import time
from collections import defaultdict
from typing import Any

import psutil  # type: ignore

from core.api import BaseSegment, post_signal
from utils.config_loader import get_config
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown

# Optional pywin32 for window title enumeration
try:
    import win32gui
    import win32process  # type: ignore
except ImportError:
    win32gui = None
    win32process = None

# =========================
# Browser Title Patterns (from browser_titles.py)
# =========================

# =========================
# Configuration Loading
# =========================


def _load_network_config() -> dict[str, Any]:
    """Load configuration from config_loader (dashboard/cache/local)"""
    try:
        config = get_config("network_config")
        if config:
            return config
    except Exception as e:
        print(f"[WebMonitor] WARNING: Config load failed: {e}")

    # Return default config
    return {
        "web_monitoring": {
            "browser_min_repeat": 60.0,
            "dns_alert_cooldown": 120.0,
            "interval_s": 92.0,
            "protected_poker_process": "game.exe",
            "other_poker_processes": [
                "pokerstars",
                "ggpoker",
                "888poker",
                "partypoker",
                "winamax",
                "pokerbros",
                "wsop",
            ],
            "network_keywords": [
                "gto wizard",
                "odin",
                "simple gto",
                "vision gto",
                "rta.poker",
                "pokerbotai",
                "warbot",
                "holdembot",
                "gtowizard.com",
                "simplegto.com",
                "visiongto.com",
            ],
            "suspicious_patterns": {
                "rta.poker": ["RTA.poker Service", "ALERT"],
                "rtapoker.com": ["RTA Poker", "ALERT"],
                "warbotpoker": ["WarBot", "ALERT"],
                "holdembot": ["HoldemBot", "ALERT"],
                "pokerbotai": ["PokerBotAI", "ALERT"],
                "gtowizard": ["GTO Wizard", "ALERT"],
                "simplegto": ["Simple GTO", "WARN"],
                "visiongto": ["Vision GTO", "WARN"],
                "odinpoker": ["Odin Poker", "WARN"],
                "gtohero": ["GTO Hero", "WARN"],
                "piosolver": ["PioSolver", "WARN"],
                "monkersolver": ["MonkerSolver", "WARN"],
                "telegram.org": ["Telegram", "WARN"],
                "api.telegram": ["Telegram API", "WARN"],
                "t.me": ["Telegram Link", "WARN"],
                "discord.com": ["Discord", "INFO"],
                "discordapp": ["Discord App", "INFO"],
                "teamviewer": ["TeamViewer", "WARN"],
                "anydesk": ["AnyDesk", "WARN"],
                "parsec.app": ["Parsec", "WARN"],
                "remotedesktop": ["Remote Desktop", "WARN"],
                "ngrok.io": ["Ngrok Tunnel", "ALERT"],
                "serveo.net": ["Serveo Tunnel", "ALERT"],
                "tor2web": ["Tor Gateway", "ALERT"],
                ".onion": ["Tor Hidden Service", "ALERT"],
                ".ru": ["Russian Domain", "INFO"],
                ".cn": ["Chinese Domain", "INFO"],
                ".tk": ["Free Domain", "INFO"],
                ".ml": ["Free Domain", "INFO"],
            },
        }
    }


# Load shared configuration
def _load_shared_config() -> dict[str, Any]:
    """Load shared configuration from config_loader"""
    try:
        config = get_config("shared_config")
        if config:
            return config
    except Exception as e:
        print(f"[WebMonitor] WARNING: Shared config load failed: {e}")

    return {}


# Load config at module level
CONFIG = _load_network_config()
SHARED_CONFIG = _load_shared_config()
NETWORK_KEYWORDS = CONFIG["web_monitoring"]["network_keywords"]
SUSPICIOUS_PATTERNS = CONFIG["web_monitoring"]["suspicious_patterns"]

# BLACKLIST: Always filter these patterns regardless of dashboard config
# These generate too many false positives
PATTERN_BLACKLIST = {
    ".cn",  # Chinese domains - too many false positives
    ".ru",  # Russian domains - too many false positives
    ".tk",  # Free domains - too common
    ".ml",  # Free domains - too common
    "telegram.org",  # Better handled by TelegramDetector (IP-based)
    "api.telegram",  # Better handled by TelegramDetector
    "discord.com",  # Too common, not necessarily RTA
    "discordapp",  # Too common
}

# Filter out blacklisted patterns from dashboard config
SUSPICIOUS_PATTERNS = {k: v for k, v in SUSPICIOUS_PATTERNS.items() if k not in PATTERN_BLACKLIST}

# =========================
# Utility Functions
# =========================


def _get_all_window_titles() -> list[str]:
    """Get all visible window titles"""
    titles: list[str] = []

    if not win32gui or not win32process:
        return titles  # pywin32 not available

    def enum_handler(hwnd, _):
        """Callback for window enumeration"""
        if not win32gui.IsWindowVisible(hwnd):
            return
        try:
            title = win32gui.GetWindowText(hwnd)
            if title and title.strip():
                titles.append(title.lower())
        except Exception:
            pass

    try:
        win32gui.EnumWindows(enum_handler, None)
    except Exception:
        pass

    return titles


class WebMonitor(BaseSegment):
    """
    Consolidated web monitor that combines:
    - Browser window title monitoring for RTA/solver websites
    - DNS cache analysis for suspicious domain lookups
    - Correlation with poker activity for enhanced detection
    """

    name = "WebMonitor"
    category = "network"
    interval_s = 92.0  # Synchronized with unified batch interval

    def __init__(self):
        super().__init__()

        # Load configuration
        self.config = CONFIG["web_monitoring"]

        # Load poker sites from shared config
        poker_config = SHARED_CONFIG.get("poker_sites", {})
        protected = poker_config.get("protected", {})
        self.protected_poker_process = protected.get("process", "game.exe")
        self.other_poker_processes = poker_config.get("other", [])

        # Allowlist for common legitimate domains (to reduce false positives)
        self.allowed_domains = {
            # Microsoft/Windows
            "microsoft.com",
            "windows.com",
            "live.com",
            "msn.com",
            "bing.com",
            "outlook.com",
            "office365.com",
            "microsoftonline.com",
            "azure.com",
            "windowsupdate.com",
            "skype.com",
            "xbox.com",
            # Google
            "google.com",
            "googleapis.com",
            "gstatic.com",
            "youtube.com",
            "googlevideo.com",
            "doubleclick.net",
            "google-analytics.com",
            "gmail.com",
            "googleusercontent.com",
            # Common CDNs and services
            "cloudflare.com",
            "amazonaws.com",
            "akamai.net",
            "fastly.net",
            "cloudfront.net",
            "jsdelivr.net",
            "unpkg.com",
            "cdnjs.com",
            # Social media (common)
            "facebook.com",
            "instagram.com",
            "twitter.com",
            "x.com",
            "linkedin.com",
            "reddit.com",
            "tiktok.com",
            # Common services
            "github.com",
            "stackoverflow.com",
            "wikipedia.org",
            "amazon.com",
            "apple.com",
            "spotify.com",
            "netflix.com",
            # Security/AV
            "virustotal.com",
            "avast.com",
            "norton.com",
            "mcafee.com",
            # Common Chinese services (to avoid .cn false positives)
            "baidu.com",
            "qq.com",
            "weibo.com",
            "taobao.com",
            "tmall.com",
            "jd.com",
            "sina.com",
            "163.com",
            "sohu.com",
            # Development
            "npmjs.org",
            "pypi.org",
            "nodejs.org",
            "python.org",
            # Poker sites (not RTA)
            "pokerstars.com",
            "ggpoker.com",
            "888poker.com",
            "partypoker.com",
            "winamax.com",
            "wsop.com",
            "pokerbros.com",
        }

        # Browser title monitoring state - minimal throttling to prevent spam (5s)
        self._last_browser_emit: dict[str, float] = {}
        self._browser_min_repeat = apply_cooldown(
            max(5.0, self.config.get("browser_min_repeat", 5.0))
        )  # scaled throttling for browser detections

        # DNS monitoring state - track seen domains with timestamps for cleanup
        self._seen_domains: dict[str, float] = {}  # domain -> first_seen timestamp
        self._domain_ttl = apply_cooldown(3600.0)  # Keep DNS entries for scaled duration
        self._last_dns_alert: dict[str, float] = defaultdict(float)
        self._dns_alert_cooldown = apply_cooldown(
            max(5.0, self.config.get("dns_alert_cooldown", 5.0))
        )

        # RTA site consolidation - prevent duplicate emissions
        self._rta_sites: dict[
            str, dict[str, Any]
        ] = {}  # service -> {via: set(), last_seen: float, last_emitted: float}
        self._rta_consolidation_window = apply_cooldown(10.0)  # Consolidation window
        self._rta_emit_cooldown = apply_cooldown(5.0)  # RTA emission cooldown

        keepalive_seconds = float(self.config.get("keepalive_seconds", 45.0))
        keepalive_seconds = max(15.0, min(keepalive_seconds, 60.0))
        active_timeout = float(self.config.get("keepalive_active_timeout", 150.0))
        if active_timeout < keepalive_seconds * 2:
            active_timeout = keepalive_seconds * 2
        self._keepalive = DetectionKeepalive(
            "network",
            keepalive_interval=keepalive_seconds,
            active_timeout=active_timeout,
        )

        # PROTECTED poker client (the one we're securing)
        self.protected_poker_process = self.config["protected_poker_process"]

        # OTHER poker sites (monitor but less aggressive)
        self.other_poker_processes = self.config["other_poker_processes"]

        # Debug tracking
        self._tick_count = 0
        self._debug_every_n_ticks = 30  # Print debug info every 30 ticks (10 minutes)

        # Check pywin32 availability
        if not win32gui or not win32process:
            print(
                "[WebMonitor] ⚠️  WARNING: pywin32 not available - browser title monitoring disabled!"
            )
            print("[WebMonitor] Install with: pip install pywin32")
        else:
            print("[WebMonitor] ✓ pywin32 available - browser title monitoring enabled")

        print(f"[WebMonitor] Initialized - monitoring {len(NETWORK_KEYWORDS)} keywords")
        print(f"[WebMonitor] Keywords: {', '.join(NETWORK_KEYWORDS[:5])}...")
        print(
            f"[WebMonitor] Browser cooldown: {self._browser_min_repeat}s | DNS cooldown: {self._dns_alert_cooldown}s | RTA emit cooldown: {self._rta_emit_cooldown}s"
        )

    def tick(self):
        """Main monitoring loop - combines browser and DNS analysis"""
        self._tick_count += 1

        # Check poker status - distinguish between protected and others
        coinpoker_active, other_poker_active = self._is_poker_active()

        # Periodic debug output
        if self._tick_count % self._debug_every_n_ticks == 0:
            print(
                f"[WebMonitor] Tick #{self._tick_count} | CoinPoker: {coinpoker_active} | Other poker: {other_poker_active}"
            )

        # 1. BROWSER TITLE MONITORING
        self._monitor_browser_titles(coinpoker_active, other_poker_active)

        # 2. DNS MONITORING
        self._monitor_dns_activity(coinpoker_active, other_poker_active)

        # Cleanup old DNS entries periodically (expire after TTL)
        now = time.time()
        expired_domains = [
            domain
            for domain, first_seen in self._seen_domains.items()
            if now - first_seen > self._domain_ttl
        ]
        for domain in expired_domains:
            del self._seen_domains[domain]

        # Also cleanup if cache gets too large
        if len(self._seen_domains) > 1000:
            # Remove oldest entries
            sorted_domains = sorted(self._seen_domains.items(), key=lambda x: x[1])
            for domain, _ in sorted_domains[:500]:  # Remove oldest 500
                del self._seen_domains[domain]

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
                if proc_name == self.protected_poker_process and "coinpoker" in proc_path:
                    protected_active = True

                # Check for other poker sites
                elif any(poker in proc_name for poker in self.other_poker_processes):
                    other_active = True

        except Exception:
            pass
        return protected_active, other_active

    def _emit_rta_site(
        self, service: str, via: str, coinpoker_active: bool, other_poker_active: bool
    ):
        """Emit consolidated RTA site detection with deduplication"""
        now = time.time()

        # Track this detection
        if service not in self._rta_sites:
            self._rta_sites[service] = {
                "via": set(),
                "last_seen": now,
                "last_emitted": 0.0,
            }

        self._rta_sites[service]["via"].add(via)
        self._rta_sites[service]["last_seen"] = now

        # Check if we should emit (cooldown) - prevent spam
        alert_key = f"rta_site:{service}"
        last_emitted = self._rta_sites[service]["last_emitted"]
        time_since_last_emit = now - last_emitted

        if time_since_last_emit < self._rta_emit_cooldown:
            # Don't emit if we just emitted this recently
            self._keepalive.refresh_alias(alert_key)
            return

        # Determine base severity - Enhanced for GTOWizard with 4 levels
        if any(bot in service.lower() for bot in ["warbot", "holdembot", "pokerbotai"]):
            base_status = "CRITICAL"  # Bot services always critical
        elif any(rta in service.lower() for rta in ["gto wizard", "rta.poker", "gtowizard"]):
            base_status = "CRITICAL"  # GTOWizard always critical
        elif any(solver in service.lower() for solver in ["piosolver", "monkersolver"]):
            base_status = "ALERT"  # Solvers are serious
        else:
            base_status = "WARN"

        # Context based on poker activity - escalate for CoinPoker
        if coinpoker_active:
            context = "CoinPoker active (protected site)"
            # Escalate by one level during CoinPoker
            if base_status == "WARN":
                status = "ALERT"
            else:
                status = base_status  # CRITICAL stays CRITICAL, ALERT stays ALERT
        elif other_poker_active:
            context = "other poker"
            status = base_status
        else:
            context = "no poker"
            # Downgrade slightly when no poker active (except CRITICAL)
            if base_status == "CRITICAL":
                status = "ALERT"
            elif base_status == "ALERT":
                status = "WARN"
            else:
                status = "INFO" if base_status == "WARN" else base_status

        # Build consolidated details
        vias = list(self._rta_sites[service]["via"])
        details = f"via={','.join(vias)} context={context}"

        print(f"[WebMonitor] 🚨 Posting signal: [{status}] RTA Site: {service} | {details}")
        post_signal("network", f"RTA Site: {service}", status, details)

        # Update emission tracking
        self._rta_sites[service]["last_emitted"] = now
        self._last_dns_alert[alert_key] = now
        detection_key = f"rta:{service}:{status}"
        self._keepalive.mark_active(
            detection_key,
            f"RTA Site: {service}",
            status,
            details,
            alias=alert_key,
        )

    def _monitor_browser_titles(self, coinpoker_active: bool, other_poker_active: bool):
        """Monitor browser window titles for RTA/solver websites"""
        now = time.time()
        titles = _get_all_window_titles()

        # Debug: Show window count periodically
        if self._tick_count % self._debug_every_n_ticks == 0:
            print(f"[WebMonitor] Found {len(titles)} window titles to scan")
            if len(titles) == 0 and (win32gui is None or win32process is None):
                print("[WebMonitor] ⚠️  No windows found - pywin32 may not be working!")
            # DEBUG: Show first 5 titles to see what we're scanning
            if len(titles) > 0:
                print("[WebMonitor] Sample titles being scanned:")
                for i, t in enumerate(titles[:5], 1):
                    print(f"  {i}. {t[:80]}")  # First 80 chars

        # Enhanced detection for GTOWizard and other RTA sites
        detected_sites = set()

        for title in titles:
            title_lower = title.lower()

            # Check for GTOWizard variations
            gto_patterns = [
                "gto wizard",
                "gtowizard",
                "gto-wizard",
                "gtowizard.com",
                "app.gtowizard",
                "wizard.gto",
                "gto-wizard.com",
            ]

            for pattern in gto_patterns:
                if pattern in title_lower:
                    detected_sites.add("GTOWizard")
                    print(f"[WebMonitor] 🎯 GTOWIZARD DETECTED: '{pattern}' in '{title}'")
                    break

            # Check for other RTA/solver sites
            for keyword in NETWORK_KEYWORDS:
                if keyword in title_lower and keyword not in gto_patterns:
                    detected_sites.add(keyword.title().replace(".", " ").strip())
                    print(f"[WebMonitor] 🎯 KEYWORD MATCH: '{keyword}' in '{title}'")

        # Emit signals for detected sites (minimal throttling to prevent spam)
        for site in detected_sites:
            time_since_last = now - self._last_browser_emit.get(site.lower(), 0.0)
            if time_since_last >= self._browser_min_repeat:
                self._last_browser_emit[site.lower()] = now
                print(f"[WebMonitor] 📤 Emitting signal for: {site}")
                self._emit_rta_site(site, "title", coinpoker_active, other_poker_active)
            # No throttling message - 5s cooldown is too short to spam

    def _monitor_dns_activity(self, coinpoker_active: bool, other_poker_active: bool):
        """Monitor DNS queries for suspicious domains"""
        # Get DNS cache entries
        dns_entries = self._get_dns_cache()

        # Debug: Show DNS count periodically
        if self._tick_count % self._debug_every_n_ticks == 0 and len(dns_entries) > 0:
            print(f"[WebMonitor] DNS cache has {len(dns_entries)} entries")
            # Show any GTOWizard-related domains
            gto_domains = [d for d in dns_entries if "gto" in d.lower() or "wizard" in d.lower()]
            if gto_domains:
                print(f"[WebMonitor] GTO-related domains found: {', '.join(gto_domains[:3])}")
                # Check if any are new (not seen before)
                new_gto = [d for d in gto_domains if d not in self._seen_domains]
                if new_gto:
                    print(f"[WebMonitor] NEW GTO domains detected: {', '.join(new_gto)}")

        # Analyze new entries only (not previously seen)
        now = time.time()
        for domain in dns_entries:
            if domain not in self._seen_domains:
                self._analyze_domain(domain, coinpoker_active, other_poker_active)
                self._seen_domains[domain] = now  # Track when first seen

    def _get_dns_cache(self) -> set[str]:
        """Get DNS cache entries from Windows"""
        domains = set()
        try:
            # Run ipconfig /displaydns
            result = subprocess.run(
                ["ipconfig", "/displaydns"], capture_output=True, text=True, timeout=10
            )

            if result.returncode == 0:
                lines = result.stdout.split("\n")
                for line in lines:
                    line = line.strip()
                    # Look for record names
                    if "Record Name" in line:
                        parts = line.split(":", 1)
                        if len(parts) == 2:
                            domain = parts[1].strip().lower()
                            if domain and "." in domain and len(domain) > 3:
                                domains.add(domain)
        except Exception:
            pass

        return domains

    def _analyze_domain(self, domain: str, coinpoker_active: bool, other_poker_active: bool):
        """Analyze domain for suspicious patterns"""
        domain_lower = domain.lower()

        # Skip allowed domains to reduce false positives
        for allowed in self.allowed_domains:
            if allowed in domain_lower or domain_lower.endswith(f".{allowed}"):
                return  # Skip analysis for whitelisted domains

        # Enhanced GTOWizard DNS detection
        gto_dns_patterns = [
            "gtowizard",
            "gto-wizard",
            "gtowizard.com",
            "app.gtowizard",
            "wizard.gto",
            "gto-wizard.com",
            "gtowizard.net",
            "gtowizard.org",
        ]

        for pattern in gto_dns_patterns:
            if pattern in domain_lower:
                print(f"[WebMonitor] 🎯 GTOWIZARD DNS DETECTED: '{pattern}' in '{domain}'")
                self._emit_rta_site("GTOWizard", "dns", coinpoker_active, other_poker_active)
                return

        # Check against other patterns
        for pattern, pattern_data in SUSPICIOUS_PATTERNS.items():
            name, base_status = pattern_data
            if pattern in domain_lower:
                # Check if this is an RTA/bot service that should be consolidated
                rta_services = [
                    "rta.poker",
                    "rtapoker",
                    "warbotpoker",
                    "holdembot",
                    "pokerbotai",
                    "gtowizard",
                    "simplegto",
                    "visiongto",
                    "odinpoker",
                    "gtohero",
                    "piosolver",
                    "monkersolver",
                ]

                is_rta = any(svc in pattern for svc in rta_services)

                if is_rta:
                    # Use consolidated RTA emission
                    self._emit_rta_site(name, "dns", coinpoker_active, other_poker_active)
                else:
                    # Regular DNS detection for non-RTA patterns - use 4 levels
                    # Escalate based on poker type
                    if coinpoker_active:
                        # Escalate during CoinPoker
                        if base_status == "INFO":
                            status = "WARN"
                        elif base_status == "WARN":
                            status = "ALERT"
                        else:
                            status = base_status
                    elif other_poker_active:
                        # Minor escalation during other poker
                        if base_status == "INFO":
                            status = "INFO"
                        else:
                            status = base_status
                    else:
                        status = base_status

                    # Check cooldown - use pattern name as key for generic patterns to consolidate multiple domains
                    now = time.time()
                    # For generic patterns like "Chinese Domain" or "Telegram", use just the name
                    # For specific domains, use name:domain
                    if pattern in [".cn", "telegram"]:
                        alert_key = name  # Consolidate all domains matching this pattern
                    else:
                        alert_key = f"{name}:{domain}"

                    if now - self._last_dns_alert.get(alert_key, 0) >= self._dns_alert_cooldown:
                        if coinpoker_active:
                            context = " (during CoinPoker - PROTECTED)"
                        elif other_poker_active:
                            context = " (during other poker)"
                        else:
                            context = ""

                        details = f"Lookup: {domain}{context}"
                        post_signal(
                            "network",
                            f"DNS: {name}",
                            status,
                            details,
                        )
                        self._last_dns_alert[alert_key] = now
                        detection_key = f"dns:{alert_key}:{status}"
                        self._keepalive.mark_active(
                            detection_key,
                            f"DNS: {name}",
                            status,
                            details,
                            alias=alert_key,
                        )
                    else:
                        self._keepalive.refresh_alias(alert_key)
                break  # Only match first pattern

    def cleanup(self):
        """Cleanup resources"""
        # Clear caches
        self._seen_domains.clear()
        self._last_browser_emit.clear()
        self._last_dns_alert.clear()
        self._rta_sites.clear()
