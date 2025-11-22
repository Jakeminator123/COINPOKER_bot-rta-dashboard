"""Shared dataclasses used across detector components."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Signal:
    """Event signal structure for inter-segment communication."""

    timestamp: float
    category: str  # programs, network, behaviour
    name: str
    status: str  # OK, INFO, WARN, ALERT, CRITICAL
    details: str
    device_id: str | None = None
    device_name: str | None = None
    device_ip: str | None = None  # Source IP address
    segment_name: str | None = None  # Name of segment that created this signal


@dataclass
class ActiveThreat:
    """Persistent threat tracking for continuous bot probability calculation."""

    threat_id: str
    category: str
    name: str
    status: str
    details: str
    first_seen: float
    last_seen: float
    detection_count: int
    threat_score: float  # Individual threat contribution to bot probability
    detection_sources: list[str]  # Which segments detected this (for confidence)
    confidence_score: int  # Number of different sources (1-5+)

