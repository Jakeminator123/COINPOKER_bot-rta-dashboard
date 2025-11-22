import { NextRequest } from "next/server";
import { createClient } from "redis";
import { THREAT_WEIGHTS } from "@/lib/detections/threat-scoring";
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

function scoreFromStored(stored: any): number {
  // Prefer system reports' bot_probability/summary.raw_detection_score
  try {
    if (
      stored?.category === "system" &&
      stored?.name &&
      stored?.details &&
      (stored.name.includes("Scan Report") ||
        stored.name.includes("Threat Summary"))
    ) {
      const det = JSON.parse(stored.details);
      if (typeof det?.bot_probability === "number") {
        const p =
          det.bot_probability <= 1
            ? det.bot_probability * 100
            : det.bot_probability;
        return Number.isFinite(p) ? Math.round(p) : 0;
      }
      if (typeof det?.summary?.raw_detection_score === "number") {
        return Number.isFinite(det.summary.raw_detection_score)
          ? Math.round(det.summary.raw_detection_score)
          : 0;
      }
      // Legacy: total_score was removed from backend, but keep for backward compatibility with old batches
      if (typeof det?.summary?.total_score === "number") {
        return Number.isFinite(det.summary.total_score)
          ? Math.round(det.summary.total_score)
          : 0;
      }
    }
  } catch {
    // Ignore Redis errors, fallback to default weights
  }
  // Fallback to status weights
  const w = (THREAT_WEIGHTS as any)[stored?.status] ?? 0;
  return typeof w === "number" ? w : 0;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const device = searchParams.get("device");
  const windowSec = Number(searchParams.get("window") || 3600);

  if (!device || typeof device !== "string" || device.trim().length === 0) {
    return errorResponse("device parameter required", 400);
  }

  const client = getRedis();
  try {
    await client.connect();
    const sectionKeys: string[] = [];
    for await (const key of client.scanIterator({
      MATCH: "section:*",
      COUNT: 200,
    })) {
      sectionKeys.push(key);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const minScore = nowSec - windowSec;

    let total = 0;
    let sum = 0;
    const minuteSet = new Set<number>();

    for (const sectionKey of sectionKeys) {
      // Get all signal keys in the time window (by score = timestamp)
      const keysInWindow = await client.zRange(sectionKey, minScore, nowSec, {
        BY: "SCORE",
      });
      if (!keysInWindow.length) continue;

      // Batch GET values
      const tx = client.multi();
      for (const k of keysInWindow) tx.get(k);
      const res = await tx.exec();
      const values = (res || []).map((r: any) => (Array.isArray(r) ? r[1] : r));

      for (const v of values) {
        if (!v) continue;
        try {
          const stored = JSON.parse(v);
          if (!stored || (stored.device_id || "unknown") !== device) continue;
          const s = scoreFromStored(stored);
          if (s > 0) {
            sum += s;
            total += 1;
          }
          if (typeof stored.timestamp === "number") {
            const minute = Math.floor(stored.timestamp / 60);
            minuteSet.add(minute);
          }
        } catch {
          // Ignore individual key processing errors
        }
      }
    }

    const avg = total > 0 ? sum / total : 0;
    return successResponse(
      {
        device,
        windowSec,
        total,
        avg,
        activeMinutes: minuteSet.size,
      },
      200,
      { cache: "no-store" },
    );
  } catch (e: any) {
    console.error("[history/hour] error:", e);
    return errorResponse(e, 500);
  } finally {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors - connection may already be closed
    }
  }
}
