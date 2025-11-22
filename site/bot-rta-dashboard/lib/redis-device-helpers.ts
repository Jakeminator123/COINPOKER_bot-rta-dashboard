import type {
  RedisClientType,
  RedisModules,
  RedisFunctions,
  RedisScripts,
} from "redis";

type RedisClient = RedisClientType<RedisModules, RedisFunctions, RedisScripts>;

const DEVICE_KEY_PREFIX = "device:";
const IGNORED_KEY_PATTERNS = [
  ":info",
  ":threat",
  ":detections",
  ":legacy",
  ":summary",
];

/**
 * Scan Redis for primary device hashes (device:<id>)
 * while skipping auxiliary hashes (e.g., device:<id>:info).
 */
export async function scanPrimaryDeviceIds(
  client: RedisClient,
  scanBatchSize = 200
): Promise<string[]> {
  const deviceIds = new Set<string>();
  let cursor = 0;

  do {
    const result = await client.scan(cursor, {
      MATCH: `${DEVICE_KEY_PREFIX}*`,
      COUNT: scanBatchSize,
    });
    cursor = result.cursor;

    for (const key of result.keys) {
      if (!key.startsWith(DEVICE_KEY_PREFIX)) {
        continue;
      }
      if (IGNORED_KEY_PATTERNS.some((pattern) => key.includes(pattern))) {
        continue;
      }
      const deviceId = key.slice(DEVICE_KEY_PREFIX.length);
      if (deviceId) {
        deviceIds.add(deviceId);
      }
    }
  } while (cursor !== 0);

  return Array.from(deviceIds);
}

