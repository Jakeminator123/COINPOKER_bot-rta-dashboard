"""Web forwarder that ships batches to the dashboard HTTP API."""

from __future__ import annotations

import hashlib
import json
import os
import threading

from core.models import Signal
from core.system_info import get_windows_computer_name


class WebForwarder:
    """Forwards batch reports to the dashboard HTTP API."""

    def __init__(self):
        self.enabled = False
        self.url = "http://localhost:3001/api/signal"
        self.token = "detector-secret-token-2024"  # Match .env.local in dashboard
        self.buffer: list[Signal] = []
        self.buffer_lock = threading.Lock()
        self.thread = None
        self.running = False
        self._stop_event = threading.Event()  # Event for interruptible sleep
        self.interval_s = 1.0  # Send immediately (1s check interval)
        self.timeout = 10.0  # HTTP request timeout

        computer_name = get_windows_computer_name()
        self.device_id = hashlib.md5(computer_name.encode()).hexdigest()
        self.device_name = computer_name

        self._load_config()

        if self.enabled:
            print(f"[WebForwarder] Enabled - forwarding to {self.url} every {self.interval_s}s")
            self.start()
        else:
            print(
                "[WebForwarder] Disabled (WEB=y not found in config.txt) - batches will only be saved locally if NEW_BATCHES_LOG=y"
            )

    def _load_config(self):
        """Load config.txt for WEB-forwarding settings."""
        try:
            config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.txt")
            if not os.path.exists(config_path):
                return

            env = "PROD"
            web_url_prod = None
            web_url_dev = None

            with open(config_path, encoding="utf-8") as f:
                for raw_line in f:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    key = key.strip().upper()
                    value = value.strip()

                    if "#" in value:
                        value = value.split("#")[0].strip()

                    if key == "ENV":
                        env = value.upper()
                    elif key == "WEB":
                        self.enabled = value.lower() in ("y", "yes", "true", "1")
                    elif key == "WEB_URL_PROD":
                        web_url_prod = value
                    elif key == "WEB_URL_DEV":
                        web_url_dev = value
                    elif key == "WEB_URL" and value:
                        web_url_prod = value
                    elif key == "WEB_FORWARDER_TIMEOUT" and value:
                        try:
                            self.timeout = float(value)
                        except ValueError:
                            pass
                    elif key == "WEB_PORT" and value:
                        try:
                            import urllib.parse

                            u = urllib.parse.urlparse(self.url)
                            new_netloc = f"{u.hostname}:{int(value)}"
                            self.url = urllib.parse.urlunparse(
                                (u.scheme, new_netloc, u.path, u.params, u.query, u.fragment)
                            )
                        except Exception:
                            pass
                    elif key == "SIGNAL_TOKEN" and value:
                        self.token = value

            if env == "DEV" and web_url_dev:
                self.url = web_url_dev
            elif env == "PROD" and web_url_prod:
                self.url = web_url_prod
            else:
                self.url = web_url_prod or web_url_dev or "http://localhost:3001/api/signal"

            print(f"[WebForwarder] Environment: {env}, URL: {self.url}")

        except Exception as e:
            print(f"[WebForwarder] Config read error: {e}")
            self.enabled = False

    def on_signal(self, signal: Signal):
        """Callback when a batch signal is emitted."""
        if not self.enabled:
            return

        if signal.category == "system" and "Scan Report" in signal.name:
            print(
                f"[WebForwarder] Received batch report: device_id={signal.device_id}, device_name={signal.device_name}, has_details={bool(signal.details)}"
            )

        try:
            from utils.signal_logger import get_signal_logger

            logger = get_signal_logger()
            logger.log_webforwarder_receive(signal.name, signal.category, signal.device_id)
        except Exception:
            pass

        with self.buffer_lock:
            self.buffer.append(signal)
            if len(self.buffer) > 200:
                self.buffer.pop(0)

    def start(self):
        if not self.enabled or self.running:
            return

        self.running = True
        self.thread = threading.Thread(target=self._forward_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        self._stop_event.set()
        if self.thread:
            self.thread.join(timeout=1.0)

    def cleanup(self):
        self.stop()
        with self.buffer_lock:
            self.buffer.clear()

    def _forward_loop(self):
        try:
            import requests
        except ImportError:
            print("[WebForwarder] requests library not installed. Run: pip install requests")
            self.enabled = False
            return

        while self.running:
            if self._stop_event.wait(timeout=self.interval_s):
                break

            if not self.running:
                break

            with self.buffer_lock:
                if not self.buffer:
                    continue
                signals_to_send = list(self.buffer)
                self.buffer.clear()

            try:
                if not self.running:
                    break
                payload = [
                    {
                        "timestamp": int(sig.timestamp),
                        "category": sig.category,
                        "name": sig.name,
                        "status": sig.status,
                        "details": sig.details or "",
                        "device_id": sig.device_id or self.device_id,
                        "device_name": sig.device_name or self.device_name,
                        "device_ip": sig.device_ip,
                        "segment_name": sig.segment_name,
                    }
                    for sig in signals_to_send
                ]

                headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

                import sys

                if getattr(sys, "frozen", False):
                    try:
                        import certifi

                        if hasattr(sys, "_MEIPASS"):
                            ca_bundle_path = os.path.join(sys._MEIPASS, "certifi", "cacert.pem")
                            if os.path.exists(ca_bundle_path):
                                os.environ["SSL_CERT_FILE"] = ca_bundle_path
                                os.environ["REQUESTS_CA_BUNDLE"] = ca_bundle_path
                            else:
                                ca_bundle_path = certifi.where()
                                if os.path.exists(ca_bundle_path):
                                    os.environ["SSL_CERT_FILE"] = ca_bundle_path
                                    os.environ["REQUESTS_CA_BUNDLE"] = ca_bundle_path
                    except Exception:
                        pass

                response = requests.post(self.url, json=payload, headers=headers, timeout=self.timeout)
                success = response.status_code == 200

                try:
                    from utils.signal_logger import get_signal_logger

                    logger = get_signal_logger()
                    logger.log_webforwarder_send(
                        len(signals_to_send),
                        self.url,
                        success,
                        None if success else f"HTTP {response.status_code}",
                    )
                except Exception:
                    pass

                if not success:
                    print(f"[WebForwarder] Dashboard returned status {response.status_code}")

            except requests.exceptions.ConnectionError:
                if not hasattr(self, "_connection_error_shown"):
                    print("[WebForwarder] Dashboard not reachable (localhost:3001)")
                    self._connection_error_shown = True
                try:
                    from utils.signal_logger import get_signal_logger

                    logger = get_signal_logger()
                    logger.log_webforwarder_send(
                        len(signals_to_send),
                        self.url,
                        False,
                        "ConnectionError",
                    )
                except Exception:
                    pass
            except Exception as e:
                print(f"[WebForwarder] Send error: {e}")
                try:
                    from utils.signal_logger import get_signal_logger

                    logger = get_signal_logger()
                    logger.log_webforwarder_send(
                        len(signals_to_send),
                        self.url,
                        False,
                        str(e),
                    )
                except Exception:
                    pass


_web_forwarder: WebForwarder | None = None


def init_web_forwarder(event_bus) -> WebForwarder | None:
    """Initialize web forwarder and subscribe to event bus (only batch reports)."""
    global _web_forwarder
    if _web_forwarder is None:
        _web_forwarder = WebForwarder()
        if _web_forwarder.enabled:
            def _on_batch_report(signal: Signal):
                if signal.category == "system" and "Scan Report" in signal.name:
                    _web_forwarder.on_signal(signal)

            event_bus.subscribe("detection", _on_batch_report)
    return _web_forwarder


def stop_web_forwarder():
    """Stop web forwarder if running."""
    global _web_forwarder
    if _web_forwarder:
        _web_forwarder.stop()

