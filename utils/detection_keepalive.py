"""
Utility helper to keep detections alive between heavy scans without
changing payload structure or severity.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Dict, Set

from core.api import post_signal


@dataclass
class _KeepaliveEntry:
    name: str
    status: str
    details: str
    last_seen: float = field(default_factory=time.time)
    last_emit: float = field(default_factory=time.time)


class DetectionKeepalive:
    """
    Tracks active detections and re-emits lightweight keepalive signals so that
    each threat appears in every 92s batch without repeating heavy work.
    """

    def __init__(
        self,
        category: str,
        keepalive_interval: float = 60.0,
        active_timeout: float = 300.0,
        emit_fn: Callable[[str, str, str], None] | None = None,
    ):
        self.category = category
        self.keepalive_interval = max(10.0, keepalive_interval)
        self.active_timeout = max(self.keepalive_interval, active_timeout)
        self._entries: Dict[str, _KeepaliveEntry] = {}
        self._aliases: Dict[str, Set[str]] = defaultdict(set)
        self._key_aliases: Dict[str, Set[str]] = defaultdict(set)
        # Allow custom emitters (useful for tests); default to post_signal
        self._emit_fn = emit_fn or (lambda name, status, details: post_signal(self.category, name, status, details))

    def mark_active(
        self,
        key: str,
        name: str,
        status: str,
        details: str,
        *,
        alias: str | None = None,
    ) -> None:
        """
        Declare a detection as active right after emitting the full/expensive signal.
        """
        now = time.time()
        entry = self._entries.get(key)
        if entry is None:
            entry = _KeepaliveEntry(name=name, status=status, details=details, last_seen=now, last_emit=now)
            self._entries[key] = entry
        else:
            entry.name = name
            entry.status = status
            entry.details = details
            entry.last_seen = now
            entry.last_emit = now

        if alias:
            bucket = self._aliases.setdefault(alias, set())
            bucket.add(key)
            self._key_aliases.setdefault(key, set()).add(alias)

    def refresh(self, key: str) -> None:
        """
        Refresh last_seen for an already-active detection without emitting.
        Use this when the threat is still present but cooldowns prevent re-sending.
        """
        entry = self._entries.get(key)
        if entry:
            entry.last_seen = time.time()

    def refresh_alias(self, alias: str) -> None:
        """
        Refresh all entries mapped to a given alias (e.g., exe path or pid).
        """
        keys = self._aliases.get(alias)
        if not keys:
            return
        now = time.time()
        for key in list(keys):
            entry = self._entries.get(key)
            if entry:
                entry.last_seen = now
            else:
                keys.remove(key)
        if not keys:
            self._aliases.pop(alias, None)

    def expire_alias(self, alias: str) -> None:
        """
        Immediately expire all entries associated with an alias.
        Use when a process/threat is confirmed to be gone.
        """
        keys = self._aliases.get(alias, set()).copy()
        for key in keys:
            self._entries.pop(key, None)
            key_aliases = self._key_aliases.pop(key, set())
            for other_alias in key_aliases:
                bucket = self._aliases.get(other_alias)
                if bucket:
                    bucket.discard(key)
                    if not bucket:
                        self._aliases.pop(other_alias, None)
        self._aliases.pop(alias, None)

    def cleanup_missing_aliases(self, seen_aliases: Set[str]) -> None:
        """
        Expire any aliases that are NOT in the seen_aliases set.
        Call this after processing all active threats to clean up stale entries.
        """
        current_aliases = set(self._aliases.keys())
        missing_aliases = current_aliases - seen_aliases
        for alias in missing_aliases:
            self.expire_alias(alias)

    def emit_keepalives(self) -> None:
        """
        Emit keepalive signals for any active detection that hasn't been reported
        within the keepalive interval. Entries automatically expire after
        active_timeout seconds without refresh.
        """
        if not self._entries:
            return

        now = time.time()
        expired = []
        for key, entry in self._entries.items():
            if now - entry.last_seen > self.active_timeout:
                expired.append(key)
                continue

            if now - entry.last_emit >= self.keepalive_interval:
                self._emit_fn(entry.name, entry.status, entry.details)
                entry.last_emit = now

        for key in expired:
            self._entries.pop(key, None)
            aliases = self._key_aliases.pop(key, set())
            for alias in aliases:
                bucket = self._aliases.get(alias)
                if bucket:
                    bucket.discard(key)
                    if not bucket:
                        self._aliases.pop(alias, None)

