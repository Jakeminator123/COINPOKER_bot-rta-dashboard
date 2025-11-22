import { NextRequest } from 'next/server';
import { withRedis } from '@/lib/redis-client';
import { successResponse, errorResponse } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cache for player summaries (TTL: 60 seconds)
const summaryCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60000; // 60 seconds

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const device = searchParams.get('device');

  if (!device) {
    return errorResponse('device parameter required', 400);
  }

  // Check cache
  const cached = summaryCache.get(device);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return successResponse(cached.data);
  }

  try {
    const result = await withRedis(async (client) => {
      // Get player summary from Redis
      // Note: Summary is stored as JSON string, not hash
      const summaryKey = `player_summary:${device}`;
      const summaryStr = await client.get(summaryKey);

      if (!summaryStr) {
        // Build summary from historical data
        const histKeys = await client.keys(`hist:${device}:*`);
        let totalDetections = 0;
         
        const totalScore = 0; // Not currently used in calculation but kept for future use
        let totalSessions = 0;
        let totalDuration = 0;
        let firstSeen = Date.now();
        let lastSeen = 0;

        for (const key of histKeys) {
          const data = await client.hGetAll(key);
          if (data.total) {
            totalDetections += parseInt(data.total);
          }
          if (data.last_ts) {
            const ts = parseInt(data.last_ts) * 1000;
            if (ts > lastSeen) lastSeen = ts;
            if (ts < firstSeen) firstSeen = ts;
          }
        }

        // Get session data
        const sessionKeys = await client.keys(`session:${device}:*`);
        totalSessions = sessionKeys.length;

        for (const sessionKey of sessionKeys) {
          try {
            // Session data is stored as JSON string, not hash
            const sessionStr = await client.get(sessionKey);
            if (sessionStr) {
              const sessionData = JSON.parse(sessionStr);
              if (sessionData.session_duration_seconds) {
                totalDuration += parseInt(sessionData.session_duration_seconds);
              }
            }
          } catch (e) {
            // Skip invalid session data
            if (process.env.NODE_ENV !== "production") {
              console.error(`[player/summary] Failed to parse session ${sessionKey}:`, e);
            }
          }
        }

        const daysActive = Math.ceil((lastSeen - firstSeen) / (1000 * 60 * 60 * 24)) || 1;
        const avgSessionDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;
        const avgThreatScore = totalDetections > 0 ? Math.min(100, (totalScore / totalDetections) * 10) : 0;

        const computedSummary = {
          device_id: device,
          device_name: device.split('_')[0],
          total_sessions: totalSessions,
          total_detections: totalDetections,
          avg_threat_score: avgThreatScore,
          avg_session_duration: avgSessionDuration,
          days_active: daysActive,
          first_seen: Math.floor(firstSeen / 1000),
          last_seen: Math.floor(lastSeen / 1000),
        };

        // Cache the computed summary in Redis
        await client.hSet(summaryKey, Object.entries(computedSummary).reduce((acc, [k, v]) => {
          acc[k] = String(v);
          return acc;
        }, {} as Record<string, string>));
        await client.expire(summaryKey, 3600); // Expire after 1 hour

        return computedSummary;
      }

      // Parse stored summary (stored as JSON string)
      try {
        const summary = JSON.parse(summaryStr);
        return {
          device_id: summary.device_id || device,
          device_name: summary.device_name || device.split('_')[0],
          avg_score: summary.avg_score || 0,
          avg_bot_probability: summary.avg_bot_probability || 0,
          total_reports: summary.total_reports || 0,
          averages: summary.averages || { "1h": 0, "24h": 0, "7d": 0, "30d": 0 },
          segments: summary.segments || {},
          top_threats: summary.top_threats || [],
          updated_at: summary.updated_at || 0,
        };
      } catch (e) {
        console.error(`[player/summary] Failed to parse summary JSON:`, e);
        // Fallback to basic summary structure
        return {
          device_id: device,
          device_name: device.split('_')[0],
          avg_score: 0,
          avg_bot_probability: 0,
          total_reports: 0,
          averages: { "1h": 0, "24h": 0, "7d": 0, "30d": 0 },
          segments: {},
          top_threats: [],
          updated_at: 0,
        };
      }
    });

    // Update cache
    summaryCache.set(device, { data: { ok: true, data: result }, timestamp: Date.now() });

    // Clean old cache entries
    if (summaryCache.size > 50) {
      const entries = Array.from(summaryCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < 25; i++) {
        summaryCache.delete(entries[i][0]);
      }
    }

    return successResponse({ ok: true, data: result });
  } catch (error: any) {
    console.error('[player/summary] Error:', error);
    return errorResponse(error.message || 'Failed to fetch player summary', 500);
  }
}
