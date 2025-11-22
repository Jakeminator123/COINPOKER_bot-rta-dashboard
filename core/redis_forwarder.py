"""
Redis Forwarder
===============
Writes batch reports directly to Redis, bypassing HTTP API for better performance.

Flow: ReportBatcher (92s) → EventBus → RedisForwarder → Redis → Dashboard reads from Redis
"""

import hashlib
import json
import threading
import time

from core.device_identity import resolve_device_name
from core.models import Signal
from core.redis_schema import redis_keys, redis_ttl_seconds
from core.system_info import get_windows_computer_name


class RedisForwarder:
    """Writes batch reports directly to Redis, matching dashboard's expected structure."""

    def __init__(self, redis_url: str | None, ttl_seconds: int | None = None):
        self.redis_url = redis_url
        self.ttl_seconds = ttl_seconds or redis_ttl_seconds
        self.redis_client = None
        self.buffer: list[Signal] = []
        self.buffer_lock = threading.Lock()
        self.thread = None
        self.running = False
        self._stop_event = threading.Event()
        self.interval_s = 1.0  # Check buffer every 1 second
        self.enabled = bool(redis_url)
        self.latest_nicknames: dict[str, str] = {}

        computer_name = get_windows_computer_name()
        self.device_id = hashlib.md5(computer_name.encode()).hexdigest()
        self.device_name = computer_name

        if self.enabled:
            print(f"[RedisForwarder] Enabled - writing to Redis at {self._mask_redis_url(self.redis_url)}")
            print(f"[RedisForwarder] Subscribed to 'detection' events - will handle 'Player Name Detected' signals")
            self.start()
        else:
            print("[RedisForwarder] Disabled (REDIS_URL missing)")

    def _mask_redis_url(self, url: str) -> str:
        """Mask password in Redis URL for logging"""
        if not url:
            return "unknown"
        if "@" in url:
            parts = url.split("@")
            if len(parts) == 2:
                return f"redis://****@{parts[1]}"
        return url

    def _connect_redis(self):
        """Connect to Redis"""
        if not self.redis_url:
            return False

        try:
            import redis
        except ImportError:
            print("[RedisForwarder] redis library not installed. Run: pip install redis")
            self.enabled = False
            return False

        try:
            # Use decode_responses=True for easier string handling
            self.redis_client = redis.from_url(self.redis_url, decode_responses=True)
            # Test connection
            self.redis_client.ping()
            print("[RedisForwarder] Connected to Redis successfully")
            return True
        except Exception as e:
            print(f"[RedisForwarder] Redis connection failed: {e}")
            self.enabled = False
            return False

    def on_signal(self, signal: Signal) -> None:
        """Callback when a batch report signal is emitted"""
        if not self.enabled:
            return

        if signal.category == "system":
            if signal.name == "Player Name Detected":
                print(f"[RedisForwarder] Received Player Name Detected signal: device_id={signal.device_id}, name={signal.device_name}")
                self._handle_player_name_signal(signal)
                return

            if "Scan Report" in signal.name:
                with self.buffer_lock:
                    self.buffer.append(signal)
                    # Limit buffer size
                    if len(self.buffer) > 200:
                        self.buffer.pop(0)

    def start(self):
        """Start the forwarding thread"""
        if not self.enabled or self.running:
            return

        # Connect to Redis
        if not self._connect_redis():
            return

        self.running = True
        self.thread = threading.Thread(target=self._forward_loop, daemon=True)
        self.thread.start()

    def stop(self):
        """Stop the forwarding thread"""
        self.running = False
        self._stop_event.set()
        if self.thread:
            self.thread.join(timeout=1.0)

        if self.redis_client:
            try:
                self.redis_client.close()
            except Exception:
                pass
            self.redis_client = None

    def cleanup(self):
        """Clean up RedisForwarder resources"""
        self.stop()
        with self.buffer_lock:
            self.buffer.clear()

    def _forward_loop(self):
        """Main loop that writes buffered batch reports to Redis"""
        while self.running:
            # Use Event.wait() instead of time.sleep() so we can interrupt it during shutdown
            if self._stop_event.wait(timeout=self.interval_s):
                break

            # Check if we should stop before processing signals
            if not self.running:
                break

            # Get buffered signals
            with self.buffer_lock:
                if not self.buffer:
                    continue
                signals_to_send = list(self.buffer)
                self.buffer.clear()

            # Write each batch report to Redis
            for sig in signals_to_send:
                try:
                    if not self.running:
                        break

                    # Parse batch data from signal details
                    if not sig.details:
                        continue

                    batch_data = json.loads(sig.details)
                    device_id = sig.device_id or self.device_id
                    device_name = sig.device_name or self.device_name
                    timestamp = int(sig.timestamp)

                    # Write batch report to Redis (matches dashboard structure)
                    self._store_batch_report(device_id, device_name, batch_data, timestamp)

                except json.JSONDecodeError as e:
                    print(f"[RedisForwarder] Failed to parse batch JSON: {e}")
                except Exception as e:
                    print(f"[RedisForwarder] Error writing to Redis: {e}")

    def _store_batch_report(self, device_id: str, device_name: str, batch: dict, timestamp: int):
        """Store batch report to Redis matching dashboard's expected structure"""
        if not self.redis_client:
            return

        try:
            # Get nickname from batch, or from latest_nicknames cache, or from Redis
            nickname = batch.get("nickname")
            # Ensure nickname is a string before calling .strip()
            if nickname is not None and not isinstance(nickname, str):
                nickname = str(nickname) if nickname else None
            
            if not nickname or (isinstance(nickname, str) and not nickname.strip()):
                # Try latest_nicknames cache first
                nickname = self.latest_nicknames.get(device_id)
                if not nickname:
                    # Fallback: read from Redis device hash
                    device_key = redis_keys.device_hash(device_id)
                    existing_data = self.redis_client.hgetall(device_key)
                    nickname = existing_data.get("player_nickname")
                    if nickname:
                        self.latest_nicknames[device_id] = nickname
            
            # Ensure nickname is a string and non-empty before using it
            if nickname and isinstance(nickname, str) and nickname.strip():
                batch["nickname"] = nickname.strip()
            elif nickname and not isinstance(nickname, str):
                # Convert non-string nickname to string if it exists
                batch["nickname"] = str(nickname).strip()

            device_hostname = device_name

            # Store batch report with timestamp key
            batch_key = redis_keys.batch_record(device_id, timestamp)
            batch_record = {
                "timestamp": timestamp,
                "bot_probability": batch.get("bot_probability", 0),
                "raw_detection_score": batch.get("summary", {}).get("raw_detection_score", 0),
                "critical": batch.get("summary", {}).get("critical", 0),
                "alert": batch.get("summary", {}).get("alert", 0),
                "warn": batch.get("summary", {}).get("warn", 0),
                "info": batch.get("summary", {}).get("info", 0),
                "threats": len(batch.get("aggregated_threats", [])),
                "categories": batch.get("categories", {}),
                "aggregated_threats": batch.get("aggregated_threats", []),
                "summary": batch.get("summary", {}),
                "segments": batch.get("segments", []),
                "meta": batch.get("metadata", None),  # Include metadata if TESTING_JSON=y
                "nickname": nickname,
            }
            self.redis_client.set(batch_key, json.dumps(batch_record), ex=self.ttl_seconds)

            # Update device info (matches dashboard's updateDevice structure)
            resolved_name = resolve_device_name(
                device_id,
                {
                    "batchNickname": batch.get("nickname"),
                    "batchDevice": batch.get("device_name"),
                    "batchHost": (batch.get("device") or {}).get("hostname")
                    or (batch.get("system") or {}).get("host"),
                    "batchDeviceHostname": (batch.get("device") or {}).get("hostname"),
                    "batchMetaHostname": (batch.get("metadata") or {}).get("hostname")
                    if isinstance(batch.get("metadata"), dict)
                    else None,
                    "signalDeviceName": device_name,
                },
            )
            self._update_device(
                device_id,
                resolved_name,
                device_hostname,
                batch.get("device_ip"),
                batch.get("bot_probability", 0),
                timestamp,
                nickname,
            )

            # Store detection counts
            summary = batch.get("summary", {})
            critical_count = summary.get("critical", 0)
            warn_count = summary.get("warn", 0)
            alert_count = summary.get("alert", 0)

            self.redis_client.set(
                redis_keys.device_detections(device_id, "CRITICAL"),
                str(critical_count),
                ex=self.ttl_seconds,
            )
            self.redis_client.set(
                redis_keys.device_detections(device_id, "WARN"),
                str(warn_count),
                ex=self.ttl_seconds,
            )
            self.redis_client.set(
                redis_keys.device_detections(device_id, "ALERT"),
                str(alert_count),
                ex=self.ttl_seconds,
            )

            # Add to time indexes
            day = time.strftime("%Y-%m-%d", time.gmtime(timestamp))
            hour = time.strftime("%Y-%m-%dT%H", time.gmtime(timestamp))

            self.redis_client.zadd(redis_keys.batches_hourly(device_id), {batch_key: timestamp})
            self.redis_client.zadd(redis_keys.batches_daily(device_id), {batch_key: timestamp})

            # Update daily/hourly averages
            day_key = redis_keys.day_stats(device_id, day)
            hour_key = redis_keys.hour_stats(device_id, hour)
            self.redis_client.hincrby(day_key, "reports", 1)
            self.redis_client.hincrby(day_key, "score_sum", batch.get("bot_probability", 0))
            self.redis_client.expire(day_key, self.ttl_seconds)
            self.redis_client.hincrby(hour_key, "reports", 1)
            self.redis_client.hincrby(hour_key, "score_sum", batch.get("bot_probability", 0))
            self.redis_client.expire(hour_key, self.ttl_seconds)

            # Publish update notification (for SSE/real-time updates)
            self.redis_client.publish(
                redis_keys.device_updates_channel(device_id),
                json.dumps({"timestamp": timestamp, "device_id": device_id}),
            )
            self.redis_client.publish(
                redis_keys.global_updates_channel(),
                json.dumps({"timestamp": timestamp, "device_id": device_id}),
            )

        except Exception as e:
            print(f"[RedisForwarder] Error storing batch report: {e}")

    def _update_device(
        self,
        device_id: str,
        device_name: str,
        device_hostname: str | None,
        device_ip: str | None,
        threat_level: float,
        timestamp: int,
        player_nickname: str | None = None,
    ):
        """Update device info in Redis (matches dashboard's updateDevice structure)"""
        if not self.redis_client:
            return

        try:
            device_key = redis_keys.device_hash(device_id)
            now_seconds = timestamp

            # Get existing device data to preserve session_start
            existing_data = self.redis_client.hgetall(device_key)
            existing_session_start = existing_data.get("session_start")
            if not existing_session_start:
                existing_session_start = str(now_seconds)

            # Update device hash
            fields = {
                "device_id": device_id,
                "last_seen": str(now_seconds),
                "threat_level": str(int(threat_level)),
                "session_start": existing_session_start,
            }

            # Only update device_name if it's valid (not empty, not device_id)
            if device_name and isinstance(device_name, str) and device_name.strip() and device_name != device_id:
                fields["device_name"] = device_name

            if device_hostname and isinstance(device_hostname, str) and device_hostname.strip():
                fields["device_hostname"] = device_hostname

            if device_ip:
                fields["ip_address"] = device_ip

            # Preserve existing player_nickname if new one is not provided
            if player_nickname and isinstance(player_nickname, str) and player_nickname.strip():
                fields["player_nickname"] = player_nickname.strip()
                self.latest_nicknames[device_id] = player_nickname.strip()
            else:
                # If no new nickname provided, preserve existing one from Redis
                existing_nickname = existing_data.get("player_nickname")
                if existing_nickname and isinstance(existing_nickname, str) and existing_nickname.strip():
                    fields["player_nickname"] = existing_nickname.strip()
                    # Also update cache
                    if device_id not in self.latest_nicknames:
                        self.latest_nicknames[device_id] = existing_nickname.strip()

            self.redis_client.hset(device_key, mapping=fields)
            self.redis_client.expire(device_key, self.ttl_seconds)

            # Update threat key
            threat_key = redis_keys.device_threat(device_id)
            self.redis_client.set(threat_key, str(int(threat_level)), ex=self.ttl_seconds)

            # Add to device indexes
            self.redis_client.zadd(redis_keys.device_index(), {device_id: now_seconds * 1000})
            self.redis_client.zadd(redis_keys.top_players(), {device_id: threat_level})

        except Exception as e:
            print(f"[RedisForwarder] Error updating device: {e}")

    def _handle_player_name_signal(self, signal: Signal) -> None:
        """Persist player nickname when detector captures it."""
        if not signal.details:
            print("[RedisForwarder] Player Name Detected signal has no details - skipping")
            return

        nickname = None
        confidence = None
        try:
            payload = json.loads(signal.details)
            nickname = payload.get("player_name") or payload.get("nickname")
            confidence = payload.get("confidence_percent") or payload.get("confidence")
            print(f"[RedisForwarder] Parsed nickname from signal: {nickname} (confidence: {confidence})")
        except Exception as e:
            print(f"[RedisForwarder] Failed to parse Player Name Detected signal details: {e}")
            return

        if not nickname:
            print("[RedisForwarder] No nickname found in Player Name Detected signal")
            return

        # Ensure nickname is a string before calling .strip()
        if not isinstance(nickname, str):
            nickname = str(nickname) if nickname else None
            if not nickname:
                print("[RedisForwarder] Nickname could not be converted to string")
                return

        nickname = nickname.strip()
        if not nickname:
            print("[RedisForwarder] Nickname is empty after stripping")
            return

        device_id = signal.device_id or self.device_id
        self.latest_nicknames[device_id] = nickname
        print(f"[RedisForwarder] Stored nickname in cache: {nickname} for device_id: {device_id}")

        if not self.redis_client and not self._connect_redis():
            print("[RedisForwarder] Failed to connect to Redis - nickname not persisted")
            return

        if not self.redis_client:
            print("[RedisForwarder] Redis client not available - nickname not persisted")
            return

        device_key = redis_keys.device_hash(device_id)
        fields = {"player_nickname": nickname}
        if confidence is not None:
            fields["player_nickname_confidence"] = str(confidence)
        
        print(f"[RedisForwarder] Writing nickname to Redis: key={device_key}, nickname={nickname}, confidence={confidence}")
        self.redis_client.hset(device_key, mapping=fields)
        self.redis_client.expire(device_key, self.ttl_seconds)
        
        # Verify what was written
        written_data = self.redis_client.hgetall(device_key)
        print(f"[RedisForwarder] Verified nickname in Redis: {written_data.get('player_nickname', 'NOT FOUND')}")


# Global Redis forwarder instance
_redis_forwarder: RedisForwarder | None = None


def init_redis_forwarder(redis_url: str | None, ttl_seconds: int | None, event_bus) -> RedisForwarder | None:
    """Initialize Redis forwarder and subscribe to event bus (handles batch reports and Player Name Detected signals)."""
    global _redis_forwarder
    if not redis_url:
        return None

    if _redis_forwarder is None:
        _redis_forwarder = RedisForwarder(redis_url, ttl_seconds)
        if _redis_forwarder.enabled:
            def _on_detection(signal: Signal):
                _redis_forwarder.on_signal(signal)

            event_bus.subscribe("detection", _on_detection)
            print("[RedisForwarder] Subscribed to 'detection' events - will receive Player Name Detected signals")
        else:
            _redis_forwarder = None
    return _redis_forwarder


def stop_redis_forwarder():
    """Stop Redis forwarder if running."""
    global _redis_forwarder
    if _redis_forwarder:
        _redis_forwarder.cleanup()
        _redis_forwarder = None

