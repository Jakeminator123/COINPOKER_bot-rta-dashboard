"""
Signal Logger
=============
Logs all signals sent to dashboard, how they're processed, and how they're stored in Redis.

This script helps debug signal flow and identify duplicate or missing signals.
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

# Global logger instance
_logger_instance: Optional["SignalLogger"] = None


class SignalLogger:
    """Logs signal flow from detector to dashboard and Redis."""

    def __init__(self, log_dir: Optional[str] = None):
        """Initialize signal logger."""
        if log_dir is None:
            # Use same directory as scanner.py
            if getattr(__import__("sys"), "frozen", False):
                # Running as .exe
                log_dir = os.path.dirname(__import__("sys").executable)
            else:
                # Running as script
                log_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(exist_ok=True)

        # Log file: signal_flow_YYYYMMDD.log
        today = datetime.now().strftime("%Y%m%d")
        self.log_file = self.log_dir / f"signal_flow_{today}.log"

        # Statistics
        self.stats = {
            "total_signals": 0,
            "by_category": {},
            "by_name": {},
            "by_status": {},
            "batch_reports": 0,
            "heartbeats": 0,
            "scanner_events": 0,
            "duplicates": 0,
            "redis_writes": 0,
            "dashboard_sends": 0,
        }

        # Track signal IDs to detect duplicates
        self._seen_signals: Dict[str, float] = {}

        # Write header
        self._write_header()

    def _write_header(self):
        """Write log file header."""
        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write("\n" + "=" * 80 + "\n")
            f.write(f"Signal Flow Log - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write("=" * 80 + "\n\n")

    def _log(self, level: str, message: str, data: Optional[Dict[str, Any]] = None):
        """Write log entry."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        log_entry = {
            "timestamp": timestamp,
            "level": level,
            "message": message,
        }
        if data:
            log_entry["data"] = data

        # Write to file
        try:
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry) + "\n")
        except Exception as e:
            print(f"[SignalLogger] Failed to write log: {e}")

    def log_signal_created(
        self,
        category: str,
        name: str,
        status: str,
        device_id: Optional[str] = None,
        details: Optional[str] = None,
    ):
        """Log when a signal is created (from segment or system)."""
        self.stats["total_signals"] += 1
        self.stats["by_category"][category] = self.stats["by_category"].get(category, 0) + 1
        self.stats["by_name"][name] = self.stats["by_name"].get(name, 0) + 1
        self.stats["by_status"][status] = self.stats["by_status"].get(status, 0) + 1

        # Track batch reports and special signals
        if category == "system":
            if "Scan Report" in name:
                self.stats["batch_reports"] += 1
            elif "Heartbeat" in name:
                self.stats["heartbeats"] += 1
            elif "Scanner" in name:
                self.stats["scanner_events"] += 1

        # Create signal ID for duplicate detection
        signal_id = f"{category}:{name}:{device_id or 'unknown'}"
        if signal_id in self._seen_signals:
            self.stats["duplicates"] += 1
            self._log(
                "WARN",
                f"Duplicate signal detected: {signal_id}",
                {
                    "category": category,
                    "name": name,
                    "status": status,
                    "device_id": device_id,
                    "time_since_last": time.time() - self._seen_signals[signal_id],
                },
            )
        else:
            self._seen_signals[signal_id] = time.time()

        self._log(
            "INFO",
            f"Signal created: {category}/{name}",
            {
                "category": category,
                "name": name,
                "status": status,
                "device_id": device_id,
                "details_preview": (details or "")[:100] if details else None,
            },
        )

    def log_event_bus_emit(self, signal_name: str, category: str):
        """Log when signal is emitted to event bus."""
        self._log(
            "DEBUG",
            f"Event bus emit: {category}/{signal_name}",
            {"category": category, "name": signal_name},
        )

    def log_webforwarder_receive(self, signal_name: str, category: str, device_id: Optional[str] = None):
        """Log when WebForwarder receives a signal."""
        self._log(
            "DEBUG",
            f"WebForwarder received: {category}/{signal_name}",
            {"category": category, "name": signal_name, "device_id": device_id},
        )

    def log_webforwarder_send(
        self,
        signal_count: int,
        url: str,
        success: bool,
        error: Optional[str] = None,
    ):
        """Log when WebForwarder sends signals to dashboard."""
        self.stats["dashboard_sends"] += 1
        self._log(
            "INFO" if success else "ERROR",
            f"WebForwarder send: {signal_count} signal(s) to {url}",
            {
                "signal_count": signal_count,
                "url": url,
                "success": success,
                "error": error,
            },
        )

    def log_http_fallback_send(
        self,
        signal_name: str,
        url: str,
        success: bool,
        error: Optional[str] = None,
    ):
        """Log when HTTP fallback sends a signal."""
        self.stats["dashboard_sends"] += 1
        self._log(
            "INFO" if success else "ERROR",
            f"HTTP fallback send: {signal_name} to {url}",
            {
                "name": signal_name,
                "url": url,
                "success": success,
                "error": error,
            },
        )

    def log_redis_write(
        self,
        operation: str,
        key: str,
        device_id: Optional[str] = None,
        signal_name: Optional[str] = None,
    ):
        """Log when data is written to Redis."""
        self.stats["redis_writes"] += 1
        self._log(
            "DEBUG",
            f"Redis write: {operation}",
            {
                "operation": operation,
                "key": key,
                "device_id": device_id,
                "signal_name": signal_name,
            },
        )

    def log_api_receive(
        self,
        signal_count: int,
        device_id: Optional[str] = None,
        is_batch: bool = False,
    ):
        """Log when API endpoint receives signals."""
        self._log(
            "INFO",
            f"API received: {signal_count} signal(s)",
            {
                "signal_count": signal_count,
                "device_id": device_id,
                "is_batch": is_batch,
            },
        )

    def log_api_process(
        self,
        signal_name: str,
        category: str,
        operation: str,
        device_id: Optional[str] = None,
    ):
        """Log when API processes a signal (normalize, addSignal, etc.)."""
        self._log(
            "DEBUG",
            f"API process: {operation} - {category}/{signal_name}",
            {
                "operation": operation,
                "category": category,
                "name": signal_name,
                "device_id": device_id,
            },
        )

    def log_player_summary_update(
        self,
        device_id: str,
        batch_number: Optional[int] = None,
        bot_probability: Optional[float] = None,
    ):
        """Log when player summary is updated in Redis."""
        self._log(
            "INFO",
            f"Player summary updated: {device_id}",
            {
                "device_id": device_id,
                "batch_number": batch_number,
                "bot_probability": bot_probability,
            },
        )

    def log_stats(self):
        """Log current statistics."""
        self._log(
            "STATS",
            "Signal flow statistics",
            {
                "stats": self.stats,
                "log_file": str(self.log_file),
            },
        )

    def get_stats(self) -> Dict[str, Any]:
        """Get current statistics."""
        return self.stats.copy()


def get_signal_logger() -> SignalLogger:
    """Get global signal logger instance."""
    global _logger_instance
    if _logger_instance is None:
        _logger_instance = SignalLogger()
    return _logger_instance


def log_signal_created(
    category: str,
    name: str,
    status: str,
    device_id: Optional[str] = None,
    details: Optional[str] = None,
):
    """Convenience function to log signal creation."""
    try:
        logger = get_signal_logger()
        logger.log_signal_created(category, name, status, device_id, details)
    except Exception:
        pass  # Don't break signal flow if logging fails

