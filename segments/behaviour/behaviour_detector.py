# segments/behaviour/behaviour_detector.py
"""
Polling-based Behaviour Detector (no admin, no hooks)
- Uses GetAsyncKeyState + GetCursorPos polling
- Tracks key/mouse patterns to detect bots
- All output in English
- Configurable via behaviour_config.json
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import math
import statistics as stats
import threading
import time
from collections import Counter, defaultdict, deque

import psutil  # type: ignore

from core.api import BaseSegment, post_signal
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown

# Load configurations
from utils.config_loader import get_config


def _load_behaviour_config():
    """Load behaviour configuration from config_loader (dashboard/cache/local)"""
    try:
        config = get_config("behaviour_config")
        if config:
            return config
    except Exception as e:
        print(f"[BehaviourDetector] WARNING: Config load failed: {e}")

    return {}


def _load_shared_config():
    """Load shared configuration from config_loader"""
    try:
        config = get_config("shared_config")
        if config:
            return config
    except Exception as e:
        print(f"[BehaviourDetector] WARNING: Shared config load failed: {e}")

    return {}


_behaviour_config = _load_behaviour_config()
_shared_config = _load_shared_config()

# Windows API setup
user32 = ctypes.WinDLL("user32", use_last_error=True)


class POINT(ctypes.Structure):
    _fields_ = [("x", wt.LONG), ("y", wt.LONG)]


GetAsyncKeyState = user32.GetAsyncKeyState
GetAsyncKeyState.argtypes = [wt.INT]
GetAsyncKeyState.restype = wt.SHORT

GetCursorPos = user32.GetCursorPos
GetCursorPos.argtypes = [ctypes.POINTER(POINT)]
GetCursorPos.restype = wt.BOOL

# Virtual key codes
VK_LBUTTON = 0x01
VK_RBUTTON = 0x02
VK_MBUTTON = 0x04
VK_XBUTTON1 = 0x05
VK_XBUTTON2 = 0x06
ESC = 0x1B


def now_ms():
    return time.perf_counter()


def angle(dx, dy):
    return math.atan2(dy, dx) if (dx or dy) else 0.0


def dist(p1, p2):
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    return math.hypot(dx, dy)


class Ring:
    """Ring buffer for efficient data storage"""

    def __init__(self, maxlen):
        self.q = deque(maxlen=maxlen)

    def add(self, x):
        self.q.append(x)

    def __len__(self):
        return len(self.q)

    def __iter__(self):
        return iter(self.q)

    def clear(self):
        self.q.clear()


class BehaviourDetector(BaseSegment):
    """
    Polling-based behaviour detector that works without admin rights
    """

    name = "BehaviourDetector"
    category = "behaviour"

    def __init__(self):
        super().__init__()

        # Load configuration
        polling_config = _behaviour_config.get("polling", {})
        self.thresholds = _behaviour_config.get("thresholds", {})
        self.weights = _behaviour_config.get("scoring_weights", {})
        reporting_config = _behaviour_config.get("reporting", {})

        # Polling settings
        self.hz = polling_config.get("frequency_hz", 200)
        self.dt_target = 1.0 / float(self.hz)
        self.window_seconds = polling_config.get("window_seconds", 10.0)
        self.min_move = polling_config.get("min_move_px", 3)
        self.jitter_px_thresh = polling_config.get("jitter_px_threshold", 2.0)
        self.jitter_window = polling_config.get("jitter_window", 0.3)
        # Tolerance for repeated-pixel grouping (to handle ±1px drift)
        self.repeated_pixel_radius = float(self.thresholds.get("repeated_pixel_radius_px", 1.0))

        # Reporting settings
        self.interval_s = reporting_config.get("interval_s", 92.0)
        self.report_cooldown = apply_cooldown(reporting_config.get("report_cooldown_s", 10.0))
        self.min_events = reporting_config.get("min_events_threshold", 10)

        # Load poker sites from shared config
        poker_config = _shared_config.get("poker_sites", {})
        protected = poker_config.get("protected", {})
        self.protected_poker_exe = protected.get("process", "game.exe")
        self.protected_poker_path = protected.get("path_hint", "coinpoker")
        self.other_poker = poker_config.get("other", [])

        # Load suspicious tools from programs_registry (single source of truth for all programs)
        # Extract automation/macro programs from programs_registry
        suspicious_tools_list = []
        try:
            programs_registry = get_config("programs_registry")
            if programs_registry and "programs" in programs_registry:
                for prog_name, prog_data in programs_registry["programs"].items():
                    # Include automation tools, macros, and scripts
                    prog_type = prog_data.get("type", "")
                    categories = prog_data.get("categories", [])
                    if prog_type in ["macro", "script", "automation"] or "automation" in categories or "macros" in categories:
                        # Extract base name (without .exe) for matching
                        base_name = prog_name.replace(".exe", "").lower()
                        suspicious_tools_list.append(base_name)
        except Exception as e:
            print(f"[BehaviourDetector] WARNING: Failed to load programs_registry: {e}")
        
        # Fallback to behaviour_config for backward compatibility
        if not suspicious_tools_list:
            suspicious_tools_list = _behaviour_config.get("suspicious_tools", [])
        
        self.suspicious_tools = set(suspicious_tools_list)

        # Keyboard tracking
        self.prev_key_down = [False] * 256
        self.key_down_since = [None] * 256
        self.iki_times = Ring(2048)  # Inter-keystroke intervals
        self.key_hold_times = Ring(4096)  # Key hold durations
        self.last_key_ts = None
        self.key_events = 0

        # Mouse button tracking
        self.buttons = [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON, VK_XBUTTON1, VK_XBUTTON2]
        self.prev_btn_down = dict.fromkeys(self.buttons, False)
        self.btn_down_since = dict.fromkeys(self.buttons)
        self.ici_times = Ring(2048)  # Inter-click intervals
        self.click_hold_times = Ring(4096)  # Click hold durations
        self.last_click_ts = None
        self.click_events = 0
        self.click_positions = Ring(4096)

        # Mouse motion tracking
        self.prev_pos = None
        self.prev_v = 0.0
        self.prev_t = None
        self.vel_samples = Ring(8192)
        self.dir_samples = Ring(8192)
        self.move_segments = []
        self.current_seg = None

        # Jitter tracking (tiny movements)
        self.jitter_dists = deque(maxlen=8192)

        # Timing
        self.last_report = now_ms()
        self.last_signal = 0.0

        keepalive_interval = float(reporting_config.get("keepalive_seconds", 45.0))
        keepalive_interval = max(10.0, min(keepalive_interval, 60.0))
        keepalive_timeout = float(reporting_config.get("keepalive_timeout", 90.0))
        keepalive_timeout = max(keepalive_timeout, keepalive_interval * 2)
        self._keepalive = DetectionKeepalive(
            "behaviour",
            keepalive_interval=keepalive_interval,
            active_timeout=keepalive_timeout,
        )
        self._active_behaviour_aliases: set[str] = set()

        # Polling thread
        self._polling_thread = None
        self._polling_active = False

        # Input source tracking
        self.input_sources = defaultdict(int)

        print("[BehaviourDetector] Initialized (polling mode, no admin required)")
        self._start_polling()

    def cleanup(self):
        """Stop polling and clear all data structures on cleanup"""
        if self._polling_active:  # Only stop if not already stopped
            self._stop_polling()
        
        # Clear all Ring buffers and data structures to free RAM
        try:
            self.iki_times.clear()
            self.key_hold_times.clear()
            self.ici_times.clear()
            self.click_hold_times.clear()
            self.click_positions.clear()
            self.vel_samples.clear()
            self.dir_samples.clear()
            self.jitter_dists.clear()
            self.move_segments.clear()
            self.input_sources.clear()
        except Exception as e:
            print(f"[BehaviourDetector] Cleanup error: {e}")
        
        super().cleanup()

    def _start_polling(self):
        """Start the polling thread"""
        self._polling_active = True
        self._polling_thread = threading.Thread(target=self._polling_loop, daemon=True)
        self._polling_thread.start()
        print("[BehaviourDetector] Polling started")

    def _stop_polling(self):
        """Stop the polling thread"""
        if not self._polling_active:
            return  # Already stopped

        self._polling_active = False
        if self._polling_thread and self._polling_thread.is_alive():
            self._polling_thread.join(timeout=0.5)  # Shorter timeout for faster shutdown
            if self._polling_thread.is_alive():
                print("[BehaviourDetector] WARNING: Polling thread did not stop in time")
        print("[BehaviourDetector] Polling stopped")

    def _polling_loop(self):
        """Main polling loop running at configured Hz"""
        while self._polling_active:
            try:
                t = now_ms()

                # Poll mouse position and movement
                self._poll_mouse_move(t)
                pos = self.prev_pos if self.prev_pos else (0, 0)

                # Poll mouse buttons
                self._poll_mouse_buttons(t, pos)

                # Poll keyboard
                self._poll_keys(t)

                # Check if report needed
                if (t - self.last_report) >= self.window_seconds:
                    self._make_report()
                    self.last_report = t

                # Throttle to target frequency
                t2 = now_ms()
                sleep_for = self.dt_target - (t2 - t)
                if sleep_for > 0:
                    time.sleep(sleep_for)

            except Exception as e:
                print(f"[BehaviourDetector] ERROR: Polling error: {e}")
                time.sleep(0.1)

    def _poll_keys(self, t):
        """Poll keyboard state"""
        for vk in range(256):
            state = GetAsyncKeyState(vk)
            down = (state & 0x8000) != 0

            # Key DOWN edge
            if down and not self.prev_key_down[vk]:
                if self.last_key_ts is not None:
                    interval = t - self.last_key_ts
                    if 0 < interval < 10.0:  # Reasonable interval
                        self.iki_times.add(interval)
                self.last_key_ts = t
                self.key_events += 1
                self.key_down_since[vk] = t

                # Track source process
                src = self._get_foreground_process()
                if src:
                    self.input_sources[src] += 1

            # Key UP edge
            if (not down) and self.prev_key_down[vk] and self.key_down_since[vk] is not None:
                hold = t - self.key_down_since[vk]
                if 0 < hold < 30.0:  # Reasonable hold time
                    self.key_hold_times.add(hold)
                self.key_down_since[vk] = None

            self.prev_key_down[vk] = down

    def _poll_mouse_buttons(self, t, pos):
        """Poll mouse button state"""
        for vk in self.buttons:
            state = GetAsyncKeyState(vk)
            down = (state & 0x8000) != 0

            # Button DOWN edge
            if down and not self.prev_btn_down[vk]:
                if self.last_click_ts is not None:
                    interval = t - self.last_click_ts
                    if 0 < interval < 10.0:
                        self.ici_times.add(interval)
                self.last_click_ts = t
                self.click_events += 1
                self.click_positions.add((t, pos[0], pos[1]))
                self.btn_down_since[vk] = t

                # Track source
                src = self._get_foreground_process()
                if src:
                    self.input_sources[src] += 1

            # Button UP edge
            if (not down) and self.prev_btn_down[vk] and self.btn_down_since[vk] is not None:
                hold = t - self.btn_down_since[vk]
                if 0 < hold < 30.0:
                    self.click_hold_times.add(hold)
                self.btn_down_since[vk] = None

            self.prev_btn_down[vk] = down

    def _poll_mouse_move(self, t):
        """Poll mouse position"""
        pt = POINT()
        if not GetCursorPos(ctypes.byref(pt)):
            return
        cur = (pt.x, pt.y)

        if self.prev_pos is None:
            self.prev_pos, self.prev_t, self.prev_v = cur, t, 0.0
            self.current_seg = None
            return

        dt = t - self.prev_t
        if dt <= 0:
            return

        d = dist(self.prev_pos, cur)

        # Record jitter (tiny movements)
        if d > 0 and d <= self.jitter_px_thresh:
            self.jitter_dists.append((t, d))

        # Track movement segments
        if d >= self.min_move:
            v = d / dt
            self.vel_samples.add(v)

            theta = angle(cur[0] - self.prev_pos[0], cur[1] - self.prev_pos[1])
            self.dir_samples.add(theta)

            if self.current_seg is None:
                self.current_seg = {
                    "start": self.prev_t,
                    "end": t,
                    "speeds": [v],
                    "dist": d,
                }
            else:
                self.current_seg["end"] = t
                self.current_seg["speeds"].append(v)
                self.current_seg["dist"] += d
        else:
            # End of movement segment
            if self.current_seg is not None:
                if self.current_seg["dist"] >= 50:  # Significant movement
                    self.move_segments.append(self.current_seg)
                self.current_seg = None

        self.prev_pos = cur
        self.prev_t = t
        self.prev_v = self.vel_samples.q[-1] if len(self.vel_samples.q) else 0.0

    def _jitter_metrics(self):
        """Compute RMS of tiny movements"""
        if self.prev_t is None:
            return None, 0
        nowt = self.prev_t
        recent = [d for (tt, d) in self.jitter_dists if (nowt - tt) <= self.jitter_window]
        if len(recent) < 5:
            return None, len(recent)
        mean_sq = sum(d * d for d in recent) / float(len(recent))
        return math.sqrt(mean_sq), len(recent)

    def _segment_constant_velocity_fraction(self):
        """Calculate fraction of segments with constant velocity"""
        if not self.move_segments:
            return 0.0, 0
        good = 0
        total = 0
        tol = self.thresholds.get("const_velocity_tolerance", 0.15)
        for seg in self.move_segments:
            speeds = seg["speeds"]
            if len(speeds) < 6:
                continue
            m = sum(speeds) / len(speeds)
            if m <= 0:
                continue
            sd = stats.pstdev(speeds)
            cv = sd / m
            if cv < tol:
                good += 1
            total += 1
        frac = (good / total) if total else 0.0
        return frac, total

    def _direction_variability(self):
        """Calculate directional variability (lower = straighter)"""
        if len(self.dir_samples) < 20:
            return None
        angs = list(self.dir_samples)
        xs = [math.cos(a) for a in angs]
        ys = [math.sin(a) for a in angs]
        R = math.hypot(sum(xs), sum(ys)) / len(angs)
        return 1.0 - R

    def _repeated_pixel_hits(self, within_sec=5.0):
        """Detect repeated exact pixel clicks"""
        if not len(self.click_positions):
            return 0, 0.0
        nowt = self.prev_t or now_ms()
        recent = [(x, y) for (tt, x, y) in self.click_positions if nowt - tt <= within_sec]
        if not recent:
            return 0, 0.0
        # Group by buckets to allow small cursor drift (±radius)
        if self.repeated_pixel_radius and self.repeated_pixel_radius > 1.0:
            r = self.repeated_pixel_radius

            def bucket(v: int | float) -> int:
                # Round to nearest bucket of size r
                return int(round(float(v) / r) * r)

            bucketed = [(bucket(x), bucket(y)) for (x, y) in recent]
            counts = Counter(bucketed)
        else:
            counts = Counter(recent)
        maxrep = max(counts.values())
        repfrac = sum(1 for c in counts.values() if c >= 2) / float(len(counts))
        return maxrep, repfrac

    def _calculate_score(self):
        """Calculate bot-likeness score (0-100)"""
        score = 0.0
        details = []

        # Get metrics
        iki = list(self.iki_times)
        ici = list(self.ici_times)

        # IKI variance check
        iki_cv = None
        if len(iki) >= 10:
            iki_ms = [i * 1000 for i in iki]
            m = sum(iki_ms) / len(iki_ms)
            if m > 0:
                iki_cv = stats.pstdev(iki_ms) / m

                if iki_cv < self.thresholds.get("iki_cv_alert", 0.12):
                    score += self.weights.get("iki_very_low_variance", 22)
                    details.append(f"IKI CV={iki_cv:.3f} (very low)")
                elif iki_cv < self.thresholds.get("iki_cv_warn", 0.18):
                    score += self.weights.get("iki_low_variance", 12)
                    details.append(f"IKI CV={iki_cv:.3f} (low)")

        # ICI variance check
        ici_cv = None
        if len(ici) >= 8:
            ici_ms = [i * 1000 for i in ici]
            m = sum(ici_ms) / len(ici_ms)
            if m > 0:
                ici_cv = stats.pstdev(ici_ms) / m

                if ici_cv < self.thresholds.get("ici_cv_alert", 0.12):
                    score += self.weights.get("ici_very_low_variance", 22)
                    details.append(f"ICI CV={ici_cv:.3f} (very low)")
                elif ici_cv < self.thresholds.get("ici_cv_warn", 0.18):
                    score += self.weights.get("ici_low_variance", 12)
                    details.append(f"ICI CV={ici_cv:.3f} (low)")

        # Constant velocity check
        const_frac, const_n = self._segment_constant_velocity_fraction()
        if const_n >= 2:
            if const_frac >= self.thresholds.get("const_velocity_alert", 0.50):
                score += self.weights.get("constant_velocity_high", 24)
                details.append(f"Constant velocity {const_frac:.0%}")
            elif const_frac >= self.thresholds.get("const_velocity_warn", 0.30):
                score += self.weights.get("constant_velocity_medium", 12)
                details.append(f"Partial constant velocity {const_frac:.0%}")

        # Direction variability check
        dir_var = self._direction_variability()
        if dir_var is not None:
            if dir_var < self.thresholds.get("dir_variability_alert", 0.10):
                score += self.weights.get("direction_very_straight", 16)
                details.append("Very straight mouse paths")
            elif dir_var < self.thresholds.get("dir_variability_warn", 0.18):
                score += self.weights.get("direction_straight", 8)
                details.append("Straight mouse paths")

        # Repeated pixel check
        maxrep, repfrac = self._repeated_pixel_hits(within_sec=self.window_seconds)
        rep_threshold = self.thresholds.get("repeated_pixel_threshold", 3)
        rep_frac_threshold = self.thresholds.get("repeated_pixel_fraction", 0.25)
        if (maxrep >= rep_threshold) or (repfrac >= rep_frac_threshold):
            score += self.weights.get("repeated_pixels", 16)
            details.append(f"Repeated pixels (max={maxrep})")

        # Jitter check
        jitter_rms, jitter_n = self._jitter_metrics()
        if (
            (jitter_rms is not None)
            and (jitter_n >= 20)
            and (jitter_rms < self.thresholds.get("jitter_rms_alert", 0.6))
        ):
            score += self.weights.get("low_jitter", 8)
            details.append(f"Low jitter RMS={jitter_rms:.2f}px")

        # Too-fast reactions check
        if len(iki) >= 5:
            min_reaction = self.thresholds.get("min_reaction_ms", 150)
            iki_ms = [i * 1000 for i in iki]
            too_fast = sum(1 for i in iki_ms if i < min_reaction)
            if too_fast > len(iki_ms) * 0.2:
                score += self.weights.get("too_fast_reactions", 25)
                details.append(f"Too fast reactions (<{min_reaction}ms)")

        # Cap score at 100
        score = min(score, 100.0)

        return int(score), details

    def _get_foreground_process(self) -> str | None:
        """Get the name of the foreground process"""
        try:
            user32 = ctypes.windll.user32
            pid = wt.DWORD()
            hwnd = user32.GetForegroundWindow()
            if not hwnd:
                return None
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if not pid.value:
                return None
            p = psutil.Process(pid.value)
            name = (p.name() or "").lower()
            path = (p.exe() or "").lower()

            # Check if it's protected poker
            if name == self.protected_poker_exe and self.protected_poker_path in path:
                return "CoinPoker"

            # Check if it's a suspicious tool
            for tool in self.suspicious_tools:
                if tool in name:
                    return f"{name} (SUSPICIOUS)"

            return name
        except Exception:
            return None

    def _make_report(self):
        """Generate and emit detection report"""
        active_aliases: set[str] = set()
        # Check minimum events
        total_events = self.key_events + self.click_events
        if total_events < self.min_events:
            self._finalize_behaviour_keepalive(active_aliases)
            return

        # Calculate score
        score, details = self._calculate_score()

        # Check cooldown
        now = time.time()
        if now - self.last_signal < self.report_cooldown:
            self._finalize_behaviour_keepalive(self._active_behaviour_aliases.copy())
            return

        # Determine status (base from score) - use all 4 levels
        if score >= 70:
            status = "CRITICAL"
            name = "Bot Input Detected"
        elif score >= 45:
            status = "ALERT"
            name = "Likely Bot Patterns"
        elif score >= 25:
            status = "WARN"
            name = "Suspicious Input Patterns"
        elif score >= 15:
            status = "INFO"
            name = "Unusual Input Behaviour"
        else:
            # Don't report normal behaviour
            self._finalize_behaviour_keepalive(active_aliases)
            return

        # -------- Conservative combo escalation (minimize false positives) --------
        # Only consider escalation if a suspicious tool is the dominant input source
        suspicious_src = any(
            ("SUSPICIOUS" in src) and (count > max(5, int(self.min_events * 0.3)))
            for src, count in self.input_sources.items()
        )

        # Only run extra computations if needed
        if suspicious_src and status not in ("CRITICAL", "ALERT"):
            # Use existing helpers to derive pattern strength
            const_frac, const_n = self._segment_constant_velocity_fraction()
            maxrep, repfrac = self._repeated_pixel_hits(within_sec=self.window_seconds)

            # Compute IKI/ICI CVs on-demand (cheap enough, guarded by suspicious_src)
            iki = list(self.iki_times)
            ici = list(self.ici_times)

            def _cv(ms_list):
                if len(ms_list) < 8:
                    return None
                m = sum(ms_list) / len(ms_list)
                if m <= 0:
                    return None
                return stats.pstdev(ms_list) / m

            iki_cv = _cv([i * 1000 for i in iki]) if len(iki) >= 10 else None
            ici_cv = _cv([i * 1000 for i in ici]) if len(ici) >= 8 else None

            thr = self.thresholds

            # Extremely tight conditions for CRITICAL (15 pts): perfekt bot-beteende
            critical_combo = (
                (const_n is not None and const_n >= 4)
                and (const_frac is not None and const_frac >= 0.85)
                and (repfrac is not None and repfrac >= 0.6)
                and (iki_cv is not None and iki_cv <= 0.05)
                and (ici_cv is not None and ici_cv <= 0.05)
            )

            # Tight conditions for ALERT (10 pts): deterministiskt beteende + misstänkt källa
            alert_combo = (
                (const_n is not None and const_n >= 3)
                and (const_frac is not None and const_frac >= thr.get("const_velocity_alert", 0.7))
                and (repfrac is not None and repfrac >= thr.get("repeated_pixel_fraction", 0.4))
                and (iki_cv is not None and iki_cv <= thr.get("iki_cv_alert", 0.12))
                and (ici_cv is not None and ici_cv <= thr.get("ici_cv_alert", 0.12))
            )

            # Moderate conditions for WARN (5 pts): halvstarka mönster + misstänkt källa
            warn_combo = (
                (const_n is not None and const_n >= 2)
                and (const_frac is not None and const_frac >= thr.get("const_velocity_warn", 0.5))
                and (
                    repfrac is not None
                    and repfrac >= max(0.2, thr.get("repeated_pixel_fraction", 0.5) * 0.4)
                )
            )

            # Apply conservative escalation: never downgrade, only raise
            if critical_combo:
                status = "CRITICAL"
                name = "Bot Input Detected"
                details.insert(0, "Suspicious tool + perfect bot patterns")
            elif alert_combo:
                status = "ALERT"
                name = "Likely Bot Patterns"
                details.insert(0, "Suspicious tool + deterministic patterns")
            elif warn_combo and status == "INFO":
                status = "WARN"
                name = "Suspicious Input Patterns"
                details.insert(0, "Suspicious tool + patterns")

        # Build details string
        detail_str = (
            f"Score: {score} | " + " | ".join(details[:3]) if details else f"Score: {score}"
        )

        # Check for suspicious sources - escalate if needed
        for src, count in self.input_sources.items():
            if "SUSPICIOUS" in src and count > 5:
                detail_str = f"Source: {src} | " + detail_str
                # Escalate INFO→WARN only (don't downgrade higher levels)
                if status == "INFO":
                    status = "WARN"
                break

        # Emit signal
        post_signal("behaviour", name, status, detail_str)
        self.last_signal = now

        alias = f"behaviour:{name.lower().replace(' ', '_')}"
        if status in ("WARN", "ALERT", "CRITICAL"):
            self._keepalive.mark_active(alias, name, status, detail_str, alias=alias)
            active_aliases.add(alias)
        else:
            self._keepalive.expire_alias(alias)

        # Clear per-window data
        self.move_segments.clear()
        self.input_sources.clear()
        self._finalize_behaviour_keepalive(active_aliases)

    def tick(self):
        """Main tick function called by framework"""
        # Polling runs in separate thread, just check if we need to force a report
        pass

    def _finalize_behaviour_keepalive(self, active_aliases: set[str]) -> None:
        """Expire stale behaviour detections and emit keepalives."""
        stale = self._active_behaviour_aliases - active_aliases
        for alias in stale:
            self._keepalive.expire_alias(alias)
        self._active_behaviour_aliases = active_aliases
        self._keepalive.emit_keepalives()
