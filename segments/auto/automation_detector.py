# segments/auto/automation_detector.py
"""
Automation / Script detector
- Scans running processes for known automation, macro and bot frameworks.
- Emits 'auto' category signals via post_signal(...)
- Prints are ASCII-only (Windows console friendly). Set INPUT_DEBUG=1 in .env to see debug logs.

Notes:
- One psutil snapshot per tick for lower overhead.
- Collapsed common variants (e.g., AutoHotkey) to a compact map.
- Loads automation programs from programs_registry.json (unified registry).
"""

from __future__ import annotations

import json
import os
import time

import psutil  # type: ignore

from core.api import BaseSegment, post_signal
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown

# Try to import config_loader
try:
    from utils.config_loader import get_config

    _use_config_loader = True
except ImportError:
    _use_config_loader = False
    print("[AutomationDetector] ConfigLoader not available, using local JSON")


# Load shared configuration
def _load_shared_config():
    """Load shared configuration from JSON file or ConfigLoader"""
    if _use_config_loader:
        try:
            # Try ConfigLoader first
            config = get_config("shared_config")
            if config:
                return config
        except Exception as e:
            print(f"[AutomationDetector] WARNING: ConfigLoader error: {e}")

    # Fallback to local file
    try:
        # Try multiple possible locations
        possible_paths = [
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "shared_config.json"),
            os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "site",
                "bot-rta-dashboard",
                "configs",
                "shared_config.json",
            ),
            os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "configs",
                "shared_config.json",
            ),
        ]
        for config_path in possible_paths:
            if os.path.exists(config_path):
                with open(config_path, encoding="utf-8") as f:
                    return json.load(f)
    except Exception as e:
        print(f"[AutomationDetector] WARNING: Failed to load shared_config.json: {e}")
        return {}


def _load_ignored_programs():
    """Load ignored programs list (optimized for high load)"""
    if _use_config_loader:
        try:
            # Try lightweight ignore endpoint first
            import requests

            # Get web URL from config.txt based on ENV setting
            web_url = "http://localhost:3001"
            env = "PROD"
            web_url_prod = None
            web_url_dev = None

            config_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "config.txt",
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

                        if key == "ENV":
                            env = value.upper()
                        elif key == "WEB_URL_PROD":
                            web_url_prod = value
                        elif key == "WEB_URL_DEV":
                            web_url_dev = value
                        elif key == "WEB_URL" and value:
                            # Backward compatibility
                            web_url_prod = value

            # Select URL based on environment
            if env == "DEV" and web_url_dev:
                web_url = web_url_dev.replace("/api/signal", "")
            elif env == "PROD" and web_url_prod:
                web_url = web_url_prod.replace("/api/signal", "")
            else:
                # Fallback
                web_url = (web_url_prod or web_url_dev or "http://localhost:3001").replace(
                    "/api/signal", ""
                )

            ignore_url = f"{web_url}/api/configs/ignore"
            response = requests.get(ignore_url, timeout=2)
            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    return data.get("ignored_programs", [])
        except Exception as e:
            print(f"[AutomationDetector] INFO: Ignore endpoint unavailable: {e}")

        # Fallback to full config
        try:
            config = get_config("programs_config")
            if config and "ignored_programs" in config:
                return config["ignored_programs"]
        except Exception as e:
            print(f"[AutomationDetector] WARNING: ConfigLoader error: {e}")

    # Fallback to local file
    try:
        # Try multiple possible locations
        possible_paths = [
            os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "programs",
                "programs_config.json",
            ),
            os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "site",
                "bot-rta-dashboard",
                "configs",
                "programs_config.json",
            ),
            os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "configs",
                "programs_config.json",
            ),
        ]
        for config_path in possible_paths:
            if os.path.exists(config_path):
                with open(config_path, encoding="utf-8") as f:
                    config = json.load(f)
                    return config.get("ignored_programs", [])
    except Exception as e:
        print(f"[AutomationDetector] WARNING: Failed to load ignored programs: {e}")
        return []


_shared_config = _load_shared_config()
_ignored_programs = _load_ignored_programs()


def _env_flag(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    v = v.strip().lower()
    return v in ("1", "true", "yes", "y", "on")


class AutomationDetector(BaseSegment):
    """
    Detects automation tools, scripting engines, and macro/clicker software
    often involved in botting.
    """

    name = "AutomationDetector"
    category = "auto"
    interval_s = 92.0  # Synchronized with unified batch interval

    # Cooldown between repeating the same report (must be < ThreatManager timeout)
    REPORT_COOLDOWN_S = 15.0

    # File extensions considered "script files" when seen in cmdline
    SCRIPT_EXTENSIONS = [".ahk", ".au3", ".py", ".js", ".vbs", ".ps1", ".bat"]

    def __init__(self):
        super().__init__()
        self._last_report: dict[str, float] = {}

        # 4-minute cache for already-checked processes (performance optimization)
        self._process_cache: dict[int, float] = {}  # pid -> last_full_check_time
        self._cache_ttl = apply_cooldown(240.0)  # scaled cooldown for cache

        self.debug = _env_flag("INPUT_DEBUG", False)
        self._report_cooldown = apply_cooldown(self.REPORT_COOLDOWN_S)

        # Build compact automation process map {exe_name_lower: (display, points, type)}
        self.automation_processes: dict[str, tuple[str, int, str]] = {}
        self._load_automation_config()

        keepalive_seconds = self._safe_float_env("AUTO_KEEPALIVE_SECONDS", 45.0)
        keepalive_seconds = max(15.0, min(keepalive_seconds, 60.0))
        active_timeout = self._safe_float_env("AUTO_KEEPALIVE_TIMEOUT", 120.0)
        if active_timeout < keepalive_seconds * 2:
            active_timeout = keepalive_seconds * 2
        self._keepalive = DetectionKeepalive(
            "auto",
            keepalive_interval=keepalive_seconds,
            active_timeout=active_timeout,
        )

        if self.debug:
            print("[AutomationDetector] Debug mode ON")
            print(
                f"[AutomationDetector] Monitoring {len(self.automation_processes)} automation exe names"
            )

    # --------------------------
    # Lifecycle
    # --------------------------
    def tick(self) -> None:
        """Main detection pass."""
        procs = self._snapshot_processes()

        # Detect automation processes (runs regardless of poker status, like other segments)
        self._detect_automation_processes(procs)
        self._keepalive.emit_keepalives()

    # --------------------------
    # Snapshot helpers
    # --------------------------
    def _snapshot_processes(self) -> list[dict[str, str | None]]:
        """Take one cheap snapshot of running processes."""
        snap: list[dict[str, str | None]] = []
        now = time.time()

        # Clean old cache entries
        self._process_cache = {
            pid: ts for pid, ts in self._process_cache.items() if now - ts < self._cache_ttl * 2
        }

        try:
            for p in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
                info = p.info
                pid = info.get("pid", 0)

                # Skip recently checked processes (4-minute cache)
                if pid in self._process_cache:
                    if now - self._process_cache[pid] < self._cache_ttl:
                        continue

                # Mark as checked
                self._process_cache[pid] = now

                name = (info.get("name") or "").strip()
                exe = (info.get("exe") or "").strip()
                cmd = info.get("cmdline") or []
                snap.append({"name": name, "exe": exe, "cmdline": cmd, "pid": pid})
        except Exception:
            # Fail-safe: better to emit nothing than crash the loop
            pass
        return snap

    @staticmethod
    def _basename_lower(s: str | None) -> str:
        """Return lowercased basename of path or name string."""
        if not s:
            return ""
        try:
            return os.path.basename(s).lower()
        except Exception:
            return s.lower()

    @staticmethod
    def normalize_program_key(key: str) -> str:
        """Normalize program key to base name without extension.

        This ensures that 'openholdem' and 'openholdem.exe' normalize to the same key,
        preventing duplicate detections and allowing proper multiplier display.

        Args:
            key: Process executable name or key (e.g., "openholdem.exe", "openholdem")

        Returns:
            Normalized key without extension (e.g., "openholdem")
        """
        if not key:
            return ""
        key = key.lower().strip()
        # Remove common executable extensions
        for ext in [".exe", ".bat", ".cmd", ".com", ".scr"]:
            if key.endswith(ext):
                return key[: -len(ext)]
        return key

    # --------------------------
    # Detection steps
    # --------------------------
    def _detect_automation_processes(self, procs: list[dict[str, str | None]]) -> None:
        now = time.time()

        # Track which aliases we've seen this tick for cleanup
        seen_aliases = set()

        # Group related processes together
        # Format: [(display, points, kind, script_file, match_count), ...]
        python_procs: list[tuple[str, int, str, str | None, int]] = []
        autohotkey_procs: list[tuple[str, int, str, str | None, int]] = []
        autoit_procs: list[tuple[str, int, str, str | None, int]] = []
        # Format: [(normalized_key, display, points, kind, script_file, match_count), ...]
        other_procs: list[tuple[str, str, int, str, str | None, int]] = []

        # Group processes by normalized key to prevent duplicates
        # Format: {normalized_key: [(display, points, kind, script_file, original_key), ...]}
        normalized_groups: dict[str, list[tuple[str, int, str, str | None, str]]] = {}

        for info in procs:
            name_l = self._basename_lower(info.get("name"))
            exe_l = self._basename_lower(info.get("exe"))
            cmdline = info.get("cmdline") or []

            # Normalize to whichever is available
            key = name_l or exe_l
            if not key:
                continue

            # Normalize key to remove extension (e.g., "openholdem.exe" -> "openholdem")
            normalized_key = self.normalize_program_key(key)

            # Check if normalized key exists in our registry
            if normalized_key in self.automation_processes:
                display, points, kind = self.automation_processes[normalized_key]

                if self.debug and "python" in normalized_key:
                    print(f"[AutomationDetector] DEBUG: Found Python process - key={key}, normalized={normalized_key}, display={display}")

                # Check if this program is in the ignore list
                if display in _ignored_programs:
                    if self.debug:
                        print(f"[AutomationDetector] DEBUG: Skipping {display} (in ignore list)")
                    continue

                # Group by normalized key to handle duplicates
                if normalized_key not in normalized_groups:
                    normalized_groups[normalized_key] = []
                normalized_groups[normalized_key].append(
                    (display, points, kind, self._first_script_file(cmdline), key)
                )

        # Process grouped detections
        for normalized_key, matches in normalized_groups.items():
            # Use highest points value from all matches
            max_points = max(m[1] for m in matches)
            display = matches[0][0]  # Use display name from first match
            kind = matches[0][2]  # Use kind from first match
            script_files = [m[3] for m in matches if m[3]]  # Collect script files

            # Count matches for multiplier display
            match_count = len(matches)

            # Group Python-related processes
            if "python" in normalized_key or normalized_key == "py":
                python_procs.append(
                    (
                        display,
                        max_points,
                        kind,
                        script_files[0] if script_files else None,
                        match_count,
                    )
                )
            # Group AutoHotkey variants
            elif "autohotkey" in normalized_key or normalized_key == "ahk":
                autohotkey_procs.append(
                    (
                        display,
                        max_points,
                        kind,
                        script_files[0] if script_files else None,
                        match_count,
                    )
                )
            # Group AutoIt variants
            elif "autoit" in normalized_key:
                autoit_procs.append(
                    (
                        display,
                        max_points,
                        kind,
                        script_files[0] if script_files else None,
                        match_count,
                    )
                )
            else:
                other_procs.append(
                    (
                        normalized_key,
                        display,
                        max_points,
                        kind,
                        script_files[0] if script_files else None,
                        match_count,
                    )
                )

        # Send grouped Python signal (if any)
        if python_procs:
            seen_aliases.add("python_group")
            if self._should_report("python_group", now):
                # Use highest points value and collect script files
                max_points = max(p[1] for p in python_procs)
                scripts = [p[3] for p in python_procs if p[3]]
                # Sum up match counts from all python processes
                total_match_count = sum(p[4] for p in python_procs)

                # Map points directly to status: 15→CRITICAL, 10→ALERT, 5→WARN, 0→INFO
                if max_points >= 15:
                    status = "CRITICAL"
                    detail = (
                        f"Python script{'s' if len(scripts) > 1 else ''}: {', '.join(scripts[:2])}"
                        if scripts
                        else "Python automation detected"
                    )
                elif max_points >= 10:
                    status = "ALERT"
                    detail = "Script detected" + (f": {scripts[0]}" if scripts else "")
                elif max_points >= 5:
                    status = "WARN"
                    detail = "Script running"
                else:
                    status = "INFO"
                    detail = "Python detected"

                if total_match_count > 1:
                    detail += f" (x{total_match_count})"

                if self.debug:
                    print(f"[AutomationDetector] DEBUG: Sending Python signal - status={status}, detail={detail}, processes={len(python_procs)}")
                
                post_signal("auto", "Python", status, detail)
                self._last_report["python_group"] = now
                detection_key = f"python_group:{status}"
                self._keepalive.mark_active(
                    detection_key,
                    "Python",
                    status,
                    detail,
                    alias="python_group",
                )

                if self.debug:
                    print(f"[AutomationDetector] Python group: {len(python_procs)} variants detected")
            else:
                self._keepalive.refresh_alias("python_group")

        # Send grouped AutoHotkey signal (if any)
        if autohotkey_procs:
            seen_aliases.add("ahk_group")
            if self._should_report("ahk_group", now):
                max_points = max(p[1] for p in autohotkey_procs)
                scripts = [p[3] for p in autohotkey_procs if p[3]]
                total_match_count = sum(p[4] for p in autohotkey_procs)

                if max_points >= 15:
                    status = "CRITICAL"
                elif max_points >= 10:
                    status = "ALERT"
                elif max_points >= 5:
                    status = "WARN"
                else:
                    status = "INFO"

                detail = "Active macro tool (high bot risk)" + (f": {scripts[0]}" if scripts else "")

                if total_match_count > 1:
                    detail += f" (x{total_match_count})"

                post_signal("auto", "AutoHotkey", status, detail)
                self._last_report["ahk_group"] = now
                detection_key = f"ahk_group:{status}"
                self._keepalive.mark_active(
                    detection_key,
                    "AutoHotkey",
                    status,
                    detail,
                    alias="ahk_group",
                )
            else:
                self._keepalive.refresh_alias("ahk_group")

        # Send grouped AutoIt signal (if any)
        if autoit_procs:
            seen_aliases.add("autoit_group")
            if self._should_report("autoit_group", now):
                max_points = max(p[1] for p in autoit_procs)
                total_match_count = sum(p[4] for p in autoit_procs)

                if max_points >= 15:
                    status = "CRITICAL"
                elif max_points >= 10:
                    status = "ALERT"
                elif max_points >= 5:
                    status = "WARN"
                else:
                    status = "INFO"

                detail = "Active macro tool (high bot risk)"

                if total_match_count > 1:
                    detail += f" (x{total_match_count})"

                post_signal("auto", "AutoIt", status, detail)
                self._last_report["autoit_group"] = now
                detection_key = f"autoit_group:{status}"
                self._keepalive.mark_active(
                    detection_key,
                    "AutoIt",
                    status,
                    detail,
                    alias="autoit_group",
                )
            else:
                self._keepalive.refresh_alias("autoit_group")

        # Send other individual signals
        for normalized_key, display, points, kind, script_file, match_count in other_procs:
            seen_aliases.add(normalized_key)
            if not self._should_report(normalized_key, now):
                self._keepalive.refresh_alias(normalized_key)
                continue

            # Map points directly to status
            if points >= 15:
                status = "CRITICAL"
                detail = f"Active {kind} tool (high bot risk)"
                if script_file:
                    detail = f"Running script: {script_file}"
            elif points >= 10:
                status = "ALERT"
                detail = f"{kind.title()} detected"
                if script_file:
                    detail = f"Running script: {script_file}"
            elif points >= 5:
                status = "WARN"
                detail = f"{kind.title()} running"
            else:
                status = "INFO"
                detail = f"{kind.title()} detected"

            # Include multiplier if multiple matches (e.g., "openholdem" and "openholdem.exe")
            if match_count > 1:
                detail += f" (x{match_count})"

            post_signal("auto", display, status, detail)
            self._last_report[normalized_key] = now
            detection_key = f"{normalized_key}:{status}"
            self._keepalive.mark_active(
                detection_key,
                display,
                status,
                detail,
                alias=normalized_key,
            )
        
        # Clean up aliases for processes that are no longer running
        self._keepalive.cleanup_missing_aliases(seen_aliases)

    # --------------------------
    # Utilities
    # --------------------------
    def _first_script_file(self, cmdline: list[str]) -> str | None:
        """Return first arg that looks like a script file by extension."""
        try:
            for arg in cmdline:
                a = (arg or "").strip().strip('"').strip("'")
                low = a.lower()
                if any(low.endswith(ext) for ext in self.SCRIPT_EXTENSIONS):
                    return os.path.basename(a)
        except Exception:
            pass
        return None

    def _should_report(self, key: str, now: float) -> bool:
        """Simple cooldown check to avoid log spam."""
        last = self._last_report.get(key, 0.0)
        return (now - last) >= self._report_cooldown

    @staticmethod
    def _safe_float_env(var_name: str, default: float) -> float:
        value = os.getenv(var_name)
        if not value:
            return default
        try:
            return float(value)
        except ValueError:
            return default

    def _load_automation_config(self) -> None:
        """Load automation programs from unified programs_registry (consolidated config)."""
        loaded_count = 0

        # Try to load from unified programs_registry via ConfigLoader first
        registry_config = None
        if _use_config_loader:
            try:
                registry_config = get_config("programs_registry")
            except Exception as e:
                if self.debug:
                    print(f"[AutomationDetector] ConfigLoader failed: {e}")

        # Fallback to local JSON file if ConfigLoader fails
        if not registry_config:
            # Try multiple possible locations
            possible_paths = [
                os.path.join(os.path.dirname(os.path.dirname(__file__)), "programs_registry.json"),
                os.path.join(
                    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                    "site",
                    "bot-rta-dashboard",
                    "configs",
                    "programs_registry.json",
                ),
                os.path.join(
                    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                    "configs",
                    "programs_registry.json",
                ),
            ]
            for registry_path in possible_paths:
                try:
                    if os.path.exists(registry_path):
                        with open(registry_path, encoding="utf-8") as f:
                            registry_config = json.load(f)
                        if self.debug:
                            print(
                                f"[AutomationDetector] Loaded programs_registry.json from {registry_path}"
                            )
                        break
                except Exception as e:
                    if self.debug:
                        print(
                            f"[AutomationDetector] ERROR: Failed to load programs_registry.json from {registry_path}: {e}"
                        )
                    continue

        # Load from unified registry - filter by automation categories
        if registry_config and "programs" in registry_config:
            programs = registry_config.get("programs", {})
            automation_categories = {"automation", "macros", "bots", "rta_tools"}

            for exe_name, program_info in programs.items():
                # Check if program belongs to automation-related categories
                categories = program_info.get("categories", [])
                if not any(cat in automation_categories for cat in categories):
                    continue

                label = program_info.get("label", exe_name)
                points = program_info.get("points", 10)
                prog_type = program_info.get("type", "unknown")

                try:
                    points = int(points)
                    # Validate points are in allowed set
                    if points not in [0, 5, 10, 15]:
                        print(
                            f"[AutomationDetector] WARNING: Invalid 'points' value for {exe_name}: {points} (must be 0, 5, 10, or 15)"
                        )
                        continue
                except Exception:
                    print(
                        f"[AutomationDetector] WARNING: Invalid 'points' value for {exe_name}: {points}"
                    )
                    continue

                # Store points directly (no risk conversion needed)
                self._add_proc(exe_name, label, points, prog_type)
                loaded_count += 1
                
                if self.debug and "python" in exe_name.lower():
                    print(f"[AutomationDetector] DEBUG: Loaded Python entry - exe={exe_name}, label={label}, points={points}, categories={categories}")

        if self.debug:
            if loaded_count > 0:
                print(f"[AutomationDetector] Loaded {loaded_count} programs from unified registry")
            else:
                print(
                    "[AutomationDetector] ERROR: No programs loaded! Check programs_registry.json"
                )

    def _add_proc(self, exe_name: str, display: str, points: int, kind: str) -> None:
        """Lowercase key insert with overwrite protection.

        Keys are normalized to remove extensions, so both "openholdem" and "openholdem.exe"
        will map to the same normalized key "openholdem".

        Args:
            exe_name: Process executable name (e.g., "python.exe")
            display: Display name for the program
            points: Threat points (0, 5, 10, or 15)
            kind: Program type (e.g., "bot", "macro", "script")
        """
        key = (exe_name or "").strip().lower()
        if not key:
            return
        # Normalize key to remove extension (prevents duplicate detections)
        normalized_key = self.normalize_program_key(key)

        # If we already have this normalized key, keep the one with higher points
        if normalized_key in self.automation_processes:
            existing_points = self.automation_processes[normalized_key][1]
            if int(points) > existing_points:
                self.automation_processes[normalized_key] = (display, int(points), str(kind))
        else:
            self.automation_processes[normalized_key] = (display, int(points), str(kind))
