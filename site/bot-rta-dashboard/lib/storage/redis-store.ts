import {
  Signal,
  Stored,
  type Status,
  routeToSectionKey,
} from "@/lib/detections/sections";
import { resolveDeviceName } from "@/lib/device/identity";
import { sanitizeDeviceName } from "@/lib/device/device-name-utils";
import { redisKeys, redisTtl } from "@/lib/redis/schema";
import { getRedisClient } from "@/lib/redis/redis-client";
import { scanPrimaryDeviceIds } from "@/lib/redis/redis-device-helpers";
import { StorageAdapter } from "./storage-adapter";
import { MemoryStore } from "./memory-store";
import { DEVICE_TIMEOUT_MS, type DeviceSessionState } from "./device-session";

// Redis TTL (Time To Live) - how long data is kept in Redis before automatic cleanup
// Configurable via REDIS_TTL_SECONDS env var (default: 604800 = 7 days)
// Examples: 604800 (7 days), 259200 (3 days), 1209600 (14 days), 2592000 (30 days)
const TTL_SECONDS = redisTtl.batchSeconds();
const TOP_PLAYERS_ZSET = redisKeys.topPlayers();
const TOP_PLAYERS_CACHE_LIMIT = Number(process.env.TOP_PLAYERS_CACHE_LIMIT || 500);
const REDIS_SNAPSHOT_BATCH_LIMIT = Number(
  process.env.REDIS_SNAPSHOT_BATCH_LIMIT || 5,
);
const REDIS_SNAPSHOT_SECTION_LIMIT = Number(
  process.env.REDIS_SNAPSHOT_SECTION_LIMIT || 50,
);
const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 15,
  ALERT: 10,
  WARN: 5,
  INFO: 0,
};

function normalizeSeverityLabel(value?: string): string {
  if (!value) return "NONE";
  const upper = value.toUpperCase();
  if (SEVERITY_RANK[upper] !== undefined) {
    return upper;
  }
  if (upper === "SEVERE" || upper === "HIGH") return "CRITICAL";
  if (upper === "MEDIUM") return "ALERT";
  if (upper === "LOW") return "WARN";
  return "NONE";
}

function getHighestSeverityFromFindings(findings?: BatchSegmentFinding[]): string {
  if (!findings || findings.length === 0) {
    return "NONE";
  }
  let bestScore = 0;
  let bestLabel: string = "NONE";
  for (const finding of findings) {
    const label = normalizeSeverityLabel(finding.severity);
    const score = SEVERITY_RANK[label] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  }
  return bestLabel;
}

/**
 * BatchData Interface
 * ===================
 * Represents batch reports sent from scanner every 92 seconds.
 * 
 * IMPORTANT: bot_probability is the authoritative threat score.
 * Frontend should NEVER recalculate scores from detection counts.
 * 
 * @since Backend deduplication update (2024)
 */
interface BatchSegmentFinding {
  id?: string;
  severity?: string;
  title?: string;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface BatchSegment {
  name: string;
  intervalSec?: number;
  findings?: BatchSegmentFinding[];
  stats?: Record<string, number>;
}

interface BatchAttachment {
  type: string;
  segment?: string;
  tableCount?: number;
  [key: string]: unknown;
}

interface BatchDeviceInfo {
  agentVersion?: string;
  scannerMode?: string;
  env?: string;
  hostname?: string;
  admin?: boolean;
}

interface BatchMetaInfo {
  generatedAt?: string;
  coinpokerDetected?: boolean;
  activePids?: number[];
  configHash?: string;
  segmentBaseDir?: string;
  [key: string]: unknown;
}

interface BatchErrorInfo {
  segment?: string;
  message?: string;
}

interface BatchData {
  bot_probability: number; // Primary threat score (0-100), already deduplicated by backend
  threats?: Array<{
    name: string;
    category: string;
    status: string;
    points: number;
    segment?: string;
    details?: string;
  }>;
  summary?: {
    critical: number;
    alert: number;
    warn: number;
    info: number;
    total_detections?: number;
    total_threats?: number;
    raw_detection_score?: number; // Raw sum of detections in the batch window
    severityHighest?: string;
    segmentsRan?: string[];
    dedupeWindowSec?: number;
  };
  aggregated_threats?: Array<{
    // Merged threats showing deduplication details
    name: string; // e.g., "weatherzeroservice.exe" or "OpenHoldem"
    category: string;
    status: string;
    score: number; // Deduplicated score for this threat
    sources: string[]; // All detection sources merged into this threat
    detections: number; // Number of detections merged
    confidence: number; // Number of segments confirming this threat
  }>;
  categories?: Record<string, number>;
  segments?: BatchSegment[];
  attachments?: BatchAttachment[];
  meta?: BatchMetaInfo;
  device?: BatchDeviceInfo;
  errors?: BatchErrorInfo[];
}

const VALID_STATUSES: ReadonlyArray<Status> = [
  "CRITICAL",
  "ALERT",
  "WARN",
  "INFO",
  "OK",
  "OFF",
  "UNK",
];

function normalizeStatus(status?: string): Status {
  if (!status) return "WARN";
  const uppercase = status.toUpperCase();
  return VALID_STATUSES.includes(uppercase as Status)
    ? (uppercase as Status)
    : "WARN";
}

export class RedisStore implements StorageAdapter {
  private client: Awaited<ReturnType<typeof getRedisClient>> | null = null;
  private connected = false;
  private memoryStore: MemoryStore;
  private deviceStates: Map<string, DeviceSessionState> = new Map();
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    // Don't create client or connect in constructor - lazy initialization
    this.memoryStore = new MemoryStore();
  }

  /**
   * Ensure Redis connection is established (lazy connection)
   * Uses shared Redis client from redis-client.ts to ensure consistency
   */
  private async ensureConnected(): Promise<boolean> {
    // Skip connection during build-time
    if (process.env.NEXT_PHASE === "phase-production-build" || 
        (process.env.NODE_ENV === "production" && process.argv.includes("build"))) {
      return false;
    }

    // If already connected, return true
    if (this.connected && this.client?.isOpen) {
      return true;
    }

    // If connection is in progress, wait for it
    if (this.connectionPromise) {
      await this.connectionPromise;
      return this.connected;
    }

    // Use shared Redis client (same as /api/players and other routes)
    this.connectionPromise = (async () => {
      try {
        this.client = await getRedisClient();
        this.connected = this.client.isOpen;
        if (this.connected) {
          // Log Redis connection details for debugging
          const clientInfo = {
            isOpen: this.client.isOpen,
            url: process.env.REDIS_URL?.replace(/:[^:@]+@/, ':****@') || 'not set',
            clientId: (this.client as any).id || 'unknown',
          };
          console.log("[RedisStore] Using shared Redis client:", JSON.stringify(clientInfo, null, 2));
        }
      } catch (err) {
        console.error("[RedisStore] Connection failed:", err);
        this.connected = false;
        // Don't throw - allow fallback to MemoryStore
      } finally {
        this.connectionPromise = null;
      }
    })();

    await this.connectionPromise;
    return this.connected;
  }

  async addSignal(sig: Signal): Promise<void> {
    const now = Date.now();
    const device_id = sig.device_id || "unknown";
    const isBatchReport =
      sig.category === "system" && sig.name.includes("Scan Report");
    
    // OPTIMIZATION: Batch reports go directly to Redis
    // Frontend player list polls Redis every 120s (reduced frequency)
    // Individual player dashboards still get real-time updates via SSE
    const isConnected = await this.ensureConnected();

    // If Redis isn't available, fall back entirely to MemoryStore behavior
    if (!isConnected || !this.client) {
      await this.memoryStore.addSignal(sig);
      return;
    }

    // Non-batch signals (e.g. Player Name Detected) should still be visible in UI
    // so we keep storing them in MemoryStore for live feed purposes
    if (!isBatchReport) {
      if (sig.name === "Player Name Detected") {
        const nickname = this.extractPlayerNameFromSignal(sig.details, sig.device_name);
        if (nickname) {
          await this.updateDeviceNickname(device_id, nickname);
        }
      }
      await this.memoryStore.addSignal(sig);
      return;
    }

    // Only process batch reports in Redis (every 92s)
    if (sig.details) {
      try {
        const batch: BatchData = JSON.parse(sig.details);
        const timestamp = sig.timestamp || Math.floor(now / 1000);
        
        // ========== COMPREHENSIVE IDENTIFIER LOGGING ==========
        console.log("[RedisStore] ========== BATCH INCOMING - ALL IDENTIFIERS ==========");
        console.log("[RedisStore] FROM SIGNAL:");
        console.log("  - signal.device_id:", sig.device_id);
        console.log("  - signal.device_name:", sig.device_name);
        console.log("  - signal.device_ip:", sig.device_ip);
        console.log("[RedisStore] FROM BATCH JSON:");
        console.log("  - batch.nickname:", (batch as any).nickname);
        console.log("  - batch.device:", (batch as any).device);
        console.log("  - batch.system?.host:", (batch as any).system?.host);
        console.log("  - batch.device?.hostname:", (batch as any).device?.hostname);
        console.log("  - batch.meta?.hostname:", (batch as any).meta?.hostname);
        console.log("[RedisStore] RESOLVED IDENTIFIERS:");
        const batchNickname = (batch as any).nickname;
        const batchDevice = (batch as any).device;
        const batchHost = (batch as any).system?.host;
        const batchDeviceHostname = (batch as any).device?.hostname;
        const batchMetaHostname = (batch as any).meta?.hostname;
        const signalDeviceName = sig.device_name;
        console.log("  - Primary device_id:", device_id);
        console.log("  - Available names:");
        console.log("    * signal.device_name:", signalDeviceName || "(null/undefined)");
        console.log("    * batch.nickname:", batchNickname || "(null/undefined)");
        console.log("    * batch.device:", batchDevice || "(null/undefined)");
        console.log("    * batch.system.host:", batchHost || "(null/undefined)");
        console.log("    * batch.device.hostname:", batchDeviceHostname || "(null/undefined)");
        console.log("    * batch.meta.hostname:", batchMetaHostname || "(null/undefined)");
        
        // Determine which name to use (priority order)
        // Try multiple sources to find a valid device name (see config/redis_identity.json)
        const deviceName = resolveDeviceName({
          deviceId: device_id,
          batchNickname,
          batchDevice: typeof batchDevice === "string" ? batchDevice : null,
          batchHost,
          batchDeviceHostname,
          batchMetaHostname,
          signalDeviceName,
        });
        console.log("  - SELECTED name for updateDevice():", deviceName);
        console.log("  - Name selection config: config/redis_identity.json (overridable via REDIS_IDENTITY_PATH)");
        console.log("[RedisStore] ============================================");
        
        // CRITICAL: Always update device when batch comes in (they're online!)
        // First, store the batch report
        await this.storeBatchReport(device_id, batch, timestamp);
        
        // Check for session events (login/logout)
        const sessionResult = await this.checkSessionEvents(device_id, signalDeviceName || device_id, timestamp, batch.bot_probability || 0, batch);
        
        if (device_id === "462a6a3a5c173a1ea54e05b355ea1790") {
          console.log("[RedisStore] sessionResult for device", device_id, ":", sessionResult);
        }
        
        // ALWAYS update device info when batch arrives (even if sessionResult is false)
        // The device is sending data, so it's online regardless of session state
        console.log("[RedisStore] Updating device (batch arrived, device is online)");
        
        // CRITICAL: Always update device when batch comes in - device is definitely online
        // Even if checkSessionEvents returns false (explicit logout), we still need to update
        // last_seen and threat_level so the device shows up correctly in the player list
        try {
          await this.updateDevice(device_id, deviceName, batch.bot_probability || 0);
        } catch (error) {
          console.error("[RedisStore] CRITICAL: Failed to update device in Redis:", error);
          // Don't throw - allow processing to continue, but log the error
        }
        
        // Extract individual threats to MemoryStore for live feed
        // First, create a summary signal for the batch report itself
        if (batch.summary) {
          const summary = batch.summary;
          
          // Create summary signals for each detection type
          if (summary.critical > 0) {
            const criticalSignal: Signal = {
              timestamp: sig.timestamp,
              category: "summary",
              name: `${summary.critical} Critical Detection${summary.critical > 1 ? 's' : ''}`,
              status: "CRITICAL" as Status,
              details: `Bot probability: ${batch.bot_probability}%`,
              device_id: device_id,
              device_name: sig.device_name,
            };
            await this.memoryStore.addSignal(criticalSignal);
          }
          
          if (summary.alert > 0) {
            const alertSignal: Signal = {
              timestamp: sig.timestamp,
              category: "summary",
              name: `${summary.alert} Alert${summary.alert > 1 ? 's' : ''}`,
              status: "ALERT" as Status,
              details: `From batch #${(batch as any).batch_number || 'N/A'}`,
              device_id: device_id,
              device_name: sig.device_name,
            };
            await this.memoryStore.addSignal(alertSignal);
          }
          
          if (summary.warn > 0) {
            const warnSignal: Signal = {
              timestamp: sig.timestamp,
              category: "summary",
              name: `${summary.warn} Warning${summary.warn > 1 ? 's' : ''}`,
              status: "WARN" as Status,
              details: `Total detections: ${summary.total_detections || 0}`,
              device_id: device_id,
              device_name: sig.device_name,
            };
            await this.memoryStore.addSignal(warnSignal);
          }
        }
        
        // Extract threats from aggregated_threats (primary source) or legacy threats array
        // aggregated_threats has structure: { threat_id, name, category, status, score, sources, detections, ... }
        // legacy threats array has structure: { name, segment, category, status, details, threat_id, ... }
        const threatsToProcess = batch.aggregated_threats || batch.threats || [];
        if (threatsToProcess.length > 0) {
          for (const threat of threatsToProcess) {
            // Handle both aggregated_threats format and legacy threats format
            const isAggregated = "sources" in threat && "detections" in threat;
            const threatSignal: Signal = {
              timestamp: sig.timestamp,
              category: threat.category || "threat",
              name: threat.name,
              status: normalizeStatus(threat.status),
              details: isAggregated 
                ? `Detected by ${(threat as any).sources?.join(", ") || "unknown"} (${(threat as any).detections || 0} detections)`
                : (threat.details || (threat as any).sources?.join(", ") || ""),
              device_id: device_id,
              device_name: sig.device_name,
              segment_name: isAggregated 
                ? (threat as any).sources?.[0]?.split("/")[0] || undefined
                : (threat.segment || (threat as any).sources?.[0] || undefined),
            };
            await this.memoryStore.addSignal(threatSignal);
          }
        }
        
        // Also extract findings from segments if they exist
        if (batch.segments && batch.segments.length > 0) {
          for (const segment of batch.segments) {
            if (segment.findings && segment.findings.length > 0) {
              for (const finding of segment.findings) {
                const findingSignal: Signal = {
                  timestamp: sig.timestamp,
                  category: segment.name || "segment",
                  name: finding.title || finding.id || "Detection",
                  status: normalizeSeverityLabel(finding.severity) as Status,
                  details: JSON.stringify(finding.details || finding.metadata || {}),
                  device_id: device_id,
                  device_name: sig.device_name,
                  segment_name: segment.name,
                };
                await this.memoryStore.addSignal(findingSignal);
              }
            }
          }
        }

        // Notify listeners (SSE) that new data is available
        await this.publishUpdate(device_id);
        await this.publishUpdate();
      } catch (err) {
        console.error("[Redis] Error processing batch:", err);
      }
    }
  }

  private async storeBatchReport(device_id: string, batch: BatchData, timestamp: number): Promise<void> {
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) return;

    const day = new Date(timestamp * 1000).toISOString().split('T')[0];
    const hour = new Date(timestamp * 1000).toISOString().slice(0, 13);
    
    // Store batch report with timestamp key for easy retrieval
    const batchKey = redisKeys.batchRecord(device_id, timestamp);
    
    // Store batch to Redis
    const categorySummary = (batch.segments || []).map((segment) => {
      const totalFindings = segment.findings?.length ?? 0;
      return {
        name: segment.name,
        totalFindings,
        highestSeverity: getHighestSeverityFromFindings(segment.findings),
        hasFindings: totalFindings > 0,
        stats: segment.stats || null,
      };
    });
    const batchRecord = {
      timestamp,
      bot_probability: batch.bot_probability || 0,
      raw_detection_score: batch.summary?.raw_detection_score || 0,
      critical: batch.summary?.critical || 0,
      alert: batch.summary?.alert || 0,
      warn: batch.summary?.warn || 0,
      info: batch.summary?.info || 0,
      threats: batch.aggregated_threats?.length || batch.threats?.length || 0,  // Use aggregated_threats count
      categories: batch.categories || {
        programs: 0,
        network: 0,
        behaviour: 0,
        auto: 0,
        vm: 0,
        screen: 0,
      },
      aggregated_threats: batch.aggregated_threats || [],  // Primary source - contains all threat info
      summary: batch.summary || null,
      segments: batch.segments || [],
      attachments: batch.attachments || [],
      meta: batch.meta || null,
      device: batch.device || null,
      errors: batch.errors || [],
    };
    await this.client.set(batchKey, JSON.stringify(batchRecord), { EX: TTL_SECONDS });
    

    const deviceCategoriesKey = redisKeys.deviceCategories(device_id);
    const categorySummaryPayload = {
      updatedAt: timestamp,
      severityHighest: batch.summary?.severityHighest || null,
      totalFindings:
        batch.summary?.total_detections ??
        categorySummary.reduce((sum, cat) => sum + (cat.totalFindings || 0), 0),
      segmentsRan:
        batch.summary?.segmentsRan ||
        categorySummary.map((segment) => segment.name),
      segments: categorySummary,
    };
    await this.client.set(deviceCategoriesKey, JSON.stringify(categorySummaryPayload), {
      EX: TTL_SECONDS,
    });

    // Add to time indexes for queries
    await this.client.zAdd(redisKeys.batchesHourly(device_id), {
      score: timestamp,
      value: batchKey,
    });
    
    await this.client.zAdd(redisKeys.batchesDaily(device_id), {
      score: timestamp,
      value: batchKey,
    });

    // Update daily average
    const dayKey = redisKeys.dayStats(device_id, day);
    await this.client.hIncrBy(dayKey, "reports", 1);
    await this.client.hIncrBy(dayKey, "score_sum", batch.bot_probability || 0);
    await this.client.expire(dayKey, TTL_SECONDS);

    // Update hourly average
    const hourKey = redisKeys.hourStats(device_id, hour);
    await this.client.hIncrBy(hourKey, "reports", 1);
    await this.client.hIncrBy(hourKey, "score_sum", batch.bot_probability || 0);
    await this.client.expire(hourKey, TTL_SECONDS);

    // Store detection counts in separate keys for quick access
    // These keys are used by buildPlayersFromRedisBatch to show detection counts in player cards
    const criticalCount = batch.summary?.critical || 0;
    const warnCount = batch.summary?.warn || 0;
    const alertCount = batch.summary?.alert || 0;
    
    // Store current detection counts (overwrite with latest batch values)
    // This represents the current state from the most recent batch report
    await this.client.set(
      redisKeys.deviceDetections(device_id, "CRITICAL"),
      criticalCount.toString(),
      { EX: TTL_SECONDS },
    );
    await this.client.set(
      redisKeys.deviceDetections(device_id, "WARN"),
      warnCount.toString(),
      { EX: TTL_SECONDS },
    );
    await this.client.set(
      redisKeys.deviceDetections(device_id, "ALERT"),
      alertCount.toString(),
      { EX: TTL_SECONDS },
    );

    // Update player_summary with rolling average (last 24 hours)
    await this.updatePlayerSummary(device_id, batch.bot_probability || 0, timestamp);
  }

  private async updateDevice(device_id: string, device_name: string, threat_level: number): Promise<void> {
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) {
      console.error("[RedisStore] updateDevice() - NOT CONNECTED! Cannot write to Redis.");
      return;
    }

    // Log client state for debugging
    console.log("[RedisStore] updateDevice() - Client state:", {
      isOpen: this.client.isOpen,
      clientExists: !!this.client,
    });

    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    const deviceKey = redisKeys.deviceHash(device_id);
    
    // ========== COMPREHENSIVE NAME HANDLING LOGGING ==========
    console.log("[RedisStore] ========== UPDATE DEVICE - NAME HANDLING ==========");
    console.log("[RedisStore] INPUT:");
    console.log("  - device_id:", device_id);
    console.log("  - device_name (received):", device_name);
    console.log("  - threat_level:", threat_level);
    console.log("  - timestamp:", nowSeconds);
    
    // Get existing device data to preserve certain fields
    const existingData = await this.client.hGetAll(deviceKey);
    const existingSessionStart = existingData?.session_start;
    const existingDeviceName = existingData?.device_name;
    const existingLastSeen = existingData?.last_seen;
    
    console.log("[RedisStore] EXISTING IN REDIS (device:" + deviceKey + "):");
    console.log("  - device_name:", existingDeviceName || "(not set)");
    console.log("  - last_seen:", existingLastSeen || "(not set)");
    console.log("  - session_start:", existingSessionStart || "(not set)");
    console.log("  - All fields:", Object.keys(existingData).length > 0 ? Object.keys(existingData).join(", ") : "(empty hash)");
    
    // CRITICAL: A batch is coming in, so device is definitely online now
    // We should ALWAYS update last_seen when batch comes in (device is online)
    // If batches stop coming, last_seen will become stale and isOnline will be false
    
    console.log("[RedisStore] NAME SANITIZATION:");
    console.log("  - Calling sanitizeDeviceName(", device_name, ",", device_id, ")");
    const sanitizedNewName = sanitizeDeviceName(device_name, device_id);
    console.log("  - sanitizedNewName result:", sanitizedNewName || "(null - rejected)");
    console.log("  - existingDeviceName:", existingDeviceName || "(null)");
    const finalDeviceName = sanitizedNewName || existingDeviceName;
    console.log("  - finalDeviceName (sanitized || existing):", finalDeviceName || "(will not set device_name)");
    
    if (!sanitizedNewName && device_name) {
      console.log("  - WARNING: device_name was rejected by sanitizeDeviceName!");
      console.log("    Reason: name equals device_id OR looks like device ID hash");
    }
    
    // IMPORTANT: When batch comes in, device is online, so always update last_seen to current time
    // This ensures that if batches stop coming, last_seen will be old and isOnline will be false
    const fields: Record<string, string> = {
      device_id,
      // CRITICAL: Always update last_seen when batch comes in (device is online)
      // This is the most important field - without it, device will show as offline
      last_seen: nowSeconds.toString(),
      threat_level: threat_level.toString(),
      session_start: existingSessionStart || nowSeconds.toString(),
    };
    // Only update device_name if we have a valid name (don't overwrite with null/empty)
    if (finalDeviceName && finalDeviceName.trim().length > 0) {
      fields.device_name = finalDeviceName;
    } else if (existingDeviceName && existingDeviceName.trim().length > 0) {
      // Preserve existing name if new name is invalid
      fields.device_name = existingDeviceName;
    }
    
    console.log("[RedisStore] WRITING TO REDIS:");
    console.log("  - Redis key:", deviceKey);
    console.log("  - Fields to write:", JSON.stringify(fields, null, 2));
    console.log("  - TTL:", TTL_SECONDS, "seconds");
    
    // CRITICAL: Write to Redis and verify immediately
    try {
      const writeResult = await this.client.hSet(deviceKey, fields);
      console.log("[RedisStore] hSet() result:", writeResult, "(should be number of fields written)");
      
      const expireResult = await this.client.expire(deviceKey, TTL_SECONDS);
      console.log("[RedisStore] expire() result:", expireResult, "(should be true if key exists)");
      
      // CRITICAL: Wait a tiny bit to ensure Redis has processed the write
      // This is necessary because Redis operations are async and might not be immediately visible
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify what was actually written (read back immediately)
      const writtenData = await this.client.hGetAll(deviceKey);
      console.log("[RedisStore] ========== VERIFICATION - READ BACK FROM REDIS ==========");
      console.log("[RedisStore] Redis key:", deviceKey);
      console.log("[RedisStore] Fields read back:");
      console.log("  - device_name:", writtenData.device_name || "(not set)");
      console.log("  - last_seen:", writtenData.last_seen || "(not set)");
      console.log("  - threat_level:", writtenData.threat_level || "(not set)");
      console.log("  - device_id:", writtenData.device_id || "(not set)");
      console.log("  - session_start:", writtenData.session_start || "(not set)");
      console.log("  - All fields:", Object.keys(writtenData).length > 0 ? Object.keys(writtenData).join(", ") : "(EMPTY HASH - PROBLEM!)");
      console.log("  - Total fields:", Object.keys(writtenData).length);
      
      // CRITICAL CHECK: If hash is empty after write, something is wrong!
      if (Object.keys(writtenData).length === 0) {
        console.error("[RedisStore] ⚠️⚠️⚠️ CRITICAL ERROR: Hash is EMPTY after write!");
        console.error("[RedisStore] This means Redis write failed or data was written to wrong key/database");
        console.error("[RedisStore] Attempting to read key again...");
        const retryData = await this.client.hGetAll(deviceKey);
        console.error("[RedisStore] Retry read result:", Object.keys(retryData).length > 0 ? "SUCCESS" : "STILL EMPTY");
      } else {
        console.log("[RedisStore] ✅ Hash write verified successfully");
      }
      console.log("[RedisStore] ============================================");
    } catch (error) {
      console.error("[RedisStore] ❌ ERROR during Redis write/verification:", error);
      throw error;
    }
    
    // Also update dedicated threat key (used by getDevices for accurate threat_level)
    const threatKey = redisKeys.deviceThreat(device_id);
    await this.client.set(threatKey, threat_level.toString(), { EX: TTL_SECONDS });
    console.log("[RedisStore] Updated threat key:", threatKey, "=", threat_level);
    
    // Add to device index (use last_seen timestamp for accurate sorting)
    await this.client.zAdd("devices", {
      score: nowSeconds * 1000, // Use seconds * 1000 for consistency with last_seen
      value: device_id,
    });
    console.log("[RedisStore] Added to devices sorted set with score:", nowSeconds * 1000);
    
    // IMPORTANT: Also update top_players immediately to ensure player shows up in dashboard
    // Note: Players remain in top_players even when offline - isOnline is calculated dynamically
    await this.client.zAdd(TOP_PLAYERS_ZSET, {
      score: threat_level,
      value: device_id,
    });
    
    // Verify the player was added
    const playerRank = await this.client.zRank(TOP_PLAYERS_ZSET, device_id);
    const playerScore = await this.client.zScore(TOP_PLAYERS_ZSET, device_id);
    console.log("[RedisStore] Added to top_players sorted set:");
    console.log("  - score (threat_level):", threat_level);
    console.log("  - rank:", playerRank);
    console.log("  - verified score:", playerScore);
    console.log("[RedisStore] ============================================");
  }

  private async updatePlayerSummary(device_id: string, current_bot_probability: number, timestamp: number): Promise<void> {
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) return;

    // Calculate rolling average from last 24 hours of batch reports
    const now = timestamp;
    const minTime = now - (24 * 3600); // 24 hours ago

    // Get all batch reports from last 24 hours
    // Use zRangeByScore to get batches within time range
    const batchKeys = await this.client.zRange(
      redisKeys.batchesHourly(device_id),
      minTime,
      now,
      { BY: "SCORE" },
    );

    let sum = 0;
    let count = 0;
    let firstSeen = now;
    let lastSeen = 0;

    // Also check the most recent batch directly (in case zRange misses it due to timing)
    const mostRecentBatchKey = redisKeys.batchRecord(device_id, timestamp);
    const mostRecentBatchData = await this.client.get(mostRecentBatchKey);
    if (mostRecentBatchData) {
      try {
        const batch = JSON.parse(mostRecentBatchData);
        // Only count if not already in batchKeys
        if (!batchKeys.includes(mostRecentBatchKey)) {
          sum += batch.bot_probability || 0;
          count += 1;
          if (batch.timestamp < firstSeen) firstSeen = batch.timestamp;
          if (batch.timestamp > lastSeen) lastSeen = batch.timestamp;
        }
      } catch {
        // Skip invalid batch data
      }
    }

    for (const key of batchKeys) {
      const data = await this.client.get(key);
      if (data) {
        try {
          const batch = JSON.parse(data);
          sum += batch.bot_probability || 0;
          count += 1;
          if (batch.timestamp < firstSeen) firstSeen = batch.timestamp;
          if (batch.timestamp > lastSeen) lastSeen = batch.timestamp;
        } catch {
          // Skip invalid batch data
        }
      }
    }

    // Calculate average (use current if no history)
    // IMPORTANT: Always use current_bot_probability if no batches found, or if current is higher
    // This ensures that if batches are coming in but zRange doesn't find them (e.g., timestamp issues),
    // we still store the current value instead of defaulting to 0
    const avg_bot_probability = count > 0 
      ? Math.round(sum / count) 
      : current_bot_probability;
    
    // Ensure we never store 0 if current_bot_probability is > 0 (defensive check)
    // This is critical for new players - their first batch should immediately create a summary
    const final_avg_bot_probability = (avg_bot_probability === 0 && current_bot_probability > 0)
      ? current_bot_probability
      : avg_bot_probability;

    // Get device name from device hash (most up-to-date source)
    const deviceKey = redisKeys.deviceHash(device_id);
    const deviceInfo = await this.client.hGetAll(deviceKey);
    console.log("[RedisStore] updatePlayerSummary - Reading device name from Redis:");
    console.log("  - deviceKey:", deviceKey);
    console.log("  - deviceInfo.device_name:", deviceInfo.device_name || "(not set)");
    console.log("  - deviceInfo.last_seen:", deviceInfo.last_seen || "(not set)");
    console.log("  - device_id:", device_id);
    
    // Priority: device hash > device_id fallback
    const device_name = deviceInfo.device_name || device_id.split('_')[0] || 'Unknown';
    console.log("  - Selected device_name:", device_name, "(deviceInfo.device_name || device_id.split('_')[0] || 'Unknown')");
    
    // If device hash has no name but we have one from elsewhere, update the hash
    if (!deviceInfo.device_name && device_name !== device_id && device_name !== 'Unknown') {
      console.log("[RedisStore] updatePlayerSummary - Updating device hash with name:", device_name);
      await this.client.hSet(deviceKey, { device_name });
      await this.client.expire(deviceKey, TTL_SECONDS);
    }

    // Get session count
    const sessionKeys = await this.client.keys(redisKeys.sessionPattern(device_id));
    const totalSessions = sessionKeys.length;

    // Calculate total detections from batch reports
    let totalDetections = 0;
    for (const key of batchKeys.slice(-100)) { // Last 100 batches max
      const data = await this.client.get(key);
      if (data) {
        try {
          const batch = JSON.parse(data);
          totalDetections += batch.threats || 0;
        } catch {
          // Skip invalid batch data
        }
      }
    }

    // Update player_summary
    const summaryKey = redisKeys.playerSummary(device_id);
    console.log("[RedisStore] updatePlayerSummary - Writing summary to Redis:");
    console.log("  - summaryKey:", summaryKey);
    console.log("  - device_name (stored in summary):", device_name);
    
    const summary = {
      device_id,
      device_name, // Use name from device hash (already fetched above)
      avg_bot_probability: final_avg_bot_probability,
      avg_score: final_avg_bot_probability, // Same as avg_bot_probability in unified system
      total_reports: count,
      total_detections: totalDetections,
      total_sessions: totalSessions,
      averages: {
        "1h": avg_bot_probability, // Simplified - could calculate from hourly aggregates
        "24h": avg_bot_probability,
        "7d": avg_bot_probability, // Would need more data
        "30d": avg_bot_probability, // Would need more data
      },
      first_seen: firstSeen || now,
      last_seen: lastSeen || now,
      updated_at: now,
    };

    await this.client.set(summaryKey, JSON.stringify(summary), { EX: TTL_SECONDS });
    
    // Verify summary was written correctly
    const writtenSummary = await this.client.get(summaryKey);
    if (writtenSummary) {
      try {
        const parsed = JSON.parse(writtenSummary);
        console.log("[RedisStore] updatePlayerSummary - Verified summary written:");
        console.log("  - device_name in summary:", parsed.device_name || "(not set)");
        console.log("  - avg_bot_probability:", parsed.avg_bot_probability ?? "(not set)");
      } catch (e) {
        console.error("[RedisStore] updatePlayerSummary - Failed to parse written summary:", e);
      }
    } else {
      console.error("[RedisStore] updatePlayerSummary - ⚠️ WARNING: Summary was NOT written to Redis!");
    }
    
    console.log("[RedisStore] updatePlayerSummary - Summary written with TTL:", TTL_SECONDS, "seconds");

    try {
      await this.client.zAdd(TOP_PLAYERS_ZSET, [
        {
          score: final_avg_bot_probability,
          value: device_id,
        },
      ]);

      if (TOP_PLAYERS_CACHE_LIMIT > 0) {
        await this.client.zRemRangeByRank(
          TOP_PLAYERS_ZSET,
          TOP_PLAYERS_CACHE_LIMIT,
          -1,
        );
      }
    } catch (err) {
      console.error("[Redis] Failed to update top players set:", err);
    }
  }

  private async checkSessionEvents(
    device_id: string,
    device_name: string, 
    timestamp: number,
    threat_level: number,
    batch?: BatchData  // Add batch to check for explicit logout
  ): Promise<boolean> {
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) return false;

    const nowMs = timestamp * 1000;
    const state = this.deviceStates.get(device_id);
    
    // Check for explicit logout signal (e.g., scan_type === "logout" or bot_probability === 0)
    const isExplicitLogout = batch && (
      (batch as any).scan_type === "logout" || 
      (batch as any).scan_type === "scanner_stopped" ||
      batch.bot_probability === -1  // Sometimes -1 indicates offline
    );
    
    const isDebugDevice = device_id === "462a6a3a5c173a1ea54e05b355ea1790";
    
    if (!state) {
      // First time seeing this device - session start (unless it's a logout)
      if (!isExplicitLogout) {
        this.deviceStates.set(device_id, {
          session_start: timestamp,
          last_seen: nowMs,
          is_online: true,
        });
        
        // Save session start event
        await this.saveSessionEvent(device_id, device_name, "login", timestamp, timestamp);
        if (isDebugDevice) {
          console.log("[RedisStore] checkSessionEvents: new session started, allowing updateDevice");
        }
        return true; // Allow updateDevice to proceed
      }
      if (isDebugDevice) {
        console.log("[RedisStore] checkSessionEvents: explicit logout on first signal, blocking updateDevice");
      }
      return false; // Explicit logout on first signal - don't update device
    } else {
      const timeSinceLastSeen = nowMs - state.last_seen;
      
      // Handle explicit logout or timeout
      if (isExplicitLogout) {
        // Explicit logout - mark as offline immediately
        const sessionDuration = Math.floor((nowMs - (state.session_start || timestamp) * 1000) / 1000);
        
        // Save session end for current session
        await this.saveSessionEvent(
          device_id,
          device_name,
          "logout",
          timestamp,
          state.session_start || timestamp,
          timestamp,
          sessionDuration,
          threat_level
        );
        
        // Mark device as offline (don't start new session)
        this.deviceStates.set(device_id, {
          session_start: state.session_start || timestamp, // Keep old session_start for reference
          last_seen: nowMs - DEVICE_TIMEOUT_MS - 1000, // Set last_seen to past to mark as offline
          is_online: false,
        });
        
        // Update Redis to reflect offline status
        const deviceKey = redisKeys.deviceHash(device_id);
        await this.client.hSet(deviceKey, {
          last_seen: (Math.floor((nowMs - DEVICE_TIMEOUT_MS - 1000) / 1000)).toString(),
        });
        
        if (isDebugDevice) {
          console.log("[RedisStore] checkSessionEvents: explicit logout detected, blocking updateDevice");
        }
        // Return false to prevent updateDevice from overwriting logout status
        return false;
      } else if (timeSinceLastSeen > DEVICE_TIMEOUT_MS) {
        // Timeout-based logout (no signal for >120s)
        const sessionDuration = Math.floor((state.last_seen - (state.session_start || timestamp) * 1000) / 1000);
        
        // Save session end for previous session
        await this.saveSessionEvent(
          device_id,
          device_name,
          "logout",
          Math.floor(state.last_seen / 1000),
          state.session_start || timestamp,
          Math.floor(state.last_seen / 1000),
          sessionDuration,
          threat_level
        );
        
        // Start new session (device came back online)
        this.deviceStates.set(device_id, {
          session_start: timestamp,
          last_seen: nowMs,
          is_online: true,
        });
        
        // Save new session start
        await this.saveSessionEvent(device_id, device_name, "login", timestamp, timestamp);
      } else {
        // Continue existing session
        state.last_seen = nowMs;
        state.is_online = true;
        if (isDebugDevice) {
          console.log("[RedisStore] checkSessionEvents: continuing session, allowing updateDevice");
        }
      }
    
    // Return true to allow updateDevice to proceed
    return true;
  }
  }

  private async saveSessionEvent(
    device_id: string,
    device_name: string,
    event_type: "login" | "logout",
    timestamp: number,
    session_start: number,
    session_end: number = 0,
    session_duration_seconds: number = 0,
    final_threat_score: number = 0
  ): Promise<void> {
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) return;

    const sessionData = {
      device_id,
      device_name,
      event_type,
      timestamp,
      session_start,
      session_end,
      session_duration_seconds,
      final_threat_score,
      final_bot_probability: final_threat_score, // Same as threat score in unified system
    };

    const sessionKey = redisKeys.sessionRecord(device_id, timestamp);
    await this.client.set(sessionKey, JSON.stringify(sessionData), {
      EX: TTL_SECONDS,
    });

    // Add to session index for queries
    await this.client.zAdd(redisKeys.sessionIndex(device_id), {
      score: timestamp,
      value: sessionKey,
    });
  }

  async addSignals(sigs: Signal[]): Promise<void> {
    for (const s of sigs) {
      await this.addSignal(s);
    }
  }

  private async publishUpdate(device_id?: string): Promise<void> {
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) return;

    try {
      const payload = Date.now().toString();
      if (device_id) {
        await this.client.publish(redisKeys.deviceUpdatesChannel(device_id), payload);
      }
      await this.client.publish(redisKeys.globalUpdatesChannel(), payload);
    } catch (error) {
      console.error("[Redis] Failed to publish update:", error);
    }
  }

  private extractPlayerNameFromSignal(details?: string | null, fallbackName?: string | null): string | null {
    if (details) {
      try {
        const parsed = JSON.parse(details);
        if (typeof parsed.player_name === "string") {
          return parsed.player_name.trim();
        }
        if (typeof parsed.nickname === "string") {
          return parsed.nickname.trim();
        }
      } catch {
        // Ignore JSON parse errors
      }

      const match = details.match(/player[_\s-]*name[:=\s-]+([^,\n]+)/i);
      if (match && match[1]) {
        return match[1].trim();
      }
      const nicknameMatch = details.match(/nickname[:=\s-]+([^,\n]+)/i);
      if (nicknameMatch && nicknameMatch[1]) {
        return nicknameMatch[1].trim();
      }
    }

    return fallbackName?.trim() || null;
  }

  private async updateDeviceNickname(device_id: string, nickname?: string | null): Promise<void> {
    console.log("[RedisStore] ========== UPDATE DEVICE NICKNAME ==========");
    console.log("[RedisStore] INPUT:");
    console.log("  - device_id:", device_id);
    console.log("  - nickname (received):", nickname || "(null/undefined)");
    
    const sanitized = sanitizeDeviceName(nickname, device_id);
    console.log("[RedisStore] SANITIZATION:");
    console.log("  - sanitized result:", sanitized || "(null - rejected)");
    
    if (!sanitized) {
      console.log("[RedisStore] Nickname rejected - not updating Redis");
      console.log("[RedisStore] ============================================");
      return;
    }

    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) {
      console.log("[RedisStore] Redis not connected - aborting");
      console.log("[RedisStore] ============================================");
      return;
    }

    const deviceKey = redisKeys.deviceHash(device_id);
    console.log("[RedisStore] WRITING TO REDIS:");
    console.log("  - Redis key:", deviceKey);
    console.log("  - Field: device_name =", sanitized);
    console.log("  - TTL:", TTL_SECONDS, "seconds");
    
    await this.client.hSet(deviceKey, { device_name: sanitized });
    await this.client.expire(deviceKey, TTL_SECONDS);
    
    // Verify what was written
    const writtenData = await this.client.hGetAll(deviceKey);
    console.log("[RedisStore] VERIFICATION:");
    console.log("  - device_name in Redis:", writtenData.device_name || "(not set)");
    console.log("[RedisStore] ============================================");
  }

  async getSnapshot(device_id?: string): Promise<{
    serverTime: number;
    sections: Record<string, { items: Stored[] }>;
  }> {
    let snapshot = await this.memoryStore.getSnapshot(device_id);

    if (device_id && this.areSectionsEmpty(snapshot.sections)) {
      const redisSnapshot = await this.buildSnapshotFromRedis(device_id);
      if (redisSnapshot) {
        snapshot = redisSnapshot;
      }
    }

    return snapshot;
  }

  async getCachedSnapshot(device_id: string): Promise<{
    serverTime: number;
    sections: Record<string, { items: Stored[] }>;
    cached?: boolean;
  } | null> {
    const cached = await this.memoryStore.getCachedSnapshot(device_id);
    if (cached && !this.areSectionsEmpty(cached.sections)) {
      return cached;
    }

    const redisSnapshot = await this.buildSnapshotFromRedis(device_id);
    return redisSnapshot ? { ...redisSnapshot, cached: false } : cached;
  }

  async getDevices(): Promise<{
    devices: Array<{
      device_id: string;
      device_name: string;
      last_seen: number;
      signal_count: number;
      unique_detection_count: number;
      threat_level: number;
      is_online: boolean;
      ip_address?: string;
    }>;
    total: number;
  }> {
    // Get from MemoryStore first (live data)
    const memoryDevices = await this.memoryStore.getDevices();
    
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) {
      return memoryDevices;
    }

    // Get devices from Redis
    let deviceIds = await this.client.zRange(redisKeys.deviceIndex(), 0, -1, { REV: true });
    
    // If devices sorted set is empty, scan for historical device keys
    if (deviceIds.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log("[Redis] devices sorted set is empty, scanning for historical device keys...");
      }
      const historicalIds = await scanPrimaryDeviceIds(this.client);

      for (const deviceId of historicalIds) {
        const deviceData = await this.client.hGetAll(redisKeys.deviceHash(deviceId));
        if (!deviceData || !deviceData.device_id) {
          continue;
        }

        const raw_last_seen = parseInt(deviceData.last_seen || "0");
        const last_seen_seconds =
          raw_last_seen > 1_000_000_000_000
            ? Math.floor(raw_last_seen / 1000)
            : raw_last_seen || Math.floor(Date.now() / 1000);

        await this.client.zAdd(redisKeys.deviceIndex(), {
          score: last_seen_seconds * 1000,
          value: deviceId,
        });
      }

      deviceIds = await this.client.zRange(redisKeys.deviceIndex(), 0, -1, { REV: true });
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Redis] Rebuilt devices sorted set with ${deviceIds.length} devices from historical data`);
      }
    }
    
    const devices = [];
    const now = Date.now();

    for (const device_id of deviceIds) {
      const data = await this.client.hGetAll(redisKeys.deviceHash(device_id));
      if (data && data.device_id) {
        const raw_last_seen = parseInt(data.last_seen || "0");
        const last_seen_seconds =
          raw_last_seen > 1_000_000_000_000
            ? Math.floor(raw_last_seen / 1000)
            : raw_last_seen;
        const last_seen_ms = last_seen_seconds * 1000;
        const is_online = now - last_seen_ms < DEVICE_TIMEOUT_MS;
        
        // Get threat_level from dedicated key (updated by batch reports) or fallback to hash
        const threatKey = redisKeys.deviceThreat(device_id);
        const threatFromKey = await this.client.get(threatKey);
        const threatLevel = threatFromKey
          ? parseFloat(threatFromKey)
          : parseInt(data.threat_level || "0");
        
        devices.push({
          device_id: data.device_id,
          device_name: data.device_name || device_id,
          device_hostname: data.device_hostname || data.host || data.device_name,
          player_nickname: data.player_nickname,
          player_nickname_confidence: data.player_nickname_confidence
            ? parseFloat(data.player_nickname_confidence)
            : undefined,
          last_seen: last_seen_ms,  // Return in milliseconds for UI consistency
          signal_count: 0,
          unique_detection_count: 0,
          threat_level: threatLevel,
          is_online,
          ip_address: data.ip_address,  // Include IP address if available
        });
      }
    }

    // Merge with memory devices (prefer latest data)
    const merged = new Map();
    [...memoryDevices.devices, ...devices].forEach(d => {
      const existing = merged.get(d.device_id);
      if (!existing || d.last_seen > existing.last_seen) {
        merged.set(d.device_id, d);
      }
    });

    const finalDevices = Array.from(merged.values())
      .sort((a, b) => b.last_seen - a.last_seen);

      return {
      devices: finalDevices,
      total: finalDevices.length,
    };
  }

  async getHourlyAggregates(
    device_id: string,
    hours: number = 24,
    minutesOverride?: number
  ): Promise<Array<{
    hour: string;
    timestamp: number;
    segments: Record<string, { critical: number; alert: number; warn: number; total_points: number }>;
    total_points: number;
    avg_score: number;
    avg_bot_probability?: number;
    sample_count: number;
    active_minutes: number;
  }>> {
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) return [];

    // For short periods, use minute-level aggregation
    if (minutesOverride || hours <= 2) {
      return this.getMinuteAggregates(device_id, minutesOverride || hours * 60);
    }

    const now = Math.floor(Date.now() / 1000);
    const minTime = now - (hours * 3600);

    // Get batch reports for time range
    const batchKeys = await this.client.zRange(
      redisKeys.batchesHourly(device_id),
      minTime,
      now,
      { BY: "SCORE" },
    );

    // Group by hour with categories
    const hourlyData = new Map<string, { 
      sum: number; 
      count: number; 
      timestamp: number;
      categories: Record<string, number>;
    }>();
    
    for (const key of batchKeys) {
      const data = await this.client.get(key);
      if (data) {
        const batch = JSON.parse(data);
        const hourKey = new Date(batch.timestamp * 1000).toISOString().slice(0, 13);
        
        const existing = hourlyData.get(hourKey) || { 
          sum: 0, 
          count: 0, 
          timestamp: batch.timestamp,
          categories: {} as Record<string, number>
        };
        existing.sum += batch.bot_probability;
        existing.count += 1;
        
        // Aggregate categories if they exist in the batch
        if (batch.categories) {
          for (const [category, value] of Object.entries(batch.categories)) {
            if (typeof value === 'number') {
              existing.categories[category] = (existing.categories[category] || 0) + value;
            }
          }
        }
        
        hourlyData.set(hourKey, existing);
      }
    }

    return Array.from(hourlyData.entries()).map(([hour, data]) => {
      // Calculate average category scores
      const segments: Record<string, any> = {};
      for (const [category, totalScore] of Object.entries(data.categories)) {
        // Convert category scores to segment format
        // For now, use the average score for that category
        const avgCategoryScore = Math.round((totalScore as number) / data.count);
        segments[category] = { 
          critical: avgCategoryScore >= 60 ? 1 : 0,
          alert: avgCategoryScore >= 30 && avgCategoryScore < 60 ? 1 : 0, 
          warn: avgCategoryScore > 0 && avgCategoryScore < 30 ? 1 : 0,
          total_points: avgCategoryScore,
          avg_score: avgCategoryScore
        };
      }
      
      // Add default segments for categories not in data
      const defaultCategories = ['programs', 'network', 'behaviour', 'vm', 'auto', 'screen'];
      for (const cat of defaultCategories) {
        if (!segments[cat]) {
          segments[cat] = { critical: 0, alert: 0, warn: 0, total_points: 0, avg_score: 0 };
        }
      }
      
      return {
        hour,
        timestamp: data.timestamp,
        segments,
        total_points: data.sum,
        avg_score: Math.round(data.sum / data.count),
        avg_bot_probability: Math.round(data.sum / data.count),
        sample_count: data.count,
        active_minutes: 60, // Approximate
      };
    }).sort((a, b) => a.timestamp - b.timestamp);
  }

  async getMinuteAggregates(
    device_id: string,
    minutes: number = 60
  ): Promise<Array<{
    hour: string;
    timestamp: number;
    segments: Record<string, { critical: number; alert: number; warn: number; total_points: number }>;
    total_points: number;
    avg_score: number;
    avg_bot_probability?: number;
    sample_count: number;
    active_minutes: number;
  }>> {
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) return [];

    const now = Math.floor(Date.now() / 1000);
    const minTime = now - (minutes * 60);

    // Get batch reports for time range (each batch report represents activity)
    const batchKeys = await this.client.zRange(
      redisKeys.batchesHourly(device_id),
      minTime,
      now,
      { BY: "SCORE" },
    );

    const results = [];
    for (const key of batchKeys) {
      const data = await this.client.get(key);
      if (data) {
        const batch = JSON.parse(data);
        
        // Process categories from batch data
        const segments: Record<string, any> = {};
        if (batch.categories) {
          for (const [category, score] of Object.entries(batch.categories)) {
            if (typeof score === 'number') {
              segments[category] = {
                critical: score >= 60 ? 1 : 0,
                alert: score >= 30 && score < 60 ? 1 : 0,
                warn: score > 0 && score < 30 ? 1 : 0,
                total_points: score,
                avg_score: score
              };
            }
          }
        }
        
        // Add default segments for missing categories
        const defaultCategories = ['programs', 'network', 'behaviour', 'vm', 'auto', 'screen'];
        for (const cat of defaultCategories) {
          if (!segments[cat]) {
            segments[cat] = { critical: 0, alert: 0, warn: 0, total_points: 0, avg_score: 0 };
          }
        }

        results.push({
          hour: new Date(batch.timestamp * 1000).toISOString(),
          timestamp: batch.timestamp,
          segments,
          total_points: batch.bot_probability || 0,
          avg_score: batch.bot_probability || 0,
          avg_bot_probability: batch.bot_probability || 0,
          sample_count: 1,
          active_minutes: 1,
        });
      }
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  async getDailyAggregates(
    device_id: string,
    days: number = 7
  ): Promise<Array<{
    day: string;
      avg_score: number;
    total_reports: number;
  }>> {
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) return [];

      const results = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayStr = date.toISOString().split('T')[0];
      
      const dayKey = redisKeys.dayStats(device_id, dayStr);
      const data = await this.client.hGetAll(dayKey);
      
      if (data && data.reports) {
        const reports = parseInt(data.reports);
        const sum = parseInt(data.score_sum || "0");
        results.push({
          day: dayStr,
          avg_score: reports > 0 ? Math.round(sum / reports) : 0,
          total_reports: reports,
        });
      }
    }

    return results.sort((a, b) => a.day.localeCompare(b.day));
  }

  private areSectionsEmpty(
    sections: Record<string, { items: Stored[] }> | undefined | null,
  ): boolean {
    if (!sections) {
      return true;
    }

    return Object.values(sections).every(
      (section) => !section || section.items.length === 0,
    );
  }

  private normalizeEpochValue(value?: number): number {
    if (
      value === undefined ||
      value === null ||
      Number.isNaN(value as number)
    ) {
      return Math.floor(Date.now() / 1000);
    }
    return value > 1_000_000_000_000
      ? Math.floor(value / 1000)
      : Math.floor(value);
  }

  private appendSectionItem(
    sections: Record<string, { items: Stored[] }>,
    section: string,
    item: Stored,
  ): void {
    if (!sections[section]) {
      sections[section] = { items: [] };
    }
    sections[section].items.push(item);
    if (sections[section].items.length > REDIS_SNAPSHOT_SECTION_LIMIT) {
      sections[section].items.length = REDIS_SNAPSHOT_SECTION_LIMIT;
    }
  }

  private getSummaryStatus(summary?: {
    critical?: number;
    alert?: number;
    warn?: number;
  }): Status {
    if (!summary) return "INFO";
    if ((summary.critical || 0) > 0) return "CRITICAL";
    if ((summary.alert || 0) > 0) return "ALERT";
    if ((summary.warn || 0) > 0) return "WARN";
    return "INFO";
  }

  private async getRecentBatchKeys(device_id: string): Promise<string[]> {
    if (!this.client) return [];

    const limit = Math.max(1, REDIS_SNAPSHOT_BATCH_LIMIT);
    let keys = await this.client.zRange(
      redisKeys.batchesHourly(device_id),
      0,
      limit - 1,
      { REV: true },
    );

    if (!keys.length) {
      keys = await this.client.zRange(
        redisKeys.batchesDaily(device_id),
        0,
        limit - 1,
        { REV: true },
      );
    }

    if (!keys.length) {
      const scanned: string[] = [];
      for await (const key of this.client.scanIterator({
        MATCH: `batch:${device_id}:*`,
        COUNT: 100,
      })) {
        scanned.push(key as string);
        if (scanned.length >= limit) {
          break;
        }
      }
      scanned.sort(
        (a, b) =>
          this.extractTimestampFromBatchKey(b) -
          this.extractTimestampFromBatchKey(a),
      );
      keys = scanned.slice(0, limit);
    }

    return keys;
  }

  private extractTimestampFromBatchKey(key: string): number {
    const raw = Number(key.split(":").pop());
    return Number.isFinite(raw) ? raw : 0;
  }

  private async buildSnapshotFromRedis(
    device_id: string,
  ): Promise<{
    serverTime: number;
    sections: Record<string, { items: Stored[] }>;
  } | null> {
    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.client) {
      return null;
    }

    const batchKeys = await this.getRecentBatchKeys(device_id);
    if (!batchKeys.length) {
      return null;
    }

    const pipeline = this.client.multi();
    for (const key of batchKeys) {
      pipeline.get(key);
    }
    const batchResults = await pipeline.exec();
    if (!batchResults) {
      return null;
    }

    const sections: Record<string, { items: Stored[] }> = {};
    let added = false;
    const nowSec = Math.floor(Date.now() / 1000);

    batchResults.forEach((entry, batchIndex) => {
      const raw = Array.isArray(entry) ? entry[1] : entry;
      if (!raw || typeof raw !== "string") {
        return;
      }

      try {
        const batch = JSON.parse(raw) as {
          timestamp?: number;
          aggregated_threats?: Array<Record<string, any>>;
          categories?: Record<string, number>;
          summary?: {
            critical?: number;
            alert?: number;
            warn?: number;
            info?: number;
            total_detections?: number;
          };
          bot_probability?: number;
          nickname?: string;
          device?: { hostname?: string };
          meta?: { hostname?: string };
          batch_number?: number;
        };

        const timestamp = this.normalizeEpochValue(batch.timestamp ?? nowSec);
        const deviceName =
          (batch.nickname as string) ||
          batch.device?.hostname ||
          (batch.meta?.hostname as string) ||
          device_id;

        const aggregated = Array.isArray(batch.aggregated_threats)
          ? batch.aggregated_threats
          : [];
        let hasThreatItems = false;

        // Inject nickname signal if available (mirrors Player Name Detected events)
        if (
          typeof batch.nickname === "string" &&
          batch.nickname.trim().length > 0
        ) {
          const nicknamePayload = {
            player_name: batch.nickname.trim(),
            confidence_percent: 100,
          };
          const nicknameSignal: Stored = {
            timestamp,
            category: "system",
            name: "Player Name Detected",
            status: "INFO",
            details: JSON.stringify(nicknamePayload),
            device_id,
            device_name: deviceName,
            id: `redis:${device_id}:${timestamp}:nickname`,
            section: "system_reports",
            uniqueKey: `redis:system:nickname:${device_id}`,
            firstSeen: timestamp,
            detections: 1,
          };
          this.appendSectionItem(sections, "system_reports", nicknameSignal);
          added = true;
        }

        aggregated.forEach((threat, threatIndex) => {
          const normalizedStatus = normalizeStatus(threat.status);
          const threatCategory =
            typeof threat.category === "string"
              ? threat.category
              : "programs";
          const detailParts: string[] = [];
          if (Array.isArray(threat.sources) && threat.sources.length) {
            detailParts.push(`Sources: ${threat.sources.join(", ")}`);
          }
          if (typeof threat.score === "number") {
            detailParts.push(`Score: ${Math.round(threat.score)}`);
          }
          if (typeof threat.detections === "number") {
            detailParts.push(`Detections: ${threat.detections}`);
          }
          const details =
            detailParts.join(" | ") ||
            `Detections: ${threat.detections ?? 1}`;
          const signal: Signal = {
            timestamp,
            category: threatCategory,
            name: threat.name || "Detection",
            status: normalizedStatus,
            details,
            device_id,
            device_name: deviceName,
            segment_name: Array.isArray(threat.sources)
              ? threat.sources[0]
              : undefined,
          };
          const section = routeToSectionKey(signal);
          const stored: Stored = {
            ...signal,
            id: `redis:${device_id}:${timestamp}:${batchIndex}:${threatIndex}`,
            section,
            uniqueKey: `redis:${section}:${threat.threat_id || threat.name || threatIndex}`,
            firstSeen: this.normalizeEpochValue(
              threat.first_detected ?? timestamp,
            ),
            detections: threat.detections ?? 1,
          };
          this.appendSectionItem(sections, section, stored);
          hasThreatItems = true;
          added = true;
        });

        if (!hasThreatItems && batch.categories) {
          const summaryStatus = this.getSummaryStatus(batch.summary);
          Object.entries(batch.categories).forEach(
            ([categoryKey, count], catIndex) => {
              if (typeof count !== "number" || count <= 0) return;
              const category = categoryKey.toLowerCase();
              const signal: Signal = {
                timestamp,
                category,
                name: `${category} activity`,
                status: summaryStatus,
                details: `Detections: ${count}`,
                device_id,
                device_name: deviceName,
              };
              const section = routeToSectionKey(signal);
              const stored: Stored = {
                ...signal,
                id: `redis:${device_id}:${timestamp}:category:${catIndex}`,
                section,
                uniqueKey: `redis:${section}:category:${category}`,
                firstSeen: timestamp,
                detections: count,
              };
              this.appendSectionItem(sections, section, stored);
              added = true;
            },
          );
        }

        if (batch.summary) {
          const summaryStatus = this.getSummaryStatus(batch.summary);
          const summaryDetails = [
            `Bot probability: ${batch.bot_probability ?? "N/A"}%`,
            `Critical: ${batch.summary.critical ?? 0}`,
            `Alert: ${batch.summary.alert ?? 0}`,
            `Warn: ${batch.summary.warn ?? 0}`,
          ].join(" | ");
          const systemItem: Stored = {
            timestamp,
            category: "system",
            name: `Threat Summary (Batch #${batch.batch_number ?? "?"})`,
            status: summaryStatus,
            details: summaryDetails,
            device_id,
            device_name: deviceName,
            id: `redis:${device_id}:${timestamp}:summary:${batchIndex}`,
            section: "system_reports",
            uniqueKey: `redis:system:${timestamp}:${batchIndex}`,
            firstSeen: timestamp,
            detections: batch.summary.total_detections ?? 0,
          };
          this.appendSectionItem(sections, "system_reports", systemItem);
          added = true;
        }
      } catch (error) {
        console.error(
          "[RedisStore] Failed to parse batch while building snapshot:",
          error,
        );
      }
    });

    if (!added) {
      return null;
    }

    return {
      serverTime: Math.floor(Date.now() / 1000),
      sections,
    };
  }

  async disconnect(): Promise<void> {
    if (this.connected && this.client?.isOpen) {
      await this.client.disconnect();
      this.connected = false;
    }
  }
}
