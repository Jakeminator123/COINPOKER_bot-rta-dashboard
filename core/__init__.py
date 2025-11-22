# Core module initialization
"""
Core API for bot detection system.
Provides EventBus, Signal, BaseSegment, ForwarderService, and SegmentLoader.
"""

from .api import (
    BaseSegment,
    EventBus,
    Signal,
    get_event_bus,
    get_threat_manager,
    init_report_batcher,
    init_web_forwarder,
    post_signal,
    stop_web_forwarder,
)
from .forwarder import ForwarderService
from .segment_loader import SegmentLoader

__all__ = [
    "BaseSegment",
    "Signal",
    "EventBus",
    "get_event_bus",
    "post_signal",
    "init_web_forwarder",
    "stop_web_forwarder",
    "init_report_batcher",
    "get_threat_manager",
    "SegmentLoader",
    "ForwarderService",
]
