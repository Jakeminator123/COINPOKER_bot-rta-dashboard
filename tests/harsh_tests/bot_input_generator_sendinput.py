"""
Bot-like input generator for BehaviourDetector testing (Windows).

This script generates intentionally "robotic" patterns:
- Very consistent keystroke timings (fast, low variance)
- Repeated mouse clicks on (nearly) the same pixel
- Straight-line mouse movement with near-constant velocity

Safety:
- 3 second countdown before starting
- Press ESC to abort while running

IMPORTANT:
- This will MOVE YOUR MOUSE and SEND KEY PRESSES.
- Close other apps and keep this console window focused.
"""

from __future__ import annotations

import argparse
import ctypes
import os
import random
import sys
import time


# --- Win32 setup ---
user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

VK_ESCAPE = 0x1B
VK_LBUTTON = 0x01

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004

KEYEVENTF_KEYUP = 0x0002


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.c_long),
        ("dy", ctypes.c_long),
        ("mouseData", ctypes.c_ulong),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", ctypes.c_ushort),
        ("wScan", ctypes.c_ushort),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", ctypes.c_ulong), ("wParamL", ctypes.c_short), ("wParamH", ctypes.c_ushort)]


class INPUT_UNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("union", INPUT_UNION)]


def _abort_requested() -> bool:
    try:
        return bool(user32.GetAsyncKeyState(VK_ESCAPE) & 0x8000)
    except Exception:
        return False


def _get_cursor_pos() -> tuple[int, int]:
    pt = POINT()
    if not user32.GetCursorPos(ctypes.byref(pt)):
        return (0, 0)
    return (int(pt.x), int(pt.y))


def _send_input(inputs: list[INPUT]) -> None:
    n = len(inputs)
    if n <= 0:
        return
    arr = (INPUT * n)(*inputs)
    sent = user32.SendInput(n, arr, ctypes.sizeof(INPUT))
    if sent != n:
        # Best-effort: don't crash; input injection can be blocked by policies
        err = ctypes.get_last_error()
        raise OSError(f"SendInput failed: sent={sent}/{n}, winerr={err}")


def _mouse_move_rel(dx: int, dy: int) -> None:
    inp = INPUT()
    inp.type = 0  # INPUT_MOUSE
    inp.union.mi = MOUSEINPUT(dx=dx, dy=dy, mouseData=0, dwFlags=MOUSEEVENTF_MOVE, time=0, dwExtraInfo=None)
    _send_input([inp])


def _mouse_click_left() -> None:
    _mouse_click_left_hold_ms(25)


def _mouse_click_left_hold_ms(hold_ms: int) -> None:
    """
    Hold the button down long enough for BehaviourDetector polling to observe it.
    BehaviourDetector polls at ~200-240Hz, so <5ms presses can be missed entirely.
    """
    hold_s = max(0.0, float(hold_ms) / 1000.0)
    down = INPUT()
    down.type = 0
    down.union.mi = MOUSEINPUT(
        dx=0, dy=0, mouseData=0, dwFlags=MOUSEEVENTF_LEFTDOWN, time=0, dwExtraInfo=None
    )
    up = INPUT()
    up.type = 0
    up.union.mi = MOUSEINPUT(
        dx=0, dy=0, mouseData=0, dwFlags=MOUSEEVENTF_LEFTUP, time=0, dwExtraInfo=None
    )
    _send_input([down])
    if hold_s:
        time.sleep(hold_s)
    _send_input([up])


def _key_tap(vk: int) -> None:
    _key_tap_hold_ms(vk, 25)


def _key_tap_hold_ms(vk: int, hold_ms: int) -> None:
    """
    Hold the key down long enough for BehaviourDetector polling to observe it.
    """
    hold_s = max(0.0, float(hold_ms) / 1000.0)
    down = INPUT()
    down.type = 1  # INPUT_KEYBOARD
    down.union.ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=0, time=0, dwExtraInfo=None)
    up = INPUT()
    up.type = 1
    up.union.ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=KEYEVENTF_KEYUP, time=0, dwExtraInfo=None)
    _send_input([down])
    if hold_s:
        time.sleep(hold_s)
    _send_input([up])


def _focus_console_window() -> None:
    """
    Try to bring this console window to foreground so BehaviourDetector attributes input to python.exe.
    This may fail due to Windows foreground restrictions; it's best-effort.
    """
    try:
        hwnd = kernel32.GetConsoleWindow()
        if hwnd:
            user32.ShowWindow(hwnd, 5)  # SW_SHOW
            user32.SetForegroundWindow(hwnd)
    except Exception:
        pass


def generate_bot_like_inputs(
    *,
    duration_s: float,
    key_vk: int,
    key_interval_s: float,
    click_interval_s: float,
    move_step_px: int,
    move_step_interval_s: float,
    move_total_px: int,
    key_hold_ms: int,
    click_hold_ms: int,
    segment_period_s: float,
    segment_pause_s: float,
    stationary_phase_s: float,
    drift_prob: float,
) -> None:
    # Use perf_counter for stable timing (lower variance -> easier to trigger CV thresholds)
    start = time.perf_counter()

    # Pick a stable direction so the path is very straight.
    # Alternate direction halfway so the cursor doesn't end up off-screen.
    direction = 1
    moved = 0

    now0 = time.perf_counter()
    next_key = now0 + 0.2
    next_click = now0 + 0.4
    next_move = now0 + 0.1

    # Create periodic pauses to end movement segments.
    # BehaviourDetector only finalizes a movement segment when movement stops (d < min_move).
    segment_period_s = max(0.2, float(segment_period_s))
    segment_pause_s = max(0.0, float(segment_pause_s))
    next_segment_break = now0 + segment_period_s
    pause_until = 0.0

    # Stationary phase helps repeated-pixel + click timing CV detections.
    stationary_phase_s = max(0.0, float(stationary_phase_s))
    drift_prob = max(0.0, min(1.0, float(drift_prob)))

    def _advance(next_t: float, step: float, now: float) -> float:
        # Keep a stable cadence without doing "catch-up bursts"
        # (but also avoid being stuck behind if we missed a lot).
        next_t += step
        if next_t < now:
            # Jump forward to just after now
            skips = int((now - next_t) / step) + 1
            next_t += skips * step
        return next_t

    while (time.perf_counter() - start) < duration_s:
        if _abort_requested():
            print("[Generator] ESC pressed -> aborting.")
            return

        now = time.perf_counter()

        # Phase control:
        # - First stationary_phase_s seconds: do NOT move mouse (maximize repeated-pixel + low ICI CV)
        # - After that: allow movement again (for straight-path metrics)
        stationary_mode = stationary_phase_s > 0 and (now - start) <= stationary_phase_s

        if segment_pause_s > 0 and now >= next_segment_break:
            pause_until = now + segment_pause_s
            next_segment_break = now + segment_period_s

        if (not stationary_mode) and now >= next_move and now >= pause_until:
            # Straight, constant-velocity movement:
            # move_step_px every move_step_interval_s.
            _mouse_move_rel(direction * move_step_px, 0)
            moved += move_step_px
            if moved >= move_total_px:
                moved = 0
                direction *= -1
            next_move = _advance(next_move, move_step_interval_s, now)

        if now >= next_click:
            # Repeated clicks at (nearly) the same pixel.
            # Add tiny drift occasionally to still count as repeated bucket clicks.
            if drift_prob > 0 and random.random() < drift_prob:
                _mouse_move_rel(1, 0)
            _mouse_click_left_hold_ms(click_hold_ms)
            next_click = _advance(next_click, click_interval_s, now)

        if now >= next_key:
            # Very consistent key timing (fast): triggers low IKI variance + too-fast reactions.
            _key_tap_hold_ms(key_vk, key_hold_ms)
            next_key = _advance(next_key, key_interval_s, now)

        # Small sleep to avoid burning CPU
        time.sleep(0.001)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=15.0, help="How long to generate inputs")
    ap.add_argument("--key-vk", type=int, default=0x41, help="Virtual key code to tap (default: 'A')")
    ap.add_argument("--key-interval", type=float, default=0.09, help="Seconds between key taps")
    ap.add_argument(
        "--key-hold-ms",
        type=int,
        default=30,
        help="How long to hold each key down (ms). Important so polling sees it.",
    )
    ap.add_argument("--click-interval", type=float, default=0.12, help="Seconds between mouse clicks")
    ap.add_argument(
        "--click-hold-ms",
        type=int,
        default=35,
        help="How long to hold mouse button down (ms). Important so polling sees it.",
    )
    ap.add_argument("--move-step-px", type=int, default=6, help="Mouse move step (pixels) per tick")
    ap.add_argument("--move-step-interval", type=float, default=0.012, help="Seconds between move steps")
    ap.add_argument("--move-total-px", type=int, default=520, help="Total pixels before reversing direction")
    ap.add_argument(
        "--segment-period-ms",
        type=int,
        default=700,
        help="How often to pause mouse movement to end movement segments (ms).",
    )
    ap.add_argument(
        "--segment-pause-ms",
        type=int,
        default=80,
        help="How long each pause lasts (ms). This helps BehaviourDetector score constant velocity.",
    )
    ap.add_argument(
        "--stationary-phase-seconds",
        type=float,
        default=25.0,
        help="First N seconds: don't move mouse to maximize repeated-pixel + click timing detections.",
    )
    ap.add_argument(
        "--drift-prob",
        type=float,
        default=0.0,
        help="Chance per click to drift +1px (default 0.0 to maximize repeated-pixel detection).",
    )
    args = ap.parse_args()

    if os.name != "nt":
        print("[Generator] Windows only.")
        return 2

    print("=" * 72)
    print("[Generator] Bot-like input generator (SendInput)")
    print("[Generator] WARNING: This will move mouse and type keys.")
    print("[Generator] Safety: Press ESC to abort.")
    print("=" * 72)

    _focus_console_window()
    for i in range(3, 0, -1):
        print(f"[Generator] Starting in {i}...")
        time.sleep(1.0)

    try:
        generate_bot_like_inputs(
            duration_s=max(1.0, float(args.seconds)),
            key_vk=int(args.key_vk),
            key_interval_s=max(0.03, float(args.key_interval)),
            click_interval_s=max(0.05, float(args.click_interval)),
            move_step_px=max(2, int(args.move_step_px)),
            move_step_interval_s=max(0.004, float(args.move_step_interval)),
            move_total_px=max(80, int(args.move_total_px)),
            key_hold_ms=max(5, int(args.key_hold_ms)),
            click_hold_ms=max(5, int(args.click_hold_ms)),
            segment_period_s=max(0.2, float(args.segment_period_ms) / 1000.0),
            segment_pause_s=max(0.0, float(args.segment_pause_ms) / 1000.0),
            stationary_phase_s=max(0.0, float(args.stationary_phase_seconds)),
            drift_prob=float(args.drift_prob),
        )
    except KeyboardInterrupt:
        print("[Generator] Ctrl+C -> aborting.")
        return 130
    except Exception as exc:
        print(f"[Generator] ERROR: {exc}")
        return 1

    print("[Generator] Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


