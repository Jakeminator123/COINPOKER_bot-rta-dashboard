import { NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import {
  corsOptions,
  errorResponse,
  successResponse,
  validateToken,
} from "@/lib/utils/api-utils";
import { getRedisClient } from "@/lib/redis/redis-client";
import { REDIS_KEYS, TTL_SECONDS } from "../../recordings/upload/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB for images
const SNAPSHOTS_DIR = process.env.SNAPSHOTS_DIR || join(process.cwd(), "snapshots");

export interface SnapshotMetadata {
  snapshotId: string;
  deviceId: string;
  commandId: string;
  filename: string;
  filePath: string;
  fileSize: number;
  createdAt: number;
  expiresAt: number;
  type: "snapshot";
  windowTitle?: string;
  windowType?: "table" | "lobby" | "unknown";
}

function generateSnapshotId(): string {
  return `snap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function getExpiresAt(): number {
  const RETENTION_DAYS = Number(process.env.MEDIA_RETENTION_DAYS) || 30;
  return Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

// Redis-backed storage functions
async function saveSnapshotMetadata(metadata: SnapshotMetadata): Promise<void> {
  try {
    const redis = await getRedisClient();
    if (!redis) return;
    
    const key = REDIS_KEYS.snapshot(metadata.deviceId, metadata.snapshotId);
    const indexKey = REDIS_KEYS.snapshotIndex(metadata.deviceId);
    
    // Store metadata
    await redis.set(key, JSON.stringify(metadata), { EX: TTL_SECONDS });
    
    // Add to device's snapshot index (sorted by createdAt)
    await redis.zAdd(indexKey, { score: metadata.createdAt, value: metadata.snapshotId });
    await redis.expire(indexKey, TTL_SECONDS);
    
    console.log(`[Snapshots] Saved metadata to Redis: ${key}`);
  } catch (error) {
    console.error("[Snapshots] Failed to save to Redis:", error);
  }
}

export async function getSnapshotMetadataFromRedis(deviceId: string, snapshotId: string): Promise<SnapshotMetadata | null> {
  try {
    const redis = await getRedisClient();
    if (!redis) return null;
    
    const key = REDIS_KEYS.snapshot(deviceId, snapshotId);
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("[Snapshots] Failed to get from Redis:", error);
    return null;
  }
}

export async function getAllSnapshotsFromRedis(deviceId: string): Promise<SnapshotMetadata[]> {
  try {
    const redis = await getRedisClient();
    if (!redis) return [];
    
    const indexKey = REDIS_KEYS.snapshotIndex(deviceId);
    const snapshotIds = await redis.zRange(indexKey, 0, -1, { REV: true }); // Newest first
    
    const snapshots: SnapshotMetadata[] = [];
    for (const snapshotId of snapshotIds) {
      const key = REDIS_KEYS.snapshot(deviceId, snapshotId);
      const data = await redis.get(key);
      if (data) {
        snapshots.push(JSON.parse(data));
      }
    }
    
    return snapshots;
  } catch (error) {
    console.error("[Snapshots] Failed to list from Redis:", error);
    return [];
  }
}

export async function deleteSnapshotFromRedis(deviceId: string, snapshotId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    if (!redis) return false;
    
    const key = REDIS_KEYS.snapshot(deviceId, snapshotId);
    const indexKey = REDIS_KEYS.snapshotIndex(deviceId);
    
    await redis.del(key);
    await redis.zRem(indexKey, snapshotId);
    
    console.log(`[Snapshots] Deleted from Redis: ${key}`);
    return true;
  } catch (error) {
    console.error("[Snapshots] Failed to delete from Redis:", error);
    return false;
  }
}

export async function OPTIONS() {
  return corsOptions();
}

export async function POST(req: NextRequest) {
  try {
    // Validate token
    const signalToken = process.env.SIGNAL_TOKEN;
    const tokenValidation = validateToken(req, signalToken);
    if (!tokenValidation.valid) {
      return errorResponse(tokenValidation.error || "Unauthorized", 401);
    }

    // Parse JSON body (base64 encoded image)
    const body = await req.json();
    const { deviceId, commandId, image, windowTitle, windowType } = body;

    if (!image || typeof image !== "string") {
      return errorResponse("image (base64) is required", 400);
    }

    if (!deviceId || typeof deviceId !== "string") {
      return errorResponse("deviceId is required", 400);
    }

    // Generate snapshot ID and filename
    const snapshotId = generateSnapshotId();
    const timestamp = Date.now();
    const filename = `${timestamp}_${commandId || "snapshot"}.png`;

    // Create device-specific directory
    const deviceDir = join(SNAPSHOTS_DIR, deviceId);
    await mkdir(deviceDir, { recursive: true });

    // Decode base64 and save file
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    
    // Validate file size
    if (buffer.length > MAX_FILE_SIZE) {
      return errorResponse(
        `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        400
      );
    }

    const filePath = join(deviceDir, filename);
    await writeFile(filePath, buffer);

    // Store metadata in Redis
    const metadata: SnapshotMetadata = {
      snapshotId,
      deviceId,
      commandId: commandId || "",
      filename,
      filePath,
      fileSize: buffer.length,
      createdAt: timestamp,
      expiresAt: getExpiresAt(),
      type: "snapshot",
      windowTitle: windowTitle || undefined,
      windowType: windowType || "unknown",
    };

    await saveSnapshotMetadata(metadata);

    console.log(
      `[Snapshots] Uploaded snapshot ${snapshotId} for device ${deviceId}, size: ${(buffer.length / 1024).toFixed(2)}KB`
    );

    return successResponse(
      {
        snapshotId,
        deviceId,
        commandId: commandId || null,
        filename,
        fileSize: buffer.length,
        createdAt: timestamp,
        expiresAt: metadata.expiresAt,
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[/api/snapshots/upload] POST error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to upload snapshot",
      500
    );
  }
}
