"""
Security Utilities
==================
Anti-tampering and security hardening measures.
"""

import hashlib
import os
from pathlib import Path
from typing import Any


def verify_file_integrity(filepath: Path, expected_hash: str | None = None) -> bool:
    """
    Verify file integrity using MD5 checksum.

    Args:
        filepath: Path to file to verify
        expected_hash: Expected MD5 hash (hex string). If None, just calculates hash.

    Returns:
        True if hash matches or expected_hash is None, False otherwise
    """
    if not filepath.exists():
        return False

    try:
        with open(filepath, "rb") as f:
            file_hash = hashlib.md5(f.read()).hexdigest()

        if expected_hash is None:
            # Just calculate hash, always return True
            return True

        return file_hash.lower() == expected_hash.lower()
    except Exception:
        return False


def check_debugger_attached() -> bool:
    """
    Check if debugger is attached to current process.

    Returns:
        True if debugger detected, False otherwise
    """
    try:
        # Windows-specific check
        if os.name == "nt":
            import ctypes

            # Check for debugger using Windows API
            kernel32 = ctypes.windll.kernel32
            # IsDebuggerPresent
            result = kernel32.IsDebuggerPresent()
            return bool(result)
    except Exception:
        pass

    return False


def validate_config_schema(config: dict[str, Any], schema: dict[str, Any]) -> bool:
    """
    Validate configuration against expected schema.

    Args:
        config: Configuration dictionary to validate
        schema: Schema dictionary defining required keys and types

    Returns:
        True if config matches schema, False otherwise
    """
    try:
        for key, expected_type in schema.items():
            if key not in config:
                return False

            if expected_type is not None and not isinstance(config[key], expected_type):
                return False

        return True
    except Exception:
        return False


def obfuscate_paths() -> dict[str, str]:
    """
    Return obfuscated path mappings for future code obfuscation.

    Currently returns empty dict - reserved for future obfuscation implementation.

    Returns:
        Dictionary mapping original paths to obfuscated paths
    """
    # Reserved for future obfuscation
    return {}


def check_process_integrity() -> bool:
    """
    Check if current process integrity is intact.

    Returns:
        True if process appears normal, False if suspicious
    """
    try:
        # Check for debugger
        # Check for suspicious imports (could indicate hooking)
        # This is a basic check - more advanced detection could be added
        return not check_debugger_attached()
    except Exception:
        # If checks fail, assume OK (don't break functionality)
        return True
