# email_detector.py
"""
Email detection from CoinPoker login window.

Hooks into the login window to read the email field directly
using Windows UI Automation (pywinauto).

This runs ONCE when the login window is detected, then stops.
"""

import json
import socket
import threading

from core.system_info import get_windows_computer_name

try:
    import win32gui
    import win32process
    import psutil
    from pywinauto import Application
    AVAILABLE = True
except ImportError:
    AVAILABLE = False


# Track if we already detected email this session
_detected_this_session = False
_detection_lock = threading.Lock()


def _find_login_window() -> int | None:
    """
    Find CoinPoker login window (NOT the lobby).
    
    The login window is a CoinPoker window that does NOT have "Lobby" in title.
    """
    if not AVAILABLE:
        return None
    
    login_hwnd = None
    
    def callback(hwnd, _):
        nonlocal login_hwnd
        try:
            if not win32gui.IsWindowVisible(hwnd):
                return True
            
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            try:
                proc = psutil.Process(pid)
                exe = proc.exe().lower()
                if "coinpoker" not in exe and "game.exe" not in exe:
                    return True
            except:
                return True
            
            title = win32gui.GetWindowText(hwnd).lower()
            
            # Login window: has CoinPoker process but NOT "lobby" in title
            # Could be empty title or "CoinPoker" or similar
            if "lobby" not in title:
                login_hwnd = hwnd
                return False  # Stop enumeration
                
        except:
            pass
        return True
    
    try:
        win32gui.EnumWindows(callback, None)
    except:
        pass
    
    return login_hwnd


def _extract_email(hwnd: int) -> str | None:
    """Extract email from the first Edit control in login window."""
    if not AVAILABLE:
        return None
    
    try:
        app = Application(backend="uia").connect(handle=hwnd)
        window = app.window(handle=hwnd)
        
        # Get Edit controls - first one contains email
        edits = window.descendants(control_type="Edit")
        if edits:
            try:
                return edits[0].get_value()
            except:
                return edits[0].window_text()
        
        return None
    except Exception as e:
        print(f"[EmailDetector] Hook error: {e}")
        return None


def _resolve_device_identity() -> tuple[str, str]:
    """Resolve device identity (hostname, device_id) matching nickname detector."""
    import hashlib
    hostname = get_windows_computer_name()
    device_id = hashlib.md5(hostname.encode()).hexdigest()
    return hostname, device_id


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


def detect_login_email(post_signal_func=None) -> str | None:
    """
    Detect and send email from CoinPoker login window to dashboard.
    
    Only runs ONCE per session. Returns email if found, None otherwise.
    
    Args:
        post_signal_func: Optional function to send signals (from core.api.post_signal).
                         If provided, sends "Player Email Detected" signal to dashboard.
    """
    global _detected_this_session
    
    if not AVAILABLE:
        return None
    
    with _detection_lock:
        if _detected_this_session:
            return None  # Already ran this session
    
    # Find login window
    hwnd = _find_login_window()
    if not hwnd:
        return None
    
    # Extract email
    email = _extract_email(hwnd)
    
    if email and "@" in email:
        with _detection_lock:
            _detected_this_session = True
        
        # Print to CMD
        print()
        print("=" * 50)
        print(f"  📧 EMAIL: {email}")
        print("=" * 50)
        print()
        
        # Send signal to dashboard (same pattern as nickname detector)
        if post_signal_func:
            try:
                hostname, device_id = _resolve_device_identity()
                device_ip = _get_device_ip()
                
                post_signal_func(
                    category="system",
                    name="Player Email Detected",
                    status="INFO",
                    details=json.dumps({
                        "email": email,
                        "detection_method": "UIAutomation_Hook",
                    }),
                    device_id=device_id,
                    device_name=hostname,
                    device_ip=device_ip,
                    segment_name="EmailDetector",
                )
                
                print(f"[EmailDetector] ✅ Sent email to dashboard: {email}")
            except Exception as e:
                print(f"[EmailDetector] Failed to send email signal: {e}")
        
        return email
    
    return None


def reset_detection():
    """Reset detection flag (for new session)."""
    global _detected_this_session
    with _detection_lock:
        _detected_this_session = False


def is_login_window_open() -> bool:
    """Check if login window (not lobby) is currently open."""
    return _find_login_window() is not None

