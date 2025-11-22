import { NextRequest } from 'next/server';
import { withRedis } from '@/lib/redis/redis-client';
import { successResponse, errorResponse } from '@/lib/utils/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cache for device history (TTL: 30 seconds)
const historyCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds
const MAX_CACHE_SIZE = 100;
const CACHE_CLEANUP_SIZE = 50;

// Input validation constants
// MAX_DAYS matches Redis TTL - data older than this is automatically cleaned up
// Reads from REDIS_TTL_SECONDS env var (default: 7 days = 604800 seconds)
const REDIS_TTL_SECONDS = Number(process.env.REDIS_TTL_SECONDS) || 604800;
const MIN_DAYS = 1;
const MAX_DAYS = Math.ceil(REDIS_TTL_SECONDS / 86400); // Convert seconds to days

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const device = searchParams.get('device');
    const daysParam = searchParams.get('days');

    // Input validation
    if (!device || typeof device !== 'string' || device.trim().length === 0) {
      return errorResponse('device parameter required', 400);
    }

    // Sanitize and validate days parameter
    const days = daysParam ? Number(daysParam) : MAX_DAYS;
    if (isNaN(days) || days < MIN_DAYS || days > MAX_DAYS) {
      return errorResponse(`days must be between ${MIN_DAYS} and ${MAX_DAYS}`, 400);
    }

    // Check cache
    const cacheKey = `${device}:${days}`;
    const cached = historyCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return successResponse(cached.data, 200, { cache: 'no-store' });
    }

    const result = await withRedis(async (client) => {
      const indexKey = `hist_index:${device}`;
      
      // Get daily aggregate keys from index
      // Using negative indices to get the most recent N days
      const keys = await client.zRange(indexKey, -days, -1);

      if (!Array.isArray(keys) || keys.length === 0) {
        return {
          device,
          days: 0,
          data: []
        };
      }

      // OPTIMIZATION: Use pipelining to fetch all daily data in parallel
      const pipeline = client.multi();
      for (const k of keys) {
        if (typeof k === 'string' && k.length > 0) {
          pipeline.hGetAll(k);
        }
      }
      const dataArray = await pipeline.exec();

      const out: Array<Record<string, any>> = [];
      for (let i = 0; i < keys.length && i < (dataArray?.length || 0); i++) {
        const _k = keys[i];
        const result = dataArray?.[i] as [Error | null, Record<string, string>] | null;
        
        // Skip invalid results
        if (!result || result[0] || !result[1] || typeof result[1] !== 'object' || Object.keys(result[1]).length === 0) {
          continue;
        }

        const h = result[1];
        const by_category: Record<string, number> = {};
        const by_status: Record<string, number> = {};
        
        // Parse category and status fields
        for (const [f, v] of Object.entries(h)) {
          if (typeof f === 'string' && typeof v === 'string') {
            if (f.startsWith('by_category:')) {
              const category = f.replace('by_category:', '');
              by_category[category] = Number(v) || 0;
            } else if (f.startsWith('by_status:')) {
              const status = f.replace('by_status:', '');
              by_status[status] = Number(v) || 0;
            }
          }
        }
        
        // Calculate avg_bot_probability from bot_prob_sum and score_count if available
        const botProbSum = Number(h.bot_prob_sum || 0);
        const scoreCount = Number(h.score_count || h.total || 0);
        const avgBotProbability = scoreCount > 0 ? Math.round(botProbSum / scoreCount) : 0;
        const avgScore = Number(h.avg_score || 0);
        
        // Validate day field exists
        if (!h.day || typeof h.day !== 'string') {
          continue; // Skip invalid entries
        }
        
        out.push({
          day: h.day,
          total: Number(h.total || 0),
          by_category,
          by_status,
          last_ts: Number(h.last_ts || 0),
          avg_score: avgScore,
          avg_bot_probability: avgBotProbability || avgScore,
          score_sum: Number(h.score_sum || 0),
          score_count: scoreCount,
        });
      }

      return {
        device,
        days: out.length,
        data: out
      };
    });

    // Update cache
    historyCache.set(cacheKey, { data: result, timestamp: Date.now() });

    // Clean old cache entries if cache is too large
    if (historyCache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(historyCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < CACHE_CLEANUP_SIZE; i++) {
        historyCache.delete(entries[i][0]);
      }
    }

    return successResponse(result, 200, { cache: 'no-store' });
  } catch (e: any) {
    console.error('[history] error:', e);
    return errorResponse(
      e instanceof Error ? e.message : 'Failed to fetch historical data',
      500
    );
  }
}
