import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;
let redisClient: RedisClient | null = null;
let connectionPromise: Promise<RedisClient | null> | null = null;

export async function getRedisClient(): Promise<RedisClient | null> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  if (!connectionPromise) {
    const url = process.env.REDIS_URL;

    if (!url) {
      console.warn("[Redis Utils] No Redis URL configured");
      return null;
    }

    connectionPromise = (async () => {
      try {
        const client = createClient({ url });
        client.on("error", (err) =>
          console.error("[Redis Utils] Redis Client Error:", err)
        );

        await client.connect();
        console.log("[Redis Utils] Redis client connected");
        return client;
      } catch (error) {
        console.error("[Redis Utils] Failed to connect to Redis:", error);
        return null;
      }
    })();
  }

  const client = await connectionPromise;
  connectionPromise = null;

  if (client && client.isOpen) {
    redisClient = client;
    return client;
  }

  redisClient = null;
  return null;
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
