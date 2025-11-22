"""
File Encryption Utilities
=========================
Reusable encryption/decryption for configuration files.
Uses same mechanism as master_config.enc (Fernet with daily key rotation).
"""

import base64
import hashlib
import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

# Encryption imports
try:
    from cryptography.fernet import Fernet
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False


# Encryption settings (same as config_loader.py)
KEY_SALT = b"detector_cache_salt_2024"  # Fixed salt for key derivation
ENCRYPTION_PASSWORD = "Ma!!orca123"


def generate_daily_key(date: datetime | None = None) -> bytes | None:
    """
    Generate encryption key from date + password.
    Format: YYYY_MM_DD + 'Ma!!orca123'
    Example: '2025_11_02Ma!!orca123'

    Args:
        date: Optional datetime to use (defaults to today)

    Returns:
        Encryption key as bytes, or None if cryptography not available
    """
    if not CRYPTO_AVAILABLE:
        return None

    if date is None:
        date = datetime.now()

    date_str = date.strftime("%Y_%m_%d")
    password = f"{date_str}{ENCRYPTION_PASSWORD}"
    password_bytes = password.encode("utf-8")

    # Derive key using PBKDF2 (same as config_loader.py)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=KEY_SALT,
        iterations=100000,
        backend=default_backend(),
    )
    key = base64.urlsafe_b64encode(kdf.derive(password_bytes))
    return key


def _calculate_checksum(data: dict[str, Any]) -> str:
    """
    Calculate MD5 checksum of configuration data.

    Args:
        data: Configuration dictionary

    Returns:
        MD5 checksum as hexadecimal string
    """
    json_str = json.dumps(data, sort_keys=True)
    return hashlib.md5(json_str.encode("utf-8")).hexdigest()


def encrypt_config_file(data: dict[str, Any], filepath: Path) -> bool:
    """
    Encrypt and save configuration data to file.

    Args:
        data: Configuration dictionary to encrypt
        filepath: Path to save encrypted file (should have .enc extension)

    Returns:
        True if encryption and save succeeded, False otherwise
    """
    if not CRYPTO_AVAILABLE:
        print("[FileEncryption] WARNING: cryptography not available, saving as plaintext")
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"[FileEncryption] ERROR: Failed to save plaintext: {e}")
            return False

    try:
        # Prepare cache data structure (same format as master_config.enc)
        cache_data = {
            "timestamp": time.time(),
            "data": data,
            "checksum": _calculate_checksum(data),
        }

        # Generate today's key
        key = generate_daily_key()
        if not key:
            return False

        # Encrypt data
        fernet = Fernet(key)
        json_data = json.dumps(cache_data, sort_keys=True).encode("utf-8")
        encrypted_data = fernet.encrypt(json_data)

        # Save encrypted data
        filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, "wb") as f:
            f.write(encrypted_data)

        print(f"[FileEncryption] Saved encrypted config to {filepath}")
        return True

    except Exception as e:
        print(f"[FileEncryption] ERROR: Encryption failed: {e}")
        return False


def decrypt_config_file(filepath: Path) -> dict[str, Any] | None:
    """
    Decrypt and load configuration from encrypted file.

    Tries today's key first, then yesterday's key (for midnight edge cases).

    Args:
        filepath: Path to encrypted file

    Returns:
        Decrypted configuration dictionary, or None if decryption fails
    """
    if not filepath.exists():
        return None

    if not CRYPTO_AVAILABLE:
        # Try to load as plaintext JSON (backward compatibility)
        try:
            with open(filepath, encoding="utf-8") as f:
                data = json.load(f)
                print(f"[FileEncryption] Loaded plaintext config from {filepath}")
                return data
        except Exception as e:
            print(f"[FileEncryption] ERROR: Failed to load plaintext: {e}")
            return None

    # Try to decrypt with today's key
    try:
        key = generate_daily_key()
        if not key:
            return None

        fernet = Fernet(key)

        with open(filepath, "rb") as f:
            encrypted_data = f.read()

        decrypted_data = fernet.decrypt(encrypted_data)
        cache_data = json.loads(decrypted_data.decode("utf-8"))

        # Verify checksum
        expected_checksum = cache_data.get("checksum")
        actual_data = cache_data.get("data", {})
        actual_checksum = _calculate_checksum(actual_data)

        if expected_checksum != actual_checksum:
            print(f"[FileEncryption] WARNING: Checksum mismatch in {filepath}")
            # Continue anyway - checksum failure might be due to minor changes

        print(f"[FileEncryption] Loaded decrypted config from {filepath}")
        return actual_data

    except Exception as decrypt_error:
        # If decryption fails, try yesterday's key (for edge cases at midnight)
        try:
            yesterday = datetime.now() - timedelta(days=1)
            key = generate_daily_key(yesterday)
            if not key:
                return None

            fernet = Fernet(key)

            with open(filepath, "rb") as f:
                encrypted_data = f.read()

            decrypted_data = fernet.decrypt(encrypted_data)
            cache_data = json.loads(decrypted_data.decode("utf-8"))

            # Verify checksum
            expected_checksum = cache_data.get("checksum")
            actual_data = cache_data.get("data", {})
            actual_checksum = _calculate_checksum(actual_data)

            if expected_checksum != actual_checksum:
                print(
                    f"[FileEncryption] WARNING: Checksum mismatch in {filepath} (yesterday's key)"
                )

            print(
                f"[FileEncryption] Loaded decrypted config from {filepath} (using yesterday's key)"
            )
            return actual_data

        except Exception:
            print(f"[FileEncryption] ERROR: Failed to decrypt {filepath}: {decrypt_error}")
            return None
