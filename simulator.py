"""
Signal Load Simulator
---------------------
Simulates N players posting fake detection signals to the dashboard API for stress testing.

Usage examples:
  - Basic (10 players, 2 min):
      python simulator.py --players 10 --duration 120
  - Custom rate and batch size:
      python simulator.py --players 25 --rate 12 --burst 8 --duration 180
  - With token and remote URL:
      python simulator.py --url https://your-app.onrender.com/api/signal --token detector-secret-token-2024
  - Against Render with system batches and X-Forwarded-For per player:
      python simulator.py --render --players 50 --duration 300 --rate 8 --burst 5
"""

import argparse
import json
import os
import random
import string
import threading
import time
import uuid
from dataclasses import dataclass
import requests

STATUS_POINTS = {
    "CRITICAL": 15,
    "ALERT": 10,
    "WARN": 5,
    "INFO": 0,
    "OK": 0,
}


CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.txt")
DEFAULT_LOCAL_URL = "http://localhost:3001/api/signal"
_CONFIG_CACHE: dict[str, str] | None = None


def load_config() -> dict[str, str]:
    """Load key=value pairs from config.txt once per execution."""
    global _CONFIG_CACHE
    if _CONFIG_CACHE is not None:
        return _CONFIG_CACHE

    parsed: dict[str, str] = {}
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, encoding="utf-8") as cfg_file:
                for raw_line in cfg_file:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    parsed[key.strip()] = value.strip()
    except Exception:
        parsed = {}

    _CONFIG_CACHE = parsed
    return _CONFIG_CACHE



# ---------------------
# Helpers
# ---------------------


def stable_fake_ip(seed: str) -> str:
    """Generate a stable fake IPv4 for a given seed (e.g., device_id).
    Format: 10.x.y.z to avoid public routable collisions."""
    h = abs(hash(seed))
    a = 10
    b = (h >> 16) & 0xFF
    c = (h >> 8) & 0xFF
    d = h & 0xFF
    # Avoid zeros in last octet for realism
    if d == 0:
        d = 1
    return f"{a}.{b}.{c}.{d}"


def parse_kv_ratios(text: str, default: dict[str, float]) -> dict[str, float]:
    """Parse 'KEY=0.2,KEY2=0.8' into normalized weights dict."""
    try:
        out: dict[str, float] = {}
        for part in text.split(","):
            part = part.strip()
            if not part:
                continue
            k, v = part.split("=", 1)
            out[k.strip()] = float(v)
        if not out:
            return default
        s = sum(out.values())
        if s <= 0:
            return default
        return {k: v / s for k, v in out.items()}
    except Exception:
        return default


# ---------------------
# Data models
# ---------------------
@dataclass
class PlayerProfile:
    device_id: str
    device_name: str
    is_special: bool = False


def bounded_random_duration(min_seconds: float, max_seconds: float) -> float:
    """Return a random duration between min and max, handling invalid bounds."""
    min_seconds = max(1.0, min_seconds)
    max_seconds = max(min_seconds, max_seconds)
    if max_seconds <= min_seconds:
        return min_seconds
    return random.uniform(min_seconds, max_seconds)


def apply_interval_spread(base_interval: float, spread: float) -> float:
    """Jitter the interval per player to desync batch posts."""
    if spread <= 0:
        return max(1.0, base_interval)
    lower = max(0.1, 1.0 - spread)
    upper = 1.0 + spread
    return max(1.0, base_interval * random.uniform(lower, upper))


# ---------------------
# Fake signal generation
# ---------------------
PROGRAM_NAMES = [
    "OpenHoldem",
    "PokerBotX",
    "solver.exe",
    "macro_tool",
    "auto_clicker",
]

DOMAINS = [
    "core.telegram.org",
    "discord.com",
    "gto-wizard.com",
    "odin-optimizer.com",
    "example.com",
]

AUTO_FILES = ["questions.txt", "run.py", "main.py", "config.yaml"]


def random_status(weights: dict[str, float]) -> str:
    statuses = list(weights.keys())
    probs = [weights[s] for s in statuses]
    return random.choices(statuses, probs, k=1)[0]


def random_category(weights: dict[str, float]) -> str:
    keys = list(weights.keys())
    probs = [weights[k] for k in keys]
    return random.choices(keys, probs, k=1)[0]


def build_signal(
    now: float,
    env: str,
    host: str,
    profile: PlayerProfile,
    status_weights: dict[str, float],
    category_weights: dict[str, float],
) -> dict[str, object]:
    category = random_category(category_weights)
    status = random_status(status_weights)

    name = "Unknown"
    details = ""

    if category == "programs":
        pname = random.choice(PROGRAM_NAMES)
        name = pname
        details = f"SHA:{uuid.uuid4().hex[:32]} | proc={pname.lower()}.exe pid={random.randint(1000, 9999)}"
        if pname == "OpenHoldem":
            status = random.choice(["ALERT", "WARN"])  # stronger
    elif category == "network":
        dom = random.choice(DOMAINS)
        name = f"DNS: {dom.split('.')[0].capitalize()}"
        details = f"Lookup: {dom}"
    elif category == "behaviour":
        name = "Suspicious Input Patterns"
        details = f"Score: {random.randint(20, 70)} | Repeated pixels (max={random.randint(1, 3)}) | Too fast reactions (<{random.randint(100, 180)}ms)"
    elif category == "auto":
        fname = random.choice(AUTO_FILES)
        name = "Multiple Automation" if random.random() < 0.4 else fname
        if name == "Multiple Automation":
            details = f"Multiple tools: Python, {fname}"
        else:
            details = (
                "Script detected: panel.py"
                if fname.endswith(".py")
                else f"Active bot tool hint: {fname}"
            )
        if random.random() < 0.25:
            status = "ALERT"
    elif category == "vm":
        name = random.choice(["VMware", "VirtualBox", "Hyper-V"])
        details = f"Evidence: tools_detected={random.choice([True, False])}"

    return {
        "v": 1,
        "ts": now,
        "env": env,
        "host": host,
        "category": category,
        "name": name,
        "status": status,
        "details": details,
        "device_id": profile.device_id,
        "device_name": profile.device_name,
    }


def build_unified_batch(
    player: PlayerProfile,
    detections: list[dict[str, object]],
    batch_no: int,
    env_name: str,
    host_name: str,
) -> dict[str, object]:
    severity_counts = {"critical": 0, "alert": 0, "warn": 0, "info": 0}
    categories: dict[str, int] = {}
    total_score = 0
    
    # Build threats list matching scanner.py format
    threats_list: list[dict[str, object]] = []
    detections_map: dict[tuple, dict] = {}
    
    for det in detections:
        status = str(det.get("status", "INFO")).upper()
        points = STATUS_POINTS.get(status, 0)
        category = str(det.get("category", "unknown"))
        name = str(det.get("name", "Unknown"))
        details = str(det.get("details", ""))
        timestamp = det.get("ts", time.time())
        
        # Deduplicate by (category, name, details) like scanner.py does
        key = (category, name, details)
        
        if key in detections_map:
            existing = detections_map[key]
            existing["occurrences"] += 1
            if timestamp < existing["first_detected"]:
                existing["first_detected"] = timestamp
        else:
            # Map category to segment name (like scanner.py does)
            segment_map = {
                "programs": "ProcessScanner",
                "network": "WebMonitor",
                "behaviour": "BehaviourDetector",
                "auto": "AutomationDetector",
                "vm": "VMDetector",
                "screen": "ScreenDetector",
            }
            segment_name = segment_map.get(category, category)
            
            detections_map[key] = {
                "name": name,
                "segment": segment_name,
                "category": category,
                "status": status,
                "points": points,
                "first_detected": timestamp,
                "details": details,
                "occurrences": 1,
            }
        
        # Count severity
        if status == "CRITICAL":
            severity_counts["critical"] += 1
        elif status == "ALERT":
            severity_counts["alert"] += 1
        elif status == "WARN":
            severity_counts["warn"] += 1
        else:
            severity_counts["info"] += 1

        categories[category] = categories.get(category, 0) + 1
        total_score += points

    # Convert to list (only threats with points > 0, like scanner.py)
    threats_list = [
        threat for threat in detections_map.values()
        if threat["points"] > 0
    ]

    total_threats = len(threats_list)
    # Calculate bot_probability as deduplicated score (same as threat_score)
    # In real scanner, this comes from ThreatManager which deduplicates by threat_id
    # For simulator, we use the raw score but cap at 100 (matches real behavior)
    bot_probability = min(100.0, max(0.0, float(total_score)))
    
    # Add threat_id to each threat (simplified: use lowercase name as ID)
    for threat in threats_list:
        threat_name_lower = str(threat.get("name", "")).lower().replace(" ", "")
        threat["threat_id"] = threat_name_lower[:32]  # Limit length like real scanner

    batch_details = {
        "scan_type": "unified",
        "batch_number": batch_no,
        "bot_probability": bot_probability,  # Deduplicated score (same as threat_score)
        "threats": threats_list,
        "summary": {
            "critical": severity_counts["critical"],
            "alert": severity_counts["alert"],
            "warn": severity_counts["warn"],
            "info": severity_counts["info"],
            "total_detections": len(threats_list),  # Match backend field name
            "total_threats": total_threats,
            "threat_score": bot_probability,  # Same as bot_probability (deduplicated)
            "raw_detection_score": total_score,  # Raw sum before dedup
        },
        "categories": categories,
        "active_threats": max(0, total_threats - severity_counts["info"]),
        "aggregated_threats": [],  # Empty for simulator (real scanner shows merged threats)
        "vm_probability": 0.0,
        "file_analysis_count": sum(
            1 for t in threats_list
            if "hash" in t["name"].lower() or "file" in t["name"].lower()
        ),
        "system": {
            "cpu_percent": random.uniform(15.0, 75.0),
            "mem_used_percent": random.uniform(20.0, 85.0),
            "segments_running": random.randint(5, 12),
            "env": env_name,
            "host": host_name,
        },
        "timestamp": time.time(),
    }

    # Match scanner.py payload format exactly (no "v" or "ts" fields)
    return {
        "timestamp": time.time(),
        "category": "system",
        "name": "Unified Scan Report",
        "status": "INFO",
        "details": json.dumps(batch_details),
        "device_id": player.device_id,
        "device_name": player.device_name,
    }


# ---------------------
# Worker
# ---------------------
def player_worker(
    player: PlayerProfile,
    url: str,
    base_headers: dict[str, str],
    rate_per_min: float,
    burst: int,
    env_name: str,
    host_name: str,
    status_weights: dict[str, float],
    category_weights: dict[str, float],
    stop_at: float,
    quiet: bool,
    stats: dict[str, int],
    jitter_frac: float,
    enable_batches: bool,
    batch_interval: float,
    interval_spread: float,
    logout_config: dict[str, float],
    logouts_enabled: bool,
    player_is_special: bool,
    use_xforwarded: bool = True,
):
    """
    Simulate a single player sending batch reports (mimics real scanner).
    Adds optional login/logout windows for special players and ensures
    per-player batch intervals are desynced to better mimic reality.
    """
    session = requests.Session()
    xfwd = stable_fake_ip(player.device_id)
    backoff = 0.0
    per_player_interval = apply_interval_spread(batch_interval, interval_spread)
    last_batch = time.time() - random.uniform(0, per_player_interval)
    batch_no = 0

    # Calculate how many detections to generate per batch based on rate
    detections_per_batch = max(1, int((rate_per_min / 60.0) * batch_interval))

    allow_logouts = logouts_enabled and player_is_special
    online = True
    next_state_change = (
        time.time()
        + bounded_random_duration(
            float(logout_config.get("min_online", 600)),
            float(logout_config.get("max_online", 1800)),
        )
        if allow_logouts
        else float("inf")
    )

    while time.time() < stop_at:
        now = time.time()

        if allow_logouts and now >= next_state_change:
            online = not online
            if online:
                duration = bounded_random_duration(
                    float(logout_config.get("min_online", 600)),
                    float(logout_config.get("max_online", 1800)),
                )
                next_state_change = now + duration
                last_batch = now - per_player_interval  # trigger immediate batch
                if not quiet:
                    print(
                        f"[SIM] {player.device_name}: LOGIN (online for {duration/60:.1f} min)"
                    )
            else:
                duration = bounded_random_duration(
                    float(logout_config.get("min_offline", 360)),
                    float(logout_config.get("max_offline", 14400)),
                )
                next_state_change = now + duration
                if not quiet:
                    print(
                        f"[SIM] {player.device_name}: LOGOUT (offline for {duration/60:.1f} min)"
                    )

        if allow_logouts and not online:
            idle = min(5.0, max(0.5, next_state_change - time.time()))
            time.sleep(idle)
            continue

        # Check if it's time to send a batch
        if (now - last_batch) >= per_player_interval:
            batch_no += 1
            
            # Generate detections for this batch period
            batch_detections: list[dict[str, object]] = []
            for _ in range(detections_per_batch):
                signal = build_signal(
                    now, env_name, host_name, player, status_weights, category_weights
                )
                batch_detections.append(signal)
            
            # Build unified batch report
            payload = build_unified_batch(
                player,
                batch_detections,
                batch_no,
                env_name,
                host_name,
            )
            
            try:
                headers_batch = dict(base_headers)
                if use_xforwarded:
                    headers_batch["X-Forwarded-For"] = xfwd
                
                # Match scanner.py format: payload must be an array with one object
                # Also convert timestamp to int like scanner.py does
                payload_array = [{
                    "timestamp": int(payload["timestamp"]),
                    "category": payload["category"],
                    "name": payload["name"],
                    "status": payload["status"],
                    "details": payload["details"],
                    "device_id": payload["device_id"],
                    "device_name": payload["device_name"],
                    "device_ip": xfwd if use_xforwarded else None,
                }]
                
                resp_batch = session.post(
                    url, data=json.dumps(payload_array), headers=headers_batch, timeout=10
                )
                if 200 <= resp_batch.status_code < 300:
                    stats["ok"] += 1
                    if not quiet:
                        bot_prob = json.loads(payload["details"]).get("bot_probability", 0)
                        print(
                            f"[SIM-BATCH] {player.device_name}: Batch #{batch_no} sent (bot_probability={bot_prob}%, detections={len(batch_detections)})"
                        )
                    backoff = max(0.0, backoff * 0.5)
                else:
                    stats["fail"] += 1
                    if not quiet:
                        print(f"[SIM-BATCH] {player.device_name}: HTTP {resp_batch.status_code}")
                    if resp_batch.status_code in (429, 500, 502, 503, 504):
                        backoff = min(5.0, max(0.5, (backoff or 0.5) * 1.5))
            except Exception as e:
                stats["fail"] += 1
                if not quiet:
                    print(f"[SIM-BATCH] {player.device_name}: Error: {e}")
                backoff = min(5.0, max(0.5, (backoff or 0.5) * 1.5))

            last_batch = now
        
        # Sleep with jitter until next batch time
        time_until_next = per_player_interval - (time.time() - last_batch)
        jitter = per_player_interval * random.uniform(-jitter_frac, jitter_frac)
        sleep_time = max(0.5, time_until_next + jitter + backoff)
        actual_sleep = min(sleep_time, stop_at - time.time())
        if actual_sleep > 0:
            time.sleep(actual_sleep)


# ---------------------
# Main
# ---------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="Simulate players sending detection signals")
    parser.add_argument(
        "--url", default=DEFAULT_LOCAL_URL, help="Target API endpoint"
    )
    parser.add_argument(
        "--token",
        default="",
        help="Bearer token for Authorization header (defaults to SIGNAL_TOKEN/env or config.txt)",
    )
    parser.add_argument("--players", type=int, default=10, help="Number of simulated players")
    parser.add_argument("--rate", type=float, default=6.0, help="Signals per player per minute")
    parser.add_argument("--burst", type=int, default=5, help="Signals per POST (batch size)")
    parser.add_argument(
        "--duration",
        type=int,
        default=120,
        help="Duration in seconds (script exits after)",
    )
    parser.add_argument("--env", default="DEV", help="Environment tag in payload")
    parser.add_argument("--host", default="simulator", help="Host tag in payload")
    parser.add_argument("--device-prefix", default="SimDevice", help="Prefix for device_name")
    parser.add_argument(
        "--status-ratio",
        default="ALERT=0.15,WARN=0.35,INFO=0.50",
        help="Comma list of weights, e.g. ALERT=0.2,WARN=0.3,INFO=0.5",
    )
    parser.add_argument("--seed", type=int, default=0, help="Random seed (0 = random)")
    parser.add_argument("--quiet", action="store_true", help="Reduce console output")
    parser.add_argument(
        "--no-interactive",
        action="store_true",
        help="Skip interactive prompts and use CLI arguments as-is",
    )

    # Advanced realism toggles
    parser.add_argument(
        "--render",
        action="store_true",
        help="Use Render URL from config.txt (WEB_URL_PROD) if present",
    )
    parser.add_argument(
        "--xforwarded",
        action="store_true",
        default=True,
        help="Send X-Forwarded-For per player (default: on)",
    )
    parser.add_argument(
        "--jitter",
        type=float,
        default=0.2,
        help="Sleep jitter fraction (+/-), e.g., 0.2 = ±20%",
    )
    parser.add_argument(
        "--system-batches",
        action="store_true",
        default=True,
        help="Send unified system batch reports (default: on)",
    )
    parser.add_argument(
        "--batch-interval",
        type=float,
        default=92.0,
        help="Unified batch interval seconds (default: 92)",
    )
    parser.add_argument(
        "--batch-spread",
        type=float,
        default=0.2,
        help="Fractional +/- spread applied per player to desync batches (0 = off)",
    )
    parser.add_argument(
        "--category-ratio",
        default="programs=0.25,network=0.25,behaviour=0.20,auto=0.20,vm=0.10",
        help="Category weights, normalized",
    )
    parser.add_argument(
        "--enable-logouts",
        action="store_true",
        help="Allow special players to log out/in during the simulation",
    )
    parser.add_argument(
        "--special-player-ratio",
        type=float,
        default=0.2,
        help="Fraction (0-1) of players marked as special (default 0.2)",
    )
    parser.add_argument(
        "--special-prefix",
        default="SpecPlayer",
        help="Name prefix for special players (only used when ratio > 0)",
    )
    parser.add_argument(
        "--logout-min-seconds",
        type=int,
        default=360,
        help="Minimum offline duration for logout-enabled players (>= 6 minutes)",
    )
    parser.add_argument(
        "--logout-max-seconds",
        type=int,
        default=14400,
        help="Maximum offline duration for logout-enabled players (<= 4 hours default)",
    )
    parser.add_argument(
        "--login-min-seconds",
        type=int,
        default=600,
        help="Minimum online session duration before a logout can occur again",
    )
    parser.add_argument(
        "--login-max-seconds",
        type=int,
        default=3600,
        help="Maximum online session duration before a logout (default 1 hour)",
    )

    args = parser.parse_args()

    if args.seed:
        random.seed(args.seed)

    interactive_mode = not args.no_interactive

    config_values = load_config()
    render_url_from_config = config_values.get("WEB_URL_PROD", "").strip()

    if interactive_mode:
        print("\n=== Interactive Simulator ===")
        print("Press Enter to accept defaults in [brackets].\n")

        # Destination choice
        dest_default = "render" if args.render else ("custom" if args.url != DEFAULT_LOCAL_URL else "local")
        print("Destination options:")
        print(f"  [L] Local dashboard ({DEFAULT_LOCAL_URL})")
        if render_url_from_config:
            print(f"  [R] Render production ({render_url_from_config})")
        else:
            print("  [R] Render production (set WEB_URL_PROD in config.txt)")
        print(f"  [C] Custom URL ({args.url})")
        try:
            dest_choice = input(f"Destination [L/R/C] ({dest_default[0].upper()}): ").strip().lower()
        except EOFError:
            dest_choice = ""

        if not dest_choice or dest_choice in ("l", "local"):
            args.render = False
            args.url = DEFAULT_LOCAL_URL
        elif dest_choice in ("r", "render"):
            args.render = True
            if render_url_from_config:
                args.url = render_url_from_config
            else:
                print("[SIM] Render URL not set in config.txt; keeping current URL.")
        elif dest_choice in ("c", "custom"):
            try:
                custom_url = input(f"Custom URL [{args.url}]: ").strip()
            except EOFError:
                custom_url = ""
            if custom_url:
                args.url = custom_url
            args.render = False
        else:
            # Direct URL typed
            args.url = dest_choice
            args.render = False

        # Players
        try:
            s = input(f"Players [{args.players}]: ").strip()
            if s:
                args.players = max(1, int(s))
        except Exception:
            pass

        # Duration
        try:
            s = input(f"Duration seconds [{args.duration}]: ").strip()
            if s:
                args.duration = max(1, int(s))
        except Exception:
            pass

        # Rate
        try:
            s = input(f"Signals per player per minute [{args.rate}]: ").strip()
            if s:
                args.rate = max(0.1, float(s))
        except Exception:
            pass

        # Burst
        try:
            s = input(f"Signals per POST (burst) [{args.burst}]: ").strip()
            if s:
                args.burst = max(1, int(s))
        except Exception:
            pass

        # Token
        try:
            default_token = os.environ.get("SIGNAL_TOKEN") or config_values.get("SIGNAL_TOKEN", "")
            s = input(f"Signal token [{default_token or 'detector-secret-token-2024'}]: ").strip()
            if s:
                args.token = s
            elif default_token:
                args.token = default_token
        except Exception:
            pass

        # Jitter
        try:
            s = input(f"Timing jitter fraction (0-0.9) [{args.jitter}]: ").strip()
            if s:
                args.jitter = max(0.0, min(0.9, float(s)))
        except Exception:
            pass

        # Quiet
        try:
            s = input(f"Quiet output? [{'y' if args.quiet else 'N'}]: ").strip().lower()
            if s:
                args.quiet = s in ("y", "yes")
        except Exception:
            pass

    # Resolve default token if not provided: env -> config.txt -> known default
    def _resolve_token() -> str:
        # 1) Environment variable
        tok = os.environ.get("SIGNAL_TOKEN")
        if tok:
            return tok.strip()
        # 2) Local config.txt
        cfg_token = config_values.get("SIGNAL_TOKEN")
        if cfg_token:
            return cfg_token.strip()
        # 3) Fallback to project default used in DEV
        return "detector-secret-token-2024"

    if not args.token:
        args.token = _resolve_token()

    # Parse status weights
    weights: dict[str, float] = parse_kv_ratios(
        args.status_ratio.upper(), {"ALERT": 0.15, "WARN": 0.35, "INFO": 0.50}
    )
    # Parse category weights
    cat_weights: dict[str, float] = parse_kv_ratios(
        args.category_ratio,
        {
            "programs": 0.25,
            "network": 0.25,
            "behaviour": 0.20,
            "auto": 0.20,
            "vm": 0.10,
        },
    )

    # If --render is set and url not overridden from default, prefer WEB_URL_PROD
    if args.render and args.url == DEFAULT_LOCAL_URL and render_url_from_config:
        args.url = render_url_from_config

    # Build players
    players: list[PlayerProfile] = []
    special_ratio = max(0.0, min(1.0, args.special_player_ratio))
    special_count = min(args.players, int(round(args.players * special_ratio)))
    special_indices: set[int] = set()
    if special_count > 0:
        special_indices = set(random.sample(range(args.players), special_count))
    special_prefix = args.special_prefix or args.device_prefix

    for i in range(args.players):
        device_id = uuid.uuid4().hex
        suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
        is_special = i in special_indices
        name_prefix = special_prefix if is_special else args.device_prefix
        device_name = f"{name_prefix}-{i + 1}-{suffix}"
        players.append(
            PlayerProfile(
                device_id=device_id,
                device_name=device_name,
                is_special=is_special,
            )
        )

    headers = {"Content-Type": "application/json"}
    if args.token:
        headers["Authorization"] = f"Bearer {args.token}"

    stop_at = time.time() + max(1, args.duration)
    stats = {"ok": 0, "fail": 0}
    batch_spread = max(0.0, min(0.9, args.batch_spread))
    logout_min = max(360.0, float(args.logout_min_seconds))
    logout_max = max(logout_min, float(args.logout_max_seconds))
    login_min = max(60.0, float(args.login_min_seconds))
    login_max = max(login_min, float(args.login_max_seconds))
    logout_config: dict[str, float] = {
        "min_offline": logout_min,
        "max_offline": logout_max,
        "min_online": login_min,
        "max_online": login_max,
    }

    # Run workers
    threads: list[threading.Thread] = []
    for p in players:
        t = threading.Thread(
            target=player_worker,
            args=(
                p,
                args.url,
                headers,
                args.rate,
                args.burst,
                args.env,
                args.host,
                weights,
                cat_weights,
                stop_at,
                args.quiet,
                stats,
                max(0.0, min(0.9, args.jitter)),
                args.system_batches,
                float(args.batch_interval),
                batch_spread,
                logout_config,
                args.enable_logouts,
                p.is_special,
                args.xforwarded,
            ),
            daemon=False,
        )
        threads.append(t)
        t.start()

    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        pass

    total_posts = stats["ok"] + stats["fail"]
    if not args.quiet:
        print("-" * 48)
        print(
            f"Players: {args.players} | Duration: {args.duration}s | Rate: {args.rate}/min | Burst: {args.burst}"
        )
        print(f"URL: {args.url}")
        print(f"Posted: {total_posts} (ok={stats['ok']}, fail={stats['fail']})")


if __name__ == "__main__":
    main()
