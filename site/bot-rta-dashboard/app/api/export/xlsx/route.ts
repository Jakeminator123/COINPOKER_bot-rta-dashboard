import { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";
import {
  exportPlayerSegmentsToXLSX,
  generateExportFilename,
  saveXLSXToFile,
} from "@/lib/utils/xlsx-export";
import { errorResponse } from "@/lib/utils/api-utils";
import { redisKeys } from "@/lib/redis/schema";

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
  const type = searchParams.get("type") || "all"; // hourly | session | daily | all
  const days = Number(searchParams.get("days") || 30);

  if (!device || typeof device !== "string" || device.trim().length === 0) {
    return errorResponse("device parameter required", 400);
  }

  const client = getRedis();
  try {
    await client.connect();

    // Get device info
    const deviceKey = redisKeys.deviceHash(device);
    const deviceData = await client.hGetAll(deviceKey);
    const deviceName =
      deviceData.device_name || `Device_${device.substring(0, 8)}`;

    const now = Math.floor(Date.now() / 1000);
    const minHourScore = now - 24 * 3600; // Last 24 hours for hourly
    const minDayTimestamp = now - days * 86400;

    const segmentIndexKey = `segment_index:${device}`;
    let comboPairs = await client
      .sMembers(segmentIndexKey)
      .catch(() => [] as string[]);

    if (!comboPairs.length) {
      const comboSet = new Set<string>();
      for await (const key of client.scanIterator({
        MATCH: `segments:${device}:*:*:hourly`,
        COUNT: 200,
      })) {
        const match = key.match(
          new RegExp(`segments:${device}:([^:]+):([^:]+):hourly`)
        );
        if (match) {
          comboSet.add(`${match[1]}:${match[2]}`);
        }
      }
      comboPairs = Array.from(comboSet);
    }

    const segmentCombos = comboPairs
      .map((pair) => {
        const [cat, subsec] = pair.split(":");
        if (!cat || !subsec) return null;
        return { cat, subsec };
      })
      .filter(Boolean) as Array<{ cat: string; subsec: string }>;

    const dayScoreForTimestamp = (tsSec: number) => {
      const date = new Date(tsSec * 1000);
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(date.getUTCDate()).padStart(2, "0");
      return Number(`${yyyy}${mm}${dd}`);
    };

    const minDayScore = dayScoreForTimestamp(minDayTimestamp);

    // Fetch hourly data
     
    const hourlyData: any[] = [];
    if (type === "hourly" || type === "all") {
      for (const { cat, subsec } of segmentCombos) {
        const indexKey = `segments:${device}:${cat}:${subsec}:hourly`;
        const keys = await client.zRange(indexKey, minHourScore, now, {
          BY: "SCORE",
          REV: true,
          LIMIT: { offset: 0, count: 24 },
        });
        for (const key of keys) {
          const data = await client.hGetAll(key);
          if (data && Object.keys(data).length > 0) {
            hourlyData.push({
              category: data.category || cat,
              subsection: data.subsection || subsec,
              timestamp: parseInt(data.timestamp || "0"),
              avg_score: parseFloat(data.avg_score || "0"),
              total_detections: parseInt(data.detection_count || "0"),
              points_sum: parseInt(data.points_sum || "0"),
              time_label: data.hour || "",
            });
          }
        }
      }
    }

    // Fetch daily data
     
    const dailyData: any[] = [];
    if (type === "daily" || type === "all") {
      for (const { cat, subsec } of segmentCombos) {
        const indexKey = `segments:${device}:${cat}:${subsec}:daily`;
        const keys = await client.zRange(indexKey, minDayScore, "+inf", {
          BY: "SCORE",
          REV: true,
          LIMIT: { offset: 0, count: days },
        });
        for (const key of keys) {
          const data = await client.hGetAll(key);
          if (data && Object.keys(data).length > 0) {
            dailyData.push({
              category: data.category || cat,
              subsection: data.subsection || subsec,
              timestamp: parseInt(data.timestamp || "0"),
              avg_score: parseFloat(data.avg_score || "0"),
              total_detections: parseInt(data.detection_count || "0"),
              points_sum: parseInt(data.points_sum || "0"),
              time_label: data.day || "",
            });
          }
        }
      }
    }

    // Fetch session data
     
    const sessionData: any[] = [];
    if (type === "session" || type === "all") {
      const sessionsIndexKey = redisKeys.sessionIndex(device);
      const since = now - days * 86400;
      // Redis 4.x API: use zRange with BY_SCORE
      const sessionKeys = await client.zRange(sessionsIndexKey, since, "+inf", {
        BY: "SCORE",
        REV: true,
        LIMIT: { offset: 0, count: 100 },
      });

      for (const key of sessionKeys) {
        const data = await client.get(key);
        if (!data) continue;
        try {
          const sessionEvent = JSON.parse(data);
          const sessionStart = sessionEvent.session_start || 0;

          // Get segments for this session
          const segmentKeys: string[] = [];
          for await (const segKey of client.scanIterator({
            MATCH: `session:${device}:${sessionStart}:segment:*`,
            COUNT: 200,
          })) {
            segmentKeys.push(segKey);
          }
           
          const segments: any[] = [];
          for (const segKey of segmentKeys) {
            const segData = await client.hGetAll(segKey);
            if (segData && Object.keys(segData).length > 0) {
              segments.push({
                category: segData.category,
                subsection: segData.subsection,
                avg_score: parseFloat(segData.avg_score || "0"),
                total_detections: parseInt(segData.detection_count || "0"),
                points_sum: parseInt(segData.points_sum || "0"),
              });
            }
          }

          sessionData.push({
            session_start: sessionStart * 1000, // Convert to ms
            session_end: (sessionEvent.session_end || 0) * 1000,
            session_duration_seconds:
              sessionEvent.session_duration_seconds || 0,
            event_type: sessionEvent.event_type || "unknown",
            final_threat_score: sessionEvent.final_threat_score || 0,
            final_bot_probability: sessionEvent.final_bot_probability || 0,
            segments,
          });
        } catch {
          // Ignore individual segment processing errors
        }
      }
    }

    // Check if running locally (save to file) or production (download)
    const isLocal =
      process.env.NODE_ENV !== "production" ||
      !process.env.REDIS_URL?.includes("render");

    if (isLocal) {
      // Save to exports directory for local development
      const filepath = await saveXLSXToFile(
        device,
        deviceName,
        hourlyData,
        dailyData,
        sessionData
      );

      if (process.env.NODE_ENV !== "production") {
        console.log(`[export/xlsx] File saved to: ${filepath}`);
        console.log(
          `[export/xlsx] Data: ${hourlyData.length} hourly, ${dailyData.length} daily, ${sessionData.length} sessions`
        );
      }

      // Still return download, but also save locally
      const buffer = await exportPlayerSegmentsToXLSX(
        device,
        deviceName,
        hourlyData,
        dailyData,
        sessionData
      );

      const filename = generateExportFilename(
        device,
        deviceName,
         
        type === "all" ? "daily" : (type as any)
      );

      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } else {
      // Production: just return download
      const buffer = await exportPlayerSegmentsToXLSX(
        device,
        deviceName,
        hourlyData,
        dailyData,
        sessionData
      );

      const filename = generateExportFilename(
        device,
        deviceName,
         
        type === "all" ? "daily" : (type as any)
      );

      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }
   
  } catch (e: any) {
    console.error("[export/xlsx] error:", e);
    return errorResponse(e, 500);
  } finally {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors - connection may already be closed
    }
  }
}
