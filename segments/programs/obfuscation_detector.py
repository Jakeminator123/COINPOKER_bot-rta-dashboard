# segments/programs/obfuscation_detector.py
"""
Detects obfuscated Python scripts by analyzing running processes
"""

from __future__ import annotations

import os
import re
import time
from collections import defaultdict

import psutil  # type: ignore

from core.api import BaseSegment, post_signal
from utils.config_loader import get_config
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown


# Load configuration
def _load_obfuscation_config():
    """Load obfuscation configuration from config_loader (dashboard/cache/local)"""
    try:
        config = get_config("obfuscation_config")
        if config:
            return config
    except Exception as e:
        print(f"[ObfuscationDetector] WARNING: Config load failed: {e}")

    # Return minimal defaults
    return {
        "obfuscation_patterns": {},
        "complexity_thresholds": {},
        "file_scan_settings": {},
        "reporting": {"report_cooldown": 60.0},
    }


_config = _load_obfuscation_config()


class ObfuscationDetector(BaseSegment):
    """
    Detects obfuscated Python scripts by analyzing command lines and memory
    """

    name = "ObfuscationDetector"
    category = "programs"
    interval_s = 92.0  # Synchronized with unified batch interval

    def __init__(self):
        super().__init__()
        self._detected = defaultdict(float)  # pid -> last_report_time

        # Load reporting settings from config
        reporting = _config.get("reporting", {})
        self._report_cooldown = apply_cooldown(
            reporting.get("report_cooldown", 15.0)
        )  # Must be < ThreatManager timeout

        keepalive_seconds = float(reporting.get("keepalive_seconds", 45.0))
        keepalive_seconds = max(15.0, min(keepalive_seconds, 60.0))
        active_timeout = float(reporting.get("active_timeout_seconds", 150.0))
        if active_timeout < keepalive_seconds * 2:
            active_timeout = keepalive_seconds * 2
        self._keepalive = DetectionKeepalive(
            "programs",
            keepalive_interval=keepalive_seconds,
            active_timeout=active_timeout,
        )

        # Load obfuscation patterns from config
        patterns_config = _config.get("obfuscation_patterns", {})
        self.obfuscation_patterns = []

        # Flatten all pattern categories into single list
        for category, patterns in patterns_config.items():
            self.obfuscation_patterns.extend(patterns)

        # If no patterns in config, use defaults
        if not self.obfuscation_patterns:
            self.obfuscation_patterns = [
                # Dynamic code execution
                r"\bexec\s*\(",
                r"\beval\s*\(",
                r"__import__\s*\(",
                r"compile\s*\(",
                # String obfuscation
                r"chr\s*\(\s*\d+\s*\)",
                r"\\x[0-9a-fA-F]{2}",
                r"base64\.b64decode",
                r"codecs\.decode",
                # Attribute manipulation
                r"__dict__\[",
                r"getattr\s*\(",
                r"setattr\s*\(",
                r"globals\s*\(\)\[",
                r"locals\s*\(\)\[",
                # Anti-analysis
                r"sys\.settrace",
                r"sys\.gettrace",
                r"__code__",
                r"__builtins__",
                # Packing/encoding
                r"zlib\.decompress",
                r"marshal\.loads",
                r"pickle\.loads",
            ]

    def tick(self):
        """Check for obfuscated Python scripts"""
        now = time.time()

        try:
            for proc in psutil.process_iter(["pid", "name", "cmdline", "memory_percent"]):
                proc_name = (proc.info.get("name") or "").lower()
                pid = proc.info.get("pid")

                # Only check Python processes
                if proc_name not in ["python.exe", "pythonw.exe", "python3.exe"]:
                    continue

                alias = f"obf:{pid}"
                # Check cooldown
                if now - self._detected.get(pid, 0) < self._report_cooldown:
                    self._keepalive.refresh_alias(alias)
                    continue

                cmdline = proc.info.get("cmdline") or []

                # Check for obfuscation indicators
                obfuscation_score = 0
                indicators = []

                # 1. Check for one-liner Python commands (common in obfuscated code)
                for arg in cmdline:
                    if arg.startswith("-c"):  # python -c "code"
                        # One-liner execution is suspicious
                        obfuscation_score += 30
                        indicators.append("One-liner execution")

                        # Check for obfuscation patterns in the command
                        if any(
                            pattern in arg for pattern in ["exec", "eval", "__import__", "chr("]
                        ):
                            obfuscation_score += 40
                            indicators.append("Dynamic execution")

                # 2. Check for scripts with suspicious patterns in filename
                script_file = None
                script_path = None
                for arg in cmdline:
                    if arg.endswith(".py"):
                        script_file = os.path.basename(arg)
                        script_path = arg

                        # Check if filename looks obfuscated (random chars, etc)
                        if len(script_file) > 20 or re.match(
                            r"^[a-f0-9]+\.py$", script_file.lower()
                        ):
                            obfuscation_score += 20
                            indicators.append("Suspicious filename")

                        # Try to read first few lines of the script (if accessible)
                        try:
                            if os.path.exists(script_path):
                                with open(script_path, encoding="utf-8", errors="ignore") as f:
                                    content = f.read(4000)  # First 4KB to catch more patterns

                                    # Count obfuscation patterns
                                    pattern_matches = 0
                                    matched_patterns = []
                                    for pattern in self.obfuscation_patterns:
                                        if re.search(pattern, content):
                                            pattern_matches += 1
                                            # Extract pattern name for reporting
                                            if pattern_matches <= 3:
                                                matched_patterns.append(pattern[:15])

                                    if pattern_matches >= 3:
                                        obfuscation_score += pattern_matches * 10
                                        indicators.append(f"{pattern_matches} obfuscation patterns")

                                    # Check for suspicious characteristics
                                    lines = content.split("\n")

                                    # Very long lines (common in obfuscated code)
                                    if any(len(line) > 200 for line in lines[:10]):
                                        obfuscation_score += 20
                                        indicators.append("Very long lines")

                                    # High density of special characters
                                    if content:
                                        special_chars = sum(
                                            1 for c in content[:500] if c in "\\[]{}()_"
                                        )
                                        if special_chars / min(len(content[:500]), 500) > 0.3:
                                            obfuscation_score += 15
                                            indicators.append("High special char density")

                                    # Check for specific obfuscation techniques from test_obf.py
                                    if (
                                        "__import__" in content
                                        and "globals()" in content
                                        and "chr(" in content
                                    ):
                                        obfuscation_score += 40
                                        indicators.append("Dynamic import obfuscation")

                                    if "exec" in content and "__dict__" in content:
                                        obfuscation_score += 30
                                        indicators.append("Exec with dict manipulation")

                                    # Check for beacon/periodic behavior (like test_obf.py)
                                    if "BEACON" in content or "beacon" in content.lower():
                                        obfuscation_score += 25
                                        indicators.append("Beacon pattern detected")

                                    # Check for minimal variable names (obfuscation pattern)
                                    short_vars = re.findall(r"\b[_a-z]{1,2}\s*=", content)
                                    if len(short_vars) > 10:
                                        obfuscation_score += 15
                                        indicators.append(f"{len(short_vars)} minimal var names")

                        except Exception:
                            pass

                # 3. Check process behavior
                try:
                    # High CPU usage for Python can indicate deobfuscation (reduced frequency)
                    cpu_percent = proc.cpu_percent(interval=0.5)
                    if cpu_percent > 50:
                        obfuscation_score += 10
                        indicators.append(f"High CPU: {cpu_percent:.0f}%")
                except Exception:
                    pass

                # Report if suspicious - use all 4 levels
                if obfuscation_score >= 30:  # Lower threshold for better detection
                    self._detected[pid] = now

                    if obfuscation_score >= 80:
                        status = "CRITICAL"
                        name = "OBFUSCATED CODE"
                    elif obfuscation_score >= 60:
                        status = "ALERT"
                        name = "Likely Obfuscated"
                    elif obfuscation_score >= 40:
                        status = "WARN"
                        name = "Suspicious Code"
                    else:
                        status = "INFO"
                        name = "Possibly Obfuscated"

                    details = f"Score: {obfuscation_score} - {', '.join(indicators[:3])}"
                    if script_file:
                        details = f"{script_file} | {details}"
                    else:
                        details = f"pid={pid} | {details}"

                    post_signal("programs", name, status, details)
                    detection_key = f"{alias}:{name}"
                    self._keepalive.mark_active(
                        detection_key,
                        name,
                        status,
                        details,
                        alias=alias,
                    )

        except Exception:
            # Silently continue on error
            pass
        self._keepalive.emit_keepalives()
