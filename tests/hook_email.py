"""
CoinPoker Login - Email Reader (Minimal)
=========================================
Reads the email from the login window using pywinauto.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import psutil

try:
    import win32gui
    import win32process
    from pywinauto import Application
except ImportError as e:
    print(f"ERROR: Missing dependency - {e}")
    print("Run: pip install pywin32 pywinauto")
    sys.exit(1)


def find_coinpoker_login_window():
    """Find the CoinPoker login window."""
    windows = []
    
    def callback(hwnd, _):
        try:
            if win32gui.IsWindowVisible(hwnd):
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                try:
                    proc = psutil.Process(pid)
                    exe = proc.exe().lower()
                    if "coinpoker" in exe or "game.exe" in exe:
                        title = win32gui.GetWindowText(hwnd)
                        windows.append({"hwnd": hwnd, "title": title})
                except:
                    pass
        except:
            pass
        return True
    
    win32gui.EnumWindows(callback, None)
    return windows


def get_login_email(hwnd):
    """Get email from the first Edit control."""
    try:
        app = Application(backend="uia").connect(handle=hwnd)
        window = app.window(handle=hwnd)
        
        edits = window.descendants(control_type="Edit")
        if edits:
            # First edit control contains email
            try:
                return edits[0].get_value()
            except:
                return edits[0].window_text()
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None


def main():
    windows = find_coinpoker_login_window()
    
    if not windows:
        print("❌ No CoinPoker window found")
        return None
    
    # Use first window found
    hwnd = windows[0]["hwnd"]
    email = get_login_email(hwnd)
    
    if email:
        print(f"📧 Email: {email}")
    else:
        print("❌ No email found")
    
    return email


if __name__ == "__main__":
    result = main()
    sys.exit(0 if result else 1)
