export interface DeviceRecord {
  device_id: string;
  device_name: string;
  device_hostname?: string;
  player_nickname?: string;
  player_nickname_confidence?: number;
  last_seen: number;
  threat_level: number;
  signal_count: number;
  is_online: boolean;
  ip_address?: string;
  score_per_hour?: number;
  historical_threat_levels?: number[];
  threat_trend?: "up" | "down" | "stable";
  session_duration?: number;
}

export type DevicesResponse =
  | {
      devices?: unknown[];
      data?: unknown;
      total?: number;
    }
  | DeviceRecord[];

export interface NormalizedDevices {
  devices: DeviceRecord[];
  total: number;
}

export const ACTIVE_DEVICE_THRESHOLD_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractPayload(raw: unknown): { list: unknown[]; total?: number } {
  if (!raw) {
    return { list: [] };
  }

  if (Array.isArray(raw)) {
    return { list: raw };
  }

  if (isRecord(raw)) {
    if ("ok" in raw && isRecord(raw) && "data" in raw) {
      return extractPayload(raw.data);
    }

    if ("devices" in raw) {
      const devices = Array.isArray(raw.devices)
        ? raw.devices
        : isRecord(raw.devices)
          ? Object.values(raw.devices)
          : [];
      return {
        list: devices,
        total: typeof raw.total === "number" ? raw.total : undefined,
      };
    }

    if ("data" in raw) {
      return extractPayload(raw.data);
    }

    return { list: Object.values(raw) };
  }

  return { list: [] };
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function toNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const mapped = value
    .map((entry) => {
      const num = Number(entry);
      return Number.isFinite(num) ? num : null;
    })
    .filter((entry): entry is number => entry !== null);
  return mapped.length ? mapped : undefined;
}

export function normalizeDeviceRecord(input: unknown): DeviceRecord | null {
  if (!isRecord(input)) {
    return null;
  }

  const rawId =
    input.device_id ??
    input.deviceId ??
    input.deviceID ??
    input.id ??
    input.device;

  const device_id = toString(rawId);

  if (!device_id) {
    return null;
  }

  const last_seen = toNumber(input.last_seen ?? input.lastSeen, 0);
  const threat_level = toNumber(
    input.threat_level ?? input.threatLevel,
    0,
  );
  const signal_count = toNumber(
    input.signal_count ?? input.signalCount,
    0,
  );
  const is_online =
    typeof input.is_online === "boolean"
      ? input.is_online
      : typeof input.isOnline === "boolean"
        ? input.isOnline
        : last_seen > 0
          ? Date.now() - last_seen < ACTIVE_DEVICE_THRESHOLD_MS
          : false;

  const scorePerHour = toOptionalNumber(
    input.score_per_hour ?? input.scorePerHour,
  );
  const sessionDuration = toOptionalNumber(
    input.session_duration ?? input.sessionDuration,
  );
  const playerNickname = toString(
    input.player_nickname ?? (input as Record<string, unknown>).nickname,
  );
  const playerNicknameConfidence = toOptionalNumber(
    (input.player_nickname_confidence as number | undefined) ??
      (input.nickname_confidence as number | undefined),
  );

  return {
    device_id,
    device_name:
      toString(input.device_name ?? input.name ?? input.deviceId) ??
      device_id,
    device_hostname: toString(
      input.device_hostname ??
        (input.device as Record<string, unknown> | undefined)?.hostname ??
        input.host ??
        input.hostname ??
        input.device_host,
    ),
    player_nickname: playerNickname,
    player_nickname_confidence: playerNicknameConfidence,
    last_seen,
    threat_level,
    signal_count,
    is_online,
    ip_address: toString(input.ip_address ?? input.ipAddress ?? input.ip),
    score_per_hour: scorePerHour,
    historical_threat_levels: toNumberArray(
      input.historical_threat_levels ?? input.historicalThreatLevels,
    ),
    threat_trend: toString(
      input.threat_trend ?? input.threatTrend,
    ) as DeviceRecord["threat_trend"],
    session_duration: sessionDuration,
  };
}

export function normalizeDevicesResponse(raw: unknown): NormalizedDevices {
  const payload = extractPayload(raw);
  const devices = payload.list
    .map((record) => normalizeDeviceRecord(record))
    .filter((record): record is DeviceRecord => Boolean(record));
  const total =
    typeof payload.total === "number" ? payload.total : devices.length;

  return { devices, total };
}


