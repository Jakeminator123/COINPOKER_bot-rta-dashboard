import { NextRequest } from "next/server";
import { createClient } from "redis";
import { successResponse, errorResponse } from "@/lib/utils/api-utils";

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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const device = searchParams.get("device");
  const category = searchParams.get("category"); // Optional filter
  const subsection = searchParams.get("subsection"); // Optional filter
  const hours = Number(searchParams.get("hours") || 24);
  const days = Number(searchParams.get("days") || 7);

  if (!device || typeof device !== "string" || device.trim().length === 0) {
    return errorResponse("device parameter required", 400);
  }

  const client = getRedis();
  try {
    await client.connect();

    const now = Math.floor(Date.now() / 1000);
    const minHourScore = now - hours * 3600;
    const minDayScore = now - days * 86400;

    const results: Array<{
      category: string;
      subsection: string;
      type: "hourly" | "daily";
      timestamp: number;
      avg_score: number;
      total_detections: number;
      points_sum: number;
      time_label: string;
    }> = [];

    // Discover segment combinations for the device
    const segmentIndexKey = `segment_index:${device}`;
    let comboPairs = await client
      .sMembers(segmentIndexKey)
      .catch(() => [] as string[]);

    if (comboPairs.length === 0) {
      const comboSet = new Set<string>();
      for await (const key of client.scanIterator({
        MATCH: `segments:${device}:*:*:hourly`,
        COUNT: 200,
      })) {
        const match = key.match(
          new RegExp(`segments:${device}:([^:]+):([^:]+):hourly`),
        );
        if (match) {
          comboSet.add(`${match[1]}:${match[2]}`);
        }
      }
      comboPairs = Array.from(comboSet);
    }

    if (category) {
      comboPairs = comboPairs.filter((pair) => pair.startsWith(`${category}:`));
    }
    if (subsection) {
      comboPairs = comboPairs.filter((pair) => {
        const [, sub] = pair.split(":");
        return sub === subsection;
      });
    }

    const dayFormatter = (tsSec: number) => {
      const date = new Date(tsSec * 1000);
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(date.getUTCDate()).padStart(2, "0");
      return Number(`${yyyy}${mm}${dd}`);
    };

    const minDayScoreNumeric = dayFormatter(minDayScore);

    for (const pair of comboPairs) {
      const [cat, subsec] = pair.split(":");
      if (!cat || !subsec) continue;

      // Hourly aggregates
      const hourlyIndexKey = `segments:${device}:${cat}:${subsec}:hourly`;
      const hourlyKeys = await client.zRange(
        hourlyIndexKey,
        minHourScore,
        now,
        {
          BY: "SCORE",
          REV: true,
          LIMIT: { offset: 0, count: hours },
        },
      );

      for (const key of hourlyKeys) {
        const data = await client.hGetAll(key);
        if (!data || Object.keys(data).length === 0) continue;

        const timestamp = parseInt(data.timestamp || "0");
        const avg_score = parseFloat(data.avg_score || "0");
        const total_detections = parseInt(data.detection_count || "0");
        const points_sum = parseInt(data.points_sum || "0");

        results.push({
          category: data.category || cat,
          subsection: data.subsection || subsec,
          type: "hourly",
          timestamp,
          avg_score,
          total_detections,
          points_sum,
          time_label: data.hour || "",
        });
      }

      // Daily aggregates
      const dailyIndexKey = `segments:${device}:${cat}:${subsec}:daily`;
      const dailyKeys = await client.zRange(
        dailyIndexKey,
        minDayScoreNumeric,
        "+inf",
        {
          BY: "SCORE",
          REV: true,
          LIMIT: { offset: 0, count: days },
        },
      );

      for (const key of dailyKeys) {
        const data = await client.hGetAll(key);
        if (!data || Object.keys(data).length === 0) continue;

        const timestamp = parseInt(data.timestamp || data.last_ts || "0");
        const avg_score = parseFloat(data.avg_score || "0");
        const total_detections = parseInt(data.detection_count || "0");
        const points_sum = parseInt(data.points_sum || "0");

        results.push({
          category: data.category || cat,
          subsection: data.subsection || subsec,
          type: "daily",
          timestamp,
          avg_score,
          total_detections,
          points_sum,
          time_label: data.day || "",
        });
      }
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Calculate summary statistics per segment
    const segmentSummaries: Record<
      string,
      {
        segment_key: string;
        category: string;
        subsection: string;
        total_avg: number;
        total_detections: number;
        total_points: number;
        daily_count: number;
        hourly_count: number;
      }
    > = {};

    for (const result of results) {
      const segmentKey = `${result.category}:${result.subsection}`;
      if (!segmentSummaries[segmentKey]) {
        segmentSummaries[segmentKey] = {
          segment_key: segmentKey,
          category: result.category,
          subsection: result.subsection,
          total_avg: 0,
          total_detections: 0,
          total_points: 0,
          daily_count: 0,
          hourly_count: 0,
        };
      }

      const summary = segmentSummaries[segmentKey];
      summary.total_detections += result.total_detections;
      summary.total_points += result.points_sum;
      if (result.type === "daily") {
        summary.daily_count += 1;
      } else {
        summary.hourly_count += 1;
      }
    }

    // Calculate total average for each segment
    for (const segmentKey in segmentSummaries) {
      const summary = segmentSummaries[segmentKey];
      if (summary.total_detections > 0) {
        summary.total_avg = Math.round(
          (summary.total_points / summary.total_detections) * 10
        ) / 10;
      }
    }

    return successResponse(
      {
        device,
        category: category || "all",
        subsection: subsection || "all",
        hours,
        days,
        count: results.length,
        data: results,
        summaries: Object.values(segmentSummaries),
      },
      200,
      { cache: "no-store" },
    );
  } catch (e: any) {
    console.error("[history/segment] error:", e);
    return errorResponse(e, 500);
  } finally {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors - connection may already be closed
    }
  }
}
