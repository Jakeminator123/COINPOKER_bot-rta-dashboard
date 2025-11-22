#!/usr/bin/env python3
"""
kill_coinpoker.py - CoinPoker Process Killer Module
===================================================
Simple module with kill function that can be called directly or via CLI.
No Flask dependency - simple and production-ready.

Usage as module:
    from kill_coinpoker import kill_coinpoker_processes
    success, message, pids = kill_coinpoker_processes()

Usage as CLI:
    python kill_coinpoker.py [device_id]
"""

import json
import re
import sys
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import psutil
except ImportError:
    print("ERROR: psutil not installed. Install with: pip install psutil")
    sys.exit(1)

try:
    import win32gui
    import win32process

    WIN32_AVAILABLE = True
except ImportError:
    WIN32_AVAILABLE = False


# Default CoinPoker config (hardcoded - no file needed)
DEFAULT_COINPOKER_CONFIG = {
    "common": {
        "process_name": "game.exe",
        "process_path_pattern": r"C:\\CoinPoker\\game\.exe",
        "window_class": "Qt673QWindowIcon",
        "children_processes": ["crashpad_handler.exe", "QtWebEngineProcess.exe"],
    }
}

# Module-level cache (automatically freed when module is unloaded/script exits)
# Using functools.lru_cache for efficient memoization with automatic cleanup


def _get_config_cache_dir() -> Path:
    """
    Get config_cache directory path, handling both script and .exe execution.
    When running as .exe (PyInstaller), config_cache is created next to the .exe file.
    Creates directory if it doesn't exist (for .exe in exe_dir only).
    """
    # Get directory where script/exe is located
    if getattr(sys, "frozen", False):
        # Running as .exe (PyInstaller)
        exe_dir = Path(sys.executable).parent
        # Use exe directory - create if it doesn't exist
        config_cache_dir = exe_dir / "config_cache"
        config_cache_dir.mkdir(exist_ok=True)
        return config_cache_dir
    else:
        # Running as script
        return Path(__file__).parent.parent / "config_cache"


@lru_cache(maxsize=1)
def _load_coinpoker_config_internal() -> dict[str, Any]:
    """
    Internal function to load config from file (encrypted or plaintext).
    Cached with lru_cache(maxsize=1) - automatically freed when process exits.
    Returns default config if file doesn't exist.
    Handles both script and .exe execution paths.
    """
    config_cache_dir = _get_config_cache_dir()

    # Try encrypted file first (.enc)
    encrypted_path = config_cache_dir / "coinpoker_windows.enc"
    legacy_path = config_cache_dir / "coinpoker_windows.json"

    # Try to load encrypted config
    if encrypted_path.exists():
        try:
            from utils.file_encryption import decrypt_config_file

            config = decrypt_config_file(encrypted_path)
            if config:
                # Merge with defaults to ensure all required keys exist
                merged = DEFAULT_COINPOKER_CONFIG.copy()
                if isinstance(config, dict):
                    merged.update(config)
                return merged
        except Exception as e:
            print(
                f"[!] Warning: Failed to decrypt CoinPoker config from {encrypted_path}: {e}, trying legacy file"
            )

    # Try legacy plaintext file (backward compatibility)
    if legacy_path.exists():
        try:
            with open(legacy_path, encoding="utf-8") as f:
                config = json.load(f)
                # Merge with defaults to ensure all required keys exist
                merged = DEFAULT_COINPOKER_CONFIG.copy()
                if isinstance(config, dict):
                    merged.update(config)
                print(f"[!] Info: Loaded legacy plaintext config from {legacy_path}")
                return merged
        except Exception as e:
            print(
                f"[!] Warning: Failed to load CoinPoker config from {legacy_path}: {e}, using defaults"
            )

    # Fallback to defaults
    return DEFAULT_COINPOKER_CONFIG.copy()


def load_coinpoker_config() -> dict[str, Any]:
    """
    Load CoinPoker window configuration.
    Uses lru_cache for efficient RAM caching - automatically freed when process exits.
    Returns default config if file doesn't exist.

    Note: Cache is automatically cleared when:
    - Python process exits
    - Module is reloaded
    - clear_coinpoker_config_cache() is called
    """
    return _load_coinpoker_config_internal()


def clear_coinpoker_config_cache():
    """Clear the RAM cache (useful for testing or forced reload)"""
    _load_coinpoker_config_internal.cache_clear()


def analyze_process_indicators(
    proc: psutil.Process, pid: int, config: dict[str, Any]
) -> dict[str, any]:
    """
    Analyze a process and collect indicators for CoinPoker detection.
    Uses same multi-factor detection as scanner.py for consistency.

    Args:
        proc: psutil Process object
        pid: Process ID
        config: CoinPoker config dict

    Returns:
        Dictionary with indicator analysis results
    """
    common = config.get("common", {})
    expected_name = common.get("process_name", "game.exe").lower()
    expected_window_class = common.get("window_class", "Qt673QWindowIcon")
    expected_children = [c.lower() for c in common.get("children_processes", [])]

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
        if proc_name == expected_name:
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
                            if expected_window_class.lower() in class_name.lower():
                                indicators["window_class_match"] = True
                                indicators["confidence_score"] += 0.2
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
            matched_children = sum(1 for child in expected_children if child.lower() in child_names)
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


def verify_coinpoker_process(
    proc: psutil.Process, pid: int, config: dict[str, Any]
) -> tuple[bool, float]:
    """
    Verify if a process is CoinPoker using multi-factor analysis.
    Same logic as scanner.py for consistency.

    Args:
        proc: psutil Process object
        pid: Process ID
        config: CoinPoker config dict

    Returns:
        Tuple of (is_coinpoker, confidence_score)
        confidence_score: 0.0-1.0, where >=0.6 is high confidence
    """
    indicators = analyze_process_indicators(proc, pid, config)
    confidence = indicators["confidence_score"]

    # High confidence: 4+ indicators or path_coinpoker + 2 other indicators
    if confidence >= 0.6 or (indicators["path_coinpoker"] and confidence >= 0.4):
        return True, confidence

    # Medium confidence: 2-3 indicators
    if confidence >= 0.4:
        return True, confidence

    # Low confidence: might be false positive
    return False, confidence


def find_coinpoker_processes() -> list[psutil.Process]:
    """
    Find all CoinPoker processes using multi-factor detection.
    Uses same detection logic as scanner.py for consistency.
    """
    config = load_coinpoker_config()
    common = config.get("common", {})
    expected_name = common.get("process_name", "game.exe").lower()

    processes = []
    all_pids = set()  # Track PIDs to avoid duplicates

    for proc in psutil.process_iter(["pid", "name"]):
        try:
            pid = proc.info.get("pid")
            name = (proc.info.get("name") or "").lower()

            # Only check processes named game.exe (CoinPoker executable)
            if name != expected_name:
                continue

            # Skip if already processed
            if pid in all_pids:
                continue

            # Get full process object for detailed analysis
            full_proc = psutil.Process(pid)
            is_coinpoker, confidence = verify_coinpoker_process(full_proc, pid, config)

            if is_coinpoker:
                processes.append(full_proc)
                all_pids.add(pid)

                # Also add child processes
                try:
                    children = full_proc.children(recursive=True)
                    for child in children:
                        if child.pid not in all_pids:
                            processes.append(child)
                            all_pids.add(child.pid)
                except Exception:
                    pass

        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except Exception:
            continue

    return processes


def kill_coinpoker_processes(
    device_id: str | None = None,
) -> tuple[bool, str, list[int]]:
    """
    Kill CoinPoker processes.
    Returns (success, message, killed_pids)
    """
    try:
        killed_pids = []

        # Find all CoinPoker processes
        processes = find_coinpoker_processes()

        if not processes:
            return False, "No CoinPoker processes found", []

        # Kill all processes
        for proc in processes:
            try:
                pid = proc.pid
                name = proc.name()

                # Try graceful termination first
                try:
                    proc.terminate()
                    killed_pids.append(pid)
                    print(f"[Kill] Terminated {name} (PID: {pid})")
                except psutil.NoSuchProcess:
                    # Already dead
                    pass
                except Exception:
                    # If terminate fails, try kill
                    try:
                        proc.kill()
                        killed_pids.append(pid)
                        print(f"[Kill] Force-killed {name} (PID: {pid})")
                    except Exception as e2:
                        print(f"[Kill] Failed to kill {name} (PID: {pid}): {e2}")
            except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
                print(f"[Kill] Could not kill process: {e}")
                continue

        # Wait a bit and verify processes are dead
        time.sleep(0.5)
        remaining = find_coinpoker_processes()

        if remaining:
            return (
                False,
                f"Some processes still running: {[p.pid for p in remaining]}",
                killed_pids,
            )

        if killed_pids:
            return (
                True,
                f"Successfully killed {len(killed_pids)} CoinPoker process(es)",
                killed_pids,
            )
        else:
            return False, "No processes were killed", []

    except Exception as e:
        return False, f"Error killing processes: {str(e)}", []


def main():
    """CLI entry point"""
    device_id = sys.argv[1] if len(sys.argv) > 1 else None

    print("[Kill] Killing CoinPoker processes...")
    if device_id:
        print(f"[Kill] Device ID: {device_id}")

    success, message, killed_pids = kill_coinpoker_processes(device_id)

    if success:
        print(f"[Kill] ✓ {message}")
        print(f"[Kill] Killed PIDs: {killed_pids}")
        sys.exit(0)
    else:
        print(f"[Kill] ✗ {message}")
        sys.exit(1)


if __name__ == "__main__":
    main()
