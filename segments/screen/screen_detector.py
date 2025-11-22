# segments/screen/screen_detector.py
"""
Screen and window analysis detector.
Monitors for overlays, suspicious window hierarchies, and poker window interactions.
Integrated from skarm_fonster.py functionality.
"""

from __future__ import annotations

import time
from collections import defaultdict

from core.api import BaseSegment, post_signal
from utils.config_loader import get_config
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown


# Load configuration
def _load_screen_config():
    """Load screen configuration from config_loader (dashboard/cache/local)"""
    try:
        config = get_config("screen_config")
        if config:
            return config
    except Exception as e:
        print(f"[ScreenDetector] WARNING: Config load failed: {e}")

    # Return minimal defaults
    return {
        "overlay_detection": {"ignored_overlays": []},
        "poker_monitoring": {},
        "alert_settings": {"alert_cooldown": 45.0},
    }


_config = _load_screen_config()

# Optional pywin32 for window analysis
try:
    import psutil  # type: ignore
    import win32con
    import win32gui
    import win32process
except ImportError:
    win32gui = None
    win32process = None
    win32con = None
    psutil = None

# WinEvent constants for background detection - loaded from config or use defaults
_winevent = _config.get("winevent_monitoring", {}).get("events", {})
WINEVENT_OUTOFCONTEXT = _winevent.get("WINEVENT_OUTOFCONTEXT", 0x0000)
WINEVENT_SKIPOWNPROCESS = _winevent.get("WINEVENT_SKIPOWNPROCESS", 0x0002)
EVENT_SYSTEM_FOREGROUND = _winevent.get("EVENT_SYSTEM_FOREGROUND", 0x0003)
EVENT_OBJECT_INVOKED = _winevent.get("EVENT_OBJECT_INVOKED", 0x8013)

# Try to import ctypes for WinEvent hooks
try:
    import ctypes
    import ctypes.wintypes as wintypes
    import threading
except ImportError:
    ctypes = None
    wintypes = None
    threading = None


# Helper functions for window rectangle operations
def _hwnd_rect(hwnd):
    """Get window rectangle"""
    try:
        r = wintypes.RECT()
        if ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(r)):
            return (r.left, r.top, r.right, r.bottom)
    except Exception:
        pass
    return None


def _rect_intersects(a, b, min_area=10000):
    """Check if two rectangles intersect with minimum area"""
    if not a or not b:
        return False
    x = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    y = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return (x * y) >= min_area


class ScreenDetector(BaseSegment):
    """
    Detects suspicious window behavior, overlays, and screen-based threats.
    Monitors CoinPoker window interactions and overlay detection.
    """

    name = "ScreenDetector"
    category = "screen"
    interval_s = 92.0  # Synchronized with unified batch interval

    def __init__(self):
        super().__init__()
        self._last_alerts: dict[str, float] = defaultdict(float)

        # Load alert settings from config
        alert_config = _config.get("alert_settings", {})
        self._alert_cooldown = apply_cooldown(alert_config.get("alert_cooldown", 45.0))
        self.interval_s = alert_config.get("detection_interval", 92.0)

        # Load overlay detection configuration
        overlay_config = _config.get("overlay_detection", {})
        self._ignored_overlays = overlay_config.get("ignored_overlays", [])
        self.overlay_classes = overlay_config.get("overlay_classes", [])
        self.hud_overlay_patterns = overlay_config.get("hud_overlay_patterns", [])
        self.suspicious_keywords = overlay_config.get("suspicious_keywords", [])
        self.safe_processes = overlay_config.get("safe_processes", [])
        self.system_window_keywords = overlay_config.get("system_window_keywords", [])

        # Load poker monitoring configuration
        poker_config = _config.get("poker_monitoring", {})
        protected = poker_config.get("protected_poker", {})

        # PROTECTED poker client (CoinPoker)
        self.protected_poker = {
            protected.get("process", "game.exe"): {
                "name": protected.get("name", "CoinPoker"),
                "path_hint": protected.get("path_hint", "CoinPoker"),
                "window_class": protected.get("window_class", "Qt673QWindowIcon"),
                "title_patterns": protected.get(
                    "title_patterns", ["coinpoker", "nl ", "plo ", "ante"]
                ),
            }
        }

        # OTHER poker sites (monitor but don't treat as threats)
        self.other_poker_processes = poker_config.get("other_poker_sites", [])
        self.poker_table_patterns = poker_config.get("poker_table_patterns", [])

        # Track active poker windows
        self.poker_windows: set[int] = set()  # All poker windows
        self.protected_windows: set[int] = set()  # Only CoinPoker windows
        self.last_poker_focus = 0.0

        # Load window hierarchy configuration
        hierarchy_config = _config.get("window_hierarchy", {})
        self.suspicious_child_keywords = hierarchy_config.get("suspicious_child_keywords", [])
        self.normal_poker_ui = hierarchy_config.get("normal_poker_ui_elements", [])

        # Load background detection settings
        bg_config = _config.get("background_detection", {})
        self.invoke_cooldown = apply_cooldown(bg_config.get("invoke_cooldown", 45.0))
        self.focus_alert_threshold = bg_config.get("focus_alert_threshold", 600)
        self.multitable_detection = bg_config.get("multitable_detection", True)

        # Load severity levels
        self.severity_levels = _config.get("severity_levels", {})

        # Load WinEvent monitoring settings
        winevent_config = _config.get("winevent_monitoring", {})
        self.winevent_enabled = winevent_config.get("enabled", True)
        self.winevent_events = winevent_config.get("events", {})

        # Background invoke detection
        self.foreground_hwnd = None
        self.invoke_events = []
        self.winevent_thread = None
        self.winevent_running = False
        self._winevent_tid = 0  # Win32 thread id for the hook thread

        # Alert tracking limits
        self.max_invoke_events = alert_config.get("max_invoke_events", 100)
        self.invoke_event_ttl = apply_cooldown(alert_config.get("invoke_event_ttl", 300))

        keepalive_seconds = float(alert_config.get("keepalive_seconds", 45.0))
        keepalive_seconds = max(15.0, min(keepalive_seconds, 60.0))
        active_timeout = float(alert_config.get("keepalive_active_timeout", 150.0))
        if active_timeout < keepalive_seconds * 2:
            active_timeout = keepalive_seconds * 2
        self._keepalive = DetectionKeepalive(
            "screen",
            keepalive_interval=keepalive_seconds,
            active_timeout=active_timeout,
        )

        # Start WinEvent monitoring if available and enabled
        if ctypes and threading and self.winevent_enabled:
            self._start_winevent_monitoring()

        print(f"[ScreenDetector] Protecting: {list(self.protected_poker.keys())}")
        print(
            f"[ScreenDetector] Loaded {len(self._ignored_overlays)} ignored overlay patterns from config"
        )
        print(f"[ScreenDetector] Monitoring {len(self.other_poker_processes)} other poker sites")

    def tick(self):
        """Main detection loop"""
        if not win32gui or not win32process or not psutil:
            self._keepalive.emit_keepalives()
            return  # Skip if dependencies not available

        try:
            # Detect overlays
            self._detect_overlays()

            # Monitor poker window interactions
            self._monitor_poker_windows()

            # Check for suspicious window hierarchies
            self._check_window_hierarchies()

            # Clean up old invoke events
            self._cleanup_invoke_events()

        except Exception:
            # Silently handle errors to avoid disrupting other segments
            pass

        self._keepalive.emit_keepalives()

    def _detect_overlays(self):
        """Detect overlay windows on screen"""
        overlays_found = []
        now = time.time()

        # Get minimum overlap area from config
        overlay_config = _config.get("overlay_detection", {})
        min_overlap = overlay_config.get("overlay_min_overlap_area", 10000)

        # Collect CoinPoker window rectangles for overlap testing
        protected_rects = []
        for h in list(getattr(self, "protected_windows", set())):
            rc = _hwnd_rect(h)
            if rc:
                protected_rects.append(rc)

        def enum_windows_proc(hwnd, lparam):
            try:
                if not win32gui.IsWindowVisible(hwnd):
                    return True

                class_name = win32gui.GetClassName(hwnd)
                title = win32gui.GetWindowText(hwnd)

                # Check for overlay class names (but skip ignored ones)
                if any(overlay in class_name for overlay in self.overlay_classes):
                    # Check ignore list first
                    should_ignore = any(
                        ignored in title.lower() or ignored in class_name.lower()
                        for ignored in self._ignored_overlays
                    )

                    if not should_ignore:
                        thread_id, process_id = win32process.GetWindowThreadProcessId(hwnd)

                        # Check additional properties
                        try:
                            exstyle = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)
                            is_topmost = bool(exstyle & win32con.WS_EX_TOPMOST)
                            is_layered = bool(exstyle & win32con.WS_EX_LAYERED)

                            # Get alpha if possible
                            alpha = None
                            if is_layered and ctypes:
                                try:
                                    crKey = wintypes.DWORD()
                                    bAlpha = wintypes.BYTE()
                                    dwFlags = wintypes.DWORD()
                                    if ctypes.windll.user32.GetLayeredWindowAttributes(
                                        hwnd,
                                        ctypes.byref(crKey),
                                        ctypes.byref(bAlpha),
                                        ctypes.byref(dwFlags),
                                    ):
                                        alpha = int(bAlpha.value)
                                except Exception:
                                    pass

                            orect = _hwnd_rect(hwnd)
                            over_coinpoker = any(
                                _rect_intersects(orect, pr, min_overlap) for pr in protected_rects
                            )
                        except Exception:
                            is_topmost = False
                            is_layered = False
                            alpha = None
                            over_coinpoker = False

                        overlays_found.append(
                            {
                                "hwnd": hwnd,
                                "title": title,
                                "class": class_name,
                                "pid": process_id,
                                "type": "Overlay Class",
                                "topmost": is_topmost,
                                "layered": is_layered,
                                "alpha": alpha,
                                "over_coinpoker": over_coinpoker,
                            }
                        )

                # Check for HUD overlays specifically (but skip ignored ones)
                elif any(hud in title.lower() for hud in self.hud_overlay_patterns) or any(
                    hud in class_name.lower() for hud in self.hud_overlay_patterns
                ):
                    # Check ignore list
                    should_ignore = any(
                        ignored in title.lower() or ignored in class_name.lower()
                        for ignored in self._ignored_overlays
                    )

                    if not should_ignore:
                        thread_id, process_id = win32process.GetWindowThreadProcessId(hwnd)

                        # Check additional properties for HUD overlay
                        try:
                            exstyle = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)
                            is_topmost = bool(exstyle & win32con.WS_EX_TOPMOST)
                            is_layered = bool(exstyle & win32con.WS_EX_LAYERED)

                            # Get alpha if possible
                            alpha = None
                            if is_layered and ctypes:
                                try:
                                    crKey = wintypes.DWORD()
                                    bAlpha = wintypes.BYTE()
                                    dwFlags = wintypes.DWORD()
                                    if ctypes.windll.user32.GetLayeredWindowAttributes(
                                        hwnd,
                                        ctypes.byref(crKey),
                                        ctypes.byref(bAlpha),
                                        ctypes.byref(dwFlags),
                                    ):
                                        alpha = int(bAlpha.value)
                                except Exception:
                                    pass

                            orect = _hwnd_rect(hwnd)
                            over_coinpoker = any(
                                _rect_intersects(orect, pr, min_overlap) for pr in protected_rects
                            )
                        except Exception:
                            is_topmost = False
                            is_layered = False
                            alpha = None
                            over_coinpoker = False

                        overlays_found.append(
                            {
                                "hwnd": hwnd,
                                "title": title,
                                "class": class_name,
                                "pid": process_id,
                                "type": "HUD Overlay",
                                "topmost": is_topmost,
                                "layered": is_layered,
                                "alpha": alpha,
                                "over_coinpoker": over_coinpoker,
                            }
                        )

                # Check for layered (transparent) windows
                try:
                    style = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)
                    if style & win32con.WS_EX_LAYERED:
                        thread_id, process_id = win32process.GetWindowThreadProcessId(hwnd)

                        # Get process name to check whitelist
                        try:
                            proc = psutil.Process(process_id)
                            proc_name = proc.name().lower()
                        except Exception:
                            proc_name = ""

                        # Use safe processes from config
                        safe_processes = self.safe_processes

                        # Use system keywords from config
                        system_keywords = self.system_window_keywords

                        # Check ignore list from overlays_to_ignore.txt
                        should_ignore = any(
                            ignored in title.lower()
                            or ignored in class_name.lower()
                            or ignored in proc_name.lower()
                            for ignored in self._ignored_overlays
                        )

                        if proc_name in safe_processes:
                            pass  # Skip safe processes
                        elif any(sys in title.lower() for sys in system_keywords):
                            pass  # Skip system windows
                        elif should_ignore:
                            pass  # Skip ignored overlays
                        else:
                            # Check additional properties for layered window
                            try:
                                is_topmost = bool(style & win32con.WS_EX_TOPMOST)

                                # Get alpha if possible
                                alpha = None
                                if ctypes:
                                    try:
                                        crKey = wintypes.DWORD()
                                        bAlpha = wintypes.BYTE()
                                        dwFlags = wintypes.DWORD()
                                        if ctypes.windll.user32.GetLayeredWindowAttributes(
                                            hwnd,
                                            ctypes.byref(crKey),
                                            ctypes.byref(bAlpha),
                                            ctypes.byref(dwFlags),
                                        ):
                                            alpha = int(bAlpha.value)
                                    except Exception:
                                        pass

                                orect = _hwnd_rect(hwnd)
                                over_coinpoker = any(
                                    _rect_intersects(orect, pr) for pr in protected_rects
                                )
                            except Exception:
                                is_topmost = False
                                alpha = None
                                over_coinpoker = False

                            # Only flag if it's actually suspicious and not on ignore list
                            overlays_found.append(
                                {
                                    "hwnd": hwnd,
                                    "title": title,
                                    "class": class_name,
                                    "pid": process_id,
                                    "type": "Layered Window",
                                    "topmost": is_topmost,
                                    "layered": True,
                                    "alpha": alpha,
                                    "over_coinpoker": over_coinpoker,
                                }
                            )
                except Exception:
                    pass

            except Exception:
                pass
            return True

        try:
            win32gui.EnumWindows(enum_windows_proc, None)
        except Exception:
            return

        # Report overlays
        for overlay in overlays_found:
            alert_key = f"overlay_{overlay['hwnd']}"
            if now - self._last_alerts[alert_key] >= self._alert_cooldown:
                # Get process name for context
                try:
                    proc = psutil.Process(overlay["pid"])
                    proc_name = proc.name()
                except Exception:
                    proc_name = "Unknown"

                # Determine severity - prioritize PROTECTED poker (CoinPoker)
                coinpoker_active = len(getattr(self, "protected_windows", set())) > 0
                other_poker_active = len(self.poker_windows) > len(
                    getattr(self, "protected_windows", set())
                )

                # Check if overlay is actually over CoinPoker
                if overlay.get("over_coinpoker") and (
                    overlay.get("topmost") or overlay.get("layered")
                ):
                    if coinpoker_active:
                        status = self.severity_levels.get("protected_overlay_overlap", "ALERT")
                        name = f"Overlay Above CoinPoker: {proc_name}"
                    else:
                        status = self.severity_levels.get("other_overlay_overlap", "WARN")
                        name = f"Overlay Above Poker: {proc_name}"
                elif overlay["type"] == "HUD Overlay":
                    if coinpoker_active and overlay.get("over_coinpoker"):
                        # HUD directly over CoinPoker = CRITICAL
                        status = "CRITICAL"
                        name = f"HUD Over CoinPoker Table: {proc_name}"
                    elif coinpoker_active:
                        # HUD during CoinPoker = ALERT
                        status = self.severity_levels.get("protected_hud", "ALERT")
                        name = f"HUD Active During CoinPoker: {proc_name}"
                    elif other_poker_active:
                        # HUD during other poker = WARN
                        status = self.severity_levels.get("other_hud", "WARN")
                        name = f"HUD Active During Other Poker: {proc_name}"
                    else:
                        # HUD without poker = INFO
                        status = "INFO"
                        name = f"HUD Overlay: {proc_name}"
                elif any(susp in overlay["title"].lower() for susp in self.suspicious_keywords):
                    # Suspicious overlays - use highest severity
                    if overlay.get("over_coinpoker"):
                        status = "CRITICAL"
                        name = f"DANGEROUS: Suspicious Overlay Over CoinPoker: {proc_name}"
                    else:
                        status = self.severity_levels.get("suspicious_overlay", "ALERT")
                        name = f"Suspicious Overlay: {proc_name}"
                else:
                    # General overlay detection
                    status = self.severity_levels.get("general_overlay", "INFO")
                    name = f"Overlay Detected: {proc_name}"

                details = (
                    f"{overlay['type']} - '{overlay['title'][:50]}' (class: {overlay['class']})"
                )
                if overlay.get("alpha") is not None:
                    details += f" | alpha={overlay['alpha']}"
                if overlay.get("topmost"):
                    details += " | TOPMOST"
                if overlay.get("over_coinpoker"):
                    details += " | OVER_COINPOKER"
                post_signal("screen", name, status, details)
                self._last_alerts[alert_key] = now
                detection_key = f"{alert_key}:{status}"
                self._keepalive.mark_active(
                    detection_key,
                    name,
                    status,
                    details,
                    alias=alert_key,
                )
            else:
                self._keepalive.refresh_alias(alert_key)

    def _monitor_poker_windows(self):
        """Monitor poker client windows - focus on PROTECTED poker (CoinPoker)"""
        current_poker_windows = set()
        current_protected_windows = set()
        foreground_hwnd = win32gui.GetForegroundWindow()
        now = time.time()

        # Find all poker windows
        def enum_poker_windows(hwnd, lparam):
            try:
                if not win32gui.IsWindowVisible(hwnd):
                    return True

                title = win32gui.GetWindowText(hwnd).lower()
                class_name = win32gui.GetClassName(hwnd)
                thread_id, process_id = win32process.GetWindowThreadProcessId(hwnd)

                try:
                    proc = psutil.Process(process_id)
                    proc_name = proc.name().lower()
                    proc_path = proc.exe().lower()
                except Exception:
                    proc_name = ""
                    proc_path = ""

                # Check if it's PROTECTED poker (CoinPoker/game.exe)
                is_protected = False
                if (
                    proc_name == "game.exe"
                    and "coinpoker" in proc_path
                    or class_name == "Qt673QWindowIcon"
                    and any(pattern in title for pattern in ["nl ", "plo ", "ante", "coinpoker"])
                ):
                    is_protected = True
                    current_protected_windows.add(hwnd)

                # Check for other poker sites
                elif any(poker in title for poker in self.other_poker_processes) or any(
                    poker in proc_name for poker in self.other_poker_processes
                ):
                    current_poker_windows.add(hwnd)
                    # Log other poker sites but don't treat as threats
                    if hwnd == foreground_hwnd:
                        poker_site = next(
                            (p for p in self.other_poker_processes if p in title or p in proc_name),
                            "Unknown",
                        )
                        # Per-site cooldown to avoid spam
                        key = f"other_site:{poker_site}"
                        if now - self._last_alerts.get(key, 0.0) >= max(60.0, self._alert_cooldown):
                            post_signal(
                                "screen",
                                f"Other Poker Site: {poker_site.title()}",
                                "INFO",
                                f"Window: {title[:50]} (proc: {proc_name})",
                            )
                            self._last_alerts[key] = now
                            detection_key = f"{key}:INFO"
                            self._keepalive.mark_active(
                                detection_key,
                                f"Other Poker Site: {poker_site.title()}",
                                "INFO",
                                f"Window: {title[:50]} (proc: {proc_name})",
                                alias=key,
                            )
                        else:
                            self._keepalive.refresh_alias(key)

                # Track focus for PROTECTED poker only
                if is_protected and hwnd == foreground_hwnd:
                    self.last_poker_focus = now

            except Exception:
                pass
            return True

        try:
            win32gui.EnumWindows(enum_poker_windows, None)
        except Exception:
            return

        # Update tracking - prioritize PROTECTED windows
        self.poker_windows = current_protected_windows | current_poker_windows  # All poker windows
        self.protected_windows = current_protected_windows  # Only CoinPoker windows

        # Alert for extended focus - ONLY for PROTECTED poker (CoinPoker)
        if foreground_hwnd in current_protected_windows:
            focus_duration = now - self.last_poker_focus
            if focus_duration > self.focus_alert_threshold:
                alert_key = "long_coinpoker_focus"
                severity = self.severity_levels.get("extended_focus", "INFO")
                details = (
                    f"CoinPoker window in focus for {focus_duration / 60:.1f} minutes (potential bot play)"
                )
                if now - self._last_alerts[alert_key] >= self.focus_alert_threshold:
                    post_signal(
                        "screen",
                        "Extended CoinPoker Focus",
                        severity,
                        details,
                    )
                    self._last_alerts[alert_key] = now
                    detection_key = f"{alert_key}:focus"
                    self._keepalive.mark_active(
                        detection_key,
                        "Extended CoinPoker Focus",
                        severity,
                        details,
                        alias=alert_key,
                    )
                else:
                    self._keepalive.refresh_alias(alert_key)

    def _check_window_hierarchies(self):
        """Check for suspicious parent-child window relationships"""
        now = time.time()

        # Check each poker window for suspicious children
        for poker_hwnd in self.poker_windows:
            try:
                children = []

                def enum_child_proc(child_hwnd, lparam):
                    try:
                        title = win32gui.GetWindowText(child_hwnd)
                        class_name = win32gui.GetClassName(child_hwnd)

                        # Use suspicious keywords from config
                        if any(
                            susp in title.lower() for susp in self.suspicious_child_keywords
                        ) or any(
                            susp in class_name.lower() for susp in self.suspicious_child_keywords
                        ):
                            children.append(
                                {
                                    "hwnd": child_hwnd,
                                    "title": title,
                                    "class": class_name,
                                }
                            )
                    except Exception:
                        pass
                    return True

                win32gui.EnumChildWindows(poker_hwnd, enum_child_proc, None)

                # Report only truly dangerous child windows
                for child in children:
                    alert_key = f"child_{child['hwnd']}"
                    if now - self._last_alerts[alert_key] >= self._alert_cooldown:
                        poker_title = win32gui.GetWindowText(poker_hwnd)
                        severity = self.severity_levels.get("dangerous_child", "ALERT")
                        details = f"In poker window '{poker_title[:30]}': {child['title']} ({child['class']})"
                        post_signal("screen", "Dangerous Child Window", severity, details)
                        self._last_alerts[alert_key] = now
                        detection_key = f"{alert_key}:{severity}"
                        self._keepalive.mark_active(
                            detection_key,
                            "Dangerous Child Window",
                            severity,
                            details,
                            alias=alert_key,
                        )
                    else:
                        self._keepalive.refresh_alias(alert_key)

            except Exception:
                continue

    def stop(self):
        """Clean shutdown"""
        self._stop_winevent_monitoring()
        super().stop()

    def _start_winevent_monitoring(self):
        """Start WinEvent monitoring in background thread"""
        if not self.winevent_running:
            self.winevent_running = True
            self.winevent_thread = threading.Thread(target=self._winevent_loop, daemon=True)
            self.winevent_thread.start()

    def _stop_winevent_monitoring(self):
        """Stop WinEvent monitoring with timeout"""
        self.winevent_running = False
        if ctypes:
            try:
                tid = getattr(self, "_winevent_tid", 0)
                if tid:
                    ctypes.windll.user32.PostThreadMessageW(tid, 0x0012, 0, 0)  # WM_QUIT
            except Exception:
                pass
        try:
            if self.winevent_thread and self.winevent_thread.is_alive():
                self.winevent_thread.join(timeout=0.5)
        except Exception:
            pass
        self._winevent_tid = 0

    def _winevent_loop(self):
        """WinEvent monitoring loop (runs in separate thread)"""
        try:
            # Define callback function type
            WinEventProcType = ctypes.WINFUNCTYPE(
                None,
                wintypes.HANDLE,
                wintypes.DWORD,
                wintypes.HWND,
                wintypes.LONG,
                wintypes.LONG,
                wintypes.DWORD,
                wintypes.DWORD,
            )

            # Save Win32 thread ID for correct WM_QUIT
            try:
                self._winevent_tid = ctypes.windll.kernel32.GetCurrentThreadId()
            except Exception:
                self._winevent_tid = 0

            def callback(
                hWinEventHook,
                event,
                hwnd,
                idObject,
                idChild,
                dwEventThread,
                dwmsEventTime,
            ):
                try:
                    if event == EVENT_SYSTEM_FOREGROUND:
                        # Track foreground changes
                        self.foreground_hwnd = hwnd

                    elif event == EVENT_OBJECT_INVOKED:
                        # Check if invoke happened in non-foreground window
                        if hwnd and self.foreground_hwnd and hwnd != self.foreground_hwnd:
                            # Record suspicious background invoke
                            self.invoke_events.append(
                                {
                                    "time": time.time(),
                                    "hwnd": hwnd,
                                    "foreground": self.foreground_hwnd,
                                }
                            )

                            # Check if it's a poker window - PRIORITY for protected windows
                            if hwnd in self.protected_windows:
                                self._report_background_invoke(hwnd, is_protected=True)
                            elif hwnd in self.poker_windows:
                                self._report_background_invoke(hwnd, is_protected=False)

                except Exception:
                    pass

            # Convert to C callback
            callback_func = WinEventProcType(callback)

            # Set up hooks
            hook1 = ctypes.windll.user32.SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                0,
                callback_func,
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )

            hook2 = ctypes.windll.user32.SetWinEventHook(
                EVENT_OBJECT_INVOKED,
                EVENT_OBJECT_INVOKED,
                0,
                callback_func,
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )

            if not hook1 or not hook2:
                return

            # Message loop with timeout
            msg = wintypes.MSG()
            while self.winevent_running:
                bRet = ctypes.windll.user32.PeekMessageW(
                    ctypes.byref(msg), None, 0, 0, 1
                )  # PM_REMOVE
                if bRet > 0:
                    if msg.message == 0x0012:  # WM_QUIT
                        break
                    ctypes.windll.user32.TranslateMessage(ctypes.byref(msg))
                    ctypes.windll.user32.DispatchMessageW(ctypes.byref(msg))
                else:
                    time.sleep(0.02)  # No message, sleep to reduce CPU

            # Unhook
            if hook1:
                ctypes.windll.user32.UnhookWinEvent(hook1)
            if hook2:
                ctypes.windll.user32.UnhookWinEvent(hook2)

        except Exception:
            pass

    def _report_background_invoke(self, hwnd: int, is_protected: bool = False):
        """Report background window UI automation - based on more_screen.txt background detection"""
        now = time.time()
        alert_key = f"bg_invoke_{hwnd}"

        if now - self._last_alerts.get(alert_key, 0) >= self.invoke_cooldown:
            try:
                # Get window info
                title = win32gui.GetWindowText(hwnd)
                class_name = win32gui.GetClassName(hwnd)
                thread_id, process_id = win32process.GetWindowThreadProcessId(hwnd)

                # Get process name and path
                try:
                    proc = psutil.Process(process_id)
                    proc_name = proc.name()
                    _ = proc.exe()  # Get path but don't use it directly
                except Exception:
                    proc_name = "Unknown"

                # Check if foreground is also poker (could be multi-tabling)
                fg_is_protected_poker = False
                fg_is_other_poker = False

                if self.foreground_hwnd:
                    try:
                        fg_title = win32gui.GetWindowText(self.foreground_hwnd).lower()
                        fg_class = win32gui.GetClassName(self.foreground_hwnd)

                        # Check if foreground is CoinPoker
                        if fg_class == "Qt673QWindowIcon" and any(
                            pattern in fg_title for pattern in ["nl ", "plo ", "ante"]
                        ):
                            fg_is_protected_poker = True
                        # Check if foreground is other poker
                        elif any(poker in fg_title for poker in self.other_poker_processes):
                            fg_is_other_poker = True
                    except Exception:
                        pass

                # Determine severity based on protected status and foreground context
                if is_protected and not fg_is_protected_poker:
                    # CRITICAL: CoinPoker being automated while not in focus
                    status = self.severity_levels.get("background_automation_protected", "ALERT")
                    name = "CoinPoker Background Automation"
                    detail_context = f"CoinPoker window '{title[:30]}' automated while not in focus (protected site)"
                elif is_protected and fg_is_protected_poker and self.multitable_detection:
                    # Could be legitimate CoinPoker multi-tabling
                    status = self.severity_levels.get("multitable_activity", "INFO")
                    name = "CoinPoker Multi-table Activity"
                    detail_context = "CoinPoker background activity (multi-tabling?)"
                elif not is_protected and not fg_is_other_poker:
                    # Other poker site being automated
                    status = self.severity_levels.get("background_automation_other", "WARN")
                    name = "Other Poker Site Automation"
                    detail_context = "Non-CoinPoker poker window automated"
                else:
                    # Normal multi-tabling for other sites
                    status = self.severity_levels.get("multitable_activity", "INFO")
                    name = "Background Poker Activity"
                    detail_context = "Background poker window activity"

                # Add technical details from window analysis
                details = (
                    f"{detail_context} | HWND: {hwnd} | Class: {class_name} | Process: {proc_name}"
                )
                if is_protected:
                    details += " | PROTECTED SITE"

                post_signal("screen", name, status, details)
                self._last_alerts[alert_key] = now
                detection_key = f"{alert_key}:{status}"
                self._keepalive.mark_active(
                    detection_key,
                    name,
                    status,
                    details,
                    alias=alert_key,
                )

            except Exception:
                pass
        else:
            self._keepalive.refresh_alias(alert_key)

    def _cleanup_invoke_events(self):
        """Clean up old invoke events to prevent memory growth"""
        if len(self.invoke_events) > self.max_invoke_events:
            # Keep only half of max events
            self.invoke_events = self.invoke_events[-(self.max_invoke_events // 2) :]

        # Remove events older than TTL
        now = time.time()
        self.invoke_events = [
            e for e in self.invoke_events if now - e["time"] < self.invoke_event_ttl
        ]
