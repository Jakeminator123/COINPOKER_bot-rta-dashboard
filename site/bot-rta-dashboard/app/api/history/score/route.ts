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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const device = searchParams.get('device');
  const days = Number(searchParams.get('days') || 30);
  const months = Number(searchParams.get('months') || 6);

  if (!device || typeof device !== "string" || device.trim().length === 0) {
    return errorResponse('device parameter required', 400);
  }

  const client = getRedis();
  try {
    await client.connect();

    // Daily aggregates
    const dayIndex = `hist_index:${device}`;
    const dayKeys = await client.zRange(dayIndex, -days, -1);
    const daily: Array<{ day: string; avg: number; total: number }> = [];

    for (const k of dayKeys) {
      const h = await client.hGetAll(k);
      if (Object.keys(h).length) {
        const sum = Number(h.score_sum || 0);
        const cnt = Number(h.score_count || 0);
        const avg = cnt > 0 ? sum / cnt : 0;
        daily.push({ day: h.day, avg, total: Number(h.total || 0) });
      }
    }

    // Monthly aggregates
    const monthIndex = `hist_month_index:${device}`;
    const monthKeys = await client.zRange(monthIndex, -months, -1);
    const monthly: Array<{ month: string; avg: number; total: number }> = [];

    for (const k of monthKeys) {
      const h = await client.hGetAll(k);
      if (Object.keys(h).length) {
        const sum = Number(h.score_sum || 0);
        const cnt = Number(h.score_count || 0);
        const avg = cnt > 0 ? sum / cnt : 0;
        monthly.push({ month: h.month, avg, total: Number(h.total || 0) });
      }
    }

    return successResponse({
      device,
      daily,
      monthly
    }, 200, { cache: 'no-store' });
  } catch (e: any) {
    console.error('[history/score] error:', e);
    return errorResponse(e, 500);
  } finally {
    try { 
      await client.disconnect(); 
    } catch {
      // Ignore disconnect errors - connection may already be closed
    }
  }
}


