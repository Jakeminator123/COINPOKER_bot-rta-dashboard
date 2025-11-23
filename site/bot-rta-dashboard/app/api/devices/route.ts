import { successResponse, errorResponse } from "@/lib/utils/api-utils";
import { getDevices } from "@/lib/utils/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DeviceCache {
  data: {
    devices: Array<{
      device_id: string;
      device_name?: string;
      is_online?: boolean;
      last_seen?: number;
      threat_level?: number;
      session_start?: number | null;
      ip_address?: string;
    }>;
    total: number;
    timestamp: number;
  } | null;
  timestamp: number;
}

// Cache for devices list (TTL: 12 seconds - optimized for better cache-hit rate)
// TTL = Time To Live - how long cached data is considered valid
const devicesCache: DeviceCache = { data: null, timestamp: 0 };
const CACHE_TTL = Number(process.env.DEVICES_CACHE_TTL_MS) || 12000; // 12 seconds (configurable via DEVICES_CACHE_TTL_MS env var)
// MS = Milliseconds (1000ms = 1 second)
export async function GET() {
  try {
    // Check cache first
    if (devicesCache.data && Date.now() - devicesCache.timestamp < CACHE_TTL) {
      return successResponse(devicesCache.data);
    }

    // Get devices from store (which handles Redis/Memory automatically)
    const devicesResult = await getDevices();
    const baseDevices = devicesResult?.devices ?? [];

    const result = {
      devices: baseDevices,
      total: devicesResult?.total ?? baseDevices.length,
      timestamp: Date.now(),
    };

    // Update cache
    devicesCache.data = result;
    devicesCache.timestamp = Date.now();

    return successResponse(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch devices";
    console.error("[devices] Error:", error);
    return errorResponse(errorMessage, 500);
  }
}
