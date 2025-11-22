#!/usr/bin/env python3
"""
take_snapshot.py - CoinPoker Table Snapshot
===========================================
Takes screenshots of CoinPoker table windows for a specific player/device.
Captures the topmost layer including any HUDs/overlays.

Usage:
    python take_snapshot.py [device_id]
    Returns JSON with table info and base64-encoded screenshots
"""

import base64
import json
import sys
from functools import lru_cache
from io import BytesIO
from pathlib import Path

try:
    import psutil
    import win32gui
    import win32process
    import win32ui
    from PIL import Image
except ImportError as e:
    print(f"ERROR: Missing dependency: {e}")
    print("Install with: pip install psutil pywin32 pillow")
    sys.exit(1)


# Default CoinPoker config (fallback if config file not found)
DEFAULT_COINPOKER_CONFIG = {
    "common": {
        "process_name": "game.exe",
        "window_class": "Qt673QWindowIcon",
        "children_processes": ["crashpad_handler.exe", "QtWebEngineProcess.exe"],
    },
    "table": {"window_title_pattern": "NL.*Hold'em.*Blinds"},
}


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
def load_coinpoker_config() -> dict:
    """
    Load CoinPoker window configuration from config_cache.
    Handles both script and .exe execution paths.
    Returns default config if file doesn't exist.
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
                f"[!] Warning: Failed to decrypt CoinPoker config: {e}, trying legacy file",
                file=sys.stderr,
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
                return merged
        except Exception as e:
            print(
                f"[!] Warning: Failed to load CoinPoker config: {e}, using defaults",
                file=sys.stderr,
            )

    # Fallback to defaults
    return DEFAULT_COINPOKER_CONFIG.copy()


def find_coinpoker_tables(device_id: str | None = None) -> list[dict]:
    """
    Find all CoinPoker table windows using config from coinpoker_windows.json.
    Returns list of table info dicts with hwnd, title, pid, etc.
    """
    config = load_coinpoker_config()
    common = config.get("common", {})

    expected_process_name = common.get("process_name", "game.exe").lower()
    expected_window_class = common.get("window_class", "Qt673QWindowIcon")

    tables = []

    def enum_windows(hwnd, lparam):
        try:
            if not win32gui.IsWindowVisible(hwnd):
                return True

            title = win32gui.GetWindowText(hwnd)
            class_name = win32gui.GetClassName(hwnd)

            # Check if it matches expected window class (CoinPoker uses Qt)
            if expected_window_class.lower() not in class_name.lower():
                return True

            # Get process info
            try:
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                proc = psutil.Process(pid)
                proc_name = proc.name().lower()
                proc_exe = (proc.exe() or "").lower()
            except Exception:
                return True

            # Must be expected process name from CoinPoker
            if proc_name != expected_process_name or "coinpoker" not in proc_exe:
                return True

            title_lower = title.lower()

            # Skip lobby
            if "lobby" in title_lower and "coinpoker" in title_lower:
                return True

            # Check if it's a table window (has table indicators)
            is_table = False
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
                is_table = True

            # Also accept if it's a CoinPoker window that's not lobby
            if not is_table and "coinpoker" in title_lower:
                return True

            if is_table:
                # Get window rect
                try:
                    rect = win32gui.GetWindowRect(hwnd)
                    width = rect[2] - rect[0]
                    height = rect[3] - rect[1]

                    # Only include reasonably sized windows (table windows are usually > 400px)
                    if width >= 400 and height >= 300:
                        tables.append(
                            {
                                "hwnd": hwnd,
                                "pid": pid,
                                "title": title,
                                "class_name": class_name,
                                "process_name": proc_name,
                                "process_exe": proc_exe,
                                "rect": {
                                    "left": rect[0],
                                    "top": rect[1],
                                    "right": rect[2],
                                    "bottom": rect[3],
                                    "width": width,
                                    "height": height,
                                },
                            }
                        )
                except Exception:
                    pass

        except Exception:
            pass

        return True

    win32gui.EnumWindows(enum_windows, None)
    return tables


def capture_window_screenshot(hwnd: int) -> Image.Image | None:
    """
    Capture screenshot of window including overlays (topmost layer).
    Uses PrintWindow first, then falls back to ImageGrab to capture everything including HUDs.
    """
    try:
        # Get window rect
        rect = win32gui.GetWindowRect(hwnd)
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]

        if width <= 0 or height <= 0:
            return None

        # Try PrintWindow first (captures window content)
        try:
            hwndDC = win32gui.GetWindowDC(hwnd)
            mfcDC = win32ui.CreateDCFromHandle(hwndDC)
            saveDC = mfcDC.CreateCompatibleDC()

            saveBitMap = win32ui.CreateBitmap()
            saveBitMap.CreateCompatibleBitmap(mfcDC, width, height)
            saveDC.SelectObject(saveBitMap)

            # Try PW_RENDERFULLCONTENT (0x00000002) first for full content
            result = win32gui.PrintWindow(hwnd, saveDC.GetSafeHdc(), 0x00000002)

            if result == 0:
                # Fallback: try PW_CLIENTONLY (0)
                result = win32gui.PrintWindow(hwnd, saveDC.GetSafeHdc(), 0)

            if result != 0:
                # Got something from PrintWindow
                bmpinfo = saveBitMap.GetInfo()
                bmpstr = saveBitMap.GetBitmapBits(True)

                img = Image.frombuffer(
                    "RGB",
                    (bmpinfo["bmWidth"], bmpinfo["bmHeight"]),
                    bmpstr,
                    "raw",
                    "BGRX",
                    0,
                    1,
                )

                # Cleanup
                win32gui.DeleteObject(saveBitMap.GetHandle())
                saveDC.DeleteDC()
                mfcDC.DeleteDC()
                win32gui.ReleaseDC(hwnd, hwndDC)

                # Check if image is not completely black/empty
                # If it seems empty, fall back to ImageGrab
                if img.getextrema()[0][1] > 10:  # Not completely black
                    return img
        except Exception:
            pass

        # Fallback: Use ImageGrab to capture screen area (includes all overlays/HUDs)
        # This captures the topmost rendered layer including any overlays
        from PIL import ImageGrab

        img = ImageGrab.grab(bbox=(rect[0], rect[1], rect[2], rect[3]))
        return img

    except Exception as e:
        # Write errors to stderr
        import sys

        print(f"[!] Error capturing window {hwnd}: {e}", file=sys.stderr)
        return None


def image_to_base64(img: Image.Image, format: str = "PNG") -> str:
    """Convert PIL Image to base64 string"""
    buffer = BytesIO()
    img.save(buffer, format=format)
    img_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return img_str


def main():
    """Main entry point"""
    import sys

    device_id = sys.argv[1] if len(sys.argv) > 1 else None

    # Write debug messages to stderr instead of stdout (so JSON output is clean)
    def debug_print(msg):
        print(msg, file=sys.stderr)

    # Find all CoinPoker tables
    debug_print("[Snapshot] Finding CoinPoker table windows...")
    tables = find_coinpoker_tables(device_id)

    if not tables:
        result = {
            "success": False,
            "error": "No CoinPoker table windows found",
            "tables": [],
            "count": 0,
        }
        print(json.dumps(result))
        sys.exit(1)

    debug_print(f"[Snapshot] Found {len(tables)} table(s)")

    # Generate timestamp for this batch of snapshots
    from datetime import datetime

    timestamp = datetime.now().isoformat()

    # Capture screenshots
    results = []
    for i, table in enumerate(tables, 1):
        debug_print(f"[Snapshot] Capturing table {i}/{len(tables)}: {table['title']}")

        img = capture_window_screenshot(table["hwnd"])

        if img:
            # Convert to base64 for dashboard (no local file saving)
            img_base64 = image_to_base64(img)
            results.append(
                {
                    "hwnd": table["hwnd"],
                    "pid": table["pid"],
                    "title": table["title"],
                    "screenshot": img_base64,
                    "screenshot_format": "PNG",
                    "width": table["rect"]["width"],
                    "height": table["rect"]["height"],
                    "rect": table["rect"],
                }
            )
            debug_print(f"[Snapshot] ✓ Captured {table['rect']['width']}x{table['rect']['height']}")
        else:
            debug_print(f"[Snapshot] ✗ Failed to capture {table['title']}")
            results.append(
                {
                    "hwnd": table["hwnd"],
                    "pid": table["pid"],
                    "title": table["title"],
                    "error": "Failed to capture screenshot",
                    "rect": table["rect"],
                }
            )

    # Output JSON result to stdout (only JSON, no debug messages)
    result = {
        "success": True,
        "count": len(results),
        "tables": results,
        "device_id": device_id,
        "timestamp": timestamp,
    }

    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
