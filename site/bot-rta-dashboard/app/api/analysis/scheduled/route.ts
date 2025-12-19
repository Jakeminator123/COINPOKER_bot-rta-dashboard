import { NextRequest } from "next/server";
import { getDevices } from "@/lib/utils/store";
import { analyzePlayerSummary, saveAIAnalysis } from "@/lib/ai/analysis";
import { successResponse, errorResponse } from "@/lib/utils/api-utils";
import { redisKeys } from "@/lib/redis/schema";

type RequestBody = {
  deviceIds?: string[];
  max?: number;
  minThreat?: number;
  onlyActiveSinceDays?: number; // consider last_seen within X days
};

export const dynamic = "force-dynamic";

const DEFAULT_MAX = 4000;

function validateToken(req: NextRequest) {
  const token = process.env.ANALYSIS_TOKEN;
  if (!token) return true;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${token}`;
}

export async function POST(req: NextRequest) {
  if (!validateToken(req)) {
    return errorResponse("Unauthorized", 401);
  }

  let body: RequestBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const max = Math.min(Math.max(body.max ?? DEFAULT_MAX, 1), DEFAULT_MAX);
  const minThreat = typeof body.minThreat === "number" ? body.minThreat : 60;
  const onlyActiveSinceDays =
    typeof body.onlyActiveSinceDays === "number" ? body.onlyActiveSinceDays : 7;
  const activeCutoffMs =
    onlyActiveSinceDays > 0 ? Date.now() - onlyActiveSinceDays * 24 * 3600 * 1000 : null;

  // Fetch devices list
  const devicesResp = await getDevices();
  const devices = Array.isArray(devicesResp?.devices) ? devicesResp.devices : [];

  const filteredDevices = (body.deviceIds && Array.isArray(body.deviceIds) && body.deviceIds.length > 0
    ? devices.filter((d) => body.deviceIds?.includes(d.device_id))
    : devices
  )
    .filter((d) => {
      const threat = Number(d.threat_level || 0);
      if (threat < minThreat) return false;
      if (activeCutoffMs) {
        const lastSeenMs = (d.last_seen || 0) * 1000;
        if (lastSeenMs < activeCutoffMs) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const ta = Number(a.threat_level || 0);
      const tb = Number(b.threat_level || 0);
      if (tb !== ta) return tb - ta;
      return (b.last_seen || 0) - (a.last_seen || 0);
    })
    .slice(0, max);

  const chosenIds = filteredDevices.map((d) => d.device_id).filter(Boolean);

  let processed = 0;
  const errors: Array<{ deviceId: string; error: string }> = [];

  for (const deviceId of chosenIds) {
    const dev = devices.find((d) => d.device_id === deviceId) || null;
    // Note: detections is optional in AIAnalysisInput
    // If needed, detections can be fetched from Redis (device:{deviceId}:threats)
    const detections: Array<{ category: string; name: string; status?: string; details?: string }> = [];

    try {
      const result = await analyzePlayerSummary({
        deviceId,
        deviceName: dev?.device_name,
        threatLevel: dev?.threat_level ?? null,
        detections,
        lastSeen: dev?.last_seen ? dev.last_seen * 1000 : null,
      });
      await saveAIAnalysis(result);
      processed += 1;
    } catch (err: any) {
      errors.push({ deviceId, error: String(err?.message || err) });
    }
  }

  return successResponse({
    processed,
    requested: chosenIds.length,
    errors,
    ttl_seconds: Number(process.env.AI_ANALYSIS_TTL_SECONDS) || 259200,
    redis_keys: {
      latest_pattern: redisKeys.aiAnalysisLatest("*" as any),
      history_pattern: redisKeys.aiAnalysisHistory("*" as any),
    },
  });
}

