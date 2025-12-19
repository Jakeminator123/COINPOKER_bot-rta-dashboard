# panel.py
"""
Headless Forwarder
------------------
Main entry point for the bot detection system.
Loads all segments, subscribes to 'detection' signals and forwards them
to the web dashboard. No GUI - pure service/daemon in console.

This is a thin wrapper around core.forwarder.ForwarderService.
"""

import os
import sys
import signal as os_signal

# Add project root to sys.path for imports
sys.path.insert(0, os.path.dirname(__file__))

# Import service from core
from core.forwarder import ForwarderService


# =========================
# Entrypoint
# =========================
def _install_sig_handlers(service: ForwarderService) -> None:
    """Install signal handlers for graceful shutdown."""
    def _graceful(_signo, _frame):
        # Idempotent shutdown
        try:
            service.stop()
        finally:
            os._exit(0)

    for sig in (
        os_signal.SIGINT,
        os_signal.SIGTERM,
        getattr(os_signal, "SIGBREAK", None),
    ):
        if sig is not None:
            try:
                os_signal.signal(sig, _graceful)
            except Exception:
                pass


if __name__ == "__main__":
    import time

    print("Starting Headless Forwarder")
    print("-" * 50)

    # Get segments directory path
    segments_dir = os.path.join(os.path.dirname(__file__), "segments")

    service = ForwarderService()
    _install_sig_handlers(service)
    service.start(segments_base_dir=segments_dir)

    # Keep process alive with simple loop
    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        pass
    finally:
        # Only call stop if not already stopped by signal handler
        if not service._stopped:
            service.stop()
