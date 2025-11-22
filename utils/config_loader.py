# config_loader.py
"""
Central Configuration Loader
============================
Fetches and caches configuration from the web dashboard.
Fallback to local JSON files if dashboard unavailable.

This is the single source of truth for all detection configurations.
"""

import base64
import hashlib
import json
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any

import requests

# Encryption imports
try:
    from cryptography.fernet import Fernet
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False
    print("[ConfigLoader] WARNING: cryptography not installed. Cache will not be encrypted.")


class ConfigLoader:
    """
    Loads configuration from web dashboard with local caching.

    Priority order:
    1. Web dashboard (if available)
    2. Local cache (if recent)
    3. Local JSON files (fallback)
    """

    def __init__(self):
        # Initialize with default URL
        self.base_url = "http://localhost:3001/api"
        self.cache_ttl = 300  # 5 minutes cache validity (reduced for 300 players)
        self.configs: dict[str, Any] = {}  # RAM cache
        self.last_fetch = 0
        self.lock = Lock()
        
        # Backoff state for handling 503/429 errors
        self._backoff_until = 0.0  # Timestamp when we can retry after backoff
        self._backoff_seconds = 0.0  # Current backoff duration
        self._consecutive_errors = 0  # Count of consecutive 503/429 errors
        self._last_backoff_log = 0.0  # Timestamp of last backoff log message

        # Get config path handling both script and .exe execution
        if getattr(sys, "frozen", False):
            # Running as .exe - config should be next to the executable
            exe_dir = Path(sys.executable).parent
            self.config_path = exe_dir / "config.txt"
            # Cache directory should be next to .exe, not in current working directory
            self.cache_dir = exe_dir / "config_cache"
        else:
            # Running as script - config is in project root
            project_root = Path(__file__).parent.parent
            self.config_path = project_root / "config.txt"
            # Cache directory in project root
            self.cache_dir = project_root / "config_cache"

        self.cache_file = self.cache_dir / "master_config.enc"  # Encrypted cache file

        # Check if config.txt exists
        self.config_txt_exists = self.config_path.exists()

        # RAM-only mode: Controlled by RAM_CONFIG=y in config.txt, or auto-enabled if config.txt doesn't exist
        # RAM_CONFIG controls both disk cache and fallback source:
        # - RAM_CONFIG=y → No disk cache, uses embedded configs as fallback (tamper-proof)
        # - RAM_CONFIG=n → Disk cache enabled, uses local JSON files as fallback
        # This allows the .exe to run without leaving config files on disk
        self.ram_only_mode = not self.config_txt_exists  # Default: auto-detect from file existence

        # Create cache directory only if config.txt exists (for disk caching)
        if not self.ram_only_mode:
            self.cache_dir.mkdir(exist_ok=True)

        # Encryption settings
        self.encryption_enabled = CRYPTO_AVAILABLE
        self.key_salt = b"detector_cache_salt_2024"  # Fixed salt for key derivation

        # Load dashboard URL from config.txt
        self._load_dashboard_url()

        # Check RAM_CONFIG setting from config.txt (overrides auto-detection)
        if self.config_txt_exists:
            self._load_ram_config_setting()

        print(f"[ConfigLoader] Initialized with URL: {self.base_url}")
        if self.ram_only_mode:
            print("[ConfigLoader] RAM-only mode: Configs kept in RAM only, using embedded configs as fallback")
        elif self.encryption_enabled:
            print("[ConfigLoader] Encryption: ENABLED (cache files encrypted)")
        else:
            print("[ConfigLoader] Encryption: DISABLED (cryptography not available)")

    def _load_dashboard_url(self):
        """Load dashboard URL from config.txt based on ENV setting"""
        try:
            if self.config_path.exists():
                env = "PROD"  # Default to production
                web_url_prod = None
                web_url_dev = None

                with open(self.config_path, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue

                        key, value = line.split("=", 1)
                        key = key.strip().upper()
                        value = value.strip()

                        # Remove inline comments
                        if "#" in value:
                            value = value.split("#")[0].strip()

                        if key == "ENV":
                            env = value.upper()
                        elif key == "WEB_URL_PROD":
                            web_url_prod = value
                        elif key == "WEB_URL_DEV":
                            web_url_dev = value

                # Select URL based on environment
                if env == "DEV" and web_url_dev:
                    url = web_url_dev
                elif env == "PROD" and web_url_prod:
                    url = web_url_prod
                else:
                    # Fallback to old WEB_URL format for backward compatibility
                    url = web_url_prod or web_url_dev or "http://localhost:3001/api/signal"

                # Convert to API base URL
                if "/api/signal" in url:
                    self.base_url = url.replace("/api/signal", "/api")
                elif not url.endswith("/api"):
                    self.base_url = url.rstrip("/") + "/api"
                else:
                    self.base_url = url

                print(f"[ConfigLoader] Environment: {env}, Dashboard URL: {self.base_url}")

        except Exception as e:
            print(f"[ConfigLoader] INFO: Using default URL: {e}")

    def _load_ram_config_setting(self):
        """
        Load RAM_CONFIG setting from config.txt.
        
        RAM_CONFIG controls both disk cache and fallback source:
        - RAM_CONFIG=y → RAM-only mode (no disk cache, uses embedded configs as fallback)
        - RAM_CONFIG=n → Disk cache mode (saves cache to disk, uses local JSON files as fallback)
        """
        try:
            if not self.config_path.exists():
                return

            with open(self.config_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue

                    key, value = line.split("=", 1)
                    key = key.strip().upper()
                    value = value.strip()

                    # Remove inline comments
                    if "#" in value:
                        value = value.split("#")[0].strip()

                    if key == "RAM_CONFIG":
                        # RAM_CONFIG=y enables RAM-only mode (overrides auto-detection)
                        self.ram_only_mode = value.upper() in ("Y", "YES", "1", "TRUE")
                        # Update cache directory creation based on RAM mode
                        if self.ram_only_mode:
                            # Don't create cache directory in RAM-only mode
                            pass
                        else:
                            # Create cache directory if not in RAM-only mode
                            self.cache_dir.mkdir(exist_ok=True)
                        break
        except Exception as e:
            print(f"[ConfigLoader] WARNING: Error reading RAM_CONFIG: {e}")

    def fetch_configs(self, force: bool = False) -> dict[str, Any]:
        """
        Fetch all configurations.

        Args:
            force: Force fetch from dashboard even if cache is valid

        Returns:
            Dictionary containing all configurations
        """
        with self.lock:
            # Check if we should use cache
            if not force and self._is_cache_valid():
                return self.configs

            # Try to fetch from dashboard
            dashboard_configs = self._fetch_from_dashboard()
            if dashboard_configs:
                # Ensure source is set
                if "_meta" not in dashboard_configs:
                    dashboard_configs["_meta"] = {}
                dashboard_configs["_meta"]["source"] = "dashboard"

                self.configs = dashboard_configs
                # Save to disk only if config.txt exists (not in RAM-only mode)
                self._save_cache(dashboard_configs)
                return dashboard_configs

            # Fallback to cache (only if not in RAM-only mode and cache file exists)
            if not self.ram_only_mode:
                cached_configs = self._load_cache()
                if cached_configs:
                    # Mark source as cache
                    if "_meta" not in cached_configs:
                        cached_configs["_meta"] = {}
                    cached_configs["_meta"]["source"] = "cache"

                    self.configs = cached_configs
                    return cached_configs

            # Last resort: local JSON files (or RAM-only fallback)
            local_configs = self._load_local_jsons()
            # Source already set in _load_local_jsons
            self.configs = local_configs
            return local_configs

    def _is_cache_valid(self) -> bool:
        """Check if current cache is still valid"""
        if not self.configs:
            return False
        return (time.time() - self.last_fetch) < self.cache_ttl

    def _fetch_from_dashboard(self) -> dict[str, Any] | None:
        """Fetch configurations from web dashboard"""
        # Check if we're in backoff period
        now = time.time()
        if now < self._backoff_until:
            remaining = int(self._backoff_until - now)
            # Log backoff status max once per 60 seconds
            if remaining > 0 and (now - self._last_backoff_log) >= 60:
                print(f"[ConfigLoader] Backoff active: waiting {remaining}s before retry")
                self._last_backoff_log = now
            return None
        
        try:
            print("[ConfigLoader] Fetching from dashboard...")

            response = requests.get(
                f"{self.base_url}/configs",
                timeout=2,  # Reduced timeout for faster startup
                headers={"Accept": "application/json"},
            )

            if response.status_code == 200:
                # Success - reset backoff
                if self._consecutive_errors > 0:
                    print("[ConfigLoader] Dashboard recovered - resetting backoff")
                self._consecutive_errors = 0
                self._backoff_until = 0.0
                self._backoff_seconds = 0.0
                self._last_backoff_log = 0.0
                
                data = response.json()

                # Handle new API response format (successResponse wrapper)
                # API returns: { ok: true, data: {...} } or { ok: false, error: "..." }
                if isinstance(data, dict):
                    # Check if it's wrapped in successResponse format
                    if "ok" in data:
                        if data.get("ok") is True and "data" in data:
                            # Success response - extract data
                            data = data["data"]
                        elif data.get("ok") is False:
                            # Error response - log and return None
                            error_msg = data.get("error", "Unknown error")
                            print(f"[ConfigLoader] Dashboard API error: {error_msg}")
                            return None
                    # Remove success flag if present (old format for backward compatibility)
                    elif "success" in data:
                        if not data.get("success"):
                            # Old error format
                            error_msg = data.get("error", "Unknown error")
                            print(f"[ConfigLoader] Dashboard API error (old format): {error_msg}")
                            return None
                        del data["success"]

                # Validate that we got actual config data (should have _meta at minimum)
                if not isinstance(data, dict) or not data:
                    print("[ConfigLoader] WARNING: Dashboard returned empty or invalid data")
                    return None

                self.last_fetch = time.time()
                config_count = len([k for k in data.keys() if not k.startswith("_")])
                print(f"[ConfigLoader] SUCCESS: Fetched {config_count} configs from dashboard")
                return data
            elif response.status_code in (503, 429):
                # Server overloaded or rate limited - apply exponential backoff
                self._consecutive_errors += 1
                # Exponential backoff: 30s, 60s, 120s, 240s, max 600s (10 min)
                self._backoff_seconds = min(30 * (2 ** (self._consecutive_errors - 1)), 600)
                self._backoff_until = now + self._backoff_seconds
                self._last_backoff_log = now
                
                error_type = "Rate limited" if response.status_code == 429 else "Service unavailable"
                print(f"[ConfigLoader] Dashboard returned {response.status_code} ({error_type})")
                print(f"[ConfigLoader] Backoff: waiting {int(self._backoff_seconds)}s before retry (attempt {self._consecutive_errors})")
                return None
            else:
                # Other HTTP errors - don't apply backoff, but log
                print(f"[ConfigLoader] Dashboard returned {response.status_code}")

        except requests.exceptions.ConnectionError:
            print("[ConfigLoader] WARNING: Dashboard not reachable")
        except requests.exceptions.Timeout:
            print("[ConfigLoader] WARNING: Dashboard timeout")
        except Exception as e:
            print(f"[ConfigLoader] WARNING: Dashboard fetch error: {e}")

        return None

    def _generate_key(self) -> bytes:
        """
        Generate encryption key from today's date + password.
        Format: YYYY_MM_DD + 'Ma!!orca123'
        Example: '2025_11_02Ma!!orca123'
        """
        today_str = datetime.now().strftime("%Y_%m_%d")
        password = f"{today_str}Ma!!orca123"
        password_bytes = password.encode("utf-8")

        # Derive key using PBKDF2
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=self.key_salt,
            iterations=100000,
            backend=default_backend(),
        )
        key = base64.urlsafe_b64encode(kdf.derive(password_bytes))
        return key

    def _save_cache(self, data: dict[str, Any]):
        """Save configuration to encrypted local cache (only if config.txt exists)"""
        # RAM-only mode: Don't save to disk if config.txt doesn't exist
        if self.ram_only_mode:
            # Config is already in RAM (self.configs), no need to save to disk
            return

        try:
            cache_data = {
                "timestamp": time.time(),
                "data": data,
                "checksum": self._calculate_checksum(data),
            }

            if self.encryption_enabled:
                # Encrypt cache data
                key = self._generate_key()
                fernet = Fernet(key)
                json_data = json.dumps(cache_data, sort_keys=True).encode("utf-8")
                encrypted_data = fernet.encrypt(json_data)

                # Save encrypted data
                with open(self.cache_file, "wb") as f:
                    f.write(encrypted_data)

                print(f"[ConfigLoader] CACHED: Saved encrypted cache to {self.cache_file}")
            else:
                # Fallback to plaintext if encryption not available
                with open(self.cache_file, "w", encoding="utf-8") as f:
                    json.dump(cache_data, f, indent=2)
                print(f"[ConfigLoader] CACHED: Saved to {self.cache_file} (unencrypted)")

        except Exception as e:
            print(f"[ConfigLoader] WARNING: Cache save error: {e}")
            # Don't fail completely - data is still in RAM

    def _load_cache(self) -> dict[str, Any] | None:
        """Load configuration from encrypted cache"""
        if not self.cache_file.exists():
            return None

        try:
            if self.encryption_enabled:
                # Try to decrypt with today's key
                try:
                    key = self._generate_key()
                    fernet = Fernet(key)

                    with open(self.cache_file, "rb") as f:
                        encrypted_data = f.read()

                    decrypted_data = fernet.decrypt(encrypted_data)
                    cache_data = json.loads(decrypted_data.decode("utf-8"))

                except Exception as decrypt_error:
                    # If decryption fails, try yesterday's key (for edge cases at midnight)
                    try:
                        yesterday = datetime.now() - timedelta(days=1)
                        yesterday_str = yesterday.strftime("%Y_%m_%d")
                        password = f"{yesterday_str}Ma!!orca123"
                        password_bytes = password.encode("utf-8")

                        kdf = PBKDF2HMAC(
                            algorithm=hashes.SHA256(),
                            length=32,
                            salt=self.key_salt,
                            iterations=100000,
                            backend=default_backend(),
                        )
                        key = base64.urlsafe_b64encode(kdf.derive(password_bytes))
                        fernet = Fernet(key)

                        with open(self.cache_file, "rb") as f:
                            encrypted_data = f.read()

                        decrypted_data = fernet.decrypt(encrypted_data)
                        cache_data = json.loads(decrypted_data.decode("utf-8"))
                        print("[ConfigLoader] CACHE: Decrypted with yesterday's key")
                    except Exception as yesterday_error:
                        print(
                            f"[ConfigLoader] WARNING: Cache decryption failed (today: {decrypt_error}, yesterday: {yesterday_error})"
                        )
                        return None
            else:
                # Plaintext fallback
                with open(self.cache_file, encoding="utf-8") as f:
                    cache_data = json.load(f)

            # Verify checksum
            if "checksum" in cache_data:
                expected_checksum = cache_data["checksum"]
                actual_checksum = self._calculate_checksum(cache_data["data"])
                if expected_checksum != actual_checksum:
                    print(
                        "[ConfigLoader] WARNING: Cache checksum mismatch - data may be corrupted!"
                    )
                    return None

            age_seconds = time.time() - cache_data["timestamp"]
            age_minutes = int(age_seconds / 60)

            # Accept cache up to 24 hours old as fallback
            if age_seconds < 86400:
                print(f"[ConfigLoader] CACHE: Using cached config (age: {age_minutes} min)")
                self.last_fetch = cache_data["timestamp"]
                return cache_data["data"]
            else:
                print(f"[ConfigLoader] Cache too old ({age_minutes} min)")

        except Exception as e:
            print(f"[ConfigLoader] WARNING: Cache load error: {e}")

        return None


    def _load_embedded_configs(self) -> dict[str, Any]:
        """Load embedded base64-encoded configs (secure, tamper-proof)"""
        print("[ConfigLoader] EMBEDDED: Loading embedded configurations...")

        try:
            from core.embedded_configs import get_all_configs

            configs = get_all_configs()
            configs["_meta"] = {
                "version": "1.0.0-embedded",
                "source": "embedded",
                "timestamp": time.time(),
            }

            self.last_fetch = time.time()
            print(f"[ConfigLoader] Loaded {len(configs) - 1} embedded configs")
            return configs

        except Exception as e:
            print(f"[ConfigLoader] CRITICAL: Failed to load embedded configs: {e}")
            return self._load_json_files()

    def _load_json_files(self) -> dict[str, Any]:
        """Load configurations from local JSON files"""
        print("[ConfigLoader] FILES: Loading from local JSON files...")
        configs = {
            "_meta": {
                "version": "1.0.0-local",
                "source": "local_files",
                "timestamp": time.time(),
            }
        }

        # Try multiple possible locations for config files
        possible_base_paths = [
            Path("."),  # Project root
            Path("site/bot-rta-dashboard/configs"),  # Dashboard configs folder
            Path("../site/bot-rta-dashboard/configs"),  # Relative from segments
        ]

        # Map of config names to file names (without path)
        # NOTE: programs_registry.json is the PRIMARY source for all program definitions
        #       programs_config.json contains process_scanner-specific settings ONLY (no programs)
        #       automation_programs.json is DEPRECATED and will be removed
        config_files = {
            "programs_registry": "programs_registry.json",  # PRIMARY: Master source for ALL programs
            "programs_config": "programs_config.json",  # Process scanner settings ONLY
            "network_config": "network_config.json",
            "screen_config": "screen_config.json",
            "behaviour_config": "behaviour_config.json",
            "vm_config": "vm_config.json",
            "obfuscation_config": "obfuscation_config.json",
            "shared_config": "shared_config.json",
            # automation_programs.json removed - use programs_registry instead
        }

        loaded_count = 0
        for name, filename in config_files.items():
            # Skip if already loaded (priority order)
            if name in configs:
                continue

            # Try each possible base path
            for base_path in possible_base_paths:
                file_path = base_path / filename
                if file_path.exists():
                    try:
                        with open(file_path, encoding="utf-8") as f:
                            configs[name] = json.load(f)
                            loaded_count += 1
                            print(f"[ConfigLoader] Loaded {name} from {file_path}")
                            break  # Found it, skip other paths
                    except Exception as e:
                        print(
                            f"[ConfigLoader] WARNING: Failed to load {name} from {file_path}: {e}"
                        )

        # Also try old segment-based paths for backward compatibility
        # NOTE: automation_programs.json removed - all programs now in programs_registry.json
        old_paths = {
            "programs_config": "segments/programs/programs_config.json",
            "network_config": "segments/network/network_config.json",
            "screen_config": "segments/screen/screen_config.json",
            "behaviour_config": "segments/behaviour/behaviour_config.json",
            "vm_config": "segments/vm/vm_config.json",
            "obfuscation_config": "segments/programs/obfuscation_config.json",
            "shared_config": "segments/shared_config.json",
        }

        for name, path in old_paths.items():
            # Only load if not already loaded from new locations
            if name not in configs:
                file_path = Path(path)
                if file_path.exists():
                    try:
                        with open(file_path, encoding="utf-8") as f:
                            configs[name] = json.load(f)
                            loaded_count += 1
                            print(f"[ConfigLoader] Loaded {name} from legacy path: {file_path}")
                    except Exception as e:
                        print(
                            f"[ConfigLoader] WARNING: Failed to load {name} from {file_path}: {e}"
                        )

        print(f"[ConfigLoader] Loaded {loaded_count}/{len(config_files)} local configs")
        self.last_fetch = time.time()
        return configs

    def _load_local_jsons(self) -> dict[str, Any]:
        """
        Load configurations based on RAM_CONFIG setting.
        
        RAM_CONFIG=y (RAM-only mode) → Use embedded configs (no disk files)
        RAM_CONFIG=n (disk cache mode) → Use local JSON files
        """
        # RAM-only mode uses embedded configs, disk mode uses local files
        if self.ram_only_mode:
            return self._load_embedded_configs()
        else:
            return self._load_json_files()

    def get(self, category: str, key: str | None = None) -> Any:
        """
        Get specific configuration value.

        Args:
            category: Config category (e.g., 'programs_registry', 'network_config', 'behaviour_config')
            key: Optional specific key within the category

        Returns:
            Configuration value or None if not found
            
        CRITICAL: This is the main entry point for all segments to get configs.
        Always returns None (not empty dict) if category not found to allow segments
        to use their own fallback defaults.
        """
        # Ensure configs are loaded (lazy initialization)
        if not self.configs:
            self.fetch_configs()

        # Handle _meta separately (it's metadata, not a config category)
        if category == "_meta":
            return self.configs.get("_meta", {})

        # Get config category
        if category in self.configs:
            config_value = self.configs[category]
            
            # Validate that it's a dict/object (not None, not a string, etc.)
            if config_value is None:
                return None
                
            if key:
                # Get specific key within category
                if isinstance(config_value, dict):
                    return config_value.get(key)
                return None
            
            return config_value

        # Category not found - return None (segments will use their fallback defaults)
        return None

    def _calculate_checksum(self, data: Any) -> str:
        """Calculate MD5 checksum for data integrity"""
        json_str = json.dumps(data, sort_keys=True)
        return hashlib.md5(json_str.encode()).hexdigest()

    def check_for_updates(self) -> bool:
        """Check if dashboard has newer configuration"""
        try:
            response = requests.get(f"{self.base_url}/configs/version", timeout=2)
            if response.status_code == 200:
                remote_data = response.json()

                # Handle new API response format
                if isinstance(remote_data, dict) and "ok" in remote_data and "data" in remote_data:
                    remote_data = remote_data["data"]

                remote_checksum = remote_data.get("checksum")

                if self.configs and "_meta" in self.configs:
                    local_checksum = self._calculate_checksum(self.configs)
                    return remote_checksum != local_checksum

                return True  # No local config, update needed
        except Exception:
            pass

        return False

    def reload(self):
        """Force reload configurations from dashboard"""
        print("[ConfigLoader] Force reloading configurations...")
        return self.fetch_configs(force=True)
    
    def cleanup(self):
        """
        Clean up ConfigLoader resources.
        
        CRITICAL: Call this when shutting down to free RAM cache.
        In RAM-only mode, this ensures configs are cleared from memory.
        """
        with self.lock:
            # Clear RAM cache
            self.configs = {}
            self.last_fetch = 0
            print("[ConfigLoader] RAM cache cleared")


# Global singleton instance
_config_loader: ConfigLoader | None = None
_cleanup_called = False  # Flag to prevent re-initialization after cleanup


def get_config_loader() -> ConfigLoader:
    """
    Get or create the global config loader instance.
    
    CRITICAL: This is a singleton - all segments share the same ConfigLoader instance.
    This ensures that configs are loaded once and cached in RAM for performance.
    
    Works in both script and .exe mode:
    - Script mode: Configs loaded from project root or dashboard
    - .exe mode: Configs loaded from dashboard or embedded/local files
    - RAM-only mode: Configs kept in RAM only (no disk cache)
    
    NOTE: Will not re-initialize after cleanup() has been called to prevent
    unnecessary re-initialization during shutdown.
    """
    global _config_loader, _cleanup_called
    
    # Prevent re-initialization after cleanup
    if _cleanup_called:
        # Return a minimal stub if cleanup was called (shouldn't happen in normal flow)
        if _config_loader is None:
            raise RuntimeError("ConfigLoader was cleaned up and cannot be re-initialized")
        return _config_loader
    
    if _config_loader is None:
        _config_loader = ConfigLoader()
        # Fetch configs immediately to ensure they're available
        try:
            _config_loader.fetch_configs()
        except Exception as e:
            print(f"[ConfigLoader] WARNING: Initial fetch failed: {e}")
            # Continue anyway - segments will use fallback defaults
    return _config_loader


def get_config(category: str, key: str | None = None) -> Any:
    """
    Convenience function to get config values.
    
    This is the main API used by all segments to get their configurations.
    
    Examples:
        # Get entire category
        behaviour_config = get_config("behaviour_config")
        programs_registry = get_config("programs_registry")
        
        # Get specific value within category
        polling = get_config("behaviour_config", "polling")
        programs = get_config("programs_registry", "programs")
    
    Returns:
        - Config dict/object if found
        - None if not found (segments should use fallback defaults)
        
    CRITICAL: All segments should handle None return values gracefully
    by using their own fallback defaults.
    
    NOTE: Returns None silently if ConfigLoader was cleaned up (during shutdown).
    """
    try:
        loader = get_config_loader()
        return loader.get(category, key)
    except RuntimeError:
        # ConfigLoader was cleaned up - return None silently (shutdown in progress)
        return None
    except Exception as e:
        # If ConfigLoader itself fails, return None
        # Segments will use their fallback defaults
        print(f"[get_config] ERROR: Failed to get {category}: {e}")
        return None


def reload_configs():
    """Force reload all configurations"""
    try:
        loader = get_config_loader()
        return loader.reload()
    except RuntimeError:
        # ConfigLoader was cleaned up - cannot reload during shutdown
        return None


def cleanup_config_loader():
    """
    Clean up ConfigLoader singleton and free RAM cache.
    
    CRITICAL: Call this when shutting down scanner to ensure no configs
    are left in RAM. Works in both script and .exe mode.
    
    After cleanup, get_config_loader() will not re-initialize to prevent
    unnecessary re-initialization during shutdown.
    """
    global _config_loader, _cleanup_called
    
    _cleanup_called = True  # Set flag to prevent re-initialization
    
    if _config_loader:
        try:
            _config_loader.cleanup()
        except Exception as e:
            print(f"[ConfigLoader] Cleanup error: {e}")
        finally:
            _config_loader = None


# Note: ConfigLoader is now initialized lazily when first requested
# This prevents auto-initialization on import which caused log spam
