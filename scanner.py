"""
Bot Detection Scanner
====================
Main entry point for CoinPoker bot detection system.
Monitors for CoinPoker process and runs detection scanner while active.

Features:
- Auto-starts when CoinPoker is detected
- Runs continuously while CoinPoker is active
- Stops gracefully when CoinPoker closes
- Sends detection signals to web dashboard
- Can run as Windows Service or standalone
- Multi-factor CoinPoker detection (process path, window class, child processes, etc.)
"""

import os
import re
import signal as os_signal
import sys
import threading
import time
from pathlib import Path
from typing import Any

# Add project root to sys.path for imports
sys.path.insert(0, os.path.dirname(__file__))

import psutil

from core.api import post_signal
from core.command_client import DashboardCommandClient
from core.forwarder import ForwarderService
from utils.admin_check import get_admin_status_message, is_admin
from utils.kill_coinpoker import kill_coinpoker_processes
from utils.take_snapshot import (
    capture_window_screenshot,
    find_coinpoker_tables,
    image_to_base64,
)

try:
    import win32gui
    import win32process

    WIN32_AVAILABLE = True
except ImportError:
    WIN32_AVAILABLE = False


class CoinPokerDetector:
    """
    Multi-factor CoinPoker process detection.

    Uses multiple indicators to reliably identify CoinPoker processes,
    even when installed in custom locations or when other poker clients
    use the same executable name (game.exe).
    """

    # Expected CoinPoker characteristics (fallback defaults)
    EXPECTED_PROCESS_NAME = "game.exe"
    EXPECTED_WINDOW_CLASS = "Qt673QWindowIcon"
    EXPECTED_CHILD_PROCESSES = ["crashpad_handler.exe", "QtWebEngineProcess.exe"]
    EXPECTED_TITLE_PATTERNS = ["coinpoker", "lobby", "nl ", "hold'em", "plo ", "ante"]

    def __init__(self):
        """Initialize detector and load config if available."""
        self._config = self._load_config()
        self._process_name = self._config.get("process_name", self.EXPECTED_PROCESS_NAME)
        self._window_class = self._config.get("window_class", self.EXPECTED_WINDOW_CLASS)
        self._child_processes = self._config.get(
            "children_processes", self.EXPECTED_CHILD_PROCESSES
        )

    def _get_config_cache_dir(self) -> Path:
        """Get config_cache directory path, handling both script and .exe execution."""
        if getattr(sys, "frozen", False):
            # Running as .exe (PyInstaller)
            exe_dir = Path(sys.executable).parent
            # Use exe directory - create if it doesn't exist
            config_cache_dir = exe_dir / "config_cache"
            config_cache_dir.mkdir(exist_ok=True)
            return config_cache_dir
        else:
            # Running as script
            return Path(__file__).parent / "config_cache"

    def _load_config(self) -> dict:
        """Load CoinPoker config from config_cache if available."""
        try:
            config_cache_dir = self._get_config_cache_dir()
            encrypted_path = config_cache_dir / "coinpoker_windows.enc"
            legacy_path = config_cache_dir / "coinpoker_windows.json"

            # Try encrypted file first
            if encrypted_path.exists():
                try:
                    from utils.file_encryption import decrypt_config_file

                    config = decrypt_config_file(encrypted_path)
                    if config and isinstance(config, dict):
                        common = config.get("common", {})
                        return {
                            "process_name": common.get("process_name", self.EXPECTED_PROCESS_NAME),
                            "window_class": common.get("window_class", self.EXPECTED_WINDOW_CLASS),
                            "children_processes": common.get(
                                "children_processes", self.EXPECTED_CHILD_PROCESSES
                            ),
                        }
                except Exception:
                    pass

            # Try legacy plaintext file
            if legacy_path.exists():
                try:
                    import json

                    with open(legacy_path, encoding="utf-8") as f:
                        config = json.load(f)
                        if config and isinstance(config, dict):
                            common = config.get("common", {})
                            return {
                                "process_name": common.get(
                                    "process_name", self.EXPECTED_PROCESS_NAME
                                ),
                                "window_class": common.get(
                                    "window_class", self.EXPECTED_WINDOW_CLASS
                                ),
                                "children_processes": common.get(
                                    "children_processes", self.EXPECTED_CHILD_PROCESSES
                                ),
                            }
                except Exception:
                    pass
        except Exception:
            pass

        # Return defaults
        return {
            "process_name": self.EXPECTED_PROCESS_NAME,
            "window_class": self.EXPECTED_WINDOW_CLASS,
            "children_processes": self.EXPECTED_CHILD_PROCESSES,
        }

    def analyze_process_indicators(self, proc: psutil.Process, pid: int) -> dict[str, any]:
        """
        Analyze a process and collect indicators for CoinPoker detection.

        Args:
            proc: psutil Process object
            pid: Process ID

        Returns:
            Dictionary with indicator analysis results
        """
        indicators = {
            "pid": pid,
            "name_match": False,
            "path_coinpoker": False,
            "cwd_coinpoker": False,
            "parent_path_coinpoker": False,
            "window_class_match": False,
            "window_title_match": False,
            "child_processes_match": False,
            "cmdline_uuid_pattern": False,
            "confidence_score": 0.0,
        }

        try:
            proc_name = (proc.name() or "").lower()
            proc_exe = (proc.exe() or "").lower() if proc.exe() else ""

            # 1. Process name match
            if proc_name == self._process_name.lower():
                indicators["name_match"] = True
                indicators["confidence_score"] += 0.1

            # 2. Path contains "coinpoker" (case-insensitive)
            if "coinpoker" in proc_exe:
                indicators["path_coinpoker"] = True
                indicators["confidence_score"] += 0.3

            # 3. Current working directory contains "coinpoker"
            try:
                cwd = (proc.cwd() or "").lower()
                if "coinpoker" in cwd:
                    indicators["cwd_coinpoker"] = True
                    indicators["confidence_score"] += 0.2
            except Exception:
                pass

            # 4. Parent directory contains "coinpoker"
            try:
                parent = proc.parent()
                if parent:
                    parent_exe = (parent.exe() or "").lower()
                    if "coinpoker" in parent_exe:
                        indicators["parent_path_coinpoker"] = True
                        indicators["confidence_score"] += 0.15
            except Exception:
                pass

            # 5. Command line contains UUID-like pattern (CoinPoker typical)
            try:
                cmdline = proc.cmdline()
                if cmdline:
                    cmdline_str = " ".join(cmdline).lower()
                    # Check for UUID pattern: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                    uuid_pattern = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
                    if re.search(uuid_pattern, cmdline_str, re.I):
                        indicators["cmdline_uuid_pattern"] = True
                        indicators["confidence_score"] += 0.15
            except Exception:
                pass

            # 6. Window class matching (requires win32gui)
            if WIN32_AVAILABLE and indicators["name_match"]:
                try:

                    def enum_handler(hwnd, _):
                        try:
                            _, hwnd_pid = win32process.GetWindowThreadProcessId(hwnd)
                            if hwnd_pid == pid:
                                class_name = win32gui.GetClassName(hwnd)
                                if self._window_class.lower() in class_name.lower():
                                    indicators["window_class_match"] = True
                                    indicators["confidence_score"] += 0.2

                                    # Also check window title
                                    title = win32gui.GetWindowText(hwnd).lower()
                                    if any(
                                        pattern in title for pattern in self.EXPECTED_TITLE_PATTERNS
                                    ):
                                        indicators["window_title_match"] = True
                                        indicators["confidence_score"] += 0.1
                        except Exception:
                            pass
                        return True

                    win32gui.EnumWindows(enum_handler, None)
                except Exception:
                    pass

            # 7. Child processes match expected CoinPoker children
            try:
                children = proc.children(recursive=False)
                child_names = [c.name().lower() for c in children if c.name()]
                matched_children = sum(
                    1 for child in self._child_processes if child.lower() in child_names
                )
                if matched_children >= 2:  # At least 2 expected children
                    indicators["child_processes_match"] = True
                    indicators["confidence_score"] += 0.2
                elif matched_children == 1:
                    indicators["confidence_score"] += 0.1
            except Exception:
                pass

        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
        except Exception:
            pass

        return indicators

    def verify_coinpoker_process(self, proc: psutil.Process, pid: int) -> tuple[bool, float]:
        """
        Verify if a process is CoinPoker using multi-factor analysis.

        Args:
            proc: psutil Process object
            pid: Process ID

        Returns:
            Tuple of (is_coinpoker, confidence_score)
            confidence_score: 0.0-1.0, where >=0.6 is high confidence
        """
        indicators = self.analyze_process_indicators(proc, pid)
        confidence = indicators["confidence_score"]

        # High confidence: 4+ indicators or path_coinpoker + 2 other indicators
        if confidence >= 0.6 or (indicators["path_coinpoker"] and confidence >= 0.4):
            return True, confidence

        # Medium confidence: 2-3 indicators
        if confidence >= 0.4:
            return True, confidence

        # Low confidence: might be false positive
        return False, confidence

    def detect_coinpoker_processes(self) -> list[dict]:
        """
        Detect all CoinPoker processes using multi-factor analysis.

        Returns:
            List of dictionaries with process info and confidence scores
        """
        detected = []

        for proc in psutil.process_iter(["pid", "name"]):
            try:
                pid = proc.info.get("pid")
                name = (proc.info.get("name") or "").lower()

                # Only check processes named game.exe (CoinPoker executable)
                if name != self._process_name.lower():
                    continue

                # Get full process object for detailed analysis
                full_proc = psutil.Process(pid)
                is_coinpoker, confidence = self.verify_coinpoker_process(full_proc, pid)

                if is_coinpoker:
                    indicators = self.analyze_process_indicators(full_proc, pid)
                    detected.append(
                        {
                            "pid": pid,
                            "process": full_proc,
                            "confidence": confidence,
                            "indicators": indicators,
                        }
                    )

            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            except Exception:
                continue

        return detected

    def find_lobby_window(self) -> tuple[int | None, int | None]:
        """Locate the CoinPoker lobby window (hwnd, pid) if visible."""
        if not WIN32_AVAILABLE:
            return None, None

        target_hwnd: int | None = None
        target_pid: int | None = None
        expected_class = (self._window_class or "").lower()
        expected_process = (self._process_name or "").lower()

        def enum_handler(hwnd, _):
            nonlocal target_hwnd, target_pid
            try:
                if not win32gui.IsWindowVisible(hwnd):
                    return True

                class_name = win32gui.GetClassName(hwnd) or ""
                if expected_class and expected_class not in class_name.lower():
                    return True

                title = win32gui.GetWindowText(hwnd) or ""
                title_lower = title.lower()
                if "lobby" not in title_lower or "coinpoker" not in title_lower:
                    return True

                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                proc = psutil.Process(pid)
                proc_name = (proc.name() or "").lower()
                exe_path = (proc.exe() or "").lower()

                if expected_process and proc_name != expected_process:
                    return True
                if "coinpoker" not in exe_path:
                    return True
            except Exception:
                return True

            target_hwnd = hwnd
            target_pid = pid
            return False  # Stop enumeration

        win32gui.EnumWindows(enum_handler, None)
        return target_hwnd, target_pid

    def wait_for_lobby_window(
        self, timeout_seconds: float = 30.0, poll_interval: float = 0.5
    ) -> tuple[int | None, int | None]:
        """Wait for lobby window to appear within timeout."""
        if not WIN32_AVAILABLE:
            return None, None

        deadline = time.time() + max(0.0, timeout_seconds)
        interval = max(0.1, poll_interval)

        while time.time() < deadline:
            hwnd, pid = self.find_lobby_window()
            if hwnd and pid:
                return hwnd, pid
            time.sleep(interval)

        return None, None


class CoinPokerScanner:
    """Scanner that monitors CoinPoker and runs detection while active."""

    COINPOKER_EXE = "game.exe"
    CHECK_INTERVAL = 5.0  # Check for CoinPoker every 5 seconds when inactive
    LOBBY_WAIT_TIMEOUT = 30.0  # seconds to wait for lobby window before fallback
    NICKNAME_WARMUP_SECONDS = 5.0  # grace period for nickname detector

    def __init__(self):
        self.service: ForwarderService | None = None
        # Get segments directory, handling both script and .exe execution
        if getattr(sys, "frozen", False):
            # Running as .exe - segments are in PyInstaller temp extraction directory
            self.segments_dir = os.path.join(sys._MEIPASS, "segments")
        else:
            # Running as script - segments are next to scanner.py
            self.segments_dir = os.path.join(os.path.dirname(__file__), "segments")
        self._running = False
        self._coinpoker_active = False
        self._coinpoker_pids: set = set()
        self.detector = CoinPokerDetector()
        self._admin_privileges = is_admin()
        self._stopping = False  # Guard flag to prevent duplicate shutdown calls
        self.command_client = DashboardCommandClient()

        # Thread-safe operations
        self._start_stop_lock = threading.Lock()
        self._last_start_attempt = 0.0
        self._start_debounce_seconds = 1.0  # Debounce start attempts by 1 second

        self._nickname_thread: threading.Thread | None = None

        # Process lock file for singleton guard
        self._lock_file: Any | None = None
        self._lock_file_path: str | None = None

    def check_admin_privileges(self) -> bool:
        """Check if running with admin privileges."""
        self._admin_privileges = is_admin()
        return self._admin_privileges

    def is_coinpoker_running(self) -> bool:
        """Check if CoinPoker process is currently running using multi-factor detection."""
        try:
            detected = self.detector.detect_coinpoker_processes()
            current_pids = {d["pid"] for d in detected}

            # Check if we have new CoinPoker processes
            if current_pids:
                self._coinpoker_pids = current_pids
                return True
            else:
                self._coinpoker_pids = set()
                return False
        except Exception as e:
            print(f"[Scanner] ERROR: CoinPoker detection failed: {e}")
            return False

    def start_scanner(self):
        """Start the detection scanner service (thread-safe with debouncing)."""
        with self._start_stop_lock:
            # Check if already running
            if self.service:
                return  # Already running

            # Debounce: prevent rapid start attempts
            now = time.time()
            if now - self._last_start_attempt < self._start_debounce_seconds:
                return  # Too soon since last attempt

            self._last_start_attempt = now

            # Check if we're stopping - don't start during shutdown
            if self._stopping:
                return

            try:
                print("[Scanner] CoinPoker detected - Starting detection scanner...")
                print("-" * 60)

                self._wait_for_lobby_window_and_warmup()

                self.service = ForwarderService()
                self.service.start(segments_base_dir=self.segments_dir)
                self._coinpoker_active = True

                # Send explicit "Scanner Started" signal for accurate online/offline tracking
                # This ensures immediate Redis update for device activity
                try:
                    post_signal(
                        category="system",
                        name="Scanner Started",
                        status="INFO",
                        details="CoinPoker detection scanner activated - device is now active",
                    )
                except Exception as e:
                    print(f"[Scanner] Could not send start signal: {e}")
            except Exception as e:
                print(f"[Scanner] ERROR: Failed to start scanner: {e}")
                # Clean up on failure
                self.service = None
                self._coinpoker_active = False

    def _wait_for_lobby_window_and_warmup(self) -> None:
        """Wait for lobby window so nickname detector can run before segments start."""
        if not WIN32_AVAILABLE:
            return

        try:
            print(f"[Scanner] Waiting for CoinPoker lobby window (timeout={self.LOBBY_WAIT_TIMEOUT}s)...")
            hwnd, pid = self.detector.wait_for_lobby_window(self.LOBBY_WAIT_TIMEOUT)
            if hwnd and pid:
                print("[Scanner] CoinPoker lobby detected - giving nickname detector time to run...")
                self._start_nickname_detection(hwnd, pid)
                if self.NICKNAME_WARMUP_SECONDS > 0:
                    time.sleep(self.NICKNAME_WARMUP_SECONDS)
            else:
                print("[Scanner] Lobby window not detected within timeout - continuing with fallback defaults")
        except Exception as exc:
            print(f"[Scanner] Lobby wait skipped due to error: {exc}")

    def _start_nickname_detection(self, hwnd: int, pid: int) -> None:
        """Kick off nickname detector thread for the detected lobby window."""
        try:
            from utils.nickname_detector import detect_nickname
        except Exception as exc:
            print(f"[Scanner] Nickname detector unavailable: {exc}")
            return

        def _runner():
            try:
                detect_nickname(hwnd, pid, post_signal)
            except Exception as err:
                print(f"[Scanner] Nickname detector error: {err}")

        thread = threading.Thread(target=_runner, daemon=True, name="NicknameDetector")
        thread.start()
        self._nickname_thread = thread

    def stop_scanner(self):
        """Stop the detection scanner service (thread-safe)."""
        with self._start_stop_lock:
            # Prevent duplicate shutdown calls
            if self._stopping or not self.service:
                return

            self._stopping = True
            service_to_stop = self.service
            self.service = None  # Clear reference immediately to prevent new starts

            try:
                print("\n[Scanner] CoinPoker closed - Stopping scanner...")

                # Send explicit "Scanner Stopping" signal BEFORE stopping service
                # This ensures last_seen is updated immediately, improving offline detection speed
                try:
                    post_signal(
                        category="system",
                        name="Scanner Stopping",
                        status="INFO",
                        details="CoinPoker detection scanner shutting down - device activity ending",
                    )
                except Exception as e:
                    print(f"[Scanner] Could not send stop signal: {e}")

                # Stop the service
                if service_to_stop:
                    try:
                        # Set stopping flag to prevent new detections during shutdown
                        if hasattr(service_to_stop, "loader"):
                            service_to_stop.loader._stopping = True
                        service_to_stop.stop()
                    except Exception as e:
                        print(f"[Scanner] Error stopping service: {e}")
            finally:
                # Reset state after service is stopped
                self._coinpoker_active = False
                self._stopping = False  # Reset stopping flag only after cleanup
                # Only print this message once, not in loops
                if self._running:
                    print("[Scanner] Scanner stopped. Waiting for CoinPoker to restart...")

    def _capture_tables_snapshot(self) -> dict[str, Any]:
        """Capture CoinPoker table screenshots for dashboard command."""
        try:
            tables = find_coinpoker_tables()
            results: list[dict[str, Any]] = []

            captured = 0
            for table in tables:
                entry: dict[str, Any] = {
                    "hwnd": table.get("hwnd"),
                    "pid": table.get("pid"),
                    "title": table.get("title"),
                    "rect": table.get("rect"),
                }

                try:
                    img = capture_window_screenshot(table.get("hwnd"))
                    if img:
                        entry["screenshot"] = image_to_base64(img)
                        entry["screenshot_format"] = "PNG"
                        captured += 1
                    else:
                        entry["error"] = "Failed to capture screenshot"
                except Exception as exc:  # pylint: disable=broad-except
                    entry["error"] = str(exc)

                results.append(entry)

            return {
                "success": captured > 0,
                "tables": results,
                "count": captured,
                "error": None if captured > 0 else "No table screenshots captured",
            }
        except Exception as exc:  # pylint: disable=broad-except
            return {
                "success": False,
                "tables": [],
                "count": 0,
                "error": str(exc),
            }

    def _handle_command(self, command: dict[str, Any]) -> None:
        """Execute a single dashboard command."""
        cmd = (command.get("command") or "").lower()
        require_admin = bool(command.get("requireAdmin"))

        # Refresh admin status before executing commands
        self.check_admin_privileges()

        admin_required = False
        success = False
        output: dict[str, Any] | None = None
        error_msg: str | None = None

        if require_admin and not self._admin_privileges:
            admin_required = True
            error_msg = "Administrator privileges required"
        else:
            try:
                if cmd == "kill_coinpoker":
                    success, message, killed_pids = kill_coinpoker_processes()
                    output = {
                        "message": message,
                        "killed_pids": killed_pids,
                    }
                    if not success:
                        error_msg = message or "Kill command failed"
                elif cmd == "take_snapshot":
                    snapshot = self._capture_tables_snapshot()
                    output = snapshot
                    success = bool(snapshot.get("success"))
                    if not success:
                        error_msg = snapshot.get("error", "Snapshot command failed")
                else:
                    error_msg = f"Unsupported command: {cmd}"
            except Exception as exc:  # pylint: disable=broad-except
                error_msg = str(exc)

        if error_msg and not success:
            print(f"[Scanner] Command '{cmd}' failed: {error_msg}")

        try:
            self.command_client.send_result(
                command,
                success,
                output,
                error_msg,
                admin_required,
            )
        except Exception as exc:  # pylint: disable=broad-except
            print(f"[Scanner] Failed to send command result: {exc}")

    def _process_commands(self) -> None:
        """Fetch and execute pending dashboard commands."""
        try:
            commands = self.command_client.fetch_commands()
        except Exception as exc:  # pylint: disable=broad-except
            print(f"[Scanner] Command fetch error: {exc}")
            return

        if not commands:
            return

        for command in commands:
            try:
                self._handle_command(command)
            except Exception as exc:  # pylint: disable=broad-except
                print(f"[Scanner] Command execution error: {exc}")

    def _acquire_lock(self) -> bool:
        """Acquire file-based lock to prevent multiple instances."""
        try:
            if getattr(sys, "frozen", False):
                # Running as .exe - lock file next to executable
                exe_dir = os.path.dirname(sys.executable)
                self._lock_file_path = os.path.join(exe_dir, "scanner.lock")
            else:
                # Running as script - lock file in project root
                project_root = os.path.dirname(os.path.abspath(__file__))
                self._lock_file_path = os.path.join(project_root, "scanner.lock")

            # Check if lock file exists with valid PID
            if os.path.exists(self._lock_file_path):
                try:
                    with open(self._lock_file_path) as f:
                        old_pid = int(f.read().strip())
                    # Check if that process is still running
                    if psutil.pid_exists(old_pid):
                        try:
                            proc = psutil.Process(old_pid)
                            # Check if it's actually our scanner
                            if (
                                "scanner" in proc.name().lower()
                                or "coinpokerscanner" in proc.name().lower()
                            ):
                                return False  # Another instance is running
                        except Exception:
                            pass
                    # Old process is dead, remove stale lock
                    os.remove(self._lock_file_path)
                except Exception:
                    # Can't read/parse lock file, try to remove it
                    try:
                        os.remove(self._lock_file_path)
                    except Exception:
                        pass

            # Create new lock file
            try:
                self._lock_file = open(self._lock_file_path, "w")
                self._lock_file.write(str(os.getpid()))
                self._lock_file.flush()
                return True
            except Exception:
                if self._lock_file:
                    self._lock_file.close()
                    self._lock_file = None
                return False
        except Exception:
            return False

    def _release_lock(self):
        """Release file-based lock."""
        try:
            if self._lock_file:
                self._lock_file.close()
                self._lock_file = None

            if self._lock_file_path and os.path.exists(self._lock_file_path):
                try:
                    os.remove(self._lock_file_path)
                except Exception:
                    pass
        except Exception:
            pass

    def cleanup(self):
        """Clean up resources when scanner exits."""
        # Stop scanner service first (stops all segments and threads)
        self.stop_scanner()
        
        # Clean up ConfigLoader RAM cache
        try:
            from utils.config_loader import cleanup_config_loader
            cleanup_config_loader()
        except Exception as e:
            print(f"[Scanner] ConfigLoader cleanup error: {e}")
        
        # Clean up global singletons (EventBus, ThreatManager, WebForwarder)
        try:
            from core.api import cleanup_globals
            cleanup_globals()
        except Exception as e:
            print(f"[Scanner] Global cleanup error: {e}")
        
        # Release file lock
        self._release_lock()
        
        # Clear references to help GC
        self.service = None
        self.detector = None
        self.command_client = None

    def run(self):
        """Main loop: monitor CoinPoker and run scanner when active."""
        # Acquire singleton lock
        if not self._acquire_lock():
            print("[Scanner] ERROR: Another instance is already running!")
            print(f"[Scanner] If no other instance is running, delete: {self._lock_file_path}")
            return

        # Install signal handlers once at startup
        _install_sig_handlers(self)

        self._running = True

        # Check admin privileges
        admin_status = get_admin_status_message()

        print("=" * 60)
        print("  COINPOKER BOT DETECTION SCANNER")
        print("=" * 60)
        print(f"[Scanner] {admin_status}")
        # Removed redundant warn_if_not_admin() - status already shown above
        print(f"[Scanner] Monitoring for CoinPoker process ({self.COINPOKER_EXE})...")
        print("[Scanner] Scanner will start automatically when CoinPoker launches")
        print("[Scanner] Press Ctrl+C to exit\n")

        try:
            # Initial check immediately (no delay)
            coinpoker_running = self.is_coinpoker_running()
            if coinpoker_running:
                self.start_scanner()

            while self._running:
                coinpoker_running = self.is_coinpoker_running()

                if coinpoker_running and not self._coinpoker_active:
                    # CoinPoker just started - start scanner immediately
                    self.start_scanner()
                elif not coinpoker_running and self._coinpoker_active:
                    # CoinPoker just closed - stop scanner
                    self.stop_scanner()

                # Process dashboard commands regardless of CoinPoker status
                self._process_commands()

                if self._coinpoker_active and self.service:
                    # CoinPoker is running - check more frequently to detect when it closes
                    time.sleep(2.0)  # Check every 2 seconds when active
                else:
                    # Waiting for CoinPoker - check more frequently for faster detection
                    time.sleep(2.0)  # Reduced from 5s to 2s for faster response

        except KeyboardInterrupt:
            print("\n[Scanner] Shutdown requested...")
        except Exception as e:
            print(f"[Scanner] ERROR: Unexpected error in main loop: {e}")
            import traceback

            traceback.print_exc()
        finally:
            self.cleanup()
            self._running = False
            print("[Scanner] Scanner exited.")


def _install_sig_handlers(scanner: CoinPokerScanner) -> None:
    """Install signal handlers for graceful shutdown."""

    def _graceful(_signo, _frame):
        print("\n[Scanner] Shutdown signal received...")
        scanner._running = False
        try:
            scanner.stop_scanner()
            scanner.cleanup()
        except Exception as e:
            print(f"[Scanner] Error during shutdown: {e}")
        finally:
            # Give threads a moment to finish, then exit
            # All threads are daemon threads, so they'll stop automatically
            import time
            time.sleep(0.5)  # Brief wait for threads to finish cleanup
            os._exit(0)  # Force exit to prevent hanging (ensures no ghost threads)

    for sig in (
        os_signal.SIGINT,
        os_signal.SIGTERM,
        getattr(os_signal, "SIGBREAK", None),
    ):
        if sig is not None:
            try:
                os_signal.signal(sig, _graceful)
            except Exception:
                pass


def _get_config_path():
    """
    Get the path to config.txt, handling both script and .exe execution.
    When running as .exe, config.txt should be in the same directory as the .exe file.
    """
    if getattr(sys, "frozen", False):
        # Running as .exe - config should be next to the executable
        exe_dir = os.path.dirname(sys.executable)
    else:
        # Running as script - config is in project root
        exe_dir = os.path.dirname(os.path.abspath(__file__))

    return os.path.join(exe_dir, "config.txt")


def _ensure_config_file_exists():
    """
    Ensure config.txt exists in the same directory as the executable.
    If not found, create a default PROD config based on the current config.txt.
    This allows the .exe to work standalone without requiring manual config setup.
    """
    config_path = _get_config_path()

    # If config.txt already exists, don't overwrite it
    if os.path.exists(config_path):
        return

    # Try to read the original config.txt from project root (for building)
    # When running as .exe, PyInstaller extracts files to a temp directory
    # We need to check both the exe directory and the temp extraction directory
    possible_template_paths = []

    if getattr(sys, "frozen", False):
        # Running as .exe - check temp extraction directory first
        base_path = sys._MEIPASS  # PyInstaller temp extraction directory
        possible_template_paths.append(os.path.join(base_path, "config.txt"))
    else:
        # Running as script - check project root (for development or if config was included)
        project_root = os.path.dirname(os.path.abspath(__file__))
        possible_template_paths.append(os.path.join(project_root, "config.txt"))

    # Try to read template from any of the possible locations
    default_config = None
    for template_path in possible_template_paths:
        if os.path.exists(template_path):
            try:
                with open(template_path, encoding="utf-8") as f:
                    default_config = f.read()
                    # Ensure ENV is set to PROD for standalone .exe
                    if "ENV=" in default_config:
                        lines = default_config.split("\n")
                        for i, line in enumerate(lines):
                            if line.strip().startswith("ENV="):
                                lines[i] = "ENV=PROD"
                                break
                        default_config = "\n".join(lines)
                    else:
                        # Add ENV=PROD if not present
                        if "Environment & System" in default_config:
                            default_config = default_config.replace(
                                "# Environment & System",
                                "# Environment & System\nENV=PROD",
                            )
                break  # Use first found template
            except Exception:
                continue

    # If no template found, create minimal PROD config
    if not default_config:
        default_config = """# Bot Detection System Configuration (Auto-generated for PROD)
# ================================

# Environment & System
ENV=PROD
INPUT_DEBUG=1
HEARTBEAT_SECONDS=30

# Web Dashboard
WEB=y
WEB_URL_PROD=https://bot-rta-dashboard-1.onrender.com/api/signal

SIGNAL_TOKEN=detector-secret-token-2024

# Detection Features
ENABLEHASHLOOKUP=true
ENABLEONLINELOOKUPS=true
CHECKSIGNATURES=true

# API Keys
VirusTotalAPIKey=

# Signal Processing
FORWARDER_MODE=auto
DEDUPE_WINDOW=60
WEB_FORWARDER_TIMEOUT=10

# Batch Reporting (Unified System)
BATCH_INTERVAL_HEAVY=92             # Unified batch reports every 92s

# Detection Intervals
PROGRAMS=20
AUTO=20
NETWORK=20
BEHAVIOUR=10
VM=120
SCREEN=20

PICTURE_NICK=y
"""

    # Create default config.txt in exe directory
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            f.write(default_config)
        print(f"[Scanner] Created default config.txt at: {config_path}")
        print(
            "[Scanner] NOTE: Review and update config.txt with your specific settings (API keys, URLs, etc.)"
        )
    except Exception as e:
        print(f"[Scanner] WARNING: Could not create config.txt: {e}")


def main():
    """Main entry point for scanner."""
    # Ensure config.txt exists before starting scanner
    _ensure_config_file_exists()

    scanner = CoinPokerScanner()
    scanner.run()


if __name__ == "__main__":
    main()
