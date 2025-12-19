import { createClient } from "redis";
import { redisKeys as schemaKeys, redisTtl as schemaTtl } from "@/lib/redis/schema";

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
  deviceCommandQueue: (deviceId: string) => schemaKeys.deviceCommandQueue(deviceId),
  deviceCommand: (deviceId: string, commandId: string) =>
    schemaKeys.deviceCommand(deviceId, commandId),
  deviceCommandResult: (deviceId: string, commandId: string) =>
    schemaKeys.deviceCommandResult(deviceId, commandId),
  
  // Existing keys for compatibility
  deviceHash: (deviceId: string) => schemaKeys.deviceHash(deviceId),
  batchRecord: (deviceId: string, timestamp: number) =>
    schemaKeys.batchRecord(deviceId, timestamp),
  deviceDetections: (deviceId: string, level: string) =>
    `device:${deviceId}:detections:${level}`,
  deviceThreat: (deviceId: string) => schemaKeys.deviceThreat(deviceId),
  
  // Indexes
  deviceIndex: () => schemaKeys.deviceIndex(),
  topPlayers: () => schemaKeys.topPlayers(),
  batchesHourly: (deviceId: string) => schemaKeys.batchesHourly(deviceId),
  batchesDaily: (deviceId: string) => schemaKeys.batchesDaily(deviceId),
  
  // Stats
  dayStats: (deviceId: string, day: string) => schemaKeys.dayStats(deviceId, day),
  hourStats: (deviceId: string, hour: string) => schemaKeys.hourStats(deviceId, hour),
  
  // Pub/Sub channels
  deviceUpdatesChannel: (deviceId: string) => schemaKeys.deviceUpdatesChannel(deviceId),
  globalUpdatesChannel: () => schemaKeys.globalUpdatesChannel(),
};

export const redisTTL = {
  command: schemaTtl.commandSeconds(), // 5 minutes for commands (default)
  commandResult: schemaTtl.commandResultSeconds(), // 1 hour for results (default)
  batch: schemaTtl.batchSeconds(), // Uses REDIS_TTL_SECONDS (default 7 days)
  device: schemaTtl.batchSeconds(), // Same policy as batch unless overridden elsewhere
};
