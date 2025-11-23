import fs from "node:fs";
import path from "node:path";

import { sanitizeDeviceName } from "./device-name-utils";

/**
 * Device name resolution sources with priority order.
 * 
 * Priority order (from highest to lowest):
 * 1. batchHost - Computer name (e.g., "JakobsDator")
 * 2. batchDevice - Device name from batch
 * 3. batchDeviceHostname - Device hostname from batch
 * 4. signalDeviceName - Device name from signal
 * 5. batchMetaHostname - Metadata hostname
 * 6. batchNickname - Player nickname (e.g., "FastCarsss") - LOW priority so it's only used for nickname field
 * 7. deviceId - MD5 hash fallback
 * 
 * This ensures "Device" field shows computer name and "Nickname" field shows player name separately.
 */
export interface DeviceNameSources {
  deviceId: string;
  batchNickname?: string | null;
  batchDevice?: string | null;
  batchHost?: string | null;
  batchDeviceHostname?: string | null;
  batchMetaHostname?: string | null;
  signalDeviceName?: string | null;
}

const DEFAULT_PRIORITY: Array<keyof DeviceNameSources> = [
  "batchHost",
  "batchDevice",
  "batchDeviceHostname",
  "signalDeviceName",
  "batchMetaHostname",
  "batchNickname",
  "deviceId",
];

const CONFIG_KEY_MAP: Record<string, keyof DeviceNameSources> = {
  "batch.nickname": "batchNickname",
  "batch.device": "batchDevice",
  "batch.system.host": "batchHost",
  "batch.device.hostname": "batchDeviceHostname",
  "batch.meta.hostname": "batchMetaHostname",
  "signal.device_name": "signalDeviceName",
  device_id: "deviceId",
};

function loadPriorityOrder(): Array<keyof DeviceNameSources> {
  try {
    const explicitPath =
      process.env.REDIS_IDENTITY_PATH ||
      path.resolve(process.cwd(), "../../config/redis_identity.json");
    if (!fs.existsSync(explicitPath)) {
      return DEFAULT_PRIORITY;
    }
    const contents = JSON.parse(fs.readFileSync(explicitPath, "utf-8"));
    if (Array.isArray(contents?.name_priority)) {
      const mapped = contents.name_priority
        .map((entry: string) => CONFIG_KEY_MAP[entry])
        .filter(Boolean) as Array<keyof DeviceNameSources>;
      if (mapped.length > 0) {
        return mapped;
      }
    }
  } catch {
    // Ignore config errors and fall back to defaults
  }
  return DEFAULT_PRIORITY;
}

const NAME_PRIORITY = loadPriorityOrder();

export function resolveDeviceName(sources: DeviceNameSources): string {
  for (const key of NAME_PRIORITY) {
    if (key === "deviceId") {
      return sources.deviceId;
    }
    const candidate = sources[key];
    const sanitized = sanitizeDeviceName(
      typeof candidate === "string" ? candidate : null,
      sources.deviceId,
    );
    if (sanitized) {
      return sanitized;
    }
  }
  return sources.deviceId;
}

