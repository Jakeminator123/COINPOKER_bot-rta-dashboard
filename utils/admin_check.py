"""
Admin Privilege Checking
========================
Centralized utilities for checking Windows administrator privileges.
"""

import subprocess
import sys


def is_admin() -> bool:
    """
    Check if current process has administrator privileges.

    Returns:
        True if running as administrator, False otherwise
    """
    try:
        # Try Windows API method (most reliable)
        import ctypes
        import os

        # Check if running on Windows
        if os.name != "nt":
            return False

        # Check if process is elevated
        try:
            # This works on Windows Vista+
            return ctypes.windll.shell32.IsUserAnAdmin() != 0
        except AttributeError:
            # Fallback for older Windows
            pass

    except ImportError:
        # ctypes might not be available
        pass

    # Fallback: Use net session command
    try:
        result = subprocess.run(
            ["net", "session"],
            capture_output=True,
            timeout=2,
            creationflags=subprocess.CREATE_NO_WINDOW
            if hasattr(subprocess, "CREATE_NO_WINDOW")
            else 0,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
        # If net command fails, assume not admin (conservative)
        return False


def require_admin_or_exit(message: str | None = None) -> None:
    """
    Exit with error if not running as administrator.

    Args:
        message: Optional custom error message
    """
    if not is_admin():
        error_msg = message or "Admin privileges required. Please run as administrator."
        print(f"[ERROR] {error_msg}")
        sys.exit(1)


def warn_if_not_admin() -> None:
    """
    Print warning if not running as administrator, but continue execution.

    This is used for features that work without admin but have reduced functionality.
    """
    if not is_admin():
        print("[WARNING] Not running as administrator - some features may be limited")
        print("[WARNING] For full functionality, run as administrator")


def get_admin_status_message() -> str:
    """
    Get a status message about admin privileges.

    Returns:
        Status message string
    """
    if is_admin():
        return "Running as administrator (full functionality available)"
    else:
        return "Not running as administrator (limited functionality)"
