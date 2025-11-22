/**
 * Redis Connection Pool
 * ====================
 * Centralized Redis client management to avoid connection leaks
 */

import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

// Global singleton for Redis connection
let globalRedisClient: RedisClient | null = null;
let connectionPromise: Promise<RedisClient> | null = null;

/**
 * Get or create a Redis client connection
 * Uses connection pooling to avoid creating multiple connections
 */
export async function getRedisClient(): Promise<RedisClient> {
  // If we already have a connected client, return it
  if (globalRedisClient?.isOpen) {
    return globalRedisClient;
  }

  // If a connection is in progress, wait for it
  if (connectionPromise) {
    return connectionPromise;
  }

  // Create new connection
  connectionPromise = createConnection();
  return connectionPromise;
}

async function createConnection(): Promise<RedisClient> {
  try {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';

    const client = createClient({
      url,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.error('[Redis] Max reconnection attempts reached');
            return new Error('Max reconnection attempts');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    client.on('error', (err) => {
      console.error('[Redis] Client error:', err);
    });

    client.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    client.on('reconnecting', () => {
      console.log('[Redis] Reconnecting...');
    });

    await client.connect();
    globalRedisClient = client;
    connectionPromise = null;

    return client;
  } catch (error) {
    connectionPromise = null;
    console.error('[Redis] Failed to connect:', error);
    throw error;
  }
}

/**
 * Execute a Redis operation with automatic connection management
 */
export async function withRedis<T>(
  operation: (client: RedisClient) => Promise<T>
): Promise<T> {
  const client = await getRedisClient();
  return operation(client);
}

/**
 * Gracefully close Redis connection (for cleanup)
 */
export async function closeRedisConnection(): Promise<void> {
  if (globalRedisClient?.isOpen) {
    await globalRedisClient.quit();
    globalRedisClient = null;
    connectionPromise = null;
  }
}

// Cleanup on process termination
if (typeof process !== 'undefined') {
  process.on('SIGINT', closeRedisConnection);
  process.on('SIGTERM', closeRedisConnection);
}
