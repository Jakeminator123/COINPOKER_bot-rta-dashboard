"""System information helpers for the detector runtime."""

from __future__ import annotations

import os
import socket


def get_windows_computer_name() -> str:
    """
    Get Windows computer name (can contain spaces like "Jakobs dator").

    Tries multiple methods:
    1. Windows API GetComputerNameEx (most accurate, preserves spaces)
    2. COMPUTERNAME environment variable
    3. socket.gethostname() fallback
    """

    # Try Windows API first (most accurate)
    try:
        import win32api  # type: ignore
        import win32con  # type: ignore

        name = win32api.GetComputerNameEx(win32con.ComputerNamePhysicalDnsHostname)
        if name:
            return name
    except (ImportError, Exception):
        pass

    # Fallback to COMPUTERNAME environment variable
    computer_name = os.environ.get("COMPUTERNAME")
    if computer_name:
        return computer_name

    # Final fallback to socket.gethostname()
    try:
        hostname = socket.gethostname()
        if hostname:
            return hostname
    except Exception:
        pass

    return "Unknown Device"

