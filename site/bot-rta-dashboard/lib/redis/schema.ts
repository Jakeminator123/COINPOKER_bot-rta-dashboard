/**
 * Redis schema helpers
 * --------------------
 *
 * This module centralises every Redis key that the detection stack touches.
 * Both the Python scanner and the Next.js dashboard MUST use the same helpers
 * so that hashes, sorted sets and TTL policies stay perfectly aligned.
 *
 * Key naming principles:
 * - All device scoped keys start with `device:${deviceId}`
 * - Time indexed collections (`batch`, `day`, `hour`, `session`) always append the timestamp/date component
 * - Global indexes (e.g. `devices`, `top_players:bot_probability`) are exposed as zero-argument helpers
 */

export type DetectionSeverityBand = "CRITICAL" | "ALERT" | "WARN";

export interface DeviceHashFields {
  device_id: string;
  device_name?: string;
  last_seen?: string;
  threat_level?: string;
  session_start?: string;
  ip_address?: string;
}

export interface PlayerSummary {
  device_id: string;
  device_name: string;
  avg_bot_probability: number;
  avg_score: number;
  total_reports: number;
  total_detections: number;
  total_sessions: number;
  averages: Record<string, number>;
  first_seen: number;
  last_seen: number;
  updated_at: number;
}

export const redisKeys = {
  deviceHash(deviceId: string): string {
    return `device:${deviceId}`;
  },
  deviceCategories(deviceId: string): string {
    return `device:${deviceId}:categories`;
  },
  legacyDeviceInfo(deviceId: string): string {
    return `device:${deviceId}:info`;
  },
  deviceDetections(deviceId: string, band: DetectionSeverityBand): string {
    return `device:${deviceId}:detections:${band}`;
  },
  deviceThreat(deviceId: string): string {
    return `device:${deviceId}:threat`;
  },
  batchRecord(deviceId: string, timestamp: number): string {
    return `batch:${deviceId}:${timestamp}`;
  },
  batchesHourly(deviceId: string): string {
    return `batches:${deviceId}:hourly`;
  },
  batchesDaily(deviceId: string): string {
    return `batches:${deviceId}:daily`;
  },
  dayStats(deviceId: string, day: string): string {
    return `day:${deviceId}:${day}`;
  },
  hourStats(deviceId: string, hour: string): string {
    return `hour:${deviceId}:${hour}`;
  },
  playerSummary(deviceId: string): string {
    return `player_summary:${deviceId}`;
  },
  sessionRecord(deviceId: string, eventTimestamp: number): string {
    return `session:${deviceId}:${eventTimestamp}`;
  },
  sessionPattern(deviceId: string): string {
    return `session:${deviceId}:*`;
  },
  sessionIndex(deviceId: string): string {
    return `sessions:${deviceId}`;
  },
  deviceIndex(): string {
    return "devices";
  },
  topPlayers(): string {
    return "top_players:bot_probability";
  },
  deviceUpdatesChannel(deviceId: string): string {
    return `updates:${deviceId}`;
  },
  globalUpdatesChannel(): string {
    return "updates:all";
  },
};

export const redisTtl = {
  batchSeconds(defaultSeconds = 604800): number {
    return Number(process.env.REDIS_TTL_SECONDS) || defaultSeconds;
  },
};


