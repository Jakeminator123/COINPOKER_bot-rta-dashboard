import { NextRequest } from "next/server";
import { createClient } from "redis";
import { successResponse, errorResponse } from "@/lib/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRedis() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return createClient({
    url,
    socket: {
      connectTimeout: 5000, // 5 second timeout
      reconnectStrategy: false, // Don't auto-reconnect for one-off queries
    },
  });
}

/**
 * GET /api/history/segment-summary
 *
 * Get average score per segment for a given period
 *
 * Query params:
 *   - device: device_id (required)
 *   - days: number of days (default: 7)
 *   - category: optional filter by category
 *   - subsection: optional filter by subsection
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const device = searchParams.get("device");
  const days = Number(searchParams.get("days") || 7);
  const category = searchParams.get("category");
  const subsection = searchParams.get("subsection");

  if (!device || typeof device !== "string" || device.trim().length === 0) {
    return errorResponse("device parameter required", 400);
  }

  const client = getRedis();
  try {
    await client.connect();

    const formatDateScore = (date: Date): number => {
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(date.getUTCDate()).padStart(2, "0");
      return Number(`${yyyy}${mm}${dd}`);
    };

    const nowMs = Date.now();
    const dayAgo = formatDateScore(new Date(nowMs - days * 86400000));
    const today = formatDateScore(new Date(nowMs));

    // Discover segment combinations for the device
    const segmentIndexKey = `segment_index:${device}`;
    let comboPairs = await client
      .sMembers(segmentIndexKey)
      .catch(() => [] as string[]);

    if (comboPairs.length === 0) {
      const comboSet = new Set<string>();
      for await (const key of client.scanIterator({
        MATCH: `segments:${device}:*:*:daily`,
        COUNT: 200,
      })) {
        const match = key.match(
          new RegExp(`segments:${device}:([^:]+):([^:]+):daily`),
        );
        if (match) {
          comboSet.add(`${match[1]}:${match[2]}`);
        }
      }
      comboPairs = Array.from(comboSet);
    }

    // Apply filters
    if (category) {
      comboPairs = comboPairs.filter((pair) => pair.startsWith(`${category}:`));
    }
    if (subsection) {
      comboPairs = comboPairs.filter((pair) => {
        const [, sub] = pair.split(":");
        return sub === subsection;
      });
    }

    const segments: Array<{
      segment_key: string;
      category: string;
      subsection: string;
      avg_score: number;
      total_detections: number;
      total_points: number;
      daily_breakdown: Array<{
        day: string;
        avg_score: number;
        detections: number;
      }>;
    }> = [];

    for (const pair of comboPairs) {
      const [cat, subsec] = pair.split(":");
      if (!cat || !subsec) continue;

      const dayIndexKey = `segments:${device}:${cat}:${subsec}:daily`;
      const dayKeys = await client.zRangeByScore(
        dayIndexKey,
        dayAgo,
        today
      );

      if (dayKeys.length === 0) continue;

      let totalPoints = 0;
      let totalDetections = 0;
      const dailyBreakdown: Array<{
        day: string;
        avg_score: number;
        detections: number;
      }> = [];

      for (const dayKey of dayKeys) {
        const dayData = await client.hGetAll(dayKey);
        const points = parseInt(dayData.points_sum || "0");
        const detections = parseInt(dayData.detection_count || "0");
        const avgScore = parseFloat(dayData.avg_score || "0");

        if (detections > 0) {
          totalPoints += points;
          totalDetections += detections;
          dailyBreakdown.push({
            day: dayData.day || "",
            avg_score: avgScore,
            detections: detections,
          });
        }
      }

      if (totalDetections > 0) {
        segments.push({
          segment_key: `${cat}:${subsec}`,
          category: cat,
          subsection: subsec,
          avg_score: Math.round((totalPoints / totalDetections) * 10) / 10,
          total_detections: totalDetections,
          total_points: totalPoints,
          daily_breakdown: dailyBreakdown.sort((a, b) =>
            a.day.localeCompare(b.day)
          ),
        });
      }
    }

    // Sort by avg_score descending
    segments.sort((a, b) => b.avg_score - a.avg_score);

    return successResponse(
      {
        device_id: device,
        days,
        category: category || "all",
        subsection: subsection || "all",
        segments,
      },
      200,
      { cache: "no-store" }
    );
  } catch (e: any) {
    console.error("[history/segment-summary] error:", e);
    return errorResponse(e, 500);
  } finally {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors - connection may already be closed
    }
  }
}

