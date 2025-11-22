import { NextRequest } from 'next/server';
import { createClient } from 'redis';
import { successResponse, errorResponse } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRedis() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    return createClient({
        url,
        socket: {
            connectTimeout: 5000, // 5 second timeout
            reconnectStrategy: false, // Don't auto-reconnect for one-off queries
        },
    });
}

/**
 * GET /api/leaderboard
 *
 * Get leaderboard rankings for players
 *
 * Query params:
 *   - period: 'hour' | 'day' | 'week' | 'month' (default: 'day')
 *   - date: optional date override (YYYYMMDD, YYYYMMDDHH, YYYYWXX, YYYYMM)
 *   - limit: number of top players (default: 100)
 *   - reverse: return lowest scores first (default: false, highest first)
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || 'day';
    const dateOverride = searchParams.get('date');
    const limit = Number(searchParams.get('limit') || 100);
    const reverse = searchParams.get('reverse') === 'true';

    const client = getRedis();
    try {
        await client.connect();

        // Build leaderboard key based on period
        let leaderboardKey: string;
        const now = new Date();

        if (dateOverride) {
            // Use provided date override
            if (period === 'hour') {
                leaderboardKey = `leaderboard:hour:${dateOverride}`;
            } else if (period === 'day') {
                leaderboardKey = `leaderboard:day:${dateOverride}`;
            } else if (period === 'week') {
                leaderboardKey = `leaderboard:week:${dateOverride}`;
            } else if (period === 'month') {
                leaderboardKey = `leaderboard:month:${dateOverride}`;
            } else {
                return errorResponse('Invalid period. Use: hour, day, week, month', 400);
            }
        } else {
            // Use current date
            const yyyy = now.getUTCFullYear();
            const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(now.getUTCDate()).padStart(2, '0');
            const hh = String(now.getUTCHours()).padStart(2, '0');

            if (period === 'hour') {
                leaderboardKey = `leaderboard:hour:${yyyy}${mm}${dd}${hh}`;
            } else if (period === 'day') {
                leaderboardKey = `leaderboard:day:${yyyy}${mm}${dd}`;
            } else if (period === 'week') {
                // Calculate week number
                const weekStart = new Date(Date.UTC(yyyy, now.getUTCMonth(), now.getUTCDate()));
                weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() || 7);
                const weekNum = Math.ceil((now.getTime() - weekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
                const weekKey = `${yyyy}W${String(weekNum).padStart(2, '0')}`;
                leaderboardKey = `leaderboard:week:${weekKey}`;
            } else if (period === 'month') {
                leaderboardKey = `leaderboard:month:${yyyy}${mm}`;
            } else {
                return errorResponse('Invalid period. Use: hour, day, week, month', 400);
            }
        }

        // Get top players from sorted set
        // For highest first: use negative indices (zRange returns last N items) and reverse
        // For lowest first: use positive indices (zRange returns first N items)
        let scores = reverse
            ? await client.zRangeWithScores(leaderboardKey, 0, limit - 1) // Lowest first
            : await client.zRangeWithScores(leaderboardKey, -limit, -1); // Highest first (negative = from end)

        // Reverse if highest first (negative indices return in ascending order, but we want descending)
        if (!reverse) {
            scores = scores.reverse();
        }

        // Get device names for each device_id
        const leaderboard: Array<{
            rank: number;
            device_id: string;
            device_name: string;
            score: number;
            bot_probability: number;
        }> = [];

        for (let i = 0; i < scores.length; i++) {
            const device_id = scores[i].value;
            const score = Math.round(scores[i].score);

            // Get device name
            const deviceKey = `device:${device_id}`;
            const deviceData = await client.hGetAll(deviceKey).catch(() => ({}));
            const device_name = (deviceData as Record<string, string>).device_name || `Device ${device_id.slice(0, 8)}`;

            leaderboard.push({
                rank: i + 1,
                device_id,
                device_name,
                score,
                bot_probability: score, // Score is bot_probability
            });
        }

        return successResponse({
            period,
            date: dateOverride || 'current',
            leaderboard,
            total: leaderboard.length,
        }, 200, { cache: 'no-store' });
    } catch (e: unknown) {
        console.error('[leaderboard] error:', e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        return errorResponse(errorMessage, 500);
    } finally {
        try { 
            await client.disconnect(); 
        } catch {
            // Ignore disconnect errors - connection may already be closed
        }
    }
}

