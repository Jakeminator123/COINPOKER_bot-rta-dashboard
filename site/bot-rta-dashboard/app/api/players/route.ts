import type {
  RedisClientType,
  RedisModules,
  RedisFunctions,
  RedisScripts,
} from "redis";
import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/utils/api-utils";
import { getDevices } from "@/lib/utils/store";
import { withRedis } from "@/lib/redis/redis-client";
import { scanPrimaryDeviceIds } from "@/lib/redis/redis-device-helpers";
import { redisKeys } from "@/lib/redis/schema";
import type { DeviceListEntry } from "@/lib/storage/storage-adapter";
import { THREAT_THRESHOLDS } from "@/lib/detections/threat-scoring";
import { getDeviceDisplayName } from "@/lib/device/device-name-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Configuration constants
// DASHBOARD_PLAYER_LIMIT: Default number of players per page (configurable via env var)
const DASHBOARD_PLAYER_LIMIT = Number(process.env.DASHBOARD_PLAYER_LIMIT || 20);
// TOP_PLAYERS_ZSET: Redis sorted set key storing players ranked by bot_probability
const TOP_PLAYERS_ZSET = redisKeys.topPlayers();
// DEVICE_TIMEOUT_MS: Device considered offline if no signal for this duration
// MS = Milliseconds (120 * 1000 = 120 seconds = 2 minutes)
// Must be > 92s (batch report interval) to avoid false logouts
const DEVICE_TIMEOUT_MS = 120 * 1000; // 120 seconds (same as redis-store.ts and memory-store.ts)
// MAX_PLAYERS_PER_REQUEST: Maximum players returned in single API call (prevents frontend overload)
const MAX_PLAYERS_PER_REQUEST = Number(process.env.MAX_PLAYERS_PER_REQUEST) || 100; // Configurable via MAX_PLAYERS_PER_REQUEST env var

type PlayerStatus = "online" | "offline" | "suspicious";
type RedisClient = RedisClientType<
  RedisModules,
  RedisFunctions,
  RedisScripts
>;

interface PlayerCategorySegment {
  name: string;
  totalFindings?: number;
  highestSeverity?: string;
  hasFindings?: boolean;
  stats?: Record<string, unknown> | null;
}

interface PlayerCategorySummary {
  updatedAt?: number;
  severityHighest?: string | null;
  totalFindings?: number;
  segmentsRan?: string[];
  segments?: PlayerCategorySegment[];
}

interface PlayerResponse {
  id: string;
  name: string;
  status: PlayerStatus;
  lastSeen: number;
  threatLevel: number;
  detections: {
    critical: number;
    warnings: number;
    total: number;
  };
  isOnline: boolean;
  ipAddress?: string;
  categories?: PlayerCategorySummary | null;
}

interface PlayerSummary {
  device_name?: string;
  avg_bot_probability?: number;
  avg_score?: number;
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const requestedOffset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));
    const requestedLimit = Math.max(
      1,
      parseInt(searchParams.get("limit") || String(DASHBOARD_PLAYER_LIMIT), 10)
    );
    // Cap at MAX_PLAYERS_PER_REQUEST to prevent frontend from being overwhelmed
    const limit = Math.min(requestedLimit, Math.min(DASHBOARD_PLAYER_LIMIT, MAX_PLAYERS_PER_REQUEST));
    const offset = requestedOffset;
    const globalCounts = await getGlobalPlayerCounts();
    
    const topPlayersResult = await fetchTopPlayers(limit, offset);

    if (topPlayersResult.players.length > 0) {
      const hasMore = offset + topPlayersResult.players.length < topPlayersResult.total;
      return successResponse({
        players: topPlayersResult.players,
        offset,
        limit,
        hasMore,
        total: topPlayersResult.total,
        meta: {
          totalPlayers: globalCounts.totalPlayers,
          onlinePlayers: globalCounts.onlinePlayers,
          highRiskPlayers: globalCounts.highRiskPlayers,
          avgThreatLevel: globalCounts.avgThreatLevel,
        },
      });
    }

    const fallbackPlayers = await buildPlayersFromDevices(limit);
    return successResponse({
      players: fallbackPlayers,
      offset,
      limit,
      hasMore: false,
      total: fallbackPlayers.length,
      meta: {
        totalPlayers: globalCounts.totalPlayers,
        onlinePlayers: globalCounts.onlinePlayers,
        highRiskPlayers: globalCounts.highRiskPlayers,
        avgThreatLevel: globalCounts.avgThreatLevel,
      },
    });
  } catch (error) {
    console.error("[players] Error:", error);
    return errorResponse(getErrorMessage(error, "Failed to fetch players"), 500);
  }
}

async function fetchTopPlayers(
  limit: number,
  offset: number = 0
): Promise<{ players: PlayerResponse[]; total: number }> {
  if (limit <= 0) {
    return { players: [], total: 0 };
  }

  try {
    return await withRedis(async (client) => {
      const totalCount = await client.zCard(TOP_PLAYERS_ZSET);
      if (!totalCount) {
        // If top_players sorted set is empty, try to rebuild it from historical device data
        console.log("[players] top_players sorted set is empty, scanning for historical devices...");
        const rebuildResult = await rebuildTopPlayersFromHistoricalData(client, limit);
        return rebuildResult;
      }

      const buffer = Math.min(offset, limit);
      const startIndex = Math.max(0, offset - buffer);
      const relativeOffset = offset - startIndex;

      const windowTarget = relativeOffset + limit + buffer;
      const chunkSize = Math.max(limit * 4, 100);

      const subsetEntries: Array<{ value: string | number; score: number }> = [];
      let currentStart = startIndex;

      while (
        subsetEntries.length < windowTarget &&
        currentStart < totalCount
      ) {
        const currentEnd = Math.min(
          totalCount - 1,
          currentStart + chunkSize - 1
        );
        const chunk = await client.zRangeWithScores(
          TOP_PLAYERS_ZSET,
          currentStart,
          currentEnd,
          { REV: true }
        );

        if (!chunk.length) {
          break;
        }

        subsetEntries.push(...chunk);
        currentStart = currentEnd + 1;
      }

      // Fallback: if nothing fetched (e.g. offset beyond total), try fetching last window
      if (subsetEntries.length === 0 && startIndex > 0) {
        const fallbackStart = Math.max(0, totalCount - chunkSize);
        const chunk = await client.zRangeWithScores(
          TOP_PLAYERS_ZSET,
          fallbackStart,
          totalCount - 1,
          { REV: true }
        );
        subsetEntries.push(...chunk);
      }

      if (!subsetEntries.length) {
        console.log("[players] ⚠️ No entries found in top_players sorted set");
        console.log("[players]   - totalCount:", totalCount);
        console.log("[players]   - startIndex:", startIndex);
        console.log("[players]   - limit:", limit);
        return { players: [], total: totalCount };
      }
      
      console.log("[players] Found", subsetEntries.length, "entries in top_players sorted set");
      console.log("[players]   - First entry:", subsetEntries[0]?.value, "score:", subsetEntries[0]?.score);
      console.log("[players]   - Last entry:", subsetEntries[subsetEntries.length - 1]?.value, "score:", subsetEntries[subsetEntries.length - 1]?.score);

      // Batch fetch all player data using pipeline for better performance
      const subsetPlayers = await buildPlayersFromRedisBatch(
        client,
        subsetEntries.map(entry => ({
          deviceId: entry.value as string,
          score: entry.score,
        }))
      );

      console.log("[players] ========== FETCHING PLAYERS FOR HOMEPAGE ==========");
      console.log("[players] Total entries from top_players:", subsetEntries.length);
      console.log("[players] Players fetched from Redis:", subsetPlayers.length);
      console.log("[players] Sample device IDs:", subsetEntries.slice(0, 5).map(e => e.value));
      
      // Log each player's status for debugging
      subsetPlayers.forEach(player => {
        console.log(`[players] Player ${player.id}: isOnline=${player.isOnline}, threatLevel=${player.threatLevel}, lastSeen=${player.lastSeen}`);
      });

      // Filter out offline players with zero threat level (they shouldn't appear on homepage)
      // Keep offline players with high threat level for historical tracking, but prioritize online players
      // IMPORTANT: Also check score from top_players sorted set - if score > 0, player should be shown
      const filteredPlayers = subsetPlayers.filter(player => {
        // Always show online players
        if (player.isOnline) {
          return true;
        }
        // Show offline players if they have significant threat level (> 0) OR if they have a score in top_players
        // This ensures we show players that have activity even if Redis hash is empty
        const threatLevel = player.threatLevel || 0;
        const entry = subsetEntries.find(e => e.value === player.id);
        const scoreFromSet = entry?.score || 0;
        const shouldShow = threatLevel > 0 || scoreFromSet > 0;
        if (!shouldShow) {
          console.log(`[players] Filtered out offline player ${player.id} (threatLevel=${threatLevel}, score=${scoreFromSet})`);
        } else if (threatLevel === 0 && scoreFromSet > 0) {
          console.log(`[players] ⚠️ Player ${player.id} has score ${scoreFromSet} but threatLevel is 0 - showing anyway (Redis hash may be empty)`);
        }
        return shouldShow;
      });
      
      console.log("[players] Players after filtering:", filteredPlayers.length);
      console.log("[players] Online players:", filteredPlayers.filter(p => p.isOnline).length);
      console.log("[players] Offline players:", filteredPlayers.filter(p => !p.isOnline).length);
      
      // Log if specific device is in the list
      const targetDevice = filteredPlayers.find(p => p.id === "462a6a3a5c173a1ea54e05b355ea1790");
      if (targetDevice) {
        console.log("[players] ✅ Target device FOUND in filtered list:", {
          id: targetDevice.id,
          name: targetDevice.name,
          isOnline: targetDevice.isOnline,
          threatLevel: targetDevice.threatLevel,
          lastSeen: targetDevice.lastSeen,
        });
      } else {
        console.log("[players] ❌ Target device NOT FOUND in filtered list (may have been filtered out)");
      }
      
      console.log("[players] ============================================");

      filteredPlayers.sort((a, b) => {
        const aIsOnline = a.isOnline ? 1 : 0;
        const bIsOnline = b.isOnline ? 1 : 0;
        if (aIsOnline !== bIsOnline) {
          return bIsOnline - aIsOnline;
        }
        const threatDiff = (b.threatLevel || 0) - (a.threatLevel || 0);
        if (threatDiff !== 0) {
          return threatDiff;
        }
        return a.name.localeCompare(b.name);
      });

      const paginatedPlayers = filteredPlayers.slice(
        relativeOffset,
        relativeOffset + limit
      );

      // Update total count to reflect filtered results (for accurate pagination)
      const filteredTotal = filteredPlayers.length;

      return { players: paginatedPlayers, total: filteredTotal };
    });
  } catch (error) {
    console.error("[players] Top players fetch error:", error);
    return { players: [], total: 0 };
  }
}

async function rebuildTopPlayersFromHistoricalData(
  client: RedisClient,
  limit: number
): Promise<{ players: PlayerResponse[]; total: number }> {
  try {
    const deviceIds = await scanPrimaryDeviceIds(client);

    if (!deviceIds.length) {
      return { players: [], total: 0 };
    }

    // Batch fetch all players at once for better performance
    const entries = deviceIds.map(deviceId => ({ deviceId, score: 0 }));
    const allPlayers = await buildPlayersFromRedisBatch(client, entries);

    const players: PlayerResponse[] = [];

    // Batch update Redis sorted sets
    const pipeline = client.multi();
    for (const player of allPlayers) {
      if (!player) {
        continue;
      }

      const threatLevel = player.threatLevel || 0;
      if (threatLevel <= 0 && !player.isOnline) {
        continue;
      }

      pipeline.zAdd(TOP_PLAYERS_ZSET, {
        score: threatLevel,
        value: player.id,
      });

      pipeline.zAdd("devices", {
        score: (player.lastSeen || 0) * 1000,
        value: player.id,
      });

      players.push(player);
    }

    // Execute all Redis updates in one batch
    await pipeline.exec();

    players.sort((a, b) => {
      const aIsOnline = a.isOnline ? 1 : 0;
      const bIsOnline = b.isOnline ? 1 : 0;
      if (aIsOnline !== bIsOnline) {
        return bIsOnline - aIsOnline;
      }
      const threatDiff = (b.threatLevel || 0) - (a.threatLevel || 0);
      if (threatDiff !== 0) {
        return threatDiff;
      }
      return a.name.localeCompare(b.name);
    });

    const total = await client.zCard(TOP_PLAYERS_ZSET);

    console.log(
      `[players] Rebuilt top_players with ${total} entries from historical data`
    );

    return {
      players: players.slice(0, limit),
      total,
    };
  } catch (error) {
    console.error(
      "[players] Error rebuilding top players from historical data:",
      error
    );
    return { players: [], total: 0 };
  }
}

async function buildPlayersFromDevices(limit: number): Promise<PlayerResponse[]> {
  const devicesResult = await getDevices();
  const baseDevices: DeviceListEntry[] = devicesResult?.devices ?? [];

  if (!baseDevices.length) {
    return [];
  }

  try {
    return await withRedis(async (client) => {
      const results: PlayerResponse[] = [];

      for (const device of baseDevices) {
        const player = await buildPlayerFromLegacySource(
          client,
          device.device_id,
          device,
        );
        if (player) {
          results.push(player);
        }
      }

      // Sort players: online first, then by threat level
      results.sort((a, b) => {
        const aIsOnline = a.isOnline ? 1 : 0;
        const bIsOnline = b.isOnline ? 1 : 0;
        if (aIsOnline !== bIsOnline) {
          return bIsOnline - aIsOnline;
        }
        return (b.threatLevel || 0) - (a.threatLevel || 0);
      });

      // Return only the requested limit after sorting
      return results.slice(0, limit);
    });
  } catch (error) {
    console.error("[players] Legacy fallback error:", error);
    const limitedDevices = baseDevices.slice(0, limit);
    return limitedDevices.map((device) => {
      const { lastSeen, isOnline } = deriveLastSeenInfo(device.last_seen);
      const threatLevel = Math.round(device.threat_level || 0);

      return {
        id: device.device_id,
        name: getDeviceDisplayName(
          device.player_nickname ?? device.device_name,
          device.device_id,
        ),
        status: isOnline
          ? threatLevel >= THREAT_THRESHOLDS.HIGH_RISK
            ? "suspicious"
            : "online"
          : "offline",
        lastSeen,
        threatLevel,
        detections: {
          critical: 0,
          warnings: 0,
          total: 0,
        },
        isOnline,
        ipAddress: device.ip_address,
      };
    });
  }
}

/**
 * Batch fetch multiple players from Redis using pipeline for better performance
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Without batching: 100 players × 6 Redis commands = 600 round-trips
 * - With batching: 1 pipeline with 600 commands = 1 round-trip
 * 
 * This dramatically reduces latency when loading player lists with many players.
 * 
 * @param client - Redis client connection
 * @param entries - Array of { deviceId, score } objects to fetch
 * @returns Array of PlayerResponse objects with all player data
 */
async function buildPlayersFromRedisBatch(
  client: RedisClient,
  entries: Array<{ deviceId: string; score: number }>
): Promise<PlayerResponse[]> {
  if (entries.length === 0) {
    return [];
  }

  // Build pipeline with all Redis operations
  // Pipeline groups commands for batch execution (single network round-trip)
  const pipeline = client.multi();
  for (const entry of entries) {
    const deviceId = entry.deviceId;
    const deviceHashKey = redisKeys.deviceHash(deviceId);
    const legacyDeviceKey = redisKeys.legacyDeviceInfo(deviceId);
    const summaryKey = redisKeys.playerSummary(deviceId);
    const threatKey = redisKeys.deviceThreat(deviceId);
    const criticalKey = redisKeys.deviceDetections(deviceId, "CRITICAL");
    const warnKey = redisKeys.deviceDetections(deviceId, "WARN");
    const categoriesKey = redisKeys.deviceCategories(deviceId);
    // Queue 7 Redis commands per player:
    pipeline.hGetAll(deviceHashKey); // Primary device info hash
    pipeline.hGetAll(legacyDeviceKey); // Legacy device info hash (for backward compatibility)
    pipeline.get(summaryKey); // Player summary JSON (contains avg_bot_probability)
    pipeline.get(threatKey); // Dedicated threat level key (updated by batch reports)
    pipeline.get(criticalKey); // Critical detection count
    pipeline.get(warnKey); // Warning detection count
    pipeline.get(categoriesKey); // Latest category summary snapshot
  }

  // Execute all operations in one batch (single network round-trip)
  const results = await pipeline.exec();

  // Process results
  // Pipeline returns array of [error, value] tuples
  // Each player has OPERATIONS_PER_PLAYER results in sequence
  const players: PlayerResponse[] = [];
  const OPERATIONS_PER_PLAYER = 7; // Each player requires 7 Redis operations

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const baseIndex = i * OPERATIONS_PER_PLAYER;

    // Extract results from pipeline
    // Pipeline results format: [error, value] tuples
    // - error is null if successful, otherwise Error object
    // - value is the Redis response (hash object for hGetAll, string for get)
    // Check bounds to prevent array access errors
    if (!results || baseIndex + OPERATIONS_PER_PLAYER > results.length) {
      // Skip this player if results are incomplete (shouldn't happen, but safety check)
      continue;
    }

    const primaryInfoResult = results[baseIndex] as [Error | null, Record<string, string>] | null;
    const legacyInfoResult = results[baseIndex + 1] as [Error | null, Record<string, string>] | null;
    const summaryJsonResult = results[baseIndex + 2] as [Error | null, string | null] | null;
    const threatFallbackResult = results[baseIndex + 3] as [Error | null, string | null] | null;
    const criticalCountResult = results[baseIndex + 4] as [Error | null, string | null] | null;
    const warnCountResult = results[baseIndex + 5] as [Error | null, string | null] | null;
    const categorySummaryResult = results[baseIndex + 6] as [Error | null, string | null] | null;

    // Extract values only if no error occurred (error is null/falsy means success)
    const primaryInfo = (primaryInfoResult && !primaryInfoResult[0] && primaryInfoResult[1]) ? primaryInfoResult[1] : {};
    const legacyInfo = (legacyInfoResult && !legacyInfoResult[0] && legacyInfoResult[1]) ? legacyInfoResult[1] : {};
    const summaryJson = (summaryJsonResult && !summaryJsonResult[0] && summaryJsonResult[1]) ? summaryJsonResult[1] : null;
    const threatFallback = (threatFallbackResult && !threatFallbackResult[0] && threatFallbackResult[1]) ? threatFallbackResult[1] : null;
    const criticalCountStr = (criticalCountResult && !criticalCountResult[0] && criticalCountResult[1]) ? criticalCountResult[1] : null;
    const warnCountStr = (warnCountResult && !warnCountResult[0] && warnCountResult[1]) ? warnCountResult[1] : null;
    const categorySummaryJson = (categorySummaryResult && !categorySummaryResult[0] && categorySummaryResult[1]) ? categorySummaryResult[1] : null;

    const deviceInfo = {
      ...legacyInfo,
      ...primaryInfo,
    };

    const summary = parseJson<PlayerSummary>(summaryJson);
    
    // Priority order for threat level:
    // 1. avg_bot_probability from player_summary (most accurate - calculated from batch reports)
    // 2. avg_score from player_summary (fallback if avg_bot_probability missing)
    // 3. threat_level from device:${deviceId}:threat key (updated immediately by batch reports)
    // 4. threat_level from device:${deviceId} hash (fallback)
    // 5. score from top_players sorted set (CRITICAL fallback - if Redis hash is empty, use this)
    const threatLevel = Math.round(
      summary?.avg_bot_probability ??
        summary?.avg_score ??
        parseNumber(threatFallback) ??  // This is device:${deviceId}:threat key - should be set immediately
        parseNumber(deviceInfo.threat_level) ??
        parseNumber(entry.score, 0),  // Use score from sorted set if all else fails
    );
    
    // CRITICAL: If threatLevel is 0 but entry.score > 0, use entry.score
    // This handles the case where Redis hash is empty but top_players has the score
    const finalThreatLevel = (threatLevel === 0 && entry.score > 0) ? Math.round(entry.score) : threatLevel;

    // ========== COMPREHENSIVE NAME LOGGING FOR PLAYERS API ==========
    console.log("[players] ========== BUILDING PLAYER FROM REDIS ==========");
    console.log("[players] Device ID:", entry.deviceId);
    console.log("[players] FROM REDIS:");
    console.log("  - device:${deviceId} hash:");
    console.log("    * device_name:", deviceInfo.device_name || "(not set)");
    console.log("    * last_seen:", deviceInfo.last_seen || "(not set)");
    console.log("    * threat_level:", deviceInfo.threat_level || "(not set)");
    console.log("    * All fields:", Object.keys(deviceInfo).length > 0 ? Object.keys(deviceInfo).join(", ") : "(empty)");
    console.log("  - player_summary:${deviceId}:");
    console.log("    * device_name:", summary?.device_name || "(not set)");
    console.log("    * avg_bot_probability:", summary?.avg_bot_probability ?? "(not set)");
    console.log("  - device:${deviceId}:threat key:");
    console.log("    * threat_level:", threatFallback || "(not set)");
    console.log("  - top_players sorted set:");
    console.log("    * score:", entry.score);
    console.log("[players] NAME RESOLUTION:");
    console.log("  - summary?.device_name:", summary?.device_name || "(null/undefined)");
    console.log("  - deviceInfo.device_name:", deviceInfo.device_name || "(null/undefined)");
    console.log("  - entry.deviceId:", entry.deviceId);
    const playerName = getDeviceDisplayName(
      summary?.device_name ||
        (deviceInfo as Record<string, string>).player_nickname ||
        deviceInfo.device_name,
      entry.deviceId,
    );
    console.log("  - getDeviceDisplayName() result:", playerName);
    console.log("[players] ============================================");

    const fallbackLastSeen =
      deviceInfo.last_seen ??
      (summary as any)?.last_seen ??
      (summary as any)?.updated_at ??
      0;
    let { lastSeen, isOnline } = deriveLastSeenInfo(fallbackLastSeen);
    
    // CRITICAL FIX: If Redis hash is empty (lastSeen = 0) but player has score > 0 in top_players,
    // assume player is online (recent batch came in but Redis hash wasn't updated)
    // This handles the case where updateDevice() failed or Redis hash is empty
    if (lastSeen === 0 && entry.score > 0) {
      // If player has a score, they were recently active
      // Set lastSeen to current time to mark as online
      const nowSeconds = Math.floor(Date.now() / 1000);
      lastSeen = nowSeconds;
      isOnline = true;
      if (entry.deviceId === "462a6a3a5c173a1ea54e05b355ea1790") {
        console.log(`[players] ⚠️ Redis hash empty but score exists - marking as online (lastSeen=${lastSeen})`);
      }
    }
    
    // Debug logging for specific device
    if (entry.deviceId === "462a6a3a5c173a1ea54e05b355ea1790") {
      console.log(`[players] DEBUG device ${entry.deviceId}:`);
      console.log(`[players]   - deviceInfo.last_seen:`, deviceInfo.last_seen);
      console.log(`[players]   - normalized lastSeen:`, lastSeen);
      console.log(`[players]   - isOnline:`, isOnline);
      console.log(`[players]   - threatLevel (before fallback):`, threatLevel);
      console.log(`[players]   - entry.score (from top_players):`, entry.score);
      console.log(`[players]   - finalThreatLevel (after fallback):`, finalThreatLevel);
      console.log(`[players]   - current time (seconds):`, Math.floor(Date.now() / 1000));
      console.log(`[players]   - time diff (seconds):`, Math.floor(Date.now() / 1000) - lastSeen);
    }
    
    const status: PlayerStatus = isOnline
      ? finalThreatLevel >= THREAT_THRESHOLDS.HIGH_RISK
        ? "suspicious"
        : "online"
      : "offline";

    const criticalCount = parseInt(criticalCountStr || "0", 10);
    const warnCount = parseInt(warnCountStr || "0", 10);

    const categories = parseJson<PlayerCategorySummary>(categorySummaryJson);

    players.push({
      id: entry.deviceId,
      name: playerName,
      status,
      lastSeen,
      threatLevel: finalThreatLevel,  // Use finalThreatLevel instead of threatLevel
      detections: {
        critical: criticalCount,
        warnings: warnCount,
        total: criticalCount + warnCount,
      },
      isOnline,
      ipAddress: deviceInfo.ip_address,
      categories: categories,
    });
  }

  return players.filter((player): player is PlayerResponse => Boolean(player));
}

/**
 * Single player fetch (fallback for legacy code)
 */
async function buildPlayerFromRedis(
  client: RedisClient,
  deviceId: string,
  score: number,
): Promise<PlayerResponse | null> {
  const players = await buildPlayersFromRedisBatch(client, [{ deviceId, score }]);
  return players[0] || null;
}

async function buildPlayerFromLegacySource(
  client: RedisClient,
  deviceId: string,
  device: DeviceListEntry,
): Promise<PlayerResponse | null> {
  try {
    const player = await buildPlayerFromRedis(client, deviceId, 0);
    if (player) {
      return player;
    }
  } catch {
    // Ignore and fallback below
  }

  // Calculate is_online dynamically based on last_seen
  const { lastSeen: deviceLastSeen, isOnline } = deriveLastSeenInfo(
    device?.last_seen,
  );
  const threatLevel = Math.round(device?.threat_level || 0);

  return {
    id: deviceId,
    name: getDeviceDisplayName(
      device?.player_nickname ?? device?.device_name,
      deviceId,
    ),
    status: isOnline
      ? threatLevel >= THREAT_THRESHOLDS.HIGH_RISK
        ? "suspicious"
        : "online"
      : "offline",
    lastSeen: deviceLastSeen,
    threatLevel,
    detections: {
      critical: 0,
      warnings: 0,
      total: 0,
    },
    isOnline,
    ipAddress: device?.ip_address,
  };
}

function deriveLastSeenInfo(value?: string | number | null): { lastSeen: number; isOnline: boolean } {
  const normalizedSeconds = normalizeLastSeen(value);
  const isOnline = isOnlineFromSeconds(normalizedSeconds);
  return {
    lastSeen: normalizedSeconds,
    isOnline: isOnline,
  };
}

function isOnlineFromSeconds(lastSeenSeconds: number): boolean {
  const lastSeenMs = lastSeenSeconds * 1000;
  return Date.now() - lastSeenMs < DEVICE_TIMEOUT_MS;
}

function parseJson<T = unknown>(value?: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseNumber(value?: string | number | null, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeLastSeen(value?: string | number | null): number {
  // If value is missing or invalid, return 0 (far in past) to mark as offline
  // This ensures players with missing last_seen are marked offline, not online
  if (value === null || value === undefined || value === "") {
    return 0; // Return 0 (far in past) instead of nowSeconds to mark as offline
  }

  const numericValue =
    typeof value === "number" ? value : parseInt(String(value), 10);

  // If value is invalid, return 0 (far in past) to mark as offline
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0; // Return 0 (far in past) instead of nowSeconds to mark as offline
  }

  // If stored as milliseconds, convert to seconds
  if (numericValue > 1_000_000_000_000) {
    return Math.floor(numericValue / 1000);
  }

  return numericValue;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

async function getGlobalPlayerCounts(): Promise<{
  totalPlayers: number;
  onlinePlayers: number;
  highRiskPlayers: number;
  avgThreatLevel: number;
}> {
  try {
    const devicesResult = await getDevices();
    const devices = devicesResult?.devices ?? [];

    if (!devices.length) {
      return {
        totalPlayers: 0,
        onlinePlayers: 0,
        highRiskPlayers: 0,
        avgThreatLevel: 0,
      };
    }

    let onlinePlayers = 0;
    let highRiskPlayers = 0;
    let threatSum = 0;

    for (const device of devices) {
      const threatLevel = Math.max(
        0,
        Math.round(device.threat_level ?? 0)
      );
      threatSum += threatLevel;

      if (threatLevel >= THREAT_THRESHOLDS.HIGH_RISK) {
        highRiskPlayers += 1;
      }

      const isExplicitOnline =
        typeof device.is_online === "boolean"
          ? device.is_online
          : undefined;

      if (isExplicitOnline !== undefined) {
        onlinePlayers += isExplicitOnline ? 1 : 0;
        continue;
      }

      const normalizedLastSeen = normalizeLastSeen(device.last_seen);
      if (isOnlineFromSeconds(normalizedLastSeen)) {
        onlinePlayers += 1;
      }
    }

    return {
      totalPlayers: devices.length,
      onlinePlayers,
      highRiskPlayers,
      avgThreatLevel: devices.length
        ? Math.round(threatSum / devices.length)
        : 0,
    };
  } catch (error) {
    console.error("[players] Failed to calculate global counts:", error);
    return {
      totalPlayers: 0,
      onlinePlayers: 0,
      highRiskPlayers: 0,
      avgThreatLevel: 0,
    };
  }
}
