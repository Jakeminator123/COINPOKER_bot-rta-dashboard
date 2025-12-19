# segments/programs/hash_and_signature_scanner.py
"""
Consolidated hash scanner combining signature definitions and IOC database lookups.
VirusTotal online lookups are disabled on the scanner side (handled by backend).
Consolidates hash_scanner.py and signatures.py.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from typing import Any

import psutil  # type: ignore

from core.api import BaseSegment, post_signal
from utils.config_reader import read_config
from utils.config_loader import get_config
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown


def _truthy(value: object) -> bool:
    return str(value).strip().lower() in {"1", "true", "y", "yes", "on"}


def _load_config_txt_settings() -> dict[str, str]:
    """
    Load a few lightweight settings from config.txt via the shared reader.
    Note: VirusTotal online lookups are disabled on the scanner side; API key is ignored.
    """
    settings = {"api_key": "", "input_debug": "0", "max_cpu_percent": "25"}
    try:
        cfg = read_config()
        settings["input_debug"] = os.getenv("INPUT_DEBUG") or str(cfg.get("INPUT_DEBUG", "0"))
        settings["max_cpu_percent"] = os.getenv("MAXCPUPERCENT") or str(cfg.get("MAXCPUPERCENT", "25"))
    except Exception as e:
        print(f"[HashAndSignatureScanner] WARNING: Failed to read config via config_reader: {e}")
    return settings


_settings = _load_config_txt_settings()
api_key = ""  # VirusTotal online lookups are disabled on the scanner side
input_debug = _settings["input_debug"].strip()
max_cpu_percent = _settings["max_cpu_percent"].strip()

print(f"[HashAndSignatureScanner] INPUT_DEBUG={input_debug} | MAXCPUPERCENT={max_cpu_percent}")
print("[HashAndSignatureScanner] VirusTotal online lookups are DISABLED (handled by backend)")


def _load_programs_config():
    """Load programs configuration from config_loader (dashboard/cache/local)"""
    try:
        config = get_config("programs_config")
        if config:
            return config
    except Exception as e:
        print(f"[HashAndSignatureScanner] WARNING: Config load failed: {e}")

    # Return minimal default config if not found
    return {
        "known_processes": {},
        "risk_mapping": {"3": "ALERT", "2": "WARN", "1": "INFO", "0": "OK"},
    }


# Load configuration and merge process categories
_config = _load_programs_config()

# If known_processes missing, build it from programs_registry (single source of truth)
if not _config.get("known_processes"):
    try:
        registry = get_config("programs_registry")
    except Exception:
        registry = None

    if registry and "programs" in registry:
        kp = {
            "bots": {},
            "rta_tools": {},
            "macro_automation": {},
            "hud_tracking": {},
            "communication": {},
        }
        for prog_name, prog_data in registry["programs"].items():
            categories = prog_data.get("categories", [])
            prog_type = prog_data.get("type", "")

            if "bots" in categories or prog_type == "bot":
                kp["bots"][prog_name] = prog_data
            elif "rta_tools" in categories or prog_type in ["rta", "solver"]:
                kp["rta_tools"][prog_name] = prog_data
            elif "macros" in categories or prog_type in ["macro", "clicker"]:
                kp["macro_automation"][prog_name] = prog_data
            elif "hud_tracking" in categories or prog_type == "hud":
                kp["hud_tracking"][prog_name] = prog_data
            elif "communication" in categories or prog_type == "messenger":
                kp["communication"][prog_name] = prog_data
        _config["known_processes"] = kp

PROCESS_NAMES = {}
for category in ["bots", "rta_tools", "macro_automation", "hud_tracking", "communication"]:
    if category in _config.get("known_processes", {}):
        PROCESS_NAMES.update(_config["known_processes"][category])

# Risk level to status mapping (4-level system)
RISK_TO_STATUS = {
    3: "CRITICAL",  # 15 points - Known bots/malware
    2: "ALERT",  # 10 points - RTA tools, suspicious
    1: "WARN",  # 5 points - Automation tools
    0: "INFO",  # 0 points - Informational
}

# =========================
# IOC and File Utils
# =========================


# IOC data now loaded from programs_config.json
def _load_hash_json(filename: str) -> dict[str, dict]:
    """Load hash database from programs_config.json IOC section"""
    try:
        ioc_config = _config.get("ioc", {})

        # Map filename to config keys
        if filename == "bad_hashes.json":
            data = ioc_config.get("bad_hashes", {})
        elif filename == "allowlist.json":
            data = ioc_config.get("allowlist", {})
        else:
            print(f"[HashAndSignatureScanner] Unknown IOC file: {filename}")
            return {}

        # Normalize keys to lowercase
        return {k.lower(): v for k, v in data.items()}
    except Exception as e:
        print(f"[HashAndSignatureScanner] WARNING: Failed to load {filename}: {e}")
        return {}


def _sha256_file(path: str) -> str | None:
    """Calculate SHA-256 hash of a file"""
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            # Read in chunks to handle large files
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest().lower()
    except Exception:
        return None


class HashAndSignatureScanner(BaseSegment):
    """
    Consolidated scanner combining:
    - Known process signature detection (from signatures.py)
    - IOC database hash lookups (from hash_scanner.py)
    - VirusTotal API integration (from virustotal_checker.py)
    - Digital signature verification
    """

    name = "HashAndSignatureScanner"
    category = "programs"
    interval_s = 92.0  # Synchronized with unified batch interval

    def __init__(self):
        super().__init__()

        # Hash cache and IOC database from programs_config.json
        self._cache: dict[str, tuple[float, int, str]] = {}  # path -> (mtime, size, sha256)
        self._ioc = _load_hash_json("bad_hashes.json")  # Loads from config now
        self._allowlist = set(_load_hash_json("allowlist.json").keys())  # Loads from config now

        # Seen tracking to avoid spam
        self._seen_emit: dict[str, float] = {}  # sha256 -> last_emit_timestamp
        self._seen_processes: dict[str, float] = {}  # process_name -> last_report_time
        self._min_repeat = apply_cooldown(3600.0)  # Scaled hash lookup cooldown
        self._process_cooldown = apply_cooldown(15.0)  # Scaled process spam guard

        # VirusTotal online lookups are disabled on scanner side (handled by backend)
        self._vt_enabled = False
        self._vt_checked_hashes: dict[str, float] = {}
        self._vt_cache_duration = 0.0
        self._last_vt_request = 0.0
        self._min_vt_interval = 0.0
        self._vt_malware_threshold = 0
        self._vt_suspicious_threshold = 0
        self._vt_poker_keywords = []
        self._vt_priority_queue = []
        self._vt_redis_cache = None
        self._online_cache: dict[str, tuple[float, dict]] = {}
        self._online_cache_ttl = 0.0

        hash_config = _config.get("hash_scanner", {})
        keepalive_seconds = float(hash_config.get("keepalive_seconds", 45.0))
        keepalive_seconds = max(15.0, min(keepalive_seconds, 60.0))
        active_timeout = float(hash_config.get("active_timeout_seconds", 150.0))
        if active_timeout < keepalive_seconds * 2:
            active_timeout = keepalive_seconds * 2
        self._keepalive = DetectionKeepalive(
            "programs",
            keepalive_interval=keepalive_seconds,
            active_timeout=active_timeout,
        )

        # Configuration (VT online lookups forced OFF on scanner side)
        self._load_config()

        print(
            f"[HashAndSignatureScanner] Initialized with {len(self._ioc)} bad hashes from config, {len(self._allowlist)} allowlisted"
        )

    def _load_config(self):
        """
        Load config via shared config reader.

        IMPORTANT:
        - ENABLEONLINELOOKUPS is ignored (online lookups disabled on scanner side).
        - ENABLEHASHLOOKUP is for local hash database lookups (IOC) only.
        """
        self._enable_online_lookups = False
        self._vt_api_key = ""
        self._check_signatures = True

        try:
            cfg = read_config()
        except Exception:
            cfg = {}

        # Online lookups (VirusTotal) are disabled on scanner side (handled by backend)
        self._enable_online_lookups = False

        # Signature checks
        raw_sig = cfg.get("CHECKSIGNATURES", os.environ.get("CHECKSIGNATURES", "true"))
        self._check_signatures = not str(raw_sig).strip().lower() in {"0", "false", "no", "off"}

        # VirusTotal API key is ignored (online lookups disabled)
        self._vt_api_key = ""

    def tick(self):
        """Main scanning loop - combines signature detection and hash analysis"""
        # Reload IOC database and lists periodically
        if int(time.time()) % 300 == 0:  # Every 5 minutes
            self._ioc = _load_hash_json("bad_hashes.json")
            self._allowlist = set(_load_hash_json("allowlist.json").keys())

        # Track which aliases we've seen this tick for cleanup
        seen_aliases = set()

        # Check if poker is active for prioritization
        coinpoker_active, other_poker_active = self._is_poker_active()

        # Collect all processes
        all_processes = []
        priority_processes = []  # Known bot/RTA programs get priority

        for p in psutil.process_iter(["pid", "name", "exe"]):
            exe = p.info.get("exe")
            proc_name = (p.info.get("name") or "").lower()

            if not exe or not os.path.isfile(exe):
                continue

            # Skip system files
            exe_lower = exe.lower()
            if any(skip in exe_lower for skip in ["\\windows\\", "\\system32\\", "\\microsoft\\"]):
                continue

            # 1. FIRST: Check against known process signatures (fast)
            if proc_name in PROCESS_NAMES:
                seen_aliases.add(proc_name)
                self._handle_known_process(p, proc_name, coinpoker_active, other_poker_active)
                priority_processes.append((p, exe, proc_name))
            else:
                all_processes.append((p, exe, proc_name))

        # 2. SECOND: Hash analysis (slower) - ONE process per tick to limit overhead
        # Priority: Known bots/RTAs first, then suspicious processes during poker
        candidates = []

        for p, exe, proc_name in priority_processes:
            if proc_name in PROCESS_NAMES:
                meta = PROCESS_NAMES[proc_name]
                points = meta.get("points", 0)
                if points >= 10:  # Only check high-risk processes (ALERT/CRITICAL)
                    candidates.append((p, exe, proc_name, 3))  # Priority 3 = highest

        if coinpoker_active or other_poker_active:
            for p, exe, proc_name in all_processes[:3]:
                if any(
                    susp in proc_name for susp in ["python", "autohotkey", "autoit", "powershell"]
                ):
                    priority = 3 if coinpoker_active else 2  # Higher priority for CoinPoker
                    candidates.append((p, exe, proc_name, priority))

        if candidates:
            candidates.sort(key=lambda x: x[3], reverse=True)
            p, exe, proc_name, _ = candidates[0]
            sha = self._handle_hash_analysis(p, exe, proc_name, coinpoker_active, other_poker_active)
            if sha:
                seen_aliases.add(sha)

        # Clean up aliases for processes that are no longer running
        self._keepalive.cleanup_missing_aliases(seen_aliases)
        self._keepalive.emit_keepalives()

    def _handle_known_process(
        self, process, proc_name: str, coinpoker_active: bool, other_poker_active: bool
    ):
        """Handle detection of known process signatures"""
        meta = PROCESS_NAMES[proc_name]
        now = time.time()

        # Check cooldown
        if now - self._seen_processes.get(proc_name, 0) < self._process_cooldown:
            self._keepalive.refresh_alias(proc_name)
            return

        label = meta.get("label", proc_name)
        points = meta.get("points")

        if points is None:
            print(f"[HashAndSignatureScanner] CRITICAL ERROR: Missing 'points' for {proc_name}")
            return

        try:
            points = int(points)
        except Exception:
            print(
                f"[HashAndSignatureScanner] CRITICAL ERROR: Invalid 'points' for {proc_name}: {points}"
            )
            return

        # Map points to risk tier for backward compat logic: 15→3, 10→2, 5→1, 0→0
        risk_tier = 3 if points >= 15 else 2 if points >= 10 else 1 if points >= 5 else 0
        proc_type = meta.get("type", "unknown")

        # Determine status - escalate more for PROTECTED poker (CoinPoker) - use 4 levels
        if coinpoker_active and proc_type in ("bot", "rta") and risk_tier >= 3:
            status = "CRITICAL"  # Bot/RTA during CoinPoker = critical
        elif coinpoker_active and proc_type in ("hud", "macro") and risk_tier >= 2:
            status = "ALERT"  # HUD/macro during CoinPoker = alert
        elif coinpoker_active and risk_tier >= 1:
            status = "WARN"  # Any suspicious tool during CoinPoker = warn
        elif (
            (coinpoker_active or other_poker_active)
            and proc_type in ("bot", "rta")
            and risk_tier >= 3
        ):
            status = "ALERT"  # Bot/RTA during any poker
        elif (
            (coinpoker_active or other_poker_active)
            and proc_type in ("hud", "macro")
            and risk_tier >= 2
        ):
            status = "WARN"  # HUD/macro during any poker
        else:
            # Map risk tier to status using new system
            status = RISK_TO_STATUS.get(risk_tier, "INFO")

        # Calculate SHA-256 for high-risk programs (points >= 10)
        exe = process.info.get("exe")
        details = f"proc={proc_name} pid={process.info.get('pid')}"
        if points >= 10 and exe:
            sha = _sha256_file(exe)
            if sha:
                details = f"SHA:{sha[:16]}... | {details}"

        if coinpoker_active and proc_type == "hud":
            details += " | COINPOKER ACTIVE! (PROTECTED)"
        elif (coinpoker_active or other_poker_active) and proc_type == "hud":
            details += " | POKER ACTIVE!"

        post_signal("programs", label, status, details)
        self._seen_processes[proc_name] = now
        detection_key = f"known:{proc_name}"
        self._keepalive.mark_active(
            detection_key,
            label,
            status,
            details,
            alias=proc_name,
        )

    def _handle_hash_analysis(
        self,
        process,
        exe_path: str,
        proc_name: str,
        coinpoker_active: bool,
        other_poker_active: bool,
    ):
        """Handle hash-based analysis (IOC + signature checks; VirusTotal disabled)"""
        # Get file stats
        try:
            st = os.stat(exe_path)
        except Exception:
            return None

        key = exe_path.lower()
        mtime, size = st.st_mtime, st.st_size
        sha = None

        # Check cache first
        cached = self._cache.get(key)
        if cached and cached[0] == mtime and cached[1] == size:
            sha = cached[2]
        else:
            # Calculate hash and cache it
            sha = _sha256_file(exe_path)
            if sha:
                self._cache[key] = (mtime, size, sha)

        if not sha:
            return None

        # Check allowlist first - skip if whitelisted
        if sha in self._allowlist:
            return sha

        # Check against IOC database
        hit = self._ioc.get(sha)
        if hit:
            # Extract metadata
            label = hit.get("label") or os.path.basename(exe_path)
            points = int(
                hit.get("points") or hit.get("risk", 0)
            )  # Fallback to old risk temporarily
            if points in (1, 2, 3):  # Old risk values, convert
                points = 5 if points == 1 else 10 if points == 2 else 15
            comment = hit.get("comment") or ""
            self._emit_detection(process, exe_path, sha, label, points, comment, "IOC Database")
            return sha

        # Check digital signature if enabled (prioritize during CoinPoker)
        if self._check_signatures and (coinpoker_active or other_poker_active):
            sig_info = self._get_authenticode_signature(exe_path)
            if sig_info and sig_info.get("Status") == "NotSigned":
                self._emit_detection(
                    process,
                    exe_path,
                    sha,
                    "Unsigned Executable",
                    5,
                    "No digital signature",
                    "Signature Check",
                )
        
        return sha

    def _is_poker_active(self) -> tuple:
        """Check if poker is active - returns (is_protected, is_other)"""
        protected_active = False
        other_active = False

        try:
            for proc in psutil.process_iter(["name", "exe"]):
                proc_name = (proc.info.get("name") or "").lower()
                proc_path = (proc.info.get("exe") or "").lower()

                # Check for PROTECTED poker (CoinPoker/game.exe)
                if proc_name == "game.exe" and "coinpoker" in proc_path:
                    protected_active = True

                # Check for other poker sites
                elif any(poker in proc_name for poker in ["pokerstars", "ggpoker", "888poker"]):
                    other_active = True

        except Exception:
            pass
        return protected_active, other_active

    def _emit_detection(
        self,
        process,
        exe_path: str,
        sha256: str,
        label: str,
        points: int,
        comment: str,
        source: str,
    ):
        """Emit a detection signal with throttling"""
        # Throttle identical SHA alerts
        last = self._seen_emit.get(sha256, 0.0)
        now = time.time()
        if now - last < self._min_repeat:
            self._keepalive.refresh_alias(sha256)
            return
        self._seen_emit[sha256] = now

        # Determine status from points
        if points >= 15:
            status = "CRITICAL"
        elif points >= 10:
            status = "ALERT"
        elif points >= 5:
            status = "WARN"
        else:
            status = "INFO"

        # Build details with full SHA256 for database storage
        exe_name = os.path.basename(exe_path)
        details = f"SHA:{sha256} | {exe_name}"
        if comment:
            details += f" | {comment}"
        if source != "IOC Database":
            details += f" | {source}"
        # Add file path for better tracking
        details += f" | Path:{exe_path}"

        post_signal("programs", label, status, details)
        detection_key = f"hash:{sha256}"
        self._keepalive.mark_active(
            detection_key,
            label,
            status,
            details,
            alias=sha256,
        )

    def _check_virustotal_hash(self, sha256: str, process_name: str) -> dict[str, Any] | None:
        """Check hash against VirusTotal database with configurable rate limiting.
        
        Cache hierarchy:
        1. Redis cache (shared with dashboard) - checked first
        2. Local file cache - fallback
        3. VirusTotal API - if not cached
        
        Rate limiting: Free tier allows 4 requests/minute (15s between requests).
        We use 20s by default for safety margin. Rate limit is shared via Redis.
        
        Returns detection info dict or None if clean/cached/rate-limited.
        """
        now = time.time()

        # Check if VT is enabled
        if not self._vt_enabled:
            return None

        # Check Redis cache first (shared with dashboard)
        if self._vt_redis_cache and self._vt_redis_cache.enabled:
            cached = self._vt_redis_cache.get_cached_result(sha256)
            if cached:
                status = cached.get("status", "")
                if status in ("malicious", "suspicious"):
                    print(f"[VT] Redis cache hit: {process_name} -> {status}")
                    self._vt_redis_cache.update_stats(cached, from_cache=True)
                    return {
                        "label": cached.get("label", process_name),
                        "points": cached.get("points", 5),
                        "reason": f"(cached) {cached.get('reason', '')}",
                    }
                elif status == "clean":
                    if input_debug == "1":
                        print(f"[VT] Redis cache hit: {process_name} -> clean")
                    self._vt_redis_cache.update_stats(cached, from_cache=True)
                    return None
                # For unknown/error, we might want to retry

        # Check shared rate limiting via Redis
        if self._vt_redis_cache and self._vt_redis_cache.enabled:
            can_request, wait_time = self._vt_redis_cache.can_make_request()
            if not can_request:
                if input_debug == "1":
                    print(f"[VT] Shared rate limit: {wait_time:.1f}s remaining")
                return None
        else:
            # Fallback to local rate limiting
            time_since_last = now - self._last_vt_request
            if time_since_last < self._min_vt_interval:
                remaining = self._min_vt_interval - time_since_last
                if input_debug == "1":
                    print(f"[VT] Local rate limit: {remaining:.1f}s remaining")
                return None

        # Check local cache (fallback)
        if sha256 in self._vt_checked_hashes:
            cache_age = now - self._vt_checked_hashes[sha256]
            if cache_age < self._vt_cache_duration:
                if input_debug == "1":
                    print(f"[VT] Local cache hit for {process_name} (cached {cache_age/3600:.1f}h ago)")
                return None

        print(f"[VT] Checking {process_name} (hash: {sha256[:16]}...)")

        try:
            headers = {"x-apikey": self._vt_api_key, "Accept": "application/json"}

            response = requests.get(
                f"https://www.virustotal.com/api/v3/files/{sha256}",
                headers=headers,
                timeout=10,
            )

            self._last_vt_request = now
            self._vt_checked_hashes[sha256] = now
            self._save_vt_cache()
            
            # Record request in shared Redis rate limiter
            if self._vt_redis_cache and self._vt_redis_cache.enabled:
                self._vt_redis_cache.record_request()

            if response.status_code == 429:
                # Rate limited by VT - back off
                print("[VT] WARNING: Rate limited by VirusTotal! Backing off...")
                self._last_vt_request = now + 60  # Extra 60s backoff
                return None

            if response.status_code == 404:
                # File not in VirusTotal database - could be custom malware
                print(f"[VT] {process_name} NOT FOUND in VT database (could be custom/new malware)")
                result = {
                    "hash": sha256,
                    "status": "unknown",
                    "severity": "WARN",
                    "label": f"Unknown File: {process_name}",
                    "points": 5,
                    "reason": "Not in VirusTotal database - unknown file",
                    "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
                # Cache in Redis for dashboard
                if self._vt_redis_cache and self._vt_redis_cache.enabled:
                    self._vt_redis_cache.cache_result(result)
                    self._vt_redis_cache.update_stats(result, from_cache=False)
                return result

            if response.status_code == 200:
                data = response.json()
                attributes = data.get("data", {}).get("attributes", {})

                # Get detection stats
                stats = attributes.get("last_analysis_stats", {})
                malicious = stats.get("malicious", 0)
                suspicious = stats.get("suspicious", 0)
                harmless = stats.get("harmless", 0)
                undetected = stats.get("undetected", 0)
                total = malicious + suspicious + harmless + undetected

                # Get meaningful names and tags
                names = attributes.get("meaningful_name", process_name)
                tags = attributes.get("tags", [])
                all_names = attributes.get("names", [])

                # Build result for Redis cache
                result = {
                    "hash": sha256,
                    "stats": {
                        "malicious": malicious,
                        "suspicious": suspicious,
                        "harmless": harmless,
                        "undetected": undetected,
                        "total": total,
                    },
                    "names": all_names[:5] if all_names else [names],
                    "tags": tags[:10] if tags else [],
                    "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }

                # Determine threat level using configurable thresholds
                if malicious >= self._vt_malware_threshold:
                    print(f"[VT] MALWARE DETECTED: {process_name} ({malicious}/{total} AV engines)")
                    result.update({
                        "status": "malicious",
                        "severity": "CRITICAL",
                        "label": f"MALWARE: {process_name}",
                        "points": 15,
                        "reason": f"VT: {malicious}/{total} AV engines detect as malware",
                    })
                elif malicious >= self._vt_suspicious_threshold or suspicious >= 3:
                    print(f"[VT] Suspicious: {process_name} ({malicious}+{suspicious}/{total} detections)")
                    result.update({
                        "status": "suspicious",
                        "severity": "ALERT",
                        "label": f"Suspicious: {process_name}",
                        "points": 10,
                        "reason": f"VT: {malicious} malicious + {suspicious} suspicious/{total}",
                    })
                elif any(keyword in names.lower() for keyword in self._vt_poker_keywords):
                    print(f"[VT] 🎰 Poker tool identified: {process_name} as '{names}'")
                    result.update({
                        "status": "suspicious",
                        "severity": "WARN",
                        "label": f"Poker Tool: {process_name}",
                        "points": 5,
                        "reason": f"Identified as: {names}",
                    })
                elif any(keyword in str(tags).lower() for keyword in self._vt_poker_keywords):
                    print(f"[VT] 🎰 Poker-related tags found: {process_name} tags={tags}")
                    result.update({
                        "status": "suspicious",
                        "severity": "WARN",
                        "label": f"Poker Related: {process_name}",
                        "points": 5,
                        "reason": f"VT tags: {', '.join(tags[:3])}",
                    })
                else:
                    print(f"[VT] {process_name} CLEAN ({total} AV engines, 0 detections)")
                    result.update({
                        "status": "clean",
                        "severity": "INFO",
                        "label": names,
                        "points": 0,
                        "reason": f"Clean ({total} AV engines checked)",
                    })
                
                # Cache in Redis for dashboard
                if self._vt_redis_cache and self._vt_redis_cache.enabled:
                    self._vt_redis_cache.cache_result(result)
                    self._vt_redis_cache.update_stats(result, from_cache=False)
                
                # Only return detection result if it's suspicious/malicious
                if result.get("status") in ("malicious", "suspicious"):
                    return result
                return None  # Clean file, no detection needed

            elif response.status_code == 401:
                print("[VT] ERROR: Invalid API key! Check config.txt VirusTotalAPIKey")
            else:
                print(f"[VT] ERROR: Unexpected status {response.status_code}")

        except requests.exceptions.Timeout:
            print(f"[VT] Timeout checking {process_name}")
        except requests.exceptions.RequestException as e:
            print(f"[VT] Network error: {e}")
        except Exception as e:
            print(f"[VT] Unexpected error: {e}")

        return None

    def _get_authenticode_signature(self, path: str) -> dict[str, Any] | None:
        """Get digital signature info via PowerShell"""
        try:
            safe_path = path.replace("'", "''")
            ps_script = (
                "$s=Get-AuthenticodeSignature -FilePath '"
                + safe_path
                + "'; $s | ConvertTo-Json -Depth 4"
            )
            ps = [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                ps_script,
            ]
            r = subprocess.run(ps, capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                j = json.loads(r.stdout)
                return {
                    "Status": j.get("Status"),
                    "StatusMessage": j.get("StatusMessage"),
                }
            return None
        except Exception:
            return None

    def _load_vt_cache(self):
        """Load VirusTotal cached results from file"""
        try:
            if os.path.exists(self._vt_cache_file):
                with open(self._vt_cache_file) as f:
                    cache = json.load(f)
                    self._vt_checked_hashes = {k: float(v) for k, v in cache.items()}
        except Exception:
            pass

    def _save_vt_cache(self):
        """Save VirusTotal cache to file"""
        try:
            with open(self._vt_cache_file, "w") as f:
                json.dump(self._vt_checked_hashes, f)
        except Exception:
            pass
