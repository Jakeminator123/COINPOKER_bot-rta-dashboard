"""
VirusTotal Redis Cache
======================
Shared cache for VirusTotal results between scanner and dashboard.
Uses Redis for persistent storage and sharing across instances.

Cache Keys:
- vt:hash:<sha256> - Individual hash results (TTL: 24 hours)
- vt:rate_limit:last_request - Last API request timestamp
- vt:stats - Statistics counters

This module allows the scanner to:
1. Check if a hash is already cached (from dashboard or previous scans)
2. Store new results for the dashboard to read
3. Respect shared rate limiting
"""

import json
import os
import time
from typing import Any

# Try to import redis
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    redis = None

# Redis key constants (must match dashboard's lib/virustotal/virustotal-service.ts)
VT_CACHE_PREFIX = "vt:hash:"
VT_RATE_LIMIT_KEY = "vt:rate_limit:last_request"
VT_STATS_KEY = "vt:stats"

# Cache TTL (24 hours)
CACHE_TTL_SECONDS = 24 * 60 * 60

# Rate limit (20 seconds minimum between requests)
MIN_REQUEST_INTERVAL_SECONDS = 20


class VTRedisCache:
    """Redis-based cache for VirusTotal results."""
    
    def __init__(self, redis_url: str | None = None):
        """Initialize the cache.
        
        Args:
            redis_url: Redis connection URL. If None, reads from REDIS_URL env var.
        """
        self.redis_url = redis_url or os.environ.get("REDIS_URL")
        self.client = None
        self.enabled = False
        
        if not REDIS_AVAILABLE:
            print("[VTCache] Redis library not installed - cache disabled")
            return
            
        if not self.redis_url:
            print("[VTCache] No REDIS_URL configured - cache disabled")
            return
            
        try:
            self.client = redis.from_url(self.redis_url, decode_responses=True)
            self.client.ping()
            self.enabled = True
            print("[VTCache] Connected to Redis - shared VT cache enabled")
        except Exception as e:
            print(f"[VTCache] Redis connection failed: {e} - cache disabled")
            self.client = None
    
    def get_cached_result(self, sha256: str) -> dict[str, Any] | None:
        """Get cached VT result for a hash.
        
        Args:
            sha256: SHA256 hash to look up
            
        Returns:
            Cached result dict or None if not found
        """
        if not self.enabled:
            return None
            
        try:
            key = f"{VT_CACHE_PREFIX}{sha256.lower()}"
            cached = self.client.get(key)
            
            if cached:
                result = json.loads(cached)
                result["source"] = "redis_cache"
                return result
        except Exception as e:
            print(f"[VTCache] Cache read error: {e}")
            
        return None
    
    def cache_result(self, result: dict[str, Any]) -> bool:
        """Store VT result in cache.
        
        Args:
            result: VT result dict with at least 'hash' key
            
        Returns:
            True if cached successfully
        """
        if not self.enabled:
            return False
            
        try:
            sha256 = result.get("hash", "").lower()
            if not sha256:
                return False
                
            key = f"{VT_CACHE_PREFIX}{sha256}"
            self.client.set(key, json.dumps(result), ex=CACHE_TTL_SECONDS)
            return True
        except Exception as e:
            print(f"[VTCache] Cache write error: {e}")
            return False
    
    def can_make_request(self) -> tuple[bool, float]:
        """Check if we can make a VT API request (rate limiting).
        
        Returns:
            Tuple of (allowed, wait_seconds)
        """
        if not self.enabled:
            # If no Redis, use local rate limiting only
            return True, 0.0
            
        try:
            last_request = self.client.get(VT_RATE_LIMIT_KEY)
            
            if not last_request:
                return True, 0.0
                
            elapsed = time.time() - float(last_request)
            if elapsed >= MIN_REQUEST_INTERVAL_SECONDS:
                return True, 0.0
                
            return False, MIN_REQUEST_INTERVAL_SECONDS - elapsed
        except Exception as e:
            print(f"[VTCache] Rate limit check error: {e}")
            return True, 0.0
    
    def record_request(self) -> None:
        """Record that we made a VT API request."""
        if not self.enabled:
            return
            
        try:
            self.client.set(VT_RATE_LIMIT_KEY, str(time.time()), ex=60)
        except Exception as e:
            print(f"[VTCache] Failed to record request: {e}")
    
    def update_stats(self, result: dict[str, Any], from_cache: bool) -> None:
        """Update VT statistics in Redis.
        
        Args:
            result: VT result dict
            from_cache: Whether result was from cache
        """
        if not self.enabled:
            return
            
        try:
            self.client.hincrby(VT_STATS_KEY, "totalLookups", 1)
            
            if from_cache:
                self.client.hincrby(VT_STATS_KEY, "cacheHits", 1)
            else:
                self.client.hincrby(VT_STATS_KEY, "apiCalls", 1)
            
            status = result.get("status", "")
            if status == "malicious":
                self.client.hincrby(VT_STATS_KEY, "malwareFound", 1)
            elif status == "suspicious":
                self.client.hincrby(VT_STATS_KEY, "suspiciousFound", 1)
            elif status == "clean":
                self.client.hincrby(VT_STATS_KEY, "cleanFiles", 1)
            elif status == "unknown":
                self.client.hincrby(VT_STATS_KEY, "unknownFiles", 1)
            elif status == "error":
                self.client.hincrby(VT_STATS_KEY, "errors", 1)
                
            self.client.hset(VT_STATS_KEY, "lastLookup", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        except Exception:
            pass  # Stats are non-critical
    
    def get_stats(self) -> dict[str, Any]:
        """Get VT statistics from Redis."""
        if not self.enabled:
            return {}
            
        try:
            stats = self.client.hgetall(VT_STATS_KEY)
            return {
                "totalLookups": int(stats.get("totalLookups", 0)),
                "cacheHits": int(stats.get("cacheHits", 0)),
                "apiCalls": int(stats.get("apiCalls", 0)),
                "malwareFound": int(stats.get("malwareFound", 0)),
                "suspiciousFound": int(stats.get("suspiciousFound", 0)),
                "cleanFiles": int(stats.get("cleanFiles", 0)),
                "unknownFiles": int(stats.get("unknownFiles", 0)),
                "errors": int(stats.get("errors", 0)),
                "lastLookup": stats.get("lastLookup"),
            }
        except Exception:
            return {}


# Global instance (lazy initialization)
_vt_cache: VTRedisCache | None = None


def get_vt_cache() -> VTRedisCache:
    """Get or create the global VT cache instance."""
    global _vt_cache
    if _vt_cache is None:
        _vt_cache = VTRedisCache()
    return _vt_cache

