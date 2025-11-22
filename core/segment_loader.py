"""
Segment Loader
==============
Dynamically loads and starts segments from segments/<category>.
"""

import importlib
import os
import sys

from core.api import BaseSegment
from utils.runtime_flags import sync_segments_enabled


class SegmentLoader:
    """Dynamically loads and starts segments from segments/<category>."""

    def __init__(self):
        self.segments: dict[str, BaseSegment] = {}
        self.segment_classes: dict[str, type[BaseSegment]] = {}
        self._stopping = False
        self._sync_segments = sync_segments_enabled()

    def discover_segments(self, segments_base_dir: str = None) -> list[str]:
        """Discover all segment modules in segments/ directory."""
        discovered: list[str] = []

        if segments_base_dir is None:
            # Handle both script and .exe execution
            if getattr(sys, "frozen", False):
                # Running as .exe - segments are in PyInstaller temp extraction directory
                segments_base_dir = os.path.join(sys._MEIPASS, "segments")
            else:
                # Running as script - segments are next to scanner.py
                segments_base_dir = os.path.join(
                    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "segments",
                )

        if not os.path.exists(segments_base_dir):
            print(f"[Loader] WARNING: segments/ directory missing: {segments_base_dir}")
            return discovered

        for category in ["programs", "network", "behaviour", "vm", "auto", "screen"]:
            category_dir = os.path.join(segments_base_dir, category)
            if not os.path.exists(category_dir):
                continue

            for filename in os.listdir(category_dir):
                if filename.endswith(".py") and filename != "__init__.py":
                    module_name = f"segments.{category}.{filename[:-3]}"
                    discovered.append(module_name)

        return discovered

    def load_segments(self, segments_base_dir: str = None) -> None:
        """Load segment classes from discovered modules."""
        discovered = self.discover_segments(segments_base_dir)
        loaded_count = 0
        for module_name in discovered:
            try:
                module = importlib.import_module(module_name)
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)
                    if (
                        isinstance(attr, type)
                        and issubclass(attr, BaseSegment)
                        and attr is not BaseSegment
                    ):
                        class_name = f"{module_name}.{attr_name}"
                        self.segment_classes[class_name] = attr
                        loaded_count += 1
            except Exception as e:
                print(f"[Loader] ERROR: Failed to load {module_name}: {e}")
        if loaded_count > 0:
            print(f"[Loader] Loaded {loaded_count} segment(s)")

    def start_all(self, stagger_delay: float = None, batch_interval: float | None = None) -> None:
        """Start all loaded segments with staggered delays to distribute CPU load over batch interval."""
        if self._sync_segments:
            stagger_delay = 0.0
        elif stagger_delay is None:
            effective_interval = (
                batch_interval if batch_interval and batch_interval > 0 else 92.0
            )
            num_segments = len(self.segment_classes)
            if num_segments > 1:
                stagger_delay = effective_interval / num_segments
            else:
                stagger_delay = 2.0
        
        for idx, (class_name, segment_class) in enumerate(self.segment_classes.items()):
            try:
                instance = segment_class()
                instance._start_offset = idx * stagger_delay  # Distribute load over batch interval
                instance.start()
                self.segments[class_name] = instance
            except Exception as e:
                print(f"[Loader] ERROR: Start error {class_name}: {e}")

    def stop_all(self) -> None:
        """Stop all running segments gracefully."""
        if not self.segments:
            return

        # Prevent duplicate shutdown calls
        if self._stopping:
            return
        self._stopping = True

        print(f"[Loader] Stopping {len(self.segments)} segments...")
        # Signal stop first
        for segment in self.segments.values():
            try:
                segment._running = False
                # Also signal polling threads
                if hasattr(segment, "_polling_active"):
                    segment._polling_active = False
            except Exception:
                pass

        # cleanup
        for segment in self.segments.values():
            try:
                segment.cleanup()
            except Exception as e:
                print(f"[Loader]  ! Cleanup error in {getattr(segment, 'name', '?')}: {e}")

        # Wait briefly for threads (shorter timeout for faster shutdown)
        # Daemon threads will stop automatically when main program exits
        for segment in self.segments.values():
            try:
                if getattr(segment, "_thread", None) and segment._thread.is_alive():
                    # Most threads are daemon, so they'll stop automatically
                    # Only wait briefly for clean shutdown
                    segment._thread.join(timeout=0.5)  # Increased timeout for cleaner shutdown
                # Also check polling threads
                if (
                    hasattr(segment, "_polling_thread")
                    and segment._polling_thread
                    and segment._polling_thread.is_alive()
                ):
                    segment._polling_thread.join(timeout=0.5)  # Increased timeout
            except Exception as e:
                print(f"[Loader]  ! Thread join error in {getattr(segment, 'name', '?')}: {e}")

        # Clear segment references to help GC
        for segment in self.segments.values():
            try:
                # Clear any large data structures
                if hasattr(segment, "_tick_durations"):
                    segment._tick_durations.clear()
                if hasattr(segment, "vel_samples"):
                    segment.vel_samples.clear()
                if hasattr(segment, "dir_samples"):
                    segment.dir_samples.clear()
            except Exception:
                pass
        
        # Clear all segment references
        self.segments.clear()
        self.segment_classes.clear()
        
        print("[Loader] All segments stopped and cleaned up.")
        self._stopping = False  # Reset stopping flag
