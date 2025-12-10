# nickname_detector.py
"""
Nickname detection for CoinPoker lobby window.

Primary method: UI Automation (pywinauto) - hooks into the UI element directly
Fallback method: OCR with red text filtering

The nickname appears as a Button element in the CoinPoker Qt interface,
which can be read directly via Windows UI Automation.
"""

import hashlib
import json
import socket
import threading
import time
from pathlib import Path

import numpy as np
import pytesseract
from PIL import Image, ImageGrab
from pytesseract import Output
from core.system_info import get_windows_computer_name

try:
    import win32gui
    import win32con
    WIN32_AVAILABLE = True
except ImportError:
    WIN32_AVAILABLE = False

# Check if pywinauto is available for UI Automation
try:
    from pywinauto import Application
    PYWINAUTO_AVAILABLE = True
except ImportError:
    PYWINAUTO_AVAILABLE = False

# Tesseract configuration
TESSERACT_EXE = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# Region to capture (percentage of window)
REGION_LEFT = 0.35
REGION_RIGHT = 0.70
REGION_TOP = 0.0
REGION_BOTTOM = 0.12

# How long to keep window on top (seconds)
TOPMOST_DURATION = 1.5


def ensure_tesseract() -> bool:
    """Check if Tesseract OCR is available."""
    if Path(TESSERACT_EXE).exists():
        pytesseract.pytesseract.tesseract_cmd = TESSERACT_EXE
    
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _is_red_pixel(r: int, g: int, b: int) -> bool:
    """
    Check if pixel is the red color used for CoinPoker nicknames.
    
    Based on color analysis:
    R: 140-240, G: 35-90, B: 35-110
    With ratios: R > 1.4*G, R > 1.2*B
    """
    return (
        140 <= r <= 240 and
        35 <= g <= 90 and
        35 <= b <= 110 and
        r > 1.4 * g and
        r > 1.2 * b
    )


def _filter_red_to_black(image: Image.Image) -> Image.Image:
    """
    Filter image: RED pixels become BLACK, everything else WHITE.
    This creates high contrast for OCR (black text on white background).
    """
    arr = np.array(image)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    
    # Vectorized red detection
    mask = (
        (r >= 140) & (r <= 240) &
        (g >= 35) & (g <= 90) &
        (b >= 35) & (b <= 110) &
        (r > 1.4 * g) &
        (r > 1.2 * b)
    )
    
    # Create output: white background, black text
    out = np.full_like(arr, 255)
    out[mask] = [0, 0, 0]
    
    return Image.fromarray(out)


def _bring_to_top(hwnd: int) -> bool:
    """Bring window to top and keep it there briefly for capture."""
    if not WIN32_AVAILABLE:
        return False
    
    try:
        # Restore if minimized
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            time.sleep(0.2)
        
        # Set TOPMOST
        win32gui.SetWindowPos(
            hwnd, win32con.HWND_TOPMOST,
            0, 0, 0, 0,
            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_SHOWWINDOW
        )
        
        # Wait for window to be fully visible
        time.sleep(TOPMOST_DURATION)
        
        # Remove TOPMOST
        win32gui.SetWindowPos(
            hwnd, win32con.HWND_NOTOPMOST,
            0, 0, 0, 0,
            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE
        )
        
        return True
    except Exception as e:
        print(f"[NicknameDetector] Could not bring window to top: {e}")
        return False


def _capture_region(hwnd: int) -> Image.Image | None:
    """Capture the nickname region of the window."""
    if not WIN32_AVAILABLE:
        return None
    
    try:
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        w, h = right - left, bottom - top
        
        # Calculate region coordinates
        x1 = left + int(w * REGION_LEFT)
        y1 = top + int(h * REGION_TOP)
        x2 = left + int(w * REGION_RIGHT)
        y2 = top + int(h * REGION_BOTTOM)
        
        return ImageGrab.grab(bbox=(x1, y1, x2, y2))
    except Exception as e:
        print(f"[NicknameDetector] Capture failed: {e}")
        return None


def _ocr_nickname(image: Image.Image) -> tuple[str | None, float]:
    """
    Extract nickname from filtered image using Tesseract OCR.
    
    Returns:
        Tuple of (nickname, confidence) where confidence is 0.0-1.0
    """
    try:
        # OCR with single line mode
        config = '--psm 7'
        data = pytesseract.image_to_data(image, config=config, output_type=Output.DICT)
        
        best_text = ""
        best_conf = 0.0
        
        for i, text in enumerate(data['text']):
            text = str(text).strip()
            if not text:
                continue
            
            # Get confidence (0-100 from Tesseract)
            conf = float(data['conf'][i])
            if conf < 0:
                continue
            
            # Clean text: keep only valid nickname chars
            clean = ''.join(c for c in text if c.isalnum() or c in '_-.')
            
            # Valid nickname? (1-20 chars)
            if 1 <= len(clean) <= 20 and conf > best_conf:
                best_text = clean
                best_conf = conf
        
        if best_text:
            return best_text, best_conf / 100.0
        
        return None, 0.0
        
    except Exception as e:
        print(f"[NicknameDetector] OCR error: {e}")
        return None, 0.0


def _resolve_device_identity() -> tuple[str, str]:
    """Return consistent hostname/device_id."""
    hostname = get_windows_computer_name()
    if not hostname or hostname == "Unknown Device":
        try:
            hostname = socket.gethostname()
        except Exception:
            hostname = "Unknown Device"
    device_id = hashlib.md5(hostname.encode()).hexdigest()
    return hostname, device_id


def _extract_via_hook(hwnd: int) -> tuple[str | None, float]:
    """
    Extract nickname using UI Automation (pywinauto).
    
    The nickname appears as a Button element in the CoinPoker lobby.
    This method is faster and more reliable than OCR.
    
    Returns:
        Tuple of (nickname, confidence) - confidence is 1.0 if found via hook
    """
    if not PYWINAUTO_AVAILABLE:
        return None, 0.0
    
    try:
        app = Application(backend="uia").connect(handle=hwnd)
        window = app.window(handle=hwnd)
        
        # Get all Button elements (nickname appears as Button)
        buttons = window.descendants(control_type="Button")
        
        # Known UI button names to exclude
        exclude = {
            'log out', 'close', 'minimize', 'maximize', 
            'open table', 'join', 'details', 'cashier'
        }
        
        for btn in buttons:
            try:
                name = btn.element_info.name
                if not name:
                    continue
                
                name_lower = name.lower()
                
                # Skip known UI buttons
                if any(ex in name_lower for ex in exclude):
                    continue
                
                # Skip currency values (starts with ₮ or contains CHP)
                if name.startswith('₮') or 'CHP' in name:
                    continue
                
                # Valid nickname: 1-20 alphanumeric chars
                clean = ''.join(c for c in name if c.isalnum() or c in '_-.')
                if 3 <= len(clean) <= 20 and clean[0].isalnum():
                    print(f"[NicknameDetector] Hook found nickname: '{clean}'")
                    return clean, 1.0  # 100% confidence for hook method
                    
            except Exception:
                continue
        
        return None, 0.0
        
    except Exception as e:
        print(f"[NicknameDetector] Hook method failed: {e}")
        return None, 0.0


def _extract_via_ocr(hwnd: int) -> tuple[str | None, float]:
    """
    Extract nickname using OCR with red text filtering.
    
    This is the fallback method when UI Automation doesn't work.
    
    Returns:
        Tuple of (nickname, confidence) where confidence is 0.0-1.0
    """
    print("[NicknameDetector] Using OCR fallback method")
    
    # Bring window to top
    _bring_to_top(hwnd)
    
    # Capture region
    region = _capture_region(hwnd)
    if not region:
        print("[NicknameDetector] Failed to capture window region")
        return None, 0.0
    
    print(f"[NicknameDetector] Captured region: {region.width}x{region.height}")
    
    # Apply red filter (red → black, rest → white)
    filtered = _filter_red_to_black(region)
    
    # OCR
    return _ocr_nickname(filtered)


def extract_nickname(hwnd: int) -> tuple[str | None, float]:
    """
    Extract nickname from CoinPoker lobby window.
    
    Primary: UI Automation hook (fast, reliable, 100% confidence)
    Fallback: OCR with red text filtering
    
    Args:
        hwnd: Window handle of CoinPoker lobby
        
    Returns:
        Tuple of (nickname, confidence) where confidence is 0.0-1.0
    """
    print(f"[NicknameDetector] Extracting nickname from HWND: {hwnd}")
    
    # Method 1: Try UI Automation hook (preferred)
    if PYWINAUTO_AVAILABLE:
        print("[NicknameDetector] Trying UI Automation hook...")
        nickname, confidence = _extract_via_hook(hwnd)
        if nickname:
            print(f"[NicknameDetector] ✓ Hook detected: '{nickname}' (100% confidence)")
            return nickname, confidence
        print("[NicknameDetector] Hook method did not find nickname")
    else:
        print("[NicknameDetector] pywinauto not available, skipping hook method")
    
    # Method 2: Fallback to OCR
    nickname, confidence = _extract_via_ocr(hwnd)
    
    if nickname:
        print(f"[NicknameDetector] ✓ OCR detected: '{nickname}' ({confidence:.1%} confidence)")
    else:
        print("[NicknameDetector] No nickname detected")
    
    return nickname, confidence


# Track which HWND/PID combinations have already sent signals
_detected_combinations: set[tuple[int, int]] = set()
_detection_lock = threading.Lock()


def detect_nickname(hwnd: int, pid: int, post_signal_func) -> None:
    """
    Main function to detect nickname from CoinPoker lobby window.
    
    Args:
        hwnd: Window handle of CoinPoker lobby window
        pid: Process ID of CoinPoker
        post_signal_func: Function to call to send signals (from core.api.post_signal)
    """
    # Prevent duplicate detections for same HWND/PID combination
    with _detection_lock:
        combination = (hwnd, pid)
        if combination in _detected_combinations:
            print(f"[NicknameDetector] Skipping duplicate detection for HWND: {hwnd}, PID: {pid}")
            return
        _detected_combinations.add(combination)
    
    # Check if Tesseract is available
    if not ensure_tesseract():
        print("[NicknameDetector] Tesseract OCR not found - nickname detection disabled")
        try:
            hostname, device_id = _resolve_device_identity()
            device_ip = _get_device_ip()
            
            post_signal_func(
                category="system",
                name="Player Name Detection - Tesseract Required",
                status="WARN",
                details=json.dumps({
                    "message": "Tesseract OCR not installed - nickname detection disabled",
                    "download_url": "https://github.com/UB-Mannheim/tesseract/wiki",
                    "expected_path": TESSERACT_EXE,
                    "pid": pid,
                }),
                device_id=device_id,
                device_name=hostname,
                device_ip=device_ip,
                segment_name="ProcessScanner",
            )
        except Exception:
            pass
        return
    
    # Extract nickname (tries hook first, then OCR fallback)
    player_name, confidence = extract_nickname(hwnd)
    
    # Determine detection method based on confidence
    # Hook method returns 1.0 (100%), OCR returns lower values
    detection_method = "UIAutomation_Hook" if confidence == 1.0 else "RedTextFilter_OCR"
    
    # Send result to dashboard
    hostname, device_id = _resolve_device_identity()
    device_ip = _get_device_ip()
    
    if player_name:
        try:
            post_signal_func(
                category="system",
                name="Player Name Detected",
                status="INFO",
                details=json.dumps({
                    "player_name": player_name,
                    "confidence": confidence,
                    "confidence_percent": int(confidence * 100),
                    "pid": pid,
                    "detection_method": detection_method,
                }),
                device_id=device_id,
                device_name=hostname,
                device_ip=device_ip,
                segment_name="ProcessScanner",
            )
            
            print(f"[NicknameDetector] ✅ Sent player name to dashboard: {player_name} ({int(confidence * 100)}% confidence)")
        except Exception as e:
            print(f"[NicknameDetector] Failed to send player name: {e}")
    else:
        print("[NicknameDetector] Could not extract nickname")
        try:
            post_signal_func(
                category="system",
                name="Player Name Detection Failed",
                status="WARN",
                details=json.dumps({
                    "reason": "Could not extract nickname from lobby",
                    "pid": pid,
                }),
                device_id=device_id,
                device_name=hostname,
                device_ip=device_ip,
                segment_name="ProcessScanner",
            )
        except Exception:
            pass


def _get_device_ip() -> str:
    """Get device IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"
