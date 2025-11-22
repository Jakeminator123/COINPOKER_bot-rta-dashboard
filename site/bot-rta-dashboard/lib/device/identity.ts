import fs from "node:fs";
import path from "node:path";

import { sanitizeDeviceName } from "./device-name-utils";

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
  "batchNickname",
  "batchDevice",
  "batchHost",
  "batchDeviceHostname",
  "batchMetaHostname",
  "signalDeviceName",
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

