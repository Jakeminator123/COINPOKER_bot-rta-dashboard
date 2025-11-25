"""
Forwarder Service
=================
Headless service that forwards detection signals to web dashboard.
"""

import os
import socket
import threading
import time

from core.api import (
    Signal,
    get_event_bus,
    get_threat_manager,
    init_report_batcher,
    init_web_forwarder,
    stop_web_forwarder,
)
from core.redis_forwarder import init_redis_forwarder, stop_redis_forwarder
from core.segment_loader import SegmentLoader
from core.system_info import get_windows_computer_name
from utils.config_loader import get_config_loader
from utils.config_reader import get_signal_token, get_web_url, read_config
from utils.network_info import format_public_ip_log, get_public_ip_info


class ForwarderService:
    """
    Headless service that:
      - initializes web-forwarder
      - loads & starts segments
      - subscribes to 'detection' and forwards unified batch reports to web
      - sends unified batch reports every 92s (includes system stats as heartbeat)
    """

    def __init__(self, config_path: str = None):
        # Load all configs from dashboard/cache/local
        print("[Forwarder] Loading configurations...")
        config_loader = get_config_loader()
        configs = config_loader.fetch_configs()

        if configs and "_meta" in configs:
            source = configs["_meta"].get("source", "unknown")
            print(f"[Forwarder] Configs loaded from: {source}")

        # Read config.txt (config_path can override default location)
        self.cfg = read_config(config_path)
        self.env = str(self.cfg.get("ENV", "TEST"))
        
        # Use Windows Computer Name (can contain spaces like "Jakobs dator")
        try:
            self.host = get_windows_computer_name()
        except Exception:
            self.host = socket.gethostname()

        # Check admin privileges (for logging)
        try:
            from utils.admin_check import get_admin_status_message, is_admin

            self.is_admin = is_admin()
            if self.is_admin:
                print(f"[Forwarder] {get_admin_status_message()}")
        except Exception:
            self.is_admin = False
        # Get local IP address for device_ip
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            self.local_ip = s.getsockname()[0]
            s.close()
        except Exception:
            self.local_ip = "127.0.0.1"

        self.public_ip_info = get_public_ip_info()
        self.device_ip = self.public_ip_info.get("ip") or self.local_ip
        log_msg = format_public_ip_log(self.public_ip_info)
        print(f"[Forwarder] {log_msg}")

        # Optional bearer token for dashboard API auth
        self.signal_token = get_signal_token(self.cfg)

        # Determine web URL based on ENV
        self.web_url = get_web_url(self.env, self.cfg)
        print(f"[Forwarder] Environment: {self.env}, Web URL: {self.web_url}")

        # Initialize unified report batcher with config interval (uses BATCH_INTERVAL_HEAVY)
        try:
            self.batch_interval = float(self.cfg.get("BATCH_INTERVAL_HEAVY", 92))
        except (TypeError, ValueError):
            self.batch_interval = 92.0
        self.report_batcher = init_report_batcher(self.batch_interval)

        # Forwarder mode: auto|web|redis|panel (default: auto)
        self.mode = os.getenv("FORWARDER_MODE", self.cfg.get("FORWARDER_MODE", "auto")).lower()

        self.event_bus = get_event_bus()

        redis_url = self.cfg.get("REDIS_URL")
        redis_ttl = self.cfg.get("REDIS_TTL_SECONDS")
        try:
            redis_ttl = int(redis_ttl) if redis_ttl else None
        except (TypeError, ValueError):
            redis_ttl = None

        self.redis_forwarder = None
        self.web_forwarder = None

        if self.mode == "redis":
            if not self._start_redis_forwarder(redis_url, redis_ttl):
                print("[Forwarder] Redis mode requested but RedisForwarder could not start - falling back to WebForwarder")
                self._start_web_forwarder()
        elif self.mode == "web":
            self._start_web_forwarder()
        elif self.mode == "auto":
            if not self._start_redis_forwarder(redis_url, redis_ttl):
                self._start_web_forwarder()
        else:
            print(f"[Forwarder] Unknown FORWARDER_MODE '{self.mode}', defaulting to web")
            self._start_web_forwarder()

        self.loader = SegmentLoader()
        self._stop_event = threading.Event()
        self._batch_thread: threading.Thread | None = None
        self._stopped = False  # Flag to prevent double shutdown

    def _start_redis_forwarder(self, redis_url: str | None, redis_ttl: int | None) -> bool:
        if not redis_url:
            return False
        try:
            self.redis_forwarder = init_redis_forwarder(redis_url, redis_ttl, self.event_bus)
            if self.redis_forwarder:
                print("[Forwarder] RedisForwarder: ENABLED (direct to Redis, bypasses HTTP API)")
                return True
            print("[Forwarder] RedisForwarder could not be started (check REDIS_URL/credentials)")
        except ImportError:
            print("[Forwarder] WARNING: redis library not installed. RedisForwarder disabled.")
        except Exception as e:
            print(f"[Forwarder] ERROR: RedisForwarder init failed: {e}")
        self.redis_forwarder = None
        return False

    def _start_web_forwarder(self):
        self.web_forwarder = init_web_forwarder()
        if self.web_forwarder and self.web_forwarder.enabled:
            print(f"[Forwarder] WebForwarder: ENABLED -> {self.web_forwarder.url}")
        else:
            print("[Forwarder] WebForwarder: DISABLED (check config.txt for WEB=y)")
            self.web_forwarder = None

    # ---- lifecycle ----
    def start(self, segments_base_dir: str = None) -> None:
        """Start the forwarder service."""
        print(f"[Forwarder] Starting in ENV={self.env} on host={self.host} mode={self.mode}")

        # Check WebForwarder health in auto mode
        if self.mode == "auto" and self.web_forwarder and not self._web_healthy():
            print("[Forwarder] WebForwarder unhealthy -> switching to PANEL HTTP")
            try:
                stop_web_forwarder()
            except Exception:
                pass
            self.web_forwarder = None

        self.loader.load_segments(segments_base_dir)
        loaded_count = len(self.loader.segment_classes)
        print(f"[Forwarder] Loaded {loaded_count} segment class(es)")
        
        self.loader.start_all(batch_interval=self.batch_interval)
        started_count = len(self.loader.segments)
        print(f"[Forwarder] Started {started_count} segment instance(s)")

        # subscribe to detection
        self.event_bus.subscribe("detection", self._on_detection)
        print("[Forwarder] Subscribed to 'detection' events")

        # Start batch report thread (runs independently of heartbeat)
        if self.report_batcher:
            self._batch_thread = threading.Thread(target=self._batch_loop, daemon=True)
            self._batch_thread.start()
            print(f"[Forwarder] Unified batch report thread started (interval={self.batch_interval}s)")

        # Heartbeats are now handled by batch reports (system stats included in batch reports)
        print("[Forwarder] Ready. Listening for 'detection' signals... (Ctrl+C to exit)")
        print(f"[Forwarder] Unified batch reports: interval={self.batch_interval}s")
        
        # Debug: Show forwarder status
        if self.redis_forwarder:
            if self.redis_forwarder.enabled:
                print(f"[Forwarder] RedisForwarder: ENABLED (direct to Redis, bypasses HTTP API)")
            else:
                print("[Forwarder] RedisForwarder: DISABLED")
        elif self.web_forwarder:
            if self.web_forwarder.enabled:
                print(f"[Forwarder] WebForwarder: ENABLED -> {self.web_forwarder.url}")
            else:
                print("[Forwarder] WebForwarder: DISABLED (check config.txt for WEB=y)")
        else:
            print("[Forwarder] No forwarder initialized (check config.txt for REDIS_URL or WEB=y)")

    def stop(self) -> None:
        """Idempotent shutdown - only run once."""
        if self._stopped:
            return
        self._stopped = True

        print("[Forwarder] Shutting down...")
        
        # Set stop event FIRST to prevent new signals from being processed
        self._stop_event.set()
        
        # Give a brief moment for any in-flight signals to complete
        # This prevents race conditions where signals are emitted during shutdown
        time.sleep(0.1)
        
        try:
            # Stop all detection segments FIRST to prevent new signals
            # This must happen before unsubscribing from event bus
            if self.loader:
                self.loader.stop_all()
        except Exception as e:
            print(f"[Forwarder] Error stopping segments: {e}")
        
        # Wait for threads to stop (they're daemon threads, will stop automatically)
        try:
            if self._batch_thread and self._batch_thread.is_alive():
                self._batch_thread.join(timeout=2.0)  # Increased timeout
        except Exception:
            pass
        
        # Stop WebForwarder/RedisForwarder and cleanup
        try:
            stop_web_forwarder()
        except Exception:
            pass
        
        try:
            if self.redis_forwarder:
                stop_redis_forwarder()
        except Exception:
            pass
        
        # Clear references to help GC
        self.loader = None
        self.web_forwarder = None
        self.redis_forwarder = None
        self.report_batcher = None
        self.event_bus = None
        
        print("[Forwarder] Shutdown complete.")

    # ---- event handling ----
    def _on_detection(self, sig: Signal) -> None:
        """
        Handle detection signals from segments.
        
        Only batch reports are sent to dashboard. Individual signals are collected
        in ReportBatcher and sent as batch reports at configured intervals.
        """
        # Ignore signals after shutdown
        if self._stopped:
            return
        
        try:
            # Debug logging (only in DEV mode or when INPUT_DEBUG=1)
            debug_mode = self.cfg.get("INPUT_DEBUG", "0") == "1" or self.env == "DEV"
            if debug_mode:
                print(f"[Forwarder] Detection received: {sig.category}/{sig.name} ({sig.status})")
            
            # Skip batching for system signals (batch reports themselves)
            # Batch reports are handled by WebForwarder directly via filtered subscription
            if sig.category == "system":
                return

            # Add regular detections to batch (always, if batcher exists)
            if self.report_batcher and not self._stopped:
                self.report_batcher.add_signal(sig)
                # Signal added to batch - will be sent in next batch report
                if debug_mode:
                    print("[Forwarder] Signal added to batch (batcher active)")
                return

            # No batcher available - log warning but don't send individual signals
            if debug_mode:
                print("[Forwarder] WARNING: No batcher available - signal discarded")
        except Exception as e:
            # Never break event chain
            print(f"[Forwarder] ERROR: Detection handler error: {e}")
            import traceback
            traceback.print_exc()

    # ---- helpers ----
    def _web_healthy(self) -> bool:
        """Check if WebForwarder is healthy."""
        try:
            fn = getattr(self.web_forwarder, "is_healthy", None)
            return bool(fn()) if callable(fn) else True
        except Exception:
            return False

    # ---- batch reports ----
    def _batch_loop(self) -> None:
        """Dedicated thread for checking and sending batch reports at correct intervals."""
        threat_manager = get_threat_manager()
        check_interval = 5.0  # Check every 5 seconds (more frequent than any batch interval)
        
        while not self._stop_event.is_set() and not self._stopped:
            try:
                if self.report_batcher and not self._stopped:
                    # Collect system info for batch reports
                    # Use Windows Computer Name for host (can contain spaces like "Jakobs dator")
                    host_name = self.host
                    try:
                        host_name = get_windows_computer_name()
                    except Exception:
                        pass  # Use self.host as fallback
                    
                    system_info = {
                        "segments_running": len(self.loader.segments) if self.loader else 0,
                        "env": self.env,
                        "host": host_name,  # Windows Computer Name (preserves spaces)
                        "device_ip": self.device_ip,  # Public IP address for identification
                        "local_ip": self.local_ip,  # Alias for device_ip
                        "public_ip_info": self.public_ip_info,
                    }
                    # Add CPU/RAM if psutil is available
                    try:
                        import psutil
                        system_info["cpu_percent"] = float(psutil.cpu_percent(interval=0.1))
                        system_info["mem_used_percent"] = float(psutil.virtual_memory().percent)
                    except Exception:
                        pass
                    
                    # Prepare segments info for metadata generation
                    segments_info = None
                    if self.loader and self.loader.segments:
                        segments_info = self.loader.segments
                    
                    self.report_batcher.maybe_send_batches(threat_manager, system_info, segments_info=segments_info)
                
                # Sleep with interruptible wait
                if self._stop_event.wait(timeout=check_interval):
                    break  # Stop event was set
            except Exception as e:
                print(f"[Forwarder] ERROR: Batch loop error: {e}")
                import traceback
                traceback.print_exc()
                # Continue loop even on error
                if self._stop_event.wait(timeout=1.0):
                    break

