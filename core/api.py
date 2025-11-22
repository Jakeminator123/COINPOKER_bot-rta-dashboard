# core/api.py
"""
Core API for the bot detection system.
Provides EventBus for inter-segment communication and BaseSegment class.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import socket
import threading
import time
from collections.abc import Callable

from core.device_identity import resolve_device_name
from core.models import ActiveThreat, Signal
from core.system_info import get_windows_computer_name
from core.web_forwarder import init_web_forwarder as _web_forwarder_init
from core.web_forwarder import stop_web_forwarder as _web_forwarder_stop


class EventBus:
    """Simple event bus for segment communication"""

    def __init__(self):
        self._listeners: dict[str, list[Callable]] = {}
        self._lock = threading.Lock()
        self._history: list[Signal] = []
        self._max_history = 1000

    def subscribe(self, event_type: str, callback: Callable):
        """Subscribe to an event type"""
        with self._lock:
            if event_type not in self._listeners:
                self._listeners[event_type] = []
            self._listeners[event_type].append(callback)

    def emit(self, event_type: str, signal: Signal):
        """Emit an event to all listeners"""
        with self._lock:
            # Store in history
            self._history.append(signal)
            if len(self._history) > self._max_history:
                self._history.pop(0)

            # Notify listeners
            listeners = self._listeners.get(event_type, [])
            for listener in listeners:
                try:
                    listener(signal)
                except Exception as e:
                    print(f"Error in listener: {e}")

    def get_history(self, category: str = None, limit: int = 100) -> list[Signal]:
        """Get signal history, optionally filtered by category"""
        with self._lock:
            history = self._history[-limit:]
            if category:
                history = [s for s in history if s.category == category]
            return history
    
    def cleanup(self):
        """Clean up EventBus resources (clear listeners and history)"""
        with self._lock:
            self._listeners.clear()
            self._history.clear()


class ReportBatcher:
    """Batches all detection signals into unified batch reports (every 92s)"""

    def __init__(self, batch_interval: float = 92.0):
        self._batch_interval = batch_interval

        # Unified detection storage (all categories together)
        self._all_detections: list[Signal] = []

        # Timing
        self._last_batch = time.time()
        self._batch_count = 0

        # Batch logging (if enabled in config)
        self._log_batches = False
        self._log_dir = None
        self._max_log_files = 20
        
        # Testing JSON metadata (if enabled in config)
        self._testing_json = False
        
        self._init_batch_logging()
    
    def _init_batch_logging(self):
        """Initialize batch logging if NEW_BATCHES_LOG=y in config, and testing_json if TESTING_JSON=y"""
        try:
            import os
            config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.txt")
            if os.path.exists(config_path):
                with open(config_path, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        
                        key, value = line.split("=", 1)
                        key = key.strip().upper()
                        value = value.strip().upper()
                        
                        # Remove inline comments
                        if "#" in value:
                            value = value.split("#")[0].strip()
                        
                        if key == "NEW_BATCHES_LOG" and value == "Y":
                            self._log_batches = True
                            # Log directory: check if BATCH_LOG_DIR is set, otherwise use batch_logs
                            scanner_dir = os.path.dirname(os.path.dirname(__file__))
                            # Check for custom log directory in config
                            log_dir_name = "batch_logs"  # default
                            try:
                                # Re-read config to get BATCH_LOG_DIR if set
                                with open(config_path, encoding="utf-8") as f2:
                                    for line2 in f2:
                                        line2 = line2.strip()
                                        if line2.startswith("BATCH_LOG_DIR="):
                                            log_dir_name = line2.split("=", 1)[1].strip()
                                            # Remove inline comments
                                            if "#" in log_dir_name:
                                                log_dir_name = log_dir_name.split("#")[0].strip()
                                            break
                            except Exception:
                                pass
                            self._log_dir = os.path.join(scanner_dir, log_dir_name)
                            os.makedirs(self._log_dir, exist_ok=True)
                            print(f"[ReportBatcher] Batch logging enabled: {self._log_dir}")
                        elif key == "TESTING_JSON" and value == "Y":
                            self._testing_json = True
                            print("[ReportBatcher] Testing JSON metadata enabled")
        except Exception as e:
            print(f"[ReportBatcher] Error initializing batch logging: {e}")
    
    def _cleanup_old_logs(self):
        """Keep only the most recent N log files"""
        if not self._log_batches or not self._log_dir:
            return
        
        try:
            import os
            import glob
            
            log_files = glob.glob(os.path.join(self._log_dir, "batch_*.json"))
            if len(log_files) > self._max_log_files:
                # Sort by modification time, oldest first
                log_files.sort(key=lambda f: os.path.getmtime(f))
                # Remove oldest files
                for f in log_files[:-self._max_log_files]:
                    try:
                        os.remove(f)
                    except Exception:
                        pass
        except Exception:
            pass
    
    def _log_batch(self, batch_data: dict):
        """Log batch report to file if enabled"""
        if not self._log_batches or not self._log_dir:
            return
        
        try:
            import os
            import json
            from datetime import datetime
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"batch_{timestamp}_{self._batch_count}.json"
            filepath = os.path.join(self._log_dir, filename)
            
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(batch_data, f, indent=2, ensure_ascii=False)
            
            # Cleanup old logs
            self._cleanup_old_logs()
        except Exception as e:
            print(f"[ReportBatcher] Error logging batch: {e}")
    
    def cleanup(self):
        """Clean up ReportBatcher resources (clear all buffers)"""
        self._all_detections.clear()
        self._batch_count = 0

    def add_signal(self, signal: Signal):
        """Add signal to unified batch (all categories together)"""
        self._all_detections.append(signal)

    def maybe_send_batches(self, threat_manager, system_info=None, segments_info=None) -> None:
        """Check if it's time to send unified batch report"""
        now = time.time()

        # Unified batch (every configured interval, default 92s)
        if now - self._last_batch >= self._batch_interval:
            window_start = self._last_batch or (now - self._batch_interval)
            self._send_batch(threat_manager, system_info, window_start=window_start, segments_info=segments_info)
            self._last_batch = now
            self._batch_count += 1

    def _generate_metadata(self, segments_info=None, system_info=None) -> dict:
        """Generate metadata JSON explaining system flow, segments, timing, and configuration"""
        import os
        from utils.runtime_flags import sync_segments_enabled
        
        # Flow explanation
        flow_steps = [
            "Segments detect threats and call post_signal()",
            "Signals are emitted to EventBus",
            "ReportBatcher collects signals in memory",
            f"Every {self._batch_interval}s, ReportBatcher creates unified batch report",
            "Batch report is sent via WebForwarder to Dashboard API"
        ]
        
        # Get active segments info
        segments_list = []
        if segments_info:
            for segment_name, segment_instance in segments_info.items():
                try:
                    segment_data = {
                        "name": getattr(segment_instance, "name", segment_name.split(".")[-1]),
                        "category": getattr(segment_instance, "category", "unknown"),
                        "interval": getattr(segment_instance, "interval_s", 0.0),
                        "status": "running" if getattr(segment_instance, "_running", False) else "stopped"
                    }
                    segments_list.append(segment_data)
                except Exception:
                    pass
        
        # Get timing info
        sync_segments = sync_segments_enabled()
        timing_info = {
            "batch_interval": self._batch_interval,
            "sync_segments": sync_segments
        }
        
        # Get configuration info
        config_info = {
            "env": system_info.get("env", "PROD") if system_info else "PROD",
            "web_enabled": False,  # Will be updated if WebForwarder is available
            "testing_json": self._testing_json
        }
        
        # Try to get web_enabled status from WebForwarder
        global _web_forwarder
        if _web_forwarder:
            config_info["web_enabled"] = _web_forwarder.enabled
        
        # Read segment intervals from config.txt
        segment_intervals = {}
        try:
            config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.txt")
            if os.path.exists(config_path):
                with open(config_path, encoding="utf-8") as f:
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
                        
                        # Map config keys to segment categories
                        if key in ["PROGRAMS", "AUTO", "NETWORK", "BEHAVIOUR", "BEHAVIUOUR", "VM", "SCREEN"]:
                            try:
                                segment_intervals[key.lower()] = float(value)
                            except ValueError:
                                pass
        except Exception:
            pass
        
        timing_info["segment_intervals"] = segment_intervals
        
        # System state
        system_state = {
            "segments_running": len(segments_list) if segments_list else 0,
            "batch_count": self._batch_count
        }
        if system_info:
            system_state.update({
                "cpu_percent": system_info.get("cpu_percent", 0.0),
                "mem_used_percent": system_info.get("mem_used_percent", 0.0),
                "host": system_info.get("host", "unknown")
            })
        
        metadata = {
            "flow": {
                "description": "Signal flow through the bot detection system",
                "steps": flow_steps
            },
            "segments": segments_list,
            "timing": timing_info,
            "configuration": config_info,
            "system_state": system_state
        }
        
        return metadata

    def _send_batch(self, threat_manager, system_info=None, window_start: float | None = None, segments_info=None):
        """Send unified batch report with all detections (all categories together)"""
        # Always send batch report, even if empty (for heartbeat functionality)
        detection_count = len(self._all_detections)
        if detection_count > 0:
            print(f"[ReportBatcher] Sending unified batch: {detection_count} detections")
        else:
            print("[ReportBatcher] Sending empty unified batch (heartbeat)")

        # Get current threat summary from ThreatManager
        summary = threat_manager.get_threat_summary(window_start=window_start)

        # Build detailed detection list with segment info and scores (deduplicated display, raw metadata kept)
        detections_map: dict[tuple, dict] = {}
        threat_counts = {"critical": 0, "alert": 0, "warn": 0, "info": 0}
        threat_details = summary.get("threat_details", []) or []
        threat_detail_map = {
            detail["threat_id"]: detail
            for detail in threat_details
            if isinstance(detail, dict) and detail.get("threat_id")
        }

        # Collect nickname from system signals before filtering them out
        detected_nickname_from_batch = None
        if self._all_detections:
            for sig in self._all_detections:
                if sig.category == "system" and sig.name == "Player Name Detected" and sig.details:
                    try:
                        import json
                        details_json = json.loads(sig.details)
                        detected_nickname_from_batch = details_json.get("player_name")
                        if detected_nickname_from_batch:
                            break
                    except Exception:
                        pass

        if self._all_detections:
            for sig in self._all_detections:
                if sig.category == "system":
                    # Unified batch reports and system events shouldn't be double-counted here
                    # But we've already extracted nickname above
                    continue

                # Get threat level and points
                threat_level = threat_manager._get_threat_level(sig) or "INFO"  # CRITICAL/ALERT/WARN/INFO
                threat_points = threat_manager._threat_points.get(threat_level, 0)

                # Skip INFO signals (0 points)
                if threat_points == 0:
                    continue

                segment_name = self._guess_segment_name(sig)
                try:
                    process_id = threat_manager._extract_process_identifier(sig)
                except Exception:
                    process_id = None
                details = sig.details or ""
                category = sig.category or "unknown"
                name = sig.name or "Unknown Detection"
                key = (category, name, details, segment_name)

                if key in detections_map:
                    existing = detections_map[key]
                    existing["occurrences"] += 1
                    if sig.timestamp and sig.timestamp < existing["first_detected"]:
                        existing["first_detected"] = sig.timestamp
                    if process_id and not existing.get("threat_id"):
                        existing["threat_id"] = process_id
                        agg_detail = threat_detail_map.get(process_id)
                        if agg_detail:
                            existing["threat_sources"] = agg_detail.get("sources", [])
                            existing["threat_confidence"] = agg_detail.get("confidence")
                            existing["threat_score"] = agg_detail.get("score")
                    continue

                detections_map[key] = {
                    "name": name,
                    "segment": segment_name,
                    "category": category,
                    "status": threat_level,
                    "points": threat_points,
                    "first_detected": sig.timestamp or time.time(),
                    "details": details,
                    "occurrences": 1,
                    "threat_id": process_id,
                }
                if process_id:
                    agg_detail = threat_detail_map.get(process_id)
                    if agg_detail:
                        detections_map[key]["threat_sources"] = agg_detail.get("sources", [])
                        detections_map[key]["threat_confidence"] = agg_detail.get("confidence")
                        detections_map[key]["threat_score"] = agg_detail.get("score")

        detections_list = list(detections_map.values())

        # Count threat levels and categories based on deduplicated detections
        categories = {}
        for detection in detections_list:
            level_key = (detection["status"] or "info").lower()
            if level_key in threat_counts:
                threat_counts[level_key] += 1

            cat_key = detection["category"] or "unknown"
            categories[cat_key] = categories.get(cat_key, 0) + 1

        # Total score is raw sum of all threat points (pre-dedup, display only)
        raw_detection_score = sum(d["points"] for d in detections_list)

        # Use nickname extracted earlier from system signals
        detected_nickname = detected_nickname_from_batch

        # Get device info early (needed for batch_data)
        device_id = None
        device_name = None
        device_ip = None
        
        # Try to get device info from first signal
        if self._all_detections:
            device_id = self._all_detections[0].device_id
            device_name = self._all_detections[0].device_name
            device_ip = self._all_detections[0].device_ip
        
        # If device_name is missing, try to get it from WebForwarder
        if not device_name and _web_forwarder:
            if _web_forwarder.device_name:
                device_name = _web_forwarder.device_name
                if not device_id and _web_forwarder.device_id:
                    device_id = _web_forwarder.device_id
        
        # If still no device_name, try system_info
        if not device_name and system_info:
            device_name = system_info.get("host")
            if device_name and device_name != "unknown":
                if not device_id:
                    device_id = hashlib.md5(device_name.encode()).hexdigest()
        
        # Final fallback: generate from Windows Computer Name
        if not device_name:
            computer_name = get_windows_computer_name()
            device_name = computer_name
            if not device_id:
                device_id = hashlib.md5(device_name.encode()).hexdigest()
        
        # Get device_ip from system_info if available (ForwarderService provides this)
        if not device_ip and system_info:
            device_ip = system_info.get("device_ip") or system_info.get("local_ip")
        
        # Fallback: try to get IP from ForwarderService
        if not device_ip:
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                device_ip = s.getsockname()[0]
                s.close()
            except Exception:
                device_ip = "127.0.0.1"

        # Check DEV mode and apply "Test" name BEFORE creating batch_data
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.txt")
        is_dev = False
        try:
            if os.path.exists(config_path):
                with open(config_path, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("ENV="):
                            env_val = line.split("=", 1)[1].strip().upper()
                            if env_val == "DEV":
                                is_dev = True
                                break
        except Exception:
            pass
        
        if is_dev:
            device_name = "Test"
            print("[ReportBatcher] DEV mode: Using player name 'Test'")

        # Ensure device_id is never None BEFORE creating batch_data
        if not device_id:
            device_id = hashlib.md5("unknown".encode()).hexdigest()
            device_name = device_name or "Unknown Device"

        # Prepare system info (defaults if not provided)
        system_data = {
            "cpu_percent": system_info.get("cpu_percent", 0.0) if system_info else 0.0,
            "mem_used_percent": system_info.get("mem_used_percent", 0.0) if system_info else 0.0,
            "segments_running": system_info.get("segments_running", 0) if system_info else 0,
            "env": system_info.get("env", "PROD") if system_info else "PROD",
            "host": system_info.get("host", "unknown") if system_info else "unknown",
        }

        # Resolve final display/stored name using shared identity priority
        name_sources = {
            "batchNickname": detected_nickname,
            "batchDevice": (system_info or {}).get("device_name") if system_info else None,
            "batchHost": system_data.get("host"),
            "batchDeviceHostname": (system_info or {}).get("host") if system_info else None,
            "batchMetaHostname": None,
            "signalDeviceName": device_name,
        }
        device_name = resolve_device_name(device_id, name_sources)

        # Structured batch data
        import json

        # OPTIMIZATION: Only include aggregated_threats to avoid duplication
        # aggregated_threats already contains all threat information grouped by threat_id
        # Individual threats array is redundant since backend can extract from aggregated_threats
        aggregated_threats = summary.get("threat_details", [])
        
        batch_timestamp = time.time()
        
        batch_data = {
            "scan_type": "unified",
            "batch_number": self._batch_count,
            "bot_probability": summary["bot_probability"],  # USE THIS - deduplicated score
            "nickname": detected_nickname,  # Add detected nickname to batch report
            "device_id": device_id,  # Device identifier (MD5 hash of computer name)
            "device_name": device_name,  # Device name (Windows Computer Name)
            "device_ip": device_ip,  # Device IP address
            "device": {
                "hostname": system_data.get("host"),
                "ip": device_ip,
            },
            "timestamp": batch_timestamp,  # When batch was created
            "batch_sent_at": batch_timestamp,  # When batch was sent (for online/offline detection)
            # REMOVED: "threats": detections_list,  # Redundant - use aggregated_threats instead
            "summary": {
                "critical": threat_counts["critical"],
                "alert": threat_counts["alert"],
                "warn": threat_counts["warn"],
                "info": threat_counts["info"],
                "total_detections": len(detections_list),  # Keep for reference but not sent
                "total_threats": summary.get("total_active_threats", len(threat_detail_map)),
                "threat_score": summary["bot_probability"],
                "raw_detection_score": raw_detection_score,
            },
            "categories": categories,
            "active_threats": summary["total_active_threats"],
            "aggregated_threats": aggregated_threats,  # Primary source - contains all threat info
            "vm_probability": summary.get("vm_probability", 0),
            "file_analysis_count": sum(
                1
                for d in detections_list
                if "hash" in d["name"].lower() or "file" in d["name"].lower()
            ) if detections_list else 0,
            "system": system_data,
        }
        
        # Add metadata if testing_json is enabled
        if self._testing_json:
            try:
                metadata = self._generate_metadata(segments_info=segments_info, system_info=system_info)
                batch_data["metadata"] = metadata
            except Exception as e:
                print(f"[ReportBatcher] Error generating metadata: {e}")

        # Log batch if enabled (before creating signal, so device info is included)
        self._log_batch(batch_data)

        # Serialize batch_data to JSON AFTER all updates are complete
        details_str = json.dumps(batch_data)

        # Create batch report signal with JSON details
        batch_signal = Signal(
            timestamp=time.time(),
            category="system",
            name="Unified Scan Report",
            status="INFO",
            details=details_str,
            device_id=device_id,
            device_name=device_name,
            device_ip=device_ip,
        )
        
        # Debug logging
        print(f"[ReportBatcher] Batch report created: device_id={device_id}, device_name={device_name}, detections={detection_count}")

        # Emit batch report
        _event_bus.emit("detection", batch_signal)

        # Clear batch
        self._all_detections.clear()

    def _guess_segment_name(self, sig: Signal) -> str:
        """Get segment name from signal, or guess from signal characteristics"""
        # Use explicit segment_name if available
        if sig.segment_name:
            return sig.segment_name

        # Fallback to guessing from signal characteristics
        name_lower = sig.name.lower()

        # Map signal patterns to segment names
        if "python" in name_lower or "autohotkey" in name_lower or "macro" in name_lower:
            return "AutomationDetector"
        elif "rename" in name_lower or "protected site" in name_lower or "coinpoker" in name_lower:
            return "ProcessScanner"
        elif "overlay" in name_lower or "window" in name_lower and sig.category == "screen":
            return "ScreenDetector"
        elif "gto" in name_lower or "rta site" in name_lower or "dns" in name_lower:
            return "WebMonitor"
        elif "telegram" in name_lower or "bot token" in name_lower:
            return "TelegramDetector"
        elif "connection" in name_lower or "rdp" in name_lower or "vnc" in name_lower:
            return "TrafficMonitor"
        elif "behaviour" in sig.category or "mouse" in name_lower or "keyboard" in name_lower:
            return "BehaviourDetector"
        elif "vm" in sig.category or "virtual" in name_lower:
            return "VMDetector"
        elif "hash" in name_lower or "virustotal" in name_lower or "sha256" in name_lower:
            return "HashAndSignatureScanner"
        elif "entropy" in name_lower or "packer" in name_lower or "path hint" in name_lower:
            return "ContentAnalyzer"
        elif "obfuscation" in name_lower:
            return "ObfuscationDetector"

        # Default: capitalize category
        return sig.category.capitalize() + "Detector"



class ThreatManager:
    """Manages persistent threats and calculates continuous bot probability"""

    def __init__(self):
        self._active_threats: dict[str, ActiveThreat] = {}
        self._lock = threading.Lock()
        self._last_cleanup = time.time()  # Track last cleanup time

        # Unified threat scoring (4-level system)
        self._threat_points = {
            "CRITICAL": 15,
            "ALERT": 10,
            "WARN": 5,
            "INFO": 0,
        }

        # Load category timeouts based on configured scan intervals (3x rule)
        self._category_timeouts = self._load_category_timeouts()

    def _is_more_specific_name(self, new_name: str, current_name: str) -> bool:
        """Determine if new_name is more specific/descriptive than current_name"""
        # Prefer names with actual process names over generic descriptions
        generic_prefixes = ["suspicious", "unsigned", "compiled", "obfuscated", "unknown"]
        
        new_lower = new_name.lower()
        current_lower = current_name.lower()
        
        # If current is generic and new has exe name, prefer new
        for prefix in generic_prefixes:
            if current_lower.startswith(prefix) and ".exe" in new_lower:
                return True
        
        # If new is more specific (has exe name that current doesn't)
        if ".exe" in new_lower and ".exe" not in current_lower:
            return True
            
        # Otherwise keep current if it's longer (more descriptive)
        return len(new_name) > len(current_name)

    def _extract_process_identifier(self, signal: Signal) -> str:
        """Extract normalized process identifier for grouping related detections"""
        import re

        name_lower = signal.name.lower()
        details_lower = (signal.details or "").lower()

        # SPECIAL: Group all Telegram-related signals together
        # This ensures "Telegram Activity" and "CoinPoker RTA Risk"
        # (when related to Telegram) are grouped as the same threat
        if "telegram" in name_lower or "telegram" in details_lower:
            # Extract PID if available (for process-specific grouping)
            pid_match = re.search(r"pid[=:]\s*(\d+)", details_lower)
            if pid_match:
                return f"telegram:{pid_match.group(1)}"
            # Otherwise group all Telegram detections together
            return "telegram"

        # Normalize common process families before regex extraction
        if (
            "node.exe" in name_lower
            or "node.js" in name_lower
            or name_lower.startswith("node")
            or "node.exe" in details_lower
        ):
            return "node"

        # IMPROVED: Extract executable name from various detection formats
        # Handle formats like "Suspicious Code: weatherzeroservice.exe"
        # "Suspicious Entropy: weatherzeroservice.exe", "OpenHoldem", etc.
        
        # First try to extract from name if it contains common patterns
        # This handles "Suspicious Code: weatherzeroservice.exe" format
        if ":" in name_lower:
            parts = name_lower.split(":", 1)
            if len(parts) == 2:
                potential_exe = parts[1].strip()
                if potential_exe.endswith(".exe"):
                    exe_name = potential_exe.replace(".exe", "")
                    # Debug log (disabled)
                    # print(f"[ThreatManager] Extracted '{exe_name}' from '{signal.name}'")
                    return exe_name
        
        # Try more specific patterns
        exe_patterns = [
            r":\s*([a-zA-Z0-9_\-]+\.exe)",  # After colon with more chars allowed
            r"^([a-zA-Z0-9_\-]+\.exe)",  # At start of string
            r"\b([a-zA-Z0-9_\-]+\.exe)\b",  # Word boundary
            r"proc[=:]\s*(\w+)",  # proc=python
            r"process[=:]\s*(\w+)",  # process=python
            r"pid[=:]\s*\d+.*?([a-zA-Z0-9_\-]+\.exe)",  # PID: 1234 | something.exe
        ]

        for pattern in exe_patterns:
            # Check both name and details
            for src in (name_lower, details_lower):
                match = re.search(pattern, src)
                if match:
                    exe_name = match.group(1).replace(".exe", "")
                    # Special handling for common process names
                    if exe_name in ["python", "pythonw", "python3"]:
                        return "python"
                    elif exe_name in ["autohotkey", "ahk"]:
                        return "autohotkey"
                    elif exe_name == "autoit3":
                        return "autoit"
                    return exe_name

        # Known bot/tool names without .exe (like "OpenHoldem")
        known_tools = {
            "openholdem": "openholdem",
            "warbot": "warbot",
            "shankybot": "shankybot",
            "pokerbotai": "pokerbotai",
            "gto wizard": "gtowizard",
            "holdem manager": "holdemmanager",
            "pokertracker": "pokertracker",
        }
        
        for tool, identifier in known_tools.items():
            if tool in name_lower:
                return identifier

        # Extract from signal name patterns
        if "python" in name_lower:
            return "python"
        elif "autohotkey" in name_lower or "ahk" in name_lower:
            return "autohotkey"
        elif "autoit" in name_lower:
            return "autoit"
        elif "powershell" in name_lower:
            return "powershell"
        elif "discord" in name_lower:
            return "discord"

        # Default: use first word of name (but clean it up)
        first_word = name_lower.split()[0] if name_lower else "unknown"
        # Remove common prefixes
        for prefix in ["suspicious", "compiled", "unsigned", "obfuscated", "protected"]:
            if first_word == prefix and len(name_lower.split()) > 1:
                first_word = name_lower.split()[1]
                break
        return first_word

    def process_signal(self, signal: Signal) -> float:
        """Process a new signal and return updated bot probability with deduplication"""
        with self._lock:
            # FILTER OUT FALSE POSITIVES - don't track as threats
            if self._is_false_positive(signal):
                return self._calculate_bot_probability()

            # Extract process identifier for grouping
            process_id = self._extract_process_identifier(signal)

            # Create unified threat ID based on process only
            # Different segments/statuses for same process will merge and escalate severity
            threat_id = process_id

            now = signal.timestamp

            # Update or merge threat
            if threat_id in self._active_threats:
                threat = self._active_threats[threat_id]
                threat.last_seen = now
                threat.detection_count += 1

                # Add detection source if not already tracked
                source = f"{signal.category}/{signal.name}"
                if source not in threat.detection_sources:
                    threat.detection_sources.append(source)
                    threat.confidence_score = len(threat.detection_sources)
                    # Debug: print(f"[ThreatManager] Merging '{signal.name}' into '{threat_id}' (sources: {len(threat.detection_sources)})")

                    # Multiple confirmations don't increase score in simplified system
                    # Just track that multiple sources detected it (confidence)

                # Update to most severe level if changed
                new_level = self._get_threat_level(signal)
                old_points = self._threat_points.get(threat.status, 0)
                new_points = self._threat_points.get(new_level, 0)
                if new_points > old_points:
                    # Debug: print(f"[ThreatManager] Escalating '{threat_id}' from {threat.status}({old_points}) to {new_level}({new_points})")
                    threat.status = new_level
                    threat.threat_score = new_points

                # Keep most detailed description
                if len(signal.details or "") > len(threat.details):
                    threat.details = signal.details or ""

                # Update name to most descriptive one
                # Prefer specific detection names over generic ones
                if self._is_more_specific_name(signal.name, threat.name):
                    threat.name = signal.name

            else:
                # Simplified scoring - map to threat level
                threat_level = self._get_threat_level(signal)
                threat_score = self._threat_points.get(threat_level, 0)

                # Create new threat only if it has a score (not INFO)
                if threat_score > 0:
                    # Debug: print(f"[ThreatManager] New threat: '{signal.name}' as '{threat_id}' ({threat_level}: {threat_score} points)")
                    threat = ActiveThreat(
                        threat_id=threat_id,
                        category=signal.category,
                        name=signal.name,
                        status=threat_level,
                        details=signal.details or "",
                        first_seen=now,
                        last_seen=now,
                        detection_count=1,
                        threat_score=threat_score,
                        detection_sources=[f"{signal.category}/{signal.name}"],
                        confidence_score=1,
                    )
                    self._active_threats[threat_id] = threat

            # Clean up timed-out threats
            self._cleanup_expired_threats(now)

            # Calculate current bot probability
            bot_probability = self._calculate_bot_probability()

            return bot_probability

    def _get_threat_level(self, signal: Signal) -> str:
        """Determine unified status (CRITICAL/ALERT/WARN/INFO) from signal"""
        name_lower = signal.name.lower()
        status = signal.status

        # CRITICAL (15 points) - Highest threats
        if status == "CRITICAL":
            return "CRITICAL"

        # Known bots and direct RTA tools
        if status == "ALERT" and any(
            bot in name_lower
            for bot in ["warbot", "holdembot", "shanky", "openholdem", "pokerbotai"]
        ):
            return "CRITICAL"

        if status == "ALERT" and any(
            rta in name_lower for rta in ["gto wizard", "gtowizard", "rta.poker"]
        ):
            return "CRITICAL"

        if "bot token" in name_lower and status in ("ALERT", "CRITICAL"):
            return "CRITICAL"

        # ALERT (10 points) - Serious threats
        if status == "ALERT":
            return "ALERT"

        # Automation during poker
        if status == "WARN" and (
            signal.category == "auto" or "python" in name_lower or "autohotkey" in name_lower
        ):
            return "ALERT"

        # VM detection
        if status == "WARN" and signal.category == "vm":
            return "ALERT"

        # WARN (5 points) - Suspicious activity
        if status == "WARN":
            return "WARN"

        # INFO (0 points) - Informational only
        return "INFO"

    def _is_false_positive(self, signal: Signal) -> bool:
        """Filter out false positive signals that shouldn't count as threats"""
        name_lower = signal.name.lower()
        details_lower = (signal.details or "").lower()

        # Don't track legitimate system processes as threats
        false_positive_indicators = [
            # Windows system processes (legitimate)
            any(
                sys_proc in name_lower
                for sys_proc in [
                    "svchost.exe",
                    "conhost.exe",
                    "taskhostw.exe",
                    "audiodg.exe",
                    "phoneexperiencehost.exe",
                    "runtimebroker.exe",
                ]
            ),
            # Modern apps in AppData (legitimate)
            "slack.exe" in name_lower and "app" in details_lower,
            "teams.exe" in name_lower and "appdata" in details_lower,
            "discord.exe" in name_lower and "local" in details_lower,
            # Windows components with .mui/.dll (legitimate)
            ".mui" in details_lower
            and any(win in name_lower for win in ["svchost", "conhost", "taskhostw"]),
            # Protected poker client running normally (not a threat)
            "protected site: coinpoker" in name_lower,
            "coinpoker" in name_lower and "running normally" in details_lower,
            # Informational detections that aren't actual threats
            signal.status == "INFO" and "other poker site:" in name_lower,
            signal.status == "INFO" and "input source:" in name_lower,
            signal.status == "OK",
            # System status messages
            "threat summary" in name_lower,
            "system" in signal.category and signal.status == "INFO",
        ]

        return any(false_positive_indicators)

    # REMOVED: _get_threat_relevance() - simplified scoring system (4-level weights)
    # doesn't use category multipliers. All threats scored equally by status level.

    def _cleanup_expired_threats(self, current_time: float):
        """
        Remove threats based on category-specific heartbeat timeouts.

        Logic: Each category has a timeout based on its segment's polling interval.
        If a threat hasn't been updated within the timeout, it means the threat
        is no longer active (e.g., program closed) and should be removed immediately.

        This gives full points while threat is active, 0 points when inactive.
        No gradual decay - binary active/inactive based on segment heartbeats.
        """
        # Check every 10 seconds (responsive without CPU overhead)
        if current_time - self._last_cleanup < 10:
            return

        self._last_cleanup = current_time
        threats_to_remove = []

        # Use loaded timeouts (fallbacks handled inside loader)
        category_timeouts = self._category_timeouts

        for threat_id, threat in self._active_threats.items():
            age_seconds = current_time - threat.last_seen

            # Get timeout for this threat's category
            timeout = category_timeouts.get(threat.category, 60)  # Default 60s

            # Remove threat if heartbeat timeout expired
            # This means: segment has scanned and NOT detected this threat anymore
            if age_seconds > timeout:
                threats_to_remove.append(threat_id)
                print(
                    f"[ThreatManager] X Removing '{threat.name}' ({threat.category}) - not detected for {int(age_seconds)}s (timeout: {timeout}s)"
                )

        # Clean up expired threats
        for threat_id in threats_to_remove:
            del self._active_threats[threat_id]
    
    def cleanup(self):
        """Clean up ThreatManager resources (clear all active threats)"""
        with self._lock:
            self._active_threats.clear()
            self._last_cleanup = 0

    def _calculate_bot_probability(self, threats: list[ActiveThreat] | None = None) -> float:
        """Calculate overall bot probability based on provided threats (defaults to all active)."""
        if threats is None:
            threats = list(self._active_threats.values())
        if not threats:
            return 0.0

        # Sum all active threat scores
        # Use linear calculation: sum of threat points, capped at 100%
        # This matches the Historical Analysis chart which uses linear aggregation
        total_score = sum(threat.threat_score for threat in threats)
        
        # Linear calculation: total_score is already in 0-100% range
        # Each threat contributes its threat_score (15 for CRITICAL, 10 for ALERT, 5 for WARN)
        # Simply cap at 100% to ensure consistency with Historical Analysis
        probability = min(100.0, max(0.0, total_score))
        return probability

    def _load_category_timeouts(self) -> dict[str, int]:
        """Load per-category timeouts as 3x configured scan intervals from config.txt.
        Provides sensible defaults if keys are missing or invalid.
        """
        defaults = {
            "programs": 360,
            "auto": 95,  # Increased to 95s (must be > 92s segment interval)
            "network": 95,  # Increased to 95s (must be > 92s segment interval)
            "behaviour": 95,  # Increased to 95s (must be > 92s segment interval)
            "vm": 360,
            "screen": 95,  # Increased to 95s (must be > 92s segment interval)
            "system": 300,
        }

        try:
            config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.txt")
            if not os.path.exists(config_path):
                return defaults

            kv: dict[str, str] = {}
            with open(config_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    kv[key.strip().upper()] = value.strip()

            # Map config intervals → timeouts = 3x
            def to_timeout(key: str, fallback: int) -> int:
                try:
                    v = float(kv.get(key, "").strip())
                    return int(max(1.0, v) * 3.0)
                except Exception:
                    return fallback

            # Handle misspelling BEHAVIUOUR
            if "BEHAVIOUR" not in kv and "BEHAVIUOUR" in kv:
                kv["BEHAVIOUR"] = kv["BEHAVIUOUR"]

            return {
                "programs": to_timeout("PROGRAMS", defaults["programs"]),
                "auto": to_timeout("AUTO", defaults["auto"]),
                "network": to_timeout("NETWORK", defaults["network"]),
                "behaviour": to_timeout("BEHAVIOUR", defaults["behaviour"]),
                "vm": to_timeout("VM", defaults["vm"]),
                "screen": to_timeout("SCREEN", defaults["screen"]),
                "system": to_timeout("SYSTEM", defaults["system"]),
            }
        except Exception:
            return defaults

    def get_active_threats(self) -> list[ActiveThreat]:
        """Get list of currently active threats"""
        with self._lock:
            return list(self._active_threats.values())

    def get_bot_probability(self) -> float:
        """Get current bot probability"""
        with self._lock:
            return self._calculate_bot_probability()

    def get_threat_summary(self, window_start: float | None = None) -> dict:
        """Get summary of active threats for dashboard with optional time filtering"""
        with self._lock:
            threats = list(self._active_threats.values())
            if window_start is not None:
                threats = [t for t in threats if t.last_seen >= window_start]
            total_threats = len(threats)
            alert_threats = sum(1 for t in threats if t.status == "ALERT")
            warn_threats = sum(1 for t in threats if t.status == "WARN")
            critical_threats = sum(1 for t in threats if t.status == "CRITICAL")
            bot_probability = self._calculate_bot_probability(threats)

            # Category breakdown
            category_counts = {}
            for threat in threats:
                category_counts[threat.category] = category_counts.get(threat.category, 0) + 1

            return {
                "bot_probability": round(bot_probability, 1),
                "total_active_threats": total_threats,
                "alert_threats": alert_threats,
                "warn_threats": warn_threats,
                "critical_threats": critical_threats,
                "category_breakdown": category_counts,
                "threat_details": [
                    {
                        "threat_id": t.threat_id,
                        "name": t.name,
                        "category": t.category,
                        "status": t.status,
                        "score": round(t.threat_score, 1),
                        "age_seconds": int(time.time() - t.last_seen),
                        "confidence": t.confidence_score,
                        "sources": t.detection_sources,
                        "detections": t.detection_count,
                    }
                    for t in sorted(threats, key=lambda x: x.threat_score, reverse=True)[:10]
                ],
            }


# Global instances
_event_bus = EventBus()
_web_forwarder = None
_threat_manager = ThreatManager()
_report_batcher: ReportBatcher | None = None


def get_event_bus() -> EventBus:
    """Get the global event bus instance"""
    return _event_bus


def get_threat_manager() -> ThreatManager:
    """Get the global threat manager instance"""
    return _threat_manager


def get_report_batcher() -> ReportBatcher | None:
    """Get the global report batcher instance"""
    return _report_batcher


def init_report_batcher(
    batch_interval: float = 92.0
) -> ReportBatcher:
    """Initialize the unified report batcher with config interval (reads config.txt when present)"""
    global _report_batcher
    if _report_batcher is None:
        # Try to read configured interval from config.txt (use BATCH_INTERVAL_HEAVY as unified interval)
        try:
            import os

            config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.txt")
            cfg_interval = None
            if os.path.exists(config_path):
                with open(config_path, encoding="utf-8") as f:
                    for raw_line in f:
                        line = raw_line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        key, value = line.split("=", 1)
                        key = key.strip().upper()
                        value = value.split("#")[0].strip()
                        # Use BATCH_INTERVAL_HEAVY as unified interval (backward compatible)
                        if key == "BATCH_INTERVAL_HEAVY":
                            try:
                                cfg_interval = float(value)
                            except Exception:
                                pass

            interval_val = (
                cfg_interval if (isinstance(cfg_interval, float) and cfg_interval > 0) else batch_interval
            )
        except Exception:
            interval_val = batch_interval

        _report_batcher = ReportBatcher(interval_val)
        print(
            f"[ReportBatcher] Initialized unified batch system (interval: {_report_batcher._batch_interval}s)"
        )
    return _report_batcher


def post_signal(
    category: str,
    name: str,
    status: str,
    details: str,
    device_id: str = None,
    device_name: str = None,
    device_ip: str = None,
    segment_name: str = None,
):
    """Helper function to post a signal to the event bus with threat tracking and batching"""
    # Get device info if not provided - use Windows Computer Name
    if not device_id:
        computer_name = get_windows_computer_name()
        device_id = hashlib.md5(computer_name.encode()).hexdigest()
        device_name = computer_name

    signal = Signal(
        timestamp=time.time(),
        category=category,
        name=name,
        status=status,
        details=details,
        device_id=device_id,
        device_name=device_name,
        device_ip=device_ip,
        segment_name=segment_name,
    )

    # Log signal creation (non-blocking)
    try:
        from utils.signal_logger import log_signal_created
        log_signal_created(category, name, status, device_id, details)
    except Exception:
        pass  # Don't break signal flow if logging fails

    # Process through threat manager for persistent tracking and deduplication
    _threat_manager.process_signal(signal)

    # Optional UI de-duplication: suppress lower-severity duplicates for same process
    with contextlib.suppress(Exception):
        process_id = _threat_manager._extract_process_identifier(signal)  # type: ignore[attr-defined]
        existing = _threat_manager._active_threats.get(process_id)  # type: ignore[attr-defined]
        if existing is not None:
            new_level = _threat_manager._get_threat_level(signal)  # type: ignore[attr-defined]
            existing_pts = _threat_manager._threat_points.get(existing.status, 0)  # type: ignore[attr-defined]
            new_pts = _threat_manager._threat_points.get(new_level, 0)  # type: ignore[attr-defined]
            # If an active higher-severity threat exists for same process, skip emitting duplicate UI event
            if existing_pts > new_pts:
                return

    # Emit to event bus for UI and web forwarding
    _event_bus.emit("detection", signal)

    # Threat summaries are sent via ReportBatcher at configured intervals


# =========================
# Web Dashboard Integration
# =========================
def init_web_forwarder():
    """Wrapper that injects the global event bus into the WebForwarder module."""
    global _web_forwarder
    if _web_forwarder is None:
        _web_forwarder = _web_forwarder_init(_event_bus)
    return _web_forwarder


def stop_web_forwarder():
    """Stop the web forwarder instance (if any)."""
    global _web_forwarder
    _web_forwarder_stop()
    _web_forwarder = None

def cleanup_globals():
    """
    Clean up all global singletons and free RAM.
    
    CRITICAL: Call this when shutting down scanner to ensure no data
    is left in RAM. Works in both script and .exe mode.
    """
    global _event_bus, _threat_manager, _report_batcher, _web_forwarder
    
    # Stop web forwarder first (stops its thread)
    if _web_forwarder:
        try:
            _web_forwarder.stop()
        except Exception as e:
            print(f"[Cleanup] WebForwarder stop error: {e}")
        finally:
            _web_forwarder = None
    
    # Clear EventBus listeners and history
    if _event_bus:
        try:
            with _event_bus._lock:
                _event_bus._listeners.clear()
                _event_bus._history.clear()
        except Exception as e:
            print(f"[Cleanup] EventBus cleanup error: {e}")
    
    # Clear ThreatManager active threats
    if _threat_manager:
        try:
            with _threat_manager._lock:
                _threat_manager._active_threats.clear()
        except Exception as e:
            print(f"[Cleanup] ThreatManager cleanup error: {e}")
    
    # Clear ReportBatcher buffers
    if _report_batcher:
        try:
            _report_batcher._all_detections.clear()
        except Exception as e:
            print(f"[Cleanup] ReportBatcher cleanup error: {e}")
        finally:
            _report_batcher = None
    
    print("[Cleanup] Global singletons cleaned up")


class BaseSegment:
    """Base class for all detection segments with consistent intervals"""

    name: str = "UnnamedSegment"
    category: str = "unknown"  # programs, network, behaviour
    interval_s: float = 5.0  # tick interval in seconds

    def __init__(self):
        self._running = False
        self._thread = None
        self._last_tick = 0.0
        self._start_offset = 0.0  # Stagger segment starts to distribute CPU load

        # Performance tracking (for debugging only)
        self._tick_durations = []  # Last N tick durations
        self._max_tick_history = 10

        # Load config
        self._load_performance_config()
        
        # Check if segment is enabled (lazy-loaded when needed)
        self._enabled = None  # None = not checked yet, True/False = cached value
        self._enabled_check_time = 0.0  # Timestamp of last enabled check (for cache invalidation)
        self._enabled_cache_ttl = 60.0  # Cache enabled status for 60 seconds (balance performance vs responsiveness)

    def start(self):
        """Start the segment's monitoring thread"""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        """Stop the segment's monitoring"""
        self._running = False

        # Call cleanup hooks first
        try:
            self.cleanup()
        except Exception as e:
            print(f"Error during cleanup in {self.name}: {e}")

        if self._thread:
            self._thread.join(timeout=2.0)  # Reduced timeout (cleanup handles most work)

    def _is_enabled(self) -> bool:
        """
        Check if segment is enabled from config.
        
        Returns True if enabled flag is not set (backward compatibility) or explicitly True.
        Returns False only if enabled flag is explicitly False.
        
        Cache is invalidated after _enabled_cache_ttl seconds to allow config updates
        to take effect without restarting the scanner.
        """
        # Check if cache is still valid (not expired)
        current_time = time.time()
        if self._enabled is not None and (current_time - self._enabled_check_time) < self._enabled_cache_ttl:
            return self._enabled
        
        # Cache expired or not set - refresh from config
        # Only check enabled flag for segments that have config files with this flag
        # (network, screen, vm segments)
        config_categories = {"network", "screen", "vm"}
        if self.category not in config_categories:
            # For other segments (programs, auto, behaviour), always enabled
            self._enabled = True
            self._enabled_check_time = current_time
            return True
        
        try:
            from utils.config_loader import get_config
            
            # Map category to config name
            config_name = f"{self.category}_config"
            config = get_config(config_name)
            
            if config is None:
                # Config not found - default to enabled for backward compatibility
                self._enabled = True
                self._enabled_check_time = current_time
                return True
            
            # Check enabled flag (defaults to True if not set)
            enabled = config.get("enabled", True)
            # Handle None/null values explicitly (treat as enabled for backward compatibility)
            if enabled is None:
                enabled = True
            self._enabled = bool(enabled)
            self._enabled_check_time = current_time
            return self._enabled
            
        except Exception as e:
            # If check fails, default to enabled (safe fallback)
            print(f"[{self.name}] WARNING: Failed to check enabled status: {e}")
            self._enabled = True
            self._enabled_check_time = current_time
            return True
    
    def _refresh_enabled_status(self):
        """
        Refresh enabled status from config (useful when configs are reloaded).
        This clears the cache and re-checks the enabled flag immediately.
        """
        self._enabled = None  # Clear cache to force re-check
        self._enabled_check_time = 0.0  # Reset timestamp

    def _run(self):
        """Main loop for the segment with consistent intervals"""
        # Apply start offset to stagger segment execution
        if self._start_offset > 0:
            time.sleep(self._start_offset)

        while self._running:
            try:
                # Check if segment is enabled before executing tick
                if not self._is_enabled():
                    # Segment is disabled - sleep and skip tick
                    time.sleep(self.interval_s)
                    continue
                
                # Track tick duration
                start_time = time.time()

                # Execute tick
                self.tick()

                # Track performance
                tick_duration = time.time() - start_time
                self._track_performance(tick_duration)

                self._last_tick = time.time()

                # Sleep for the configured interval (consistent, no throttling)
                sleep_time = max(0.1, self.interval_s - tick_duration)
                time.sleep(sleep_time)

            except Exception as e:
                print(f"Error in {self.name}: {e}")
                time.sleep(self.interval_s)

    def tick(self):
        """Override this method to implement segment logic"""
        pass

    def cleanup(self):
        """Override this method for cleanup (called before thread join)"""
        pass

    def _load_performance_config(self):
        """Load interval settings from config.txt"""
        try:
            config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.txt")
            if os.path.exists(config_path):
                with open(config_path, encoding="utf-8") as f:
                    # Collect key/value pairs first
                    kv = {}
                    for line in f:
                        line = line.strip()
                        if "=" in line and not line.startswith("#"):
                            key, value = line.split("=", 1)
                            key = key.strip().upper()
                            value = value.strip()

                            # Remove inline comments
                            if "#" in value:
                                value = value.split("#")[0].strip()

                            kv[key] = value

                    # Apply per-category scan interval overrides
                    # Map category -> config key
                    category_key = {
                        "programs": "PROGRAMS",
                        "auto": "AUTO",
                        "network": "NETWORK",
                        "behaviour": "BEHAVIOUR",
                        "vm": "VM",
                        "screen": "SCREEN",
                        "system": "SYSTEM",
                    }.get(self.category, None)

                    # Handle common misspelling for behaviour
                    if category_key == "BEHAVIOUR" and "BEHAVIOUR" not in kv and "BEHAVIUOUR" in kv:
                        kv["BEHAVIOUR"] = kv["BEHAVIUOUR"]

                    if category_key and category_key in kv:
                        try:
                            cfg_interval = float(kv[category_key].strip())
                            if cfg_interval > 0:
                                self.interval_s = cfg_interval
                        except ValueError:
                            pass
        except Exception:
            pass

    def _track_performance(self, tick_duration: float):
        """Track segment performance metrics"""
        self._tick_durations.append(tick_duration)
        if len(self._tick_durations) > self._max_tick_history:
            self._tick_durations.pop(0)

    def get_performance_stats(self) -> dict[str, float]:
        """Get performance statistics for this segment"""
        if not self._tick_durations:
            return {"avg_tick_ms": 0, "max_tick_ms": 0, "interval_s": self.interval_s}

        return {
            "avg_tick_ms": sum(self._tick_durations) / len(self._tick_durations) * 1000,
            "max_tick_ms": max(self._tick_durations) * 1000,
            "interval_s": self.interval_s,
        }
