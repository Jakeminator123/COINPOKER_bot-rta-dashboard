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
  const since = Number(searchParams.get("since") || 0); // Timestamp in seconds
  const limit = Number(searchParams.get("limit") || 50);

  if (!device || typeof device !== "string" || device.trim().length === 0) {
    return errorResponse("device parameter required", 400);
  }

  const client = getRedis();
  try {
    await client.connect();

    // Get session events (Redis 4.x API: use zRange with BY_SCORE)
    const sessionsIndexKey = `sessions:${device}`;
    const sessionKeys = await client.zRange(sessionsIndexKey, since, "+inf", {
      BY: "SCORE",
      REV: true,
      LIMIT: { offset: 0, count: limit },
    });

    const sessions: Array<{
      session_start: number;
      session_end: number;
      session_duration_seconds: number;
      event_type: string;
      final_threat_score: number;
      final_bot_probability: number;
    }> = [];

    for (const key of sessionKeys) {
      const data = await client.get(key);
      if (!data) continue;

      try {
        const sessionEvent = JSON.parse(data);
        sessions.push({
          session_start: sessionEvent.session_start || 0,
          session_end: sessionEvent.session_end || 0,
          session_duration_seconds: sessionEvent.session_duration_seconds || 0,
          event_type: sessionEvent.event_type || "unknown",
          final_threat_score: sessionEvent.final_threat_score || 0,
          final_bot_probability: sessionEvent.final_bot_probability || 0,
        });
      } catch {
        // Ignore individual session processing errors
      }
    }

    // Get segment data for each session (Redis 4.x API: use zRange with BY_SCORE)
    const sessionSegmentsIndexKey = `sessions:${device}:segments`;
    const segmentKeys = await client.zRange(
      sessionSegmentsIndexKey,
      since * 1000,
      "+inf",
      {
        BY: "SCORE",
        REV: true,
        LIMIT: { offset: 0, count: limit * 10 }, // More segments than sessions
      }
    );

    const segmentMap = new Map<
      string,
      Array<{
        category: string;
        subsection: string;
        avg_score: number;
        total_detections: number;
        points_sum: number;
      }>
    >();

    for (const key of segmentKeys) {
      // Extract session ID from key: session:device:sessionId:segment:category:subsection
      const match = key.match(/session:[^:]+:(\d+):segment:([^:]+):([^:]+)/);
      if (!match) continue;

      const [, sessionId, category, subsection] = match;
      const sessionStart = parseInt(sessionId) * 1000; // Convert back to ms

      if (sessionStart < since * 1000) continue;

      const data = await client.hGetAll(key);
      if (!data || Object.keys(data).length === 0) continue;

      const sessionKey = String(sessionStart);
      if (!segmentMap.has(sessionKey)) {
        segmentMap.set(sessionKey, []);
      }

      segmentMap.get(sessionKey)!.push({
        category: data.category || category,
        subsection: data.subsection || subsection,
        avg_score: parseFloat(data.avg_score || "0"),
        total_detections: parseInt(data.detection_count || "0"),
        points_sum: parseInt(data.points_sum || "0"),
      });
    }

    // Combine sessions with segment data
    const result = sessions.map((session) => ({
      ...session,
      segments: segmentMap.get(String(session.session_start)) || [],
    }));

    return successResponse(
      {
        device,
        since,
        count: result.length,
        sessions: result,
      },
      200,
      { cache: "no-store" }
    );
   
  } catch (e: any) {
    console.error("[history/session] error:", e);
    return errorResponse(e, 500);
  } finally {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors - connection may already be closed
    }
  }
}
