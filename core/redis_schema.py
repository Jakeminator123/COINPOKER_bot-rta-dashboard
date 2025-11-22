"""
Shared Redis schema helpers for the scanner.

These helpers mirror Next.js `lib/redis/schema.ts` so both projects
write/read identical keys. Always use these helpers instead of hardcoded
strings when touching Redis.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _default_ttl() -> int:
    return int(os.getenv("REDIS_TTL_SECONDS", "604800"))


@dataclass(frozen=True)
class RedisKeys:
    def device_hash(self, device_id: str) -> str:
        return f"device:{device_id}"

    def device_categories(self, device_id: str) -> str:
        return f"device:{device_id}:categories"

    def device_detections(self, device_id: str, severity: str) -> str:
        return f"device:{device_id}:detections:{severity}"

    def device_threat(self, device_id: str) -> str:
        return f"device:{device_id}:threat"

    def batch_record(self, device_id: str, timestamp: int) -> str:
        return f"batch:{device_id}:{timestamp}"

    def batches_hourly(self, device_id: str) -> str:
        return f"batches:{device_id}:hourly"

    def batches_daily(self, device_id: str) -> str:
        return f"batches:{device_id}:daily"

    def day_stats(self, device_id: str, day: str) -> str:
        return f"day:{device_id}:{day}"

    def hour_stats(self, device_id: str, hour: str) -> str:
        return f"hour:{device_id}:{hour}"

    def player_summary(self, device_id: str) -> str:
        return f"player_summary:{device_id}"

    def session_record(self, device_id: str, timestamp: int) -> str:
        return f"session:{device_id}:{timestamp}"

    def session_index(self, device_id: str) -> str:
        return f"sessions:{device_id}"

    def session_pattern(self, device_id: str) -> str:
        return f"session:{device_id}:*"

    def device_index(self) -> str:
        return "devices"

    def top_players(self) -> str:
        return "top_players:bot_probability"

    def device_updates_channel(self, device_id: str) -> str:
        return f"updates:{device_id}"

    def global_updates_channel(self) -> str:
        return "updates:all"


redis_keys = RedisKeys()
redis_ttl_seconds = _default_ttl()


