import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/utils/store";
import { createRedisClient } from "@/lib/utils/redis-client";
import { redis as redisKeys } from "@/lib/storage/redis-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PaginatedResponse {
  devices: any[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "20");
    const sortBy = searchParams.get("sortBy") || "threat"; // threat | last_seen
    const includeOffline = searchParams.get("includeOffline") !== "false";
    
    // Calculate pagination
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize - 1;

    // Try Redis first for better performance
    const useRedis = process.env.USE_REDIS === "true";
    
    if (useRedis) {
      const client = await createRedisClient();
      
      if (client) {
        try {
          // Get all device IDs sorted by last_seen (most recent first)
          const deviceIds = await client.zRange(
            redisKeys.deviceIndex(),
            0,
            -1,
            { REV: true }
          );
          
          if (deviceIds.length === 0) {
            return NextResponse.json({
              devices: [],
              total: 0,
              page,
              pageSize,
              hasMore: false
            });
          }
          
          // Fetch device data for all devices to sort by threat
          const devices = [];
          const now = Date.now();
          const ACTIVE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
          
          for (const deviceId of deviceIds) {
            const deviceData = await client.hGetAll(
              redisKeys.deviceHash(deviceId)
            );
            
            if (!deviceData?.device_id) continue;
            
            // Parse last_seen
            const lastSeenRaw = parseInt(deviceData.last_seen || "0");
            const lastSeenMs = lastSeenRaw < 10000000000 
              ? lastSeenRaw * 1000 
              : lastSeenRaw;
            
            const isOnline = (now - lastSeenMs) < ACTIVE_THRESHOLD;
            
            // Skip offline if not requested
            if (!includeOffline && !isOnline) continue;
            
            // Get threat level - for offline, use historical max
            let threatLevel = 0;
            
            if (isOnline) {
              // Current threat from dedicated key or hash
              const threatKey = redisKeys.deviceThreat(deviceId);
              const currentThreat = await client.get(threatKey);
              threatLevel = currentThreat 
                ? parseFloat(currentThreat)
                : parseInt(deviceData.threat_level || "0");
            } else {
              // For offline, get historical max threat
              const historicalKey = `device:${deviceId}:max_threat`;
              const maxThreat = await client.get(historicalKey);
              threatLevel = maxThreat 
                ? parseFloat(maxThreat)
                : parseInt(deviceData.threat_level || "0");
            }
            
            devices.push({
              device_id: deviceData.device_id,
              device_name: deviceData.device_name || deviceData.device_id,
              device_hostname: deviceData.device_hostname || deviceData.host,
              player_nickname: deviceData.player_nickname,
              last_seen: lastSeenMs,
              threat_level: threatLevel,
              is_online: isOnline,
              ip_address: deviceData.ip_address,
              signal_count: parseInt(deviceData.signal_count || "0"),
              unique_detection_count: parseInt(deviceData.unique_detection_count || "0"),
            });
          }
          
          // Sort by threat level (highest first) or last_seen
          if (sortBy === "threat") {
            devices.sort((a, b) => (b.threat_level || 0) - (a.threat_level || 0));
          } else {
            devices.sort((a, b) => b.last_seen - a.last_seen);
          }
          
          // Apply pagination
          const paginatedDevices = devices.slice(startIdx, endIdx + 1);
          
          // Store max threat for offline devices
          for (const device of devices) {
            if (!device.is_online && device.threat_level > 0) {
              const historicalKey = `device:${device.device_id}:max_threat`;
              const currentMax = await client.get(historicalKey);
              if (!currentMax || parseFloat(currentMax) < device.threat_level) {
                await client.set(historicalKey, device.threat_level.toString());
              }
            }
          }
          
          await client.quit();
          
          return NextResponse.json({
            devices: paginatedDevices,
            total: devices.length,
            page,
            pageSize,
            hasMore: endIdx < devices.length - 1
          } as PaginatedResponse);
          
        } catch (error) {
          console.error("[Paginated API] Redis error:", error);
          await client.quit();
        }
      }
    }
    
    // Fallback to memory store
    const store = getStore();
    const result = await store.getDevices();
    
    // Apply sorting
    let devices = [...result.devices];
    if (sortBy === "threat") {
      devices.sort((a, b) => (b.threat_level || 0) - (a.threat_level || 0));
    }
    
    // Filter offline if needed
    if (!includeOffline) {
      devices = devices.filter(d => d.is_online);
    }
    
    // Paginate
    const paginatedDevices = devices.slice(startIdx, endIdx + 1);
    
    return NextResponse.json({
      devices: paginatedDevices,
      total: devices.length,
      page,
      pageSize,
      hasMore: endIdx < devices.length - 1
    } as PaginatedResponse);
    
  } catch (error) {
    console.error("[Paginated API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch devices" },
      { status: 500 }
    );
  }
}
