import { withRedis } from "@/lib/redis/redis-client";
import { redisKeys } from "@/lib/redis/schema";
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
const MAX_DEVICES_TO_ENHANCE = Number(process.env.MAX_DEVICES_TO_ENHANCE) || 100; // Limit Redis lookups to top N devices for performance (configurable via MAX_DEVICES_TO_ENHANCE env var)
// Note: All devices are still returned, but only top N get Redis enhancement lookup
// Devices beyond top N use data from MemoryStore (still accurate, just without Redis-enhancement)

export async function GET() {
  try {
    // Check cache first
    if (devicesCache.data && Date.now() - devicesCache.timestamp < CACHE_TTL) {
      return successResponse(devicesCache.data);
    }

    // Get devices from store (which handles Redis/Memory automatically)
    const devicesResult = await getDevices();
    const baseDevices = devicesResult?.devices ?? [];

    // Limit devices to enhance from Redis (performance optimization)
    const devicesToEnhance = baseDevices.slice(0, MAX_DEVICES_TO_ENHANCE);
    const remainingDevices = baseDevices.slice(MAX_DEVICES_TO_ENHANCE);

    // For enhanced device info, get additional data from Redis using batch operations
    const enhancedDevices = await withRedis(async (client) => {
      const DEVICE_TIMEOUT_MS = 120 * 1000; // 120 seconds (same as redis-store.ts and players/route.ts)
      const now = Date.now();

      // Prepare batch Redis operations using pipeline for better performance
      // Pipeline groups multiple Redis commands into one network round-trip
      // Instead of: 100 devices × 2 commands = 200 round-trips
      // We do: 1 pipeline with 200 commands = 1 round-trip
      const pipeline = client.multi();

      for (const device of devicesToEnhance) {
        const deviceKey = redisKeys.deviceHash(device.device_id);
        const threatKey = redisKeys.deviceThreat(device.device_id);
        // Queue Redis commands in pipeline (executed together later)
        pipeline.hGetAll(deviceKey); // Get device info hash
        pipeline.get(threatKey); // Get threat level (updated by batch reports)
      }

      // Execute all Redis operations in one batch
      const results = await pipeline.exec();

      // Process results
      // Pipeline results format: [error, value] tuples
      // - error is null if successful, otherwise Error object
      // - value is the Redis response (hash object for hGetAll, string for get)
      const deviceList = [];
      const OPERATIONS_PER_DEVICE = 2; // Each device has 2 operations (hGetAll + get)
      
      if (!results) {
        // If pipeline failed, return devices without enhancement
        return baseDevices;
      }

      for (let i = 0; i < devicesToEnhance.length; i++) {
        const device = devicesToEnhance[i];
        const resultIndex = i * OPERATIONS_PER_DEVICE;
        
        // Check bounds to prevent array access errors
        if (resultIndex + OPERATIONS_PER_DEVICE > results.length) {
          // Skip this device if results are incomplete (fallback to base device data)
          deviceList.push(device);
          continue;
        }
        
        // Get results from pipeline
        const deviceInfoResult = results[resultIndex] as [Error | null, Record<string, string>] | null;
        const threatLevelResult = results[resultIndex + 1] as [Error | null, string | null] | null;
        
        // Extract values only if no error occurred (error is null/falsy means success)
        const deviceInfo = (deviceInfoResult && !deviceInfoResult[0] && deviceInfoResult[1]) ? deviceInfoResult[1] : {};
        const threatLevel = (threatLevelResult && !threatLevelResult[0] && threatLevelResult[1]) ? threatLevelResult[1] : null;

        // Calculate is_online dynamically based on last_seen (same logic as players/route.ts)
        // Don't trust stored is_online values - always calculate fresh
        const lastSeenRaw = deviceInfo.last_seen 
          ? parseInt(deviceInfo.last_seen) 
          : device.last_seen || Date.now();
        // Handle both seconds and milliseconds timestamps
        const lastSeenMs = typeof lastSeenRaw === 'number' 
          ? (lastSeenRaw < 10000000000 ? lastSeenRaw * 1000 : lastSeenRaw)
          : Date.now();
        const loggedOut = deviceInfo.logged_out === "true";
        // Calculate is_online dynamically - don't trust stored values
        const isOnline = (now - lastSeenMs < DEVICE_TIMEOUT_MS) && !loggedOut;

        // Get session_start from Redis
        const sessionStartRaw = deviceInfo.session_start 
          ? parseInt(deviceInfo.session_start) 
          : null;
        const sessionStart =
          sessionStartRaw && !Number.isNaN(sessionStartRaw)
            ? sessionStartRaw < 10_000_000_000
              ? sessionStartRaw * 1000
              : sessionStartRaw
            : null;

        // Priority: Use dedicated threat key (updated by batch reports), fallback to hash, then device.threat_level
        const finalThreatLevel = threatLevel
          ? parseFloat(threatLevel)
          : (deviceInfo.threat_level ? parseFloat(deviceInfo.threat_level) : null)
          ?? (device as { threat_level?: number }).threat_level ?? 0;
        
        deviceList.push({
          ...device,
          // Use device_name from Redis if available, otherwise keep from device
          device_name: deviceInfo.device_name || device.device_name,
          device_hostname: deviceInfo.device_hostname || device.device_hostname || device.device_name,
          threat_level: finalThreatLevel,
          last_seen: lastSeenMs,
          is_online: isOnline,
          session_start: sessionStart,
          // Include player_nickname from Redis if available
          player_nickname: deviceInfo.player_nickname || device.player_nickname,
          player_nickname_confidence: deviceInfo.player_nickname_confidence 
            ? parseFloat(deviceInfo.player_nickname_confidence) 
            : device.player_nickname_confidence,
        });
      }

      // Add remaining devices without Redis enhancement
      for (const device of remainingDevices) {
        deviceList.push(device);
      }

      return deviceList;
    }).catch(() => baseDevices); // Fallback to basic devices if Redis fails

    const result = {
      devices: enhancedDevices,
      total: enhancedDevices.length,
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
