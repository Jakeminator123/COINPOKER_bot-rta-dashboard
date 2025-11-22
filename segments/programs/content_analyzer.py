# segments/programs/content_analyzer.py
"""
Content Analyzer (programs):
- Path hints for bots/RTA/automation
- Binary obfuscation: entropy, packer signatures, anti-analysis, PE section anomalies

NOTE: Window-title checks were removed to avoid overlap with the Network detector.
"""

from __future__ import annotations

import hashlib
import math
import os
import time

import psutil  # type: ignore

from core.api import BaseSegment, post_signal
from utils.config_loader import get_config
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown


# Load configuration from central config loader
def _load_programs_config():
    """Load programs configuration from config_loader (dashboard/cache/local)"""
    try:
        config = get_config("programs_config")
        if config:
            return config
    except Exception as e:
        print(f"[ContentAnalyzer] WARNING: Config load failed: {e}")

    # Return minimal defaults if not found
    return {
        "path_hints": {
            "bot_paths": [],
            "rta_solver_paths": [],
            "automation_paths": [],
            "suspicious_generic": [],
        },
        "packer_signatures": {},
        "anti_analysis_signatures": {},
    }


# Load configuration
_config = _load_programs_config()

# Build PATH_HINTS from all path categories
PATH_HINTS = []
for category in [
    "bot_paths",
    "rta_solver_paths",
    "automation_paths",
    "suspicious_generic",
]:
    PATH_HINTS.extend(_config.get("path_hints", {}).get(category, []))

# Packer signatures (convert string keys to bytes)
PACKER_SIGNATURES = {k.encode(): v for k, v in _config.get("packer_signatures", {}).items()}

# Anti-analysis signatures (convert string keys to bytes)
ANTI_ANALYSIS_SIGNATURES = {
    k.encode(): v for k, v in _config.get("anti_analysis_signatures", {}).items()
}


class ContentAnalyzer(BaseSegment):
    """
    Content analyzer focusing on:
    - Path hints for bots/RTA in executables
    - Binary obfuscation and packer detection
    - Entropy analysis for encrypted/packed executables
    - PE section analysis for anomalies
    """

    name = "ContentAnalyzer"
    category = "programs"
    interval_s = 92.0  # Synchronized with unified batch interval

    def __init__(self):
        super().__init__()

        # Load configuration
        content_config = _config.get("content_analyzer", {})

        # Name/title scanner state
        self._last_emit: dict[str, float] = {}  # key -> timestamp
        self._min_repeat = apply_cooldown(
            content_config.get("min_repeat_seconds", 15.0)
        )  # scaled throttle
        self._sha_cache: dict[str, str] = {}  # exe_path -> sha256 hash

        # Obfuscation scanner state
        self._obf_cache: dict[str, float] = {}  # path -> last_scan_time
        self._obf_min_repeat = apply_cooldown(
            content_config.get("obfuscation_cache_ttl", 3600.0)
        )

        # Entropy thresholds
        self._entropy_high = content_config.get("entropy_thresholds", {}).get("high", 7.8)
        self._entropy_suspicious = content_config.get("entropy_thresholds", {}).get(
            "suspicious", 7.4
        )

        # Anti-analysis thresholds
        self._anti_analysis_alert = content_config.get("anti_analysis_alert_threshold", 5)
        self._anti_analysis_warn = content_config.get("anti_analysis_warn_threshold", 3)

        # Skip patterns for obfuscation
        self._obf_skip_patterns = content_config.get("obfuscation_skip_patterns", [])

        # Load safe processes whitelist for obfuscation scanning
        self._safe_processes = self._load_safe_processes()

        keepalive_seconds = float(content_config.get("keepalive_seconds", 45.0))
        keepalive_seconds = max(15.0, min(keepalive_seconds, 60.0))
        active_timeout = float(content_config.get("active_timeout_seconds", 150.0))
        if active_timeout < keepalive_seconds * 2:
            active_timeout = keepalive_seconds * 2
        self._keepalive = DetectionKeepalive(
            "programs",
            keepalive_interval=keepalive_seconds,
            active_timeout=active_timeout,
        )

        # Keepalive helper so detections stay alive between heavy scans
        print("[ContentAnalyzer] Ready (paths+binary obfuscation)")

    def _load_safe_processes(self) -> set[str]:
        """Load safe process whitelist from programs_config.json"""
        safe_procs = set()
        try:
            # Load from programs_config.json IOC section
            ioc_config = _config.get("ioc", {})
            safe_processes = ioc_config.get("safe_processes", {})
            safe_procs = set(safe_processes.keys())

            # Also add from legacy whitelist section if present
            whitelist = _config.get("whitelist", {})
            if "safe_processes" in whitelist:
                safe_procs.update(whitelist["safe_processes"])

            print(f"[ContentAnalyzer] Loaded {len(safe_procs)} safe processes from config")
        except Exception as e:
            print(f"[ContentAnalyzer] WARNING: Failed to load safe processes: {e}")
        return safe_procs

    def tick(self):
        """Main scanning loop - path hints and obfuscation analysis"""
        now = time.time()

        # Scan all running processes
        for p in psutil.process_iter(["pid", "name", "exe"]):
            pid = p.info.get("pid")
            raw_name = (p.info.get("name") or "").lower()
            exe = (p.info.get("exe") or "").lower()
            base = os.path.basename(exe) if exe else ""

            if not exe or not os.path.isfile(exe):
                continue

            # 1) Path hints - use severity based on hint type
            if any(hint in exe for hint in PATH_HINTS):
                for hint in [h for h in PATH_HINTS if h in exe][:2]:
                    # Bot paths are critical, automation/RTA are alert
                    if any(
                        bot_hint in hint for bot_hint in ["\\bot\\", "\\warbot\\", "\\holdembot\\"]
                    ):
                        hint_status = "CRITICAL"
                    elif any(rta_hint in hint for rta_hint in ["\\rta\\", "\\gto\\", "\\solver\\"]):
                        hint_status = "ALERT"
                    else:
                        hint_status = "WARN"

                    hint_cleaned = hint.strip("\\")
                    detection_key = f"path:{exe}:{hint}"
                    alias = f"{exe}:path"
                    emitted = self._emit_once(
                        detection_key,
                        "Path hint",
                        hint_status,
                        f"{hint_cleaned} in {base} (pid={pid})",
                        now,
                    )
                    if emitted:
                        self._keepalive.mark_active(
                            detection_key,
                            f"Path hint: {hint_cleaned}",
                            hint_status,
                            f"{hint_cleaned} in {base} (pid={pid})",
                            alias=alias,
                        )
                    else:
                        self._keepalive.refresh_alias(alias)

            # 2) Binary obfuscation (skip known-safe/system)

            # Skip if in safe process whitelist
            if raw_name in self._safe_processes:
                continue

            # Skip system files and common legitimate programs
            if any(skip in exe for skip in self._obf_skip_patterns):
                continue

            # Skip if we've scanned this file recently
            alias = f"{exe}:obf"
            if exe in self._obf_cache and now - self._obf_cache[exe] < self._obf_min_repeat:
                self._keepalive.refresh_alias(alias)
                continue

            # Analyze the file for obfuscation
            for label, status, details in self._analyze_obfuscation(exe, raw_name):
                post_signal("programs", label, status, details)
                detection_key = f"obf:{exe}:{label}"
                self._keepalive.mark_active(
                    detection_key,
                    label,
                    status,
                    details,
                    alias=alias,
                )
            self._obf_cache[exe] = now
        self._keepalive.emit_keepalives()

    def _emit_once(self, key: str, name: str, status: str, details: str, now: float) -> bool:
        """Emit signal with throttling to avoid spam. Returns True if signal was emitted."""
        last = self._last_emit.get(key, 0.0)
        if now - last >= self._min_repeat:
            self._last_emit[key] = now
            post_signal("programs", name, status, details)
            return True
        return False

    def _get_sha256(self, file_path: str) -> str | None:
        """Calculate SHA-256 hash of a file (with caching)"""
        if file_path in self._sha_cache:
            return self._sha_cache[file_path]

        try:
            h = hashlib.sha256()
            with open(file_path, "rb") as f:
                # Read in chunks to handle large files
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(chunk)
            sha = h.hexdigest().lower()
            self._sha_cache[file_path] = sha
            return sha
        except Exception:
            return None

    def _analyze_obfuscation(self, file_path: str, process_name: str) -> list[tuple]:
        """
        Analyze a file for signs of obfuscation.
        Returns list of (label, status, details) tuples for each detection.
        """
        results = []

        try:
            with open(file_path, "rb") as f:
                # Read first 4MB for analysis
                data = f.read(4 * 1024 * 1024)

            if not data:
                return results

            # 1. Calculate entropy (increased thresholds to reduce false positives)
            entropy = self._calculate_entropy(data)
            if entropy > self._entropy_high:  # Very high entropy indicates encryption/packing
                results.append(
                    (
                        f"High Entropy: {process_name}",
                        "CRITICAL",
                        f"entropy={entropy:.2f} (likely packed/encrypted)",
                    )
                )
            elif entropy > self._entropy_suspicious:  # Suspicious entropy
                results.append(
                    (
                        f"Suspicious Entropy: {process_name}",
                        "ALERT",
                        f"entropy={entropy:.2f} (possibly obfuscated)",
                    )
                )

            # 2. Check for packer signatures
            for signature, packer_name in PACKER_SIGNATURES.items():
                if signature in data:
                    results.append(
                        (
                            f"{packer_name}: {process_name}",
                            "CRITICAL",
                            f"Packed with {packer_name}",
                        )
                    )
                    break  # One packer is enough

            # 3. Check for anti-analysis techniques (more conservative)
            proc_lower = (process_name or "").lower()
            if proc_lower in self._safe_processes:
                # Safe-listed process: skip anti-analysis checks for this file
                # (We do NOT 'continue' here because we are not inside a loop.)
                pass
            else:
                anti_techniques = []
                for signature, technique in ANTI_ANALYSIS_SIGNATURES.items():
                    if signature in data:
                        anti_techniques.append(technique)

                if (
                    len(anti_techniques) >= self._anti_analysis_alert
                ):  # Need many techniques for critical
                    results.append(
                        (
                            f"Anti-Analysis: {process_name}",
                            "CRITICAL",
                            f"Techniques: {', '.join(set(anti_techniques[:3]))}",
                        )
                    )
                    print(
                        f"[ContentAnalyzer] Anti-analysis CRITICAL for {process_name}: {anti_techniques}"
                    )
                elif len(anti_techniques) >= self._anti_analysis_warn:
                    results.append(
                        (
                            f"Suspicious Code: {process_name}",
                            "ALERT",
                            f"Found {len(anti_techniques)} anti-analysis techniques",
                        )
                    )
                    print(
                        f"[ContentAnalyzer] Anti-analysis ALERT for {process_name}: {anti_techniques}"
                    )

            # 4. Check for suspicious section names (PE specific)
            if data[:2] == b"MZ":  # PE file
                suspicious_sections = self._check_pe_sections(data)
                if suspicious_sections:
                    results.append(
                        (
                            f"PE Anomaly: {process_name}",
                            "WARN",
                            f"Suspicious sections: {', '.join(suspicious_sections[:2])}",
                        )
                    )

        except Exception:
            # Silently skip files we can't read
            pass

        return results

    def _calculate_entropy(self, data: bytes) -> float:
        """Calculate Shannon entropy of binary data"""
        if not data:
            return 0.0

        # Count byte frequencies
        frequencies = {}
        for byte in data:
            frequencies[byte] = frequencies.get(byte, 0) + 1

        # Calculate entropy
        entropy = 0.0
        data_len = len(data)
        for count in frequencies.values():
            probability = count / data_len
            if probability > 0:
                entropy -= probability * math.log2(probability)

        return entropy

    def _check_pe_sections(self, data: bytes) -> list[str]:
        """Check for suspicious PE section names"""
        suspicious = []

        # Common packed/obfuscated section names from config
        suspicious_names = [s.encode() for s in _config.get("suspicious_pe_sections", [])]

        for name in suspicious_names:
            if name in data:
                suspicious.append(name.decode("ascii", errors="ignore"))

        # Check for sections with high entropy names (random)
        import re

        section_pattern = rb"\x2E[\x20-\x7E]{7}"  # . followed by 7 printable chars
        sections = re.findall(section_pattern, data)

        for section in sections[:10]:  # Check first 10 sections
            section_str = section.decode("ascii", errors="ignore")
            # Check if section name looks random (high entropy)
            if self._calculate_entropy(section[1:]) > 3.5:
                suspicious.append(f"Random: {section_str}")

        return suspicious
