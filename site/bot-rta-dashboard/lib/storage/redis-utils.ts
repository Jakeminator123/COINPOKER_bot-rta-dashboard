import { Redis } from "@upstash/redis";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (redisClient) {
    return redisClient;
  }

  const url = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;

  if (!url) {
    console.warn("[Redis Utils] No Redis URL configured");
    return null;
  }

  try {
    if (token) {
      // Use Upstash Redis with token
      redisClient = new Redis({
        url,
        token,
      });
    } else {
      // Use standard Redis URL
      redisClient = Redis.fromEnv();
    }
    
    console.log("[Redis Utils] Redis client initialized");
    return redisClient;
  } catch (error) {
    console.error("[Redis Utils] Failed to initialize Redis client:", error);
    return null;
  }
}

export function isRedisAvailable(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL);
}

export const redisKeys = {
  // Command queue keys
  deviceCommandQueue: (deviceId: string) => `device:${deviceId}:command_queue`,
  deviceCommand: (deviceId: string, commandId: string) => `device:${deviceId}:commands:${commandId}`,
  deviceCommandResult: (deviceId: string, commandId: string) => `device:${deviceId}:command_result:${commandId}`,
  
  // Existing keys for compatibility
  deviceHash: (deviceId: string) => `device:${deviceId}`,
  batchRecord: (deviceId: string, timestamp: number) => `batch:${deviceId}:${timestamp}`,
  deviceDetections: (deviceId: string, level: string) => `device:${deviceId}:detections:${level}`,
  deviceThreat: (deviceId: string) => `device:${deviceId}:threat`,
  
  // Indexes
  deviceIndex: () => "devices:index",
  topPlayers: () => "top_players",
  batchesHourly: (deviceId: string) => `batches:hourly:${deviceId}`,
  batchesDaily: (deviceId: string) => `batches:daily:${deviceId}`,
  
  // Stats
  dayStats: (deviceId: string, day: string) => `stats:${deviceId}:daily:${day}`,
  hourStats: (deviceId: string, hour: string) => `stats:${deviceId}:hourly:${hour}`,
  
  // Pub/Sub channels
  deviceUpdatesChannel: (deviceId: string) => `updates:device:${deviceId}`,
  globalUpdatesChannel: () => "updates:global",
};

export const redisTTL = {
  command: 300, // 5 minutes for commands
  commandResult: 3600, // 1 hour for results
  batch: 86400, // 24 hours for batch reports
  device: 604800, // 7 days for device info
};
