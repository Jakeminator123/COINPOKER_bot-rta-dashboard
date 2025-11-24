"""
Redis Command Client
====================
Polls Redis for commands from dashboard and writes results back to Redis.
Used when dashboard is hosted remotely (e.g. on Render) and HTTP is not accessible.
"""

import hashlib
import json
import time
from typing import Any, Optional

import redis

from core.system_info import get_windows_computer_name


class RedisCommandClient:
    """Redis-based command client for bidirectional communication with dashboard."""

    def __init__(
        self,
        redis_url: str | None,
        device_id: str | None = None,
        poll_interval: float = 2.0,
    ) -> None:
        self.redis_url = redis_url
        self.poll_interval = poll_interval
        self._last_fetch = 0.0
        self.enabled = bool(redis_url)
        
        # Compute device ID to match scanner
        if device_id:
            self.device_id = device_id
        else:
            computer_name = get_windows_computer_name()
            self.device_id = hashlib.md5(computer_name.encode()).hexdigest()
        
        self.redis_client: Optional[redis.Redis] = None
        
        if self.enabled:
            self._connect()
            if self.redis_client:
                print(f"[RedisCommandClient] Enabled for device {self.device_id}")
            else:
                self.enabled = False
                print("[RedisCommandClient] Failed to connect to Redis")
        else:
            print("[RedisCommandClient] Disabled (REDIS_URL missing)")

    def _connect(self) -> bool:
        """Connect to Redis."""
        if not self.redis_url:
            return False
        
        try:
            # Use decode_responses=True for easier string handling
            self.redis_client = redis.from_url(self.redis_url, decode_responses=True)
            # Test connection
            self.redis_client.ping()
            print("[RedisCommandClient] Connected to Redis successfully")
            return True
        except Exception as e:
            print(f"[RedisCommandClient] Redis connection failed: {e}")
            return False

    def fetch_commands(self) -> list[dict[str, Any]]:
        """Poll Redis for pending commands."""
        if not self.enabled or not self.redis_client:
            return []
        
        now = time.time()
        
        # Check poll interval
        if now - self._last_fetch < self.poll_interval:
            return []
        
        self._last_fetch = now
        
        try:
            # Get command queue for this device
            queue_key = f"device:{self.device_id}:command_queue"
            
            # Get up to 5 oldest commands from the sorted set
            command_ids = self.redis_client.zrange(queue_key, 0, 4)
            
            if not command_ids:
                return []
            
            commands = []
            for cmd_id in command_ids:
                # Fetch command details
                command_key = f"device:{self.device_id}:commands:{cmd_id}"
                command_data = self.redis_client.get(command_key)
                
                if command_data:
                    try:
                        command = json.loads(command_data)
                        # Only process pending commands
                        if command.get("status") == "pending":
                            commands.append(command)
                            
                            # Mark as processing
                            command["status"] = "processing"
                            self.redis_client.set(command_key, json.dumps(command), ex=300)
                            
                            # Remove from queue
                            self.redis_client.zrem(queue_key, cmd_id)
                            
                            print(f"[RedisCommandClient] Fetched command: {cmd_id} - {command.get('command')}")
                    except json.JSONDecodeError as e:
                        print(f"[RedisCommandClient] Invalid command JSON: {e}")
            
            return commands
            
        except Exception as e:
            print(f"[RedisCommandClient] Error fetching commands: {e}")
            return []

    def send_result(
        self,
        command: dict[str, Any],
        success: bool,
        output: str | None = None,
        error: str | None = None,
        admin_required: bool = False,
    ) -> bool:
        """Send command result back to Redis."""
        if not self.enabled or not self.redis_client:
            return False
        
        command_id = command.get("id")
        if not command_id:
            print("[RedisCommandClient] Command missing ID")
            return False
        
        try:
            # Create result object
            result = {
                "commandId": command_id,
                "success": success,
                "output": output,
                "error": error,
                "adminRequired": admin_required,
                "completedAt": int(time.time() * 1000),
            }
            
            # Store result in Redis
            result_key = f"device:{self.device_id}:command_result:{command_id}"
            self.redis_client.set(result_key, json.dumps(result), ex=3600)  # 1 hour TTL
            
            # Clean up command entry
            command_key = f"device:{self.device_id}:commands:{command_id}"
            self.redis_client.delete(command_key)
            
            print(f"[RedisCommandClient] Sent result for command {command_id}: success={success}")
            return True
            
        except Exception as e:
            print(f"[RedisCommandClient] Error sending result: {e}")
            return False

    def cleanup(self):
        """Clean up Redis connection."""
        if self.redis_client:
            try:
                self.redis_client.close()
            except Exception:
                pass
            self.redis_client = None
