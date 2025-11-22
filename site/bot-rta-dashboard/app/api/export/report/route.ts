import { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";
import { errorResponse } from "@/lib/utils/api-utils";
import {
  exportPlayerSegmentsToXLSX,
  generateExportFilename,
} from "@/lib/utils/xlsx-export";
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

/**
 * Unified export endpoint supporting XLSX, CSV, and JSON formats
 * Supports session filtering and custom time ranges
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const device = searchParams.get("device");
  const format = searchParams.get("format") || "xlsx"; // xlsx | csv | json
  const type = searchParams.get("type") || "all"; // hourly | daily | sessions | all
  const days = Number(searchParams.get("days") || 7);
  const hours = Number(searchParams.get("hours") || 0);
  
  // Session filters
  const minDuration = searchParams.get("minDuration");
  const maxDuration = searchParams.get("maxDuration");
  const minThreatScore = searchParams.get("minThreatScore");
  const maxThreatScore = searchParams.get("maxThreatScore");

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
    const minTimestamp = now - (days * 86400 + hours * 3600);
    const minHourScore = now - 24 * 3600; // Last 24 hours for hourly
    const minDayTimestamp = now - days * 86400;

    // Get segment combinations
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

    // Fetch session data with filters
     
    const sessionData: any[] = [];
    if (type === "sessions" || type === "all") {
      const sessionsIndexKey = redisKeys.sessionIndex(device);
      const since = minTimestamp;
      
      const sessionKeys = await client.zRange(sessionsIndexKey, since, "+inf", {
        BY: "SCORE",
        REV: true,
        LIMIT: { offset: 0, count: 500 }, // Increased limit for filtering
      });

      for (const key of sessionKeys) {
        const data = await client.get(key);
        if (!data) continue;
        
        try {
          const sessionEvent = JSON.parse(data);
          const sessionStart = sessionEvent.session_start || 0;
          const sessionEnd = sessionEvent.session_end || 0;
          const durationSeconds = sessionEvent.session_duration_seconds || 0;
          const durationMinutes = Math.floor(durationSeconds / 60);
          const threatScore = sessionEvent.final_threat_score || 0;
          const botProbability = sessionEvent.final_bot_probability || 0;

          // Apply filters
          if (minDuration && durationMinutes < Number(minDuration)) continue;
          if (maxDuration && durationMinutes > Number(maxDuration)) continue;
          if (minThreatScore && botProbability < Number(minThreatScore)) continue;
          if (maxThreatScore && botProbability > Number(maxThreatScore)) continue;

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
            session_end: sessionEnd * 1000,
            session_duration_seconds: durationSeconds,
            session_duration_minutes: durationMinutes,
            event_type: sessionEvent.event_type || "unknown",
            final_threat_score: threatScore,
            final_bot_probability: botProbability,
            segments,
          });
        } catch {
          // Ignore individual segment processing errors
        }
      }
    }

    // Generate export based on format
    if (format === "xlsx") {
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
    } else if (format === "csv") {
      // Generate CSV
      const csvLines: string[] = [];
      
      // Header
      csvLines.push("Type,Category,Subsection,Timestamp,Time Label,Avg Score,Total Detections,Points Sum");
      
      // Hourly data
      for (const item of hourlyData) {
        csvLines.push(
          `Hourly,${item.category},${item.subsection},"${new Date(item.timestamp * 1000).toISOString()}","${item.time_label}",${item.avg_score},${item.total_detections},${item.points_sum}`
        );
      }
      
      // Daily data
      for (const item of dailyData) {
        csvLines.push(
          `Daily,${item.category},${item.subsection},"${new Date(item.timestamp * 1000).toISOString()}","${item.time_label}",${item.avg_score},${item.total_detections},${item.points_sum}`
        );
      }
      
      // Session data
      for (const session of sessionData) {
        const sessionStart = new Date(session.session_start).toISOString();
        const sessionEnd = session.session_end > 0
          ? new Date(session.session_end).toISOString()
          : "Active";
        
        if (session.segments.length === 0) {
          csvLines.push(
            `Session,All,All,"${sessionStart}","${sessionEnd}",${session.final_bot_probability},0,${session.final_threat_score}`
          );
        } else {
          for (const segment of session.segments) {
            csvLines.push(
              `Session,${segment.category},${segment.subsection},"${sessionStart}","${sessionEnd}",${segment.avg_score},${segment.total_detections},${segment.points_sum}`
            );
          }
        }
      }
      
      const csvContent = csvLines.join("\n");
      const filename = `player_${deviceName.replace(/[^a-zA-Z0-9]/g, "_")}_${device.substring(0, 8)}_${type}_${new Date().toISOString().split("T")[0]}.csv`;
      
      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } else if (format === "json") {
      // Generate JSON
      const jsonData = {
        device_id: device,
        device_name: deviceName,
        exported_at: new Date().toISOString(),
        time_range: {
          days,
          hours,
          start_timestamp: minTimestamp,
          end_timestamp: now,
        },
        filters: {
          min_duration_minutes: minDuration ? Number(minDuration) : null,
          max_duration_minutes: maxDuration ? Number(maxDuration) : null,
          min_threat_score: minThreatScore ? Number(minThreatScore) : null,
          max_threat_score: maxThreatScore ? Number(maxThreatScore) : null,
        },
        data: {
          hourly: hourlyData,
          daily: dailyData,
          sessions: sessionData.map(s => ({
            ...s,
            session_start: new Date(s.session_start).toISOString(),
            session_end: s.session_end > 0 ? new Date(s.session_end).toISOString() : null,
          })),
        },
        summary: {
          total_hourly_records: hourlyData.length,
          total_daily_records: dailyData.length,
          total_sessions: sessionData.length,
          avg_session_duration_minutes: sessionData.length > 0
            ? Math.round(sessionData.reduce((sum, s) => sum + s.session_duration_minutes, 0) / sessionData.length)
            : 0,
          avg_threat_score: sessionData.length > 0
            ? Math.round(sessionData.reduce((sum, s) => sum + s.final_bot_probability, 0) / sessionData.length * 10) / 10
            : 0,
        },
      };
      
      const filename = `player_${deviceName.replace(/[^a-zA-Z0-9]/g, "_")}_${device.substring(0, 8)}_${type}_${new Date().toISOString().split("T")[0]}.json`;
      
      return new NextResponse(JSON.stringify(jsonData, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } else {
      return errorResponse(`Unsupported format: ${format}`, 400);
    }
   
  } catch (e: any) {
    console.error("[export/report] error:", e);
    return errorResponse(e.message || "Export failed", 500);
  } finally {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors - connection may already be closed
    }
  }
}

