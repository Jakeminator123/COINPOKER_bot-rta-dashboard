#!/usr/bin/env python3
"""
Lightweight monitoring helper for the Bot RTA Dashboard.

This script can be placed anywhere (desktop, etc.) - it doesn't need the project folder.
Just edit DEFAULT_SITE_URL and DEFAULT_REDIS_URL at the top of this file.

Usage:
    # Double-click the file to run with defaults (measures production site)
    # Or run from terminal:
    python monitor_load.py --watch  # Continuous monitoring (every 60 seconds)
    python monitor_load.py --watch --interval 30  # Every 30 seconds
    python monitor_load.py  # Single check

Requires:
    pip install requests redis
"""

from __future__ import annotations

import argparse
import importlib
import os
import pathlib
import statistics
import sys
import time
from datetime import datetime
from typing import List, Tuple

# ============================================================================
# CONFIGURATION - Edit these values for your production site
# ============================================================================
# This script can be placed anywhere (desktop, etc.) - it doesn't need the project folder
# Just update these URLs to match your production environment:

# Your Render/production site URL (change to your actual URL)
DEFAULT_SITE_URL = "https://bot-rta-dashboard-2.onrender.com/api/players"

# Your Redis connection URL (already configured)
DEFAULT_REDIS_URL = "redis://default:RmJmzvxtcg4PpDPCEly7ap7sHdpgQhmR@redis-12756.c44.us-east-1-2.ec2.redns.redis-cloud.com:12756"

try:
    import requests
except ImportError:
    print("requests is required. Install with: pip install requests", file=sys.stderr)
    sys.exit(1)

try:
    redis_module = importlib.import_module("redis")
except ImportError:
    redis_module = None


def probe_site(url: str, timeout: float) -> Tuple[int, float, int]:
    start = time.perf_counter()
    response = requests.get(url, timeout=timeout)
    latency_ms = (time.perf_counter() - start) * 1000
    return response.status_code, latency_ms, len(response.content)


def sample_site(url: str, timeout: float, samples: int) -> Tuple[List[float], List[int], List[int]]:
    latencies: List[float] = []
    statuses: List[int] = []
    sizes: List[int] = []

    for _ in range(samples):
        status, latency, size = probe_site(url, timeout)
        latencies.append(latency)
        statuses.append(status)
        sizes.append(size)
        time.sleep(0.2)

    return latencies, statuses, sizes


def fetch_redis_metrics(redis_url: str, timeout: float) -> dict:
    if redis_module is None:
        raise ImportError("redis module not installed. Install with: pip install redis")

    client = redis_module.from_url(redis_url, socket_connect_timeout=timeout)
    info = client.info()
    return {
        "connected_clients": info.get("connected_clients"),
        "blocked_clients": info.get("blocked_clients"),
        "used_memory_human": info.get("used_memory_human"),
        "instantaneous_ops_per_sec": info.get("instantaneous_ops_per_sec"),
        "total_commands_processed": info.get("total_commands_processed"),
        "role": info.get("role"),
    }


def print_site_summary(latencies: List[float], statuses: List[int], sizes: List[int]) -> None:
    if not latencies:
        print("No site samples collected.")
        return

    print("\n=== Site Probe ===")
    print(f"Status codes: {statuses}")
    print(f"Latency (ms): min={min(latencies):.1f}, p50={statistics.median(latencies):.1f}, "
          f"max={max(latencies):.1f}")
    print(f"Payload size (bytes): min={min(sizes)}, max={max(sizes)}")


def print_redis_summary(metrics: dict) -> None:
    if not metrics:
        print("\nNo Redis metrics.")
        return

    print("\n=== Redis Metrics ===")
    for key, value in metrics.items():
        print(f"{key}: {value}")


def load_env_defaults() -> tuple[str, str]:
    """Load defaults - checks environment variables first, then uses hardcoded defaults."""
    site_url = DEFAULT_SITE_URL
    redis_url = DEFAULT_REDIS_URL
    
    # Check environment variables (highest priority - useful if running from terminal with env vars)
    if os.getenv("NEXTAUTH_URL"):
        site_url = f"{os.getenv('NEXTAUTH_URL')}/api/players"
    if os.getenv("REDIS_URL"):
        redis_url = os.getenv("REDIS_URL")
    
    # Optional: Try to find .env file in same directory as script (if script is in project folder)
    # This is optional - script works fine without it
    script_dir = pathlib.Path(__file__).parent
    env_file = script_dir / ".env.local"
    if not env_file.exists():
        env_file = script_dir / ".env"
    
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, value = line.split("=", 1)
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        
                        if key == "NEXTAUTH_URL" and value and not os.getenv("NEXTAUTH_URL"):
                            site_url = f"{value}/api/players"
                        elif key == "REDIS_URL" and value and not os.getenv("REDIS_URL"):
                            redis_url = value
        except Exception:  # noqa: BLE001
            pass  # Fall back to hardcoded defaults
    
    return site_url, redis_url


def run_monitoring_cycle(site_url: str, redis_url: str, samples: int, timeout: float) -> None:
    """Run one monitoring cycle and print results."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n{'='*60}")
    print(f"Monitoring at {timestamp}")
    print(f"{'='*60}")
    
    try:
        latencies, statuses, sizes = sample_site(site_url, timeout, samples)
        print_site_summary(latencies, statuses, sizes)
    except Exception as exc:  # noqa: BLE001
        print(f"\nSite probe failed: {exc}", file=sys.stderr)
    
    try:
        redis_metrics = fetch_redis_metrics(redis_url, timeout)
        print_redis_summary(redis_metrics)
    except Exception as exc:  # noqa: BLE001
        print(f"\nRedis probe failed: {exc}", file=sys.stderr)


def main() -> None:
    # Load defaults from .env or use hardcoded values
    default_site, default_redis = load_env_defaults()
    
    parser = argparse.ArgumentParser(description="Monitor site + Redis load.")
    parser.add_argument("--site", default=default_site,
                        help=f"URL to probe (default: from .env or {DEFAULT_SITE_URL})")
    parser.add_argument("--redis", default=default_redis,
                        help=f"Redis connection URL (default: from .env or configured default)")
    parser.add_argument("--samples", type=int, default=5, help="Number of HTTP samples to gather")
    parser.add_argument("--timeout", type=float, default=5.0, help="Request timeout in seconds")
    parser.add_argument("--watch", action="store_true", 
                        help="Run continuously (press Ctrl+C to stop)")
    parser.add_argument("--interval", type=int, default=60,
                        help="Interval in seconds between checks (only with --watch, default: 60)")
    args = parser.parse_args()

    if args.watch:
        print("Starting continuous monitoring...")
        print(f"Site: {args.site}")
        print(f"Redis: {args.redis.split('@')[-1] if '@' in args.redis else args.redis}")  # Hide password
        print(f"Interval: {args.interval} seconds")
        print("Press Ctrl+C to stop\n")
        
        try:
            while True:
                run_monitoring_cycle(args.site, args.redis, args.samples, args.timeout)
                print(f"\nNext check in {args.interval} seconds...")
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n\nMonitoring stopped by user.")
    else:
        # Single run
        run_monitoring_cycle(args.site, args.redis, args.samples, args.timeout)


if __name__ == "__main__":
    main()

