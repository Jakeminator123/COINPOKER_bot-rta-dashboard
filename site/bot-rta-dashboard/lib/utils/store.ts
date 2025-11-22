import { Signal } from "@/lib/detections/sections";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import { MemoryStore } from "@/lib/storage/memory-store";

// Lazy-load Redis to avoid import errors if not installed
type RedisStoreConstructor = new () => StorageAdapter;
let RedisStoreCtor: RedisStoreConstructor | null = null;

// Singleton pattern: Use global to persist instance across module reloads during build
const GLOBAL_STORE_KEY = "__BOT_RTA_STORE_INSTANCE__";
const globalForStore = global as unknown as {
  [GLOBAL_STORE_KEY]?: StorageAdapter;
};

function getStoreInstance(): StorageAdapter {
  // Return existing instance if available (singleton pattern)
  if (globalForStore[GLOBAL_STORE_KEY]) {
    return globalForStore[GLOBAL_STORE_KEY]!;
  }

  // Initialize storage based on environment
  // Next.js loads .env.local automatically, but we need to ensure it's read correctly
  const USE_REDIS = process.env.USE_REDIS === "true";
  
  // During build-time, always use MemoryStore to avoid Redis connections
  const isBuildTime = process.env.NEXT_PHASE === "phase-production-build" || 
                      (process.env.NODE_ENV === "production" && process.argv.includes("build"));

  let store: StorageAdapter;

  if (USE_REDIS && !isBuildTime) {
    // Only log in development, reduce noise in production
    if (process.env.NODE_ENV === "development") {
      console.log("[Store] Using Redis storage");
    }
    try {
      // Synchronously import Redis store (works in Next.js server context)
      if (!RedisStoreCtor) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const redisModule = require("../storage/redis-store") as {
          RedisStore: RedisStoreConstructor;
        };
        RedisStoreCtor = redisModule.RedisStore;
      }
      store = new RedisStoreCtor();
    } catch (err) {
      console.error(
        "[Store] Redis initialization failed, using memory store:",
        err
      );
      store = new MemoryStore();
    }
  } else {
    // Only log in development, not during build or production runtime
    if (!isBuildTime && process.env.NODE_ENV === "development") {
      console.log("[Store] Using in-memory storage (USE_REDIS=false)");
    }
    // During build-time, silently use MemoryStore (no Redis connection needed)
    store = new MemoryStore();
  }

  // Cache instance globally for reuse
  globalForStore[GLOBAL_STORE_KEY] = store;
  return store;
}

// Initialize store (singleton - only creates once per process)
const store = getStoreInstance();

// Export storage functions
export const addSignal = (sig: Signal) => store.addSignal(sig);
export const addSignals = (sigs: Signal[]) => store.addSignals(sigs);
export const getSnapshot = (device_id?: string) => store.getSnapshot(device_id);
export const getCachedSnapshot = (device_id: string) =>
  store.getCachedSnapshot?.(device_id) ?? null;
export const getHourlyAggregates = (device_id: string, hours?: number, minutesOverride?: number) =>
  store.getHourlyAggregates?.(device_id, hours, minutesOverride) ?? Promise.resolve([]);
export const getMinuteAggregates = (device_id: string, minutes?: number) =>
  store.getMinuteAggregates?.(device_id, minutes) ?? Promise.resolve([]);
export const getDevices = () => store.getDevices();
export const getCachedDevicesList = () =>
  store.getCachedDevicesList?.() ?? Promise.resolve(null);
export const getGlobalStats = () =>
  store.getGlobalStats?.() ?? Promise.resolve({
    totalPlayers: 0,
    onlinePlayers: 0,
    highRiskPlayers: 0,
    avgThreatLevel: 0,
  });
