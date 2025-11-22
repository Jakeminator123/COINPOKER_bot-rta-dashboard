/**
 * Shared helpers for session handling between MemoryStore and RedisStore.
 */

const FALLBACK_TIMEOUT_MS = 120 * 1000; // 120 seconds

export const DEVICE_TIMEOUT_MS =
  Number(process.env.DEVICE_TIMEOUT_MS) || FALLBACK_TIMEOUT_MS;

export interface DeviceSessionState {
  session_start?: number;
  last_seen: number;
  is_online: boolean;
}

export function isDeviceOnline(
  lastSeenMs: number,
  nowMs: number = Date.now(),
  timeoutMs: number = DEVICE_TIMEOUT_MS,
): boolean {
  return nowMs - lastSeenMs < timeoutMs;
}

