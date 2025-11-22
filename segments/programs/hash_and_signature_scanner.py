# segments/programs/hash_and_signature_scanner.py
"""
Consolidated hash scanner combining signature definitions, IOC database lookups,
and VirusTotal API integration for comprehensive executable analysis.
Consolidates hash_scanner.py, signatures.py, and virustotal_checker.py.
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
from utils.config_loader import get_config
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown

# Try to import requests (optional)
try:
    import requests
except ImportError:
    requests = None


# Read settings from config.txt
def _load_config_txt_settings():
    """Load settings from config.txt"""
    settings = {"api_key": "", "input_debug": "0", "max_cpu_percent": "25"}

    try:
        config_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "config.txt"
        )
        if os.path.exists(config_path):
            with open(config_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue

                    key, value = line.split("=", 1)
                    key = key.strip().upper()
                    value = value.strip()

                    # Remove inline comments
                    if "#" in value:
                        value = value.split("#")[0].strip()

                    if key == "VIRUSTOTALAPIKEY":
                        settings["api_key"] = value
                    elif key == "INPUT_DEBUG":
                        settings["input_debug"] = value
                    elif key == "MAXCPUPERCENT":
                        settings["max_cpu_percent"] = value
    except Exception as e:
        print(f"[HashAndSignatureScanner] WARNING: Failed to read config.txt: {e}")

    # Allow environment variables to override
    settings["api_key"] = os.getenv("VirusTotalAPIKey") or settings["api_key"]
    settings["input_debug"] = os.getenv("INPUT_DEBUG") or settings["input_debug"]
    settings["max_cpu_percent"] = os.getenv("MAXCPUPERCENT") or settings["max_cpu_percent"]

    return settings


_settings = _load_config_txt_settings()
api_key = _settings["api_key"].strip()
input_debug = _settings["input_debug"].strip()
max_cpu_percent = _settings["max_cpu_percent"].strip()

print(f"[HashAndSignatureScanner] INPUT_DEBUG={input_debug} | MAXCPUPERCENT={max_cpu_percent}")
if api_key:
    print("[HashAndSignatureScanner] VirusTotal API key found -> VT lookups ENABLED")
else:
    print("[HashAndSignatureScanner] VirusTotal API key missing -> VT lookups DISABLED")


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

        # VirusTotal integration with improved rate limiting
        self._vt_checked_hashes: dict[str, float] = {}  # hash -> last_check_time
        self._vt_cache_duration = apply_cooldown(86400.0)  # Scaled VT cache duration
        self._last_vt_request = 0.0
        self._min_vt_interval = apply_cooldown(
            20.0, minimum=5.0, allow_zero=False
        )  # Guard for VT rate limiting
        self._vt_priority_queue = []  # Queue for high-priority processes (bots/RTAs)

        # Online reputation cache
        self._online_cache: dict[str, tuple[float, dict]] = {}
        self._online_cache_ttl = apply_cooldown(3600.0)  # Scaled online lookup cache

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

        # Load VirusTotal cache if exists
        self._vt_cache_file = "virustotal_cache.json"
        self._load_vt_cache()

        # Configuration
        self._load_config()

        # Simplified rate limiting - only for VirusTotal (20s minimum)
        # Removed other APIs to focus on VT control

        print(
            f"[HashAndSignatureScanner] Initialized with {len(self._ioc)} bad hashes from config, {len(self._allowlist)} allowlisted"
        )
        if self._vt_api_key:
            print(
                f"[HashAndSignatureScanner] VirusTotal API configured - {self._min_vt_interval}s rate limit"
            )
        else:
            print("[HashAndSignatureScanner] VirusTotal API disabled (no key)")

    def _load_config(self):
        """Load configuration from config.txt"""
        self._enable_online_lookups = False
        self._vt_api_key = ""
        self._check_signatures = True

        try:
            config_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "config.txt",
            )
            if os.path.exists(config_path):
                with open(config_path) as f:
                    for line in f:
                        line = line.strip()
                        if "=" in line:
                            key, value = line.split("=", 1)
                            key = key.strip().upper()
                            value = value.strip()

                            if key == "ENABLEHASHLOOKUP" and value.lower() in (
                                "true",
                                "yes",
                                "1",
                            ):
                                self._enable_online_lookups = True
                            elif key == "VIRUSTOTALAPIKEY":
                                self._vt_api_key = value
                            elif key == "CHECKSIGNATURES" and value.lower() in (
                                "false",
                                "no",
                                "0",
                            ):
                                self._check_signatures = False
        except Exception:
            pass

        # Allow override from environment and .env
        env_key = os.environ.get("VirusTotalAPIKey", "")
        if env_key:
            self._vt_api_key = env_key

        # Use API key loaded from .env if available
        if api_key and not self._vt_api_key:
            self._vt_api_key = api_key
            print("[HashAndSignatureScanner] Using VirusTotal API key from .env")

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

        # 2. SECOND: Hash analysis (slower) - ONE process per tick to avoid VT spam
        # Priority: Known bots/RTAs first, then suspicious processes during poker
        vt_candidates = []

        # Add known bots/RTAs to VT queue (highest priority)
        for p, exe, proc_name in priority_processes:
            if proc_name in PROCESS_NAMES:
                meta = PROCESS_NAMES[proc_name]
                points = meta.get("points", 0)
                if points >= 10:  # Only check high-risk processes (ALERT/CRITICAL)
                    vt_candidates.append((p, exe, proc_name, 3))  # Priority 3 = highest

        # Add suspicious processes during poker (medium priority - prioritize during CoinPoker)
        if coinpoker_active or other_poker_active:
            for p, exe, proc_name in all_processes[:3]:
                if any(
                    susp in proc_name for susp in ["python", "autohotkey", "autoit", "powershell"]
                ):
                    priority = 3 if coinpoker_active else 2  # Higher priority for CoinPoker
                    vt_candidates.append((p, exe, proc_name, priority))

        # Sort by priority and take only ONE for this tick
        if vt_candidates:
            vt_candidates.sort(key=lambda x: x[3], reverse=True)  # Sort by priority
            p, exe, proc_name, _ = vt_candidates[0]  # Take highest priority
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
        """Handle hash-based analysis (IOC + VirusTotal)"""
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

        # Check VirusTotal if enabled - ONLY for high-risk processes with strict rate limiting
        if self._enable_online_lookups and self._vt_api_key and requests:
            # Only check known bot/RTA processes or highly suspicious processes
            should_check_vt = False

            # Known bots/RTAs always get checked
            if proc_name in PROCESS_NAMES:
                meta2 = PROCESS_NAMES[proc_name]
                p2 = meta2.get("points")
                r2 = meta2.get("risk", 0)
                try:
                    p2i = int(p2) if p2 is not None else None
                except Exception:
                    p2i = None
                r2i = (
                    r2
                    if isinstance(r2, int)
                    else int(r2)
                    if isinstance(r2, str) and r2.isdigit()
                    else 0
                )
                if (p2i is not None and p2i >= 10) or (
                    p2i is None and r2i >= 2
                ):  # Only medium/high
                    should_check_vt = True

            # Suspicious automation during poker (prioritize CoinPoker)
            elif (coinpoker_active or other_poker_active) and any(
                susp in proc_name for susp in ["python", "autohotkey", "autoit"]
            ):
                should_check_vt = True

            if should_check_vt:
                vt_result = self._check_virustotal_hash(sha, proc_name)
                if vt_result:
                    self._emit_detection(
                        process,
                        exe_path,
                        sha,
                        vt_result["label"],
                        vt_result["points"],
                        vt_result["reason"],
                        "VirusTotal",
                    )

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
        """Check hash against VirusTotal database with strict 20-second rate limiting"""
        now = time.time()

        # STRICT rate limiting - 20 seconds minimum between ANY VT requests
        if now - self._last_vt_request < self._min_vt_interval:
            print(
                f"[VT] Rate limit: {self._min_vt_interval - (now - self._last_vt_request):.1f}s remaining"
            )
            return None

        # Check if already scanned recently (longer cache for efficiency)
        if sha256 in self._vt_checked_hashes:
            if now - self._vt_checked_hashes[sha256] < self._vt_cache_duration:
                return None

        print(f"[VT] Checking {process_name} (hash: {sha256[:12]}...) - ONE process per detection")

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

            if response.status_code == 404:
                # File not in VirusTotal database
                print(f"[VT] {process_name} not found in VT database (could be custom/new)")
                return {
                    "label": f"Unknown File: {process_name}",
                    "points": 5,
                    "reason": "Not in VirusTotal database",
                }

            if response.status_code == 200:
                data = response.json()
                attributes = data.get("data", {}).get("attributes", {})

                # Get detection stats
                stats = attributes.get("last_analysis_stats", {})
                malicious = stats.get("malicious", 0)
                suspicious = stats.get("suspicious", 0)
                total = sum(stats.values())

                # Get meaningful names
                names = attributes.get("meaningful_name", process_name)

                # Determine threat level with logging
                if malicious >= 5:
                    print(f"[VT] MALWARE DETECTED: {process_name} ({malicious}/{total} detections)")
                    return {
                        "label": f"MALWARE: {process_name}",
                        "points": 15,
                        "reason": f"VT: {malicious}/{total} detect as malware",
                    }
                elif malicious >= 2 or suspicious >= 3:
                    print(
                        f"[VT] Suspicious file: {process_name} ({malicious + suspicious}/{total} detections)"
                    )
                    return {
                        "label": f"Suspicious: {process_name}",
                        "points": 10,
                        "reason": f"VT: {malicious + suspicious}/{total} detections",
                    }
                elif any(
                    keyword in names.lower()
                    for keyword in ["poker", "bot", "rta", "solver", "gto", "holdem"]
                ):
                    print(f"[VT] Poker tool identified: {process_name} as {names}")
                    return {
                        "label": f"Poker Tool: {process_name}",
                        "points": 5,
                        "reason": f"Identified as: {names}",
                    }
                else:
                    print(f"[VT] {process_name} clean in VirusTotal ({total} engines checked)")

        except Exception as e:
            print(f"[HashAndSignatureScanner] VirusTotal error: {e}")

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
