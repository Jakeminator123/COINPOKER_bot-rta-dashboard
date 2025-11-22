# segments/programs/process_scanner.py
"""
Process Scanner (programs):
- Report PROTECTED CoinPoker app (info)
- Detect suspicious process renaming / unexpected locations
- Detect compiled macro/script headers (quick static check)

Removed:
- Built-in risk_db for known bots/RTAs (handled by HashAndSignatureScanner)
- Browser/RTA window-title checks (handled by Network detector)
"""

from __future__ import annotations

import json
import os
import time

import psutil  # type: ignore

from core.api import BaseSegment, post_signal
from utils.config_loader import get_config
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown


# Load configuration
def _load_programs_config():
    """Load programs configuration from config_loader (dashboard/cache/local)"""
    try:
        # Load process scanner specific settings
        config = get_config("programs_config")
        if not config:
            config = {}

        # Load programs from programs_registry (master source)
        registry = get_config("programs_registry")
        if registry and "programs" in registry:
            # Convert registry format to process scanner format
            config["known_processes"] = {
                "bots": {},
                "rta_tools": {},
                "macro_automation": {},
                "hud_tracking": {},
                "communication": {},
            }

            for prog_name, prog_data in registry["programs"].items():
                # Map based on categories or type
                categories = prog_data.get("categories", [])
                prog_type = prog_data.get("type", "")

                # Determine which category to place it in
                if "bots" in categories or prog_type == "bot":
                    config["known_processes"]["bots"][prog_name] = prog_data
                elif "rta_tools" in categories or prog_type in ["rta", "solver"]:
                    config["known_processes"]["rta_tools"][prog_name] = prog_data
                elif "macros" in categories or prog_type in ["macro", "clicker"]:
                    config["known_processes"]["macro_automation"][prog_name] = prog_data
                elif "hud_tracking" in categories or prog_type == "hud":
                    config["known_processes"]["hud_tracking"][prog_name] = prog_data
                elif "communication" in categories or prog_type == "messenger":
                    config["known_processes"]["communication"][prog_name] = prog_data

        return config
    except Exception as e:
        print(f"[ProcessScanner] WARNING: Config load failed: {e}")

    return {"process_scanner": {}}


_config = _load_programs_config()


class ProcessScanner(BaseSegment):
    """
    Process scanner that detects:
    - Protected CoinPoker application
    - Suspicious process renaming
    - Compiled macros/scripts
    """

    name = "ProcessScanner"
    category = "programs"
    interval_s = 92.0  # Synchronized with unified batch interval

    def __init__(self):
        super().__init__()
        self._last: dict[str, float] = {}
        self._cooldown = apply_cooldown(
            15.0
        )  # scaled cooldown between identical process reports

        # 4-minute cache for already-checked processes (performance optimization)
        self._process_cache: dict[int, float] = {}  # pid -> last_full_check_time
        self._cache_ttl = apply_cooldown(240.0)  # scaled cache TTL before re-checking

        # Track CoinPoker processes (for table detection only)
        self._coinpoker_pids: set = set()  # Track PIDs we've seen
        self._last_table_check: float = 0.0  # Last time we checked for tables
        self._table_check_interval: float = apply_cooldown(30.0)  # scaled table check interval

        # Load configuration
        scanner_config = _config.get("process_scanner", {})

        # Protected poker app
        protected = scanner_config.get("protected_poker", {})
        self.PROTECTED_EXE = protected.get("exe", "game.exe")
        self.PROTECTED_PATH_KEY = protected.get("path_key", "coinpoker")

        # Quick macro header scan (convert from strings to bytes)
        self._macro_headers: list[bytes] = [
            h.encode()
            for h in scanner_config.get("macro_headers", ["AUT0HOOK", "AUT0IT", "CHEATENG"])
        ]

        # Windows system processes to skip
        self._windows_system = scanner_config.get("windows_system_processes", [])

        # Expected locations for binaries
        self._expected_locations = scanner_config.get("expected_locations", {})

        # Other poker sites
        self._other_poker = scanner_config.get("other_poker_sites", [])

        # Auto-kill configuration
        self._kill_enabled = os.environ.get("KILL_AUTO_ENABLED", "false").lower() == "true"
        self._kill_cooldown: dict[str, float] = {}  # program_name -> last_kill_time
        self._kill_cooldown_seconds = apply_cooldown(
            60.0
        )  # Don't kill same program more than once per minute

        # Keepalive helper to keep detections present between heavy scans
        keepalive_seconds = float(scanner_config.get("keepalive_seconds", 45.0))
        keepalive_seconds = max(15.0, min(keepalive_seconds, 60.0))
        active_timeout = float(scanner_config.get("active_timeout_seconds", 150.0))
        if active_timeout < keepalive_seconds * 2:
            active_timeout = keepalive_seconds * 2
        self._keepalive = DetectionKeepalive(
            "programs",
            keepalive_interval=keepalive_seconds,
            active_timeout=active_timeout,
        )

        print("[ProcessScanner] Ready (protected app + renames + compiled macros)")
        if self._kill_enabled:
            print("[ProcessScanner] Auto-kill enabled (direct kill_coinpoker.py)")

    def tick(self):
        """Main loop"""
        now = time.time()
        coinpoker_active, other_active = self._is_poker_active()

        # Track which aliases we've seen this tick for cleanup
        seen_aliases = set()

        # Reset CoinPoker tracking if no longer active
        if not coinpoker_active:
            self._coinpoker_pids.clear()

        for proc in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
            try:
                pid = proc.info.get("pid")
                name = (proc.info.get("name") or "").lower()
                exe = (proc.info.get("exe") or "").lower()

                key = f"{name}:{pid}"
                seen_aliases.add(key)
                
                if now - self._last.get(key, 0.0) < self._cooldown:
                    self._keepalive.refresh_alias(key)
                    continue

                # 1) Protected app info
                if name == self.PROTECTED_EXE and self.PROTECTED_PATH_KEY in exe:
                    # Track new CoinPoker process
                    if pid not in self._coinpoker_pids:
                        self._coinpoker_pids.add(pid)

                    # Check for active tables periodically
                    if now - self._last_table_check > self._table_check_interval:
                        self._detect_and_report_tables(pid)
                        self._last_table_check = now

                    post_signal(
                        "programs",
                        "Protected Site: CoinPoker",
                        "INFO",
                        f"PID: {pid} | Running normally",
                    )
                    self._last[key] = now
                    detection_key = f"protected:{pid}"
                    self._keepalive.mark_active(
                        detection_key,
                        "Protected Site: CoinPoker",
                        "INFO",
                        f"PID: {pid} | Running normally",
                        alias=key,
                    )
                    continue

                # 2) Compiled macro/script quick check
                if exe and os.path.isfile(exe):
                    macro = self._detect_compiled_macro(exe)
                    if macro:
                        # Compiled macros are serious threats
                        macro_status = "CRITICAL" if coinpoker_active else "ALERT"
                        post_signal(
                            "programs",
                            "Compiled macro/script",
                            macro_status,
                            f"PID: {pid} | {macro}",
                        )
                        self._last[key] = now
                        detection_key = f"macro:{pid}:{macro}"
                        self._keepalive.mark_active(
                            detection_key,
                            "Compiled macro/script",
                            macro_status,
                            f"PID: {pid} | {macro}",
                        alias=key,
                        )
                        continue

                # 3) Suspicious rename / location - use 4 levels
                rename = self._detect_process_renaming(proc)
                if rename:
                    if coinpoker_active:
                        severity = "CRITICAL"
                    elif other_active:
                        severity = "ALERT"
                    else:
                        severity = "WARN"

                    post_signal(
                        "programs",
                        "Suspicious Process Rename",
                        severity,
                        f"PID: {pid} | {rename}",
                    )
                    self._last[key] = now
                    detection_key = f"rename:{pid}:{rename}"
                    self._keepalive.mark_active(
                        detection_key,
                        "Suspicious Process Rename",
                        severity,
                        f"PID: {pid} | {rename}",
                        alias=key,
                    )

                # 4) Check if program should be auto-killed
                if self._kill_enabled and coinpoker_active:
                    self._check_and_kill_program(name, pid, now)

            except Exception:
                continue
        
        # Clean up aliases for processes that are no longer running
        self._keepalive.cleanup_missing_aliases(seen_aliases)
        self._keepalive.emit_keepalives()

    def _is_poker_active(self) -> tuple[bool, bool]:
        """Check if poker is active - returns (is_protected, is_other)"""
        prot, other = False, False
        try:
            for p in psutil.process_iter(["name", "exe"]):
                n = (p.info.get("name") or "").lower()
                x = (p.info.get("exe") or "").lower()
                if n == self.PROTECTED_EXE and self.PROTECTED_PATH_KEY in x:
                    prot = True
                elif any(s in n for s in self._other_poker):
                    other = True
        except Exception:
            pass
        return prot, other

    def _detect_compiled_macro(self, exe_path: str) -> str | None:
        """Detect compiled macro/script signatures"""
        try:
            with open(exe_path, "rb") as f:
                header = f.read(4096)
            for sig in self._macro_headers:
                if sig in header:
                    return "Header signature match"
        except Exception:
            pass
        return None

    def _detect_process_renaming(self, proc) -> str | None:
        """Detect if a process has been renamed from its original"""
        try:
            exe = proc.info.get("exe") or ""
            if not exe or not os.path.isfile(exe):
                return None
            exe_dir = os.path.dirname(exe).lower()
            exe_name = os.path.basename(exe).lower()
            proc_name = (proc.info.get("name") or "").lower()

            # Skip Windows system processes - they often have .mui language files
            if any(sys in proc_name for sys in self._windows_system):
                return None  # Skip Windows system processes entirely

            # Expected locations for common binaries (poker-relevant)
            if exe_name in self._expected_locations and not any(
                p in exe_dir for p in self._expected_locations[exe_name]
            ):
                return f"Unexpected location for {exe_name}"

            # Highly suspicious drop zones (focus on actual threats)
            scanner_config = _config.get("process_scanner", {})
            drop_zones = scanner_config.get(
                "suspicious_drop_zones", ["\\temp\\", "\\tmp\\", "appdata\\local\\temp"]
            )
            user_folders = scanner_config.get("user_folders", ["downloads", "desktop", "documents"])
            
            # Load automation tools from programs_registry (single source of truth)
            automation_tools = []
            try:
                registry = get_config("programs_registry")
                if registry and "programs" in registry:
                    for prog_name, prog_data in registry["programs"].items():
                        prog_type = prog_data.get("type", "")
                        categories = prog_data.get("categories", [])
                        if prog_type in ["macro", "script", "automation"] or "automation" in categories or "macros" in categories:
                            # Extract base name (without .exe) for matching
                            base_name = prog_name.replace(".exe", "").lower()
                            automation_tools.append(base_name)
            except Exception as e:
                print(f"[ProcessScanner] WARNING: Failed to load programs_registry: {e}")
                # Fallback to programs_config for backward compatibility
                automation_tools = scanner_config.get("automation_tools", [])

            if any(s in exe_dir for s in drop_zones):
                # Only flag if it's a potentially dangerous executable
                if any(t in exe_name for t in automation_tools):
                    return "Automation tool running from TEMP folder"

            # User folders + automation tools (poker-relevant)
            if any(s in exe_dir for s in user_folders):
                if any(t in exe_name for t in ["autohotkey", "autoit", "bot", "macro", "poker"]):
                    return "Suspicious tool in user folder"

            # Original filename mismatch - IGNORE .mui differences and known apps
            try:
                import win32api  # type: ignore

                info = win32api.GetFileVersionInfo(exe, "\\")
                if info:
                    lang, codepage = win32api.GetFileVersionInfo(exe, "\\VarFileInfo\\Translation")[
                        0
                    ]
                    sfi = f"\\StringFileInfo\\{lang:04x}{codepage:04x}\\"
                    orig = win32api.GetFileVersionInfo(exe, sfi + "OriginalFilename")
                    if orig:
                        orig_lower = orig.lower()
                        # Load rename ignore settings from config
                        rename_config = _config.get("process_scanner", {}).get("rename_ignore", {})
                        mui_files = rename_config.get("mui_files", [".mui"])
                        benign_procs = rename_config.get(
                            "benign_processes", ["nvcontainer", "nvdisplay", "rtkaud"]
                        )
                        suspicious_keywords = rename_config.get(
                            "suspicious_keywords",
                            [
                                "bot",
                                "macro",
                                "auto",
                                "poker",
                                "holdem",
                                "cheat",
                                "hack",
                            ],
                        )

                        # Ignore .mui language files and minor case differences
                        if any(mui in orig_lower for mui in mui_files):
                            return None
                        # Ignore known benign renames
                        if any(
                            benign in orig_lower or benign in proc_name for benign in benign_procs
                        ):
                            return None
                        # Only flag if SIGNIFICANTLY different and poker-relevant
                        if orig_lower.replace(".exe", "") != proc_name.replace(".exe", ""):
                            # Check if it's actually suspicious (bot/macro/poker related)
                            if any(kw in orig_lower for kw in suspicious_keywords):
                                return f"Suspicious rename: {orig} -> {proc_name}"
            except Exception:
                pass

        except Exception:
            pass
        return None

    def _detect_and_report_tables(self, pid: int):
        """Detect CoinPoker table windows and report them"""
        try:
            import win32gui
            import win32process

            tables = []

            def enum_windows(hwnd, lparam):
                try:
                    if not win32gui.IsWindowVisible(hwnd):
                        return True

                    _, win_pid = win32process.GetWindowThreadProcessId(hwnd)
                    if win_pid != pid:
                        return True

                    title = win32gui.GetWindowText(hwnd)
                    title_lower = title.lower()

                    # Skip lobby
                    if "lobby" in title_lower and "coinpoker" in title_lower:
                        return True

                    # Check if it's a table window
                    table_indicators = [
                        "nl ",
                        "plo ",
                        "hold'em",
                        "omaha",
                        "blinds",
                        "ante",
                        "table",
                        "seat",
                        "₮",
                        "tournament",
                        "cash",
                    ]

                    if any(indicator in title_lower for indicator in table_indicators):
                        rect = win32gui.GetWindowRect(hwnd)
                        width = rect[2] - rect[0]
                        height = rect[3] - rect[1]

                        if width >= 400 and height >= 300:  # Reasonable table size
                            tables.append(
                                {
                                    "title": title,
                                    "hwnd": hwnd,
                                    "width": width,
                                    "height": height,
                                }
                            )
                except Exception:
                    pass
                return True

            win32gui.EnumWindows(enum_windows, None)

            if tables:
                # Report tables as system signal
                table_info = json.dumps(
                    {
                        "count": len(tables),
                        "tables": [
                            {
                                "title": t["title"],
                                "width": t["width"],
                                "height": t["height"],
                            }
                            for t in tables
                        ],
                    }
                )

                post_signal(
                    "system",
                    "Active Tables Detected",
                    "INFO",
                    table_info,
                )
        except Exception as e:
            print(f"[ProcessScanner] Error detecting tables: {e}")



    def _check_and_kill_program(self, process_name: str, pid: int, now: float):
        """Check if program should be auto-killed and trigger kill if needed"""
        try:
            # Load programs config to check kill flag
            programs_config = get_config("programs_config")
            if not programs_config:
                return

            programs = programs_config.get("programs", {})

            # Check if this process name matches any configured program with kill:true
            for program_key, program_data in programs.items():
                program_name = program_data.get("label", "").lower()
                kill_enabled = program_data.get("kill", False)

                # Check if process name matches (with or without .exe)
                process_name_clean = process_name.replace(".exe", "").lower()
                program_name_clean = program_name.replace(".exe", "").lower()

                if kill_enabled and (
                    process_name_clean == program_name_clean
                    or process_name.lower() == program_name.lower()
                ):
                    # Check cooldown
                    last_kill_time = self._kill_cooldown.get(program_key, 0.0)
                    if now - last_kill_time < self._kill_cooldown_seconds:
                        continue

                    # Update cooldown
                    self._kill_cooldown[program_key] = now

                    # Trigger kill
                    print(
                        f"[ProcessScanner] Auto-killing {program_name} (PID: {pid}) - kill flag enabled"
                    )
                    self._trigger_kill(program_name, pid)

                    # Log kill action
                    post_signal(
                        "system",
                        "Auto-Kill Triggered",
                        "ALERT",
                        f"Program: {program_name} (PID: {pid}) | Auto-killed due to kill flag in config",
                    )
                    break
        except Exception as e:
            print(f"[ProcessScanner] Error checking kill flag: {e}")

    def _trigger_kill(self, program_name: str, pid: int):
        """Trigger kill_coinpoker.py to kill CoinPoker processes"""
        try:
            # Import kill function directly
            import os
            import sys
            import subprocess

            kill_module_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "utils",
                "kill_coinpoker.py",
            )

            # Try to import and call directly
            if os.path.exists(kill_module_path):
                import importlib.util

                spec = importlib.util.spec_from_file_location("kill_coinpoker", kill_module_path)
                if spec and spec.loader:
                    kill_module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(kill_module)

                    # Call kill function
                    success, message, killed_pids = kill_module.kill_coinpoker_processes()

                    if success:
                        print(f"[ProcessScanner] Kill triggered successfully: {message}")
                    else:
                        print(f"[ProcessScanner] Kill failed: {message}")
                    return

            # Fallback: try subprocess
            python_cmd = sys.executable
            result = subprocess.run(
                [python_cmd, kill_module_path],
                capture_output=True,
                text=True,
                timeout=10,
            )

            if result.returncode == 0:
                print("[ProcessScanner] Kill triggered successfully")
            else:
                print(f"[ProcessScanner] Kill failed: {result.stderr}")
        except Exception as e:
            print(f"[ProcessScanner] Error triggering kill: {e}")

    def cleanup(self):
        """Clean up resources and reset flags."""
        # Reset CoinPoker tracking
        self._coinpoker_pids.clear()
