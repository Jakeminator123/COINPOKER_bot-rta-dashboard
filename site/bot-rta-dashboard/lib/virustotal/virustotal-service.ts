/**
 * VirusTotal Integration Service
 * ==============================
 * Shared service for checking file hashes against VirusTotal API.
 * Results are cached in Redis for sharing between dashboard and scanner.
 * 
 * Rate Limiting:
 * - Free tier: 4 requests/minute (15s between requests)
 * - We use 20s by default for safety margin
 * 
 * Cache Strategy:
 * - Results cached in Redis for 24 hours
 * - Both clean and malicious results are cached
 * - Scanner and dashboard share the same cache
 */

import { getRedisClient } from '@/lib/redis/redis-client';

// Redis key prefix for VT cache
const VT_CACHE_PREFIX = 'vt:hash:';
const VT_RATE_LIMIT_KEY = 'vt:rate_limit:last_request';
const VT_STATS_KEY = 'vt:stats';

// Cache TTL (24 hours in seconds)
const CACHE_TTL_SECONDS = 24 * 60 * 60;

// Rate limit (20 seconds between requests)
const MIN_REQUEST_INTERVAL_MS = 20 * 1000;

// Detection thresholds
const MALWARE_THRESHOLD = 5;  // 5+ AV detections = CRITICAL
const SUSPICIOUS_THRESHOLD = 2;  // 2+ AV detections = ALERT

// Poker-related keywords to detect
const POKER_KEYWORDS = [
  'poker', 'bot', 'rta', 'solver', 'gto', 'holdem', 
  'cardbot', 'pokerbot', 'cheat', 'macro', 'autohotkey'
];

export interface VTResult {
  hash: string;
  status: 'clean' | 'suspicious' | 'malicious' | 'unknown' | 'error';
  severity: 'INFO' | 'WARN' | 'ALERT' | 'CRITICAL';
  points: number;
  label: string;
  reason: string;
  stats?: {
    malicious: number;
    suspicious: number;
    harmless: number;
    undetected: number;
    total: number;
  };
  names?: string[];
  tags?: string[];
  checkedAt: string;
  source: 'cache' | 'api';
}

export interface VTStats {
  totalLookups: number;
  cachHits: number;
  apiCalls: number;
  malwareFound: number;
  suspiciousFound: number;
  cleanFiles: number;
  unknownFiles: number;
  errors: number;
  lastLookup: string | null;
}

/**
 * Check if we can make a VT API request (rate limiting)
 */
async function canMakeRequest(): Promise<{ allowed: boolean; waitMs: number }> {
  try {
    const redis = await getRedisClient();
    const lastRequest = await redis.get(VT_RATE_LIMIT_KEY);
    
    if (!lastRequest) {
      return { allowed: true, waitMs: 0 };
    }
    
    const elapsed = Date.now() - parseInt(lastRequest, 10);
    if (elapsed >= MIN_REQUEST_INTERVAL_MS) {
      return { allowed: true, waitMs: 0 };
    }
    
    return { allowed: false, waitMs: MIN_REQUEST_INTERVAL_MS - elapsed };
  } catch {
    // If Redis fails, allow request but log warning
    console.warn('[VT] Redis unavailable for rate limiting');
    return { allowed: true, waitMs: 0 };
  }
}

/**
 * Record that we made a VT API request
 */
async function recordRequest(): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.set(VT_RATE_LIMIT_KEY, Date.now().toString(), { EX: 60 });
  } catch {
    console.warn('[VT] Failed to record request timestamp');
  }
}

/**
 * Get cached VT result from Redis
 */
async function getCachedResult(hash: string): Promise<VTResult | null> {
  try {
    const redis = await getRedisClient();
    const cached = await redis.get(`${VT_CACHE_PREFIX}${hash.toLowerCase()}`);
    
    if (cached) {
      const result = JSON.parse(cached) as VTResult;
      result.source = 'cache';
      return result;
    }
  } catch (error) {
    console.warn('[VT] Cache read error:', error);
  }
  
  return null;
}

/**
 * Cache VT result in Redis
 */
async function cacheResult(result: VTResult): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.set(
      `${VT_CACHE_PREFIX}${result.hash.toLowerCase()}`,
      JSON.stringify(result),
      { EX: CACHE_TTL_SECONDS }
    );
  } catch (error) {
    console.warn('[VT] Cache write error:', error);
  }
}

/**
 * Update VT statistics in Redis
 */
async function updateStats(result: VTResult, fromCache: boolean): Promise<void> {
  try {
    const redis = await getRedisClient();
    
    // Increment counters
    await redis.hIncrBy(VT_STATS_KEY, 'totalLookups', 1);
    
    if (fromCache) {
      await redis.hIncrBy(VT_STATS_KEY, 'cacheHits', 1);
    } else {
      await redis.hIncrBy(VT_STATS_KEY, 'apiCalls', 1);
    }
    
    switch (result.status) {
      case 'malicious':
        await redis.hIncrBy(VT_STATS_KEY, 'malwareFound', 1);
        break;
      case 'suspicious':
        await redis.hIncrBy(VT_STATS_KEY, 'suspiciousFound', 1);
        break;
      case 'clean':
        await redis.hIncrBy(VT_STATS_KEY, 'cleanFiles', 1);
        break;
      case 'unknown':
        await redis.hIncrBy(VT_STATS_KEY, 'unknownFiles', 1);
        break;
      case 'error':
        await redis.hIncrBy(VT_STATS_KEY, 'errors', 1);
        break;
    }
    
    await redis.hSet(VT_STATS_KEY, 'lastLookup', new Date().toISOString());
  } catch {
    // Stats are non-critical
  }
}

/**
 * Get VT statistics from Redis
 */
export async function getVTStats(): Promise<VTStats> {
  try {
    const redis = await getRedisClient();
    const stats = await redis.hGetAll(VT_STATS_KEY);
    
    return {
      totalLookups: parseInt(stats.totalLookups || '0', 10),
      cachHits: parseInt(stats.cacheHits || '0', 10),
      apiCalls: parseInt(stats.apiCalls || '0', 10),
      malwareFound: parseInt(stats.malwareFound || '0', 10),
      suspiciousFound: parseInt(stats.suspiciousFound || '0', 10),
      cleanFiles: parseInt(stats.cleanFiles || '0', 10),
      unknownFiles: parseInt(stats.unknownFiles || '0', 10),
      errors: parseInt(stats.errors || '0', 10),
      lastLookup: stats.lastLookup || null,
    };
  } catch {
    return {
      totalLookups: 0,
      cachHits: 0,
      apiCalls: 0,
      malwareFound: 0,
      suspiciousFound: 0,
      cleanFiles: 0,
      unknownFiles: 0,
      errors: 0,
      lastLookup: null,
    };
  }
}

/**
 * Check a file hash against VirusTotal
 * 
 * @param hash - SHA256 hash of the file
 * @param apiKey - VirusTotal API key (optional, uses env var if not provided)
 * @param processName - Optional process name for better labeling
 * @returns VTResult with detection info
 */
export async function checkHash(
  hash: string,
  apiKey?: string,
  processName?: string
): Promise<VTResult> {
  const normalizedHash = hash.toLowerCase();
  const now = new Date().toISOString();
  
  // Check cache first
  const cached = await getCachedResult(normalizedHash);
  if (cached) {
    await updateStats(cached, true);
    return cached;
  }
  
  // Check rate limiting
  const { allowed, waitMs } = await canMakeRequest();
  if (!allowed) {
    return {
      hash: normalizedHash,
      status: 'error',
      severity: 'INFO',
      points: 0,
      label: 'Rate Limited',
      reason: `Rate limit: wait ${Math.ceil(waitMs / 1000)}s`,
      checkedAt: now,
      source: 'api',
    };
  }
  
  // Get API key
  const key = apiKey || process.env.VIRUSTOTAL_API_KEY || process.env.VirusTotalAPIKey;
  if (!key) {
    return {
      hash: normalizedHash,
      status: 'error',
      severity: 'INFO',
      points: 0,
      label: 'No API Key',
      reason: 'VirusTotal API key not configured',
      checkedAt: now,
      source: 'api',
    };
  }
  
  // Make API request
  try {
    await recordRequest();
    
    const response = await fetch(
      `https://www.virustotal.com/api/v3/files/${normalizedHash}`,
      {
        headers: {
          'x-apikey': key,
          'Accept': 'application/json',
        },
      }
    );
    
    if (response.status === 429) {
      // Rate limited by VT
      return {
        hash: normalizedHash,
        status: 'error',
        severity: 'INFO',
        points: 0,
        label: 'VT Rate Limited',
        reason: 'VirusTotal rate limit exceeded',
        checkedAt: now,
        source: 'api',
      };
    }
    
    if (response.status === 404) {
      // File not in VT database
      const result: VTResult = {
        hash: normalizedHash,
        status: 'unknown',
        severity: 'WARN',
        points: 5,
        label: processName ? `Unknown: ${processName}` : 'Unknown File',
        reason: 'Not found in VirusTotal database',
        checkedAt: now,
        source: 'api',
      };
      
      await cacheResult(result);
      await updateStats(result, false);
      return result;
    }
    
    if (response.status === 401) {
      return {
        hash: normalizedHash,
        status: 'error',
        severity: 'INFO',
        points: 0,
        label: 'Invalid API Key',
        reason: 'VirusTotal API key is invalid',
        checkedAt: now,
        source: 'api',
      };
    }
    
    if (!response.ok) {
      return {
        hash: normalizedHash,
        status: 'error',
        severity: 'INFO',
        points: 0,
        label: 'API Error',
        reason: `VirusTotal returned ${response.status}`,
        checkedAt: now,
        source: 'api',
      };
    }
    
    const data = await response.json();
    const attributes = data.data?.attributes || {};
    
    // Extract stats
    const stats = attributes.last_analysis_stats || {};
    const malicious = stats.malicious || 0;
    const suspicious = stats.suspicious || 0;
    const harmless = stats.harmless || 0;
    const undetected = stats.undetected || 0;
    const total = malicious + suspicious + harmless + undetected;
    
    // Extract names and tags
    const meaningfulName = attributes.meaningful_name || processName || 'Unknown';
    const names = attributes.names || [];
    const tags = attributes.tags || [];
    
    // Determine threat level
    let result: VTResult;
    
    if (malicious >= MALWARE_THRESHOLD) {
      result = {
        hash: normalizedHash,
        status: 'malicious',
        severity: 'CRITICAL',
        points: 15,
        label: `MALWARE: ${meaningfulName}`,
        reason: `${malicious}/${total} AV engines detect as malware`,
        stats: { malicious, suspicious, harmless, undetected, total },
        names,
        tags,
        checkedAt: now,
        source: 'api',
      };
    } else if (malicious >= SUSPICIOUS_THRESHOLD || suspicious >= 3) {
      result = {
        hash: normalizedHash,
        status: 'suspicious',
        severity: 'ALERT',
        points: 10,
        label: `Suspicious: ${meaningfulName}`,
        reason: `${malicious}+${suspicious}/${total} detections`,
        stats: { malicious, suspicious, harmless, undetected, total },
        names,
        tags,
        checkedAt: now,
        source: 'api',
      };
    } else if (
      POKER_KEYWORDS.some(kw => 
        meaningfulName.toLowerCase().includes(kw) ||
        names.some((n: string) => n.toLowerCase().includes(kw)) ||
        tags.some((t: string) => t.toLowerCase().includes(kw))
      )
    ) {
      result = {
        hash: normalizedHash,
        status: 'suspicious',
        severity: 'WARN',
        points: 5,
        label: `Poker Tool: ${meaningfulName}`,
        reason: `Identified as poker-related tool`,
        stats: { malicious, suspicious, harmless, undetected, total },
        names,
        tags,
        checkedAt: now,
        source: 'api',
      };
    } else {
      result = {
        hash: normalizedHash,
        status: 'clean',
        severity: 'INFO',
        points: 0,
        label: meaningfulName,
        reason: `Clean (${total} AV engines checked)`,
        stats: { malicious, suspicious, harmless, undetected, total },
        names,
        tags,
        checkedAt: now,
        source: 'api',
      };
    }
    
    await cacheResult(result);
    await updateStats(result, false);
    return result;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      hash: normalizedHash,
      status: 'error',
      severity: 'INFO',
      points: 0,
      label: 'Request Failed',
      reason: errorMessage,
      checkedAt: now,
      source: 'api',
    };
  }
}

/**
 * Batch check multiple hashes (respects rate limiting)
 * Returns immediately available cached results, queues API lookups
 */
export async function checkHashesBatch(
  hashes: string[],
  apiKey?: string
): Promise<Map<string, VTResult>> {
  const results = new Map<string, VTResult>();
  const uncached: string[] = [];
  
  // First pass: get all cached results
  for (const hash of hashes) {
    const cached = await getCachedResult(hash.toLowerCase());
    if (cached) {
      results.set(hash.toLowerCase(), cached);
    } else {
      uncached.push(hash);
    }
  }
  
  // For uncached, we can only check one due to rate limiting
  // Return placeholder for the rest
  if (uncached.length > 0) {
    // Check first uncached hash
    const result = await checkHash(uncached[0], apiKey);
    results.set(uncached[0].toLowerCase(), result);
    
    // Mark rest as pending
    for (let i = 1; i < uncached.length; i++) {
      results.set(uncached[i].toLowerCase(), {
        hash: uncached[i].toLowerCase(),
        status: 'error',
        severity: 'INFO',
        points: 0,
        label: 'Queued',
        reason: 'Rate limited - will check on next request',
        checkedAt: new Date().toISOString(),
        source: 'api',
      });
    }
  }
  
  return results;
}

/**
 * Get all cached VT results from Redis
 */
export async function getAllCachedResults(): Promise<VTResult[]> {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys(`${VT_CACHE_PREFIX}*`);
    
    if (keys.length === 0) {
      return [];
    }
    
    const results: VTResult[] = [];
    for (const key of keys) {
      const cached = await redis.get(key);
      if (cached) {
        try {
          results.push(JSON.parse(cached));
        } catch {
          // Skip invalid entries
        }
      }
    }
    
    return results;
  } catch {
    return [];
  }
}

/**
 * Clear VT cache (for testing/admin)
 */
export async function clearVTCache(): Promise<number> {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys(`${VT_CACHE_PREFIX}*`);
    
    if (keys.length > 0) {
      await redis.del(keys);
    }
    
    return keys.length;
  } catch {
    return 0;
  }
}

