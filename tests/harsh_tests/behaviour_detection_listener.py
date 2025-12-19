"""
Local BehaviourDetector test harness.

What it does:
- Starts BehaviourDetector (polling-based: GetAsyncKeyState + GetCursorPos)
- Prints all emitted signals to console (as if they were forwarded to the dashboard)
- Periodically prints a lightweight "batch-like" summary using ThreatManager

Notes:
- This does NOT require CoinPoker to be running.
- For stronger severity, keep this console window in the foreground while generating inputs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from datetime import datetime

# Ensure project root is on sys.path (test scripts are executed from /test)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from core.api import get_event_bus, get_threat_manager  # noqa: E402
from segments.behaviour.behaviour_detector import BehaviourDetector  # noqa: E402


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--seconds",
        type=float,
        default=0.0,
        help="How long to run (seconds). Use 0 to run until Ctrl+C.",
    )
    ap.add_argument(
        "--summary-interval",
        type=float,
        default=5.0,
        help="How often to print threat summary (seconds)",
    )
    args = ap.parse_args()

    bus = get_event_bus()
    tm = get_threat_manager()

    def on_detection(sig) -> None:
        # Keep output compact but useful
        details = (sig.details or "").replace("\n", " ")
        if len(details) > 220:
            details = details[:220] + "..."
        print(f"[{_ts()}] {sig.category}/{sig.name} {sig.status} | {details}")

    bus.subscribe("detection", on_detection)

    print("=" * 72)
    print("[Listener] BehaviourDetector live harness")
    print("[Listener] Tip: Keep this console in the foreground while you run the input generator.")
    print("[Listener] Stop: Ctrl+C")
    print("=" * 72)

    detector = BehaviourDetector()

    stop = threading.Event()

    def summary_loop() -> None:
        interval = max(1.0, float(args.summary_interval))
        while not stop.is_set():
            try:
                # Show raw counters so we can confirm polling is actually seeing inputs
                raw_counts = {
                    "key_events": getattr(detector, "key_events", None),
                    "click_events": getattr(detector, "click_events", None),
                    "iki_samples": len(getattr(detector, "iki_times", [])),
                    "ici_samples": len(getattr(detector, "ici_times", [])),
                    "vel_samples": len(getattr(detector, "vel_samples", [])),
                }
                # Compute current score even when BehaviourDetector decides not to emit a signal.
                # This helps diagnose "nothing happens" cases (score < 15 or cooldown/min_events).
                score_debug = None
                try:
                    score_val, score_details = detector._calculate_score()  # type: ignore[attr-defined]
                    score_debug = {
                        "score": score_val,
                        "details": score_details[:6],
                    }
                except Exception:
                    score_debug = None
                summary = tm.get_threat_summary()
                # Only print when there is something to show, to avoid spam
                if (
                    summary.get("total_active_threats", 0) > 0
                    or summary.get("bot_probability", 0) > 0
                    or (raw_counts.get("key_events") or 0) > 0
                    or (raw_counts.get("click_events") or 0) > 0
                ):
                    payload = {"summary": summary, "raw": raw_counts, "score": score_debug}
                    print(f"[{_ts()}] [BatchLike] " + json.dumps(payload, ensure_ascii=False))
            except Exception as exc:
                print(f"[{_ts()}] [Listener] Summary error: {exc}")
            stop.wait(interval)

    t = threading.Thread(target=summary_loop, daemon=True, name="ThreatSummaryLoop")
    t.start()

    try:
        if float(args.seconds) <= 0:
            while True:
                time.sleep(0.2)
        else:
            deadline = time.time() + max(1.0, float(args.seconds))
            while time.time() < deadline:
                time.sleep(0.2)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        try:
            detector.cleanup()
        except Exception:
            pass

    print(f"[{_ts()}] [Listener] Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


