"""
CoinPoker Lobby - Nickname Reader (Minimal)
============================================
Reads the nickname from the lobby window using pywinauto.
The nickname appears as a Button element.
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


def find_coinpoker_lobby():
    """Find the CoinPoker lobby window."""
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
                        if "lobby" in title.lower():
                            windows.append({"hwnd": hwnd, "title": title})
                except:
                    pass
        except:
            pass
        return True
    
    win32gui.EnumWindows(callback, None)
    return windows


def get_nickname(hwnd):
    """Get nickname from Button elements."""
    try:
        app = Application(backend="uia").connect(handle=hwnd)
        window = app.window(handle=hwnd)
        
        buttons = window.descendants(control_type="Button")
        
        # Known UI buttons to exclude
        exclude = {'log out', 'close', 'minimize', 'maximize', 
                   'open table', 'join', 'details', 'cashier'}
        
        for btn in buttons:
            try:
                name = btn.element_info.name
                if not name:
                    continue
                
                name_lower = name.lower()
                
                # Skip known UI buttons
                if any(ex in name_lower for ex in exclude):
                    continue
                
                # Skip currency values
                if name.startswith('₮') or 'CHP' in name:
                    continue
                
                # Valid nickname: 3-20 chars, starts with alphanumeric
                clean = ''.join(c for c in name if c.isalnum() or c in '_-.')
                if 3 <= len(clean) <= 20 and clean[0].isalnum():
                    return clean
                    
            except:
                continue
        
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None


def main():
    windows = find_coinpoker_lobby()
    
    if not windows:
        print("❌ No CoinPoker lobby found")
        return None
    
    hwnd = windows[0]["hwnd"]
    nickname = get_nickname(hwnd)
    
    if nickname:
        print(f"🎯 Nickname: {nickname}")
    else:
        print("❌ No nickname found")
    
    return nickname


if __name__ == "__main__":
    result = main()
    sys.exit(0 if result else 1)
