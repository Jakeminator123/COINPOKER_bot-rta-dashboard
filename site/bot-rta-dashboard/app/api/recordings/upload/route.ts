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
import { redisTtl } from "@/lib/redis/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
// Use environment variable for Render Disk, fallback to local recordings folder
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || join(process.cwd(), "recordings");
const RETENTION_DAYS = Number(process.env.MEDIA_RETENTION_DAYS) || 30; // 30 days default for media
const TTL_SECONDS = redisTtl.batchSeconds(RETENTION_DAYS * 24 * 60 * 60);

export interface RecordingMetadata {
  recordingId: string;
  deviceId: string;
  commandId: string;
  filename: string;
  filePath: string;
  duration: number;
  fileSize: number;
  createdAt: number;
  expiresAt: number;
  type: "recording";
}

// Redis keys for media storage
const REDIS_KEYS = {
  recording: (deviceId: string, recordingId: string) => `media:${deviceId}:recording:${recordingId}`,
  recordingIndex: (deviceId: string) => `media:${deviceId}:recordings`,
  snapshot: (deviceId: string, snapshotId: string) => `media:${deviceId}:snapshot:${snapshotId}`,
  snapshotIndex: (deviceId: string) => `media:${deviceId}:snapshots`,
};

function generateRecordingId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function getExpiresAt(): number {
  return Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

// Redis-backed storage functions
async function saveRecordingMetadata(metadata: RecordingMetadata): Promise<void> {
  try {
    const redis = await getRedisClient();
    if (!redis) return;
    
    const key = REDIS_KEYS.recording(metadata.deviceId, metadata.recordingId);
    const indexKey = REDIS_KEYS.recordingIndex(metadata.deviceId);
    
    // Store metadata
    await redis.set(key, JSON.stringify(metadata), { EX: TTL_SECONDS });
    
    // Add to device's recording index (sorted by createdAt)
    await redis.zAdd(indexKey, { score: metadata.createdAt, value: metadata.recordingId });
    await redis.expire(indexKey, TTL_SECONDS);
    
    console.log(`[Recordings] Saved metadata to Redis: ${key}`);
  } catch (error) {
    console.error("[Recordings] Failed to save to Redis:", error);
  }
}

export async function getRecordingMetadataFromRedis(deviceId: string, recordingId: string): Promise<RecordingMetadata | null> {
  try {
    const redis = await getRedisClient();
    if (!redis) return null;
    
    const key = REDIS_KEYS.recording(deviceId, recordingId);
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("[Recordings] Failed to get from Redis:", error);
    return null;
  }
}

export async function getAllRecordingsFromRedis(deviceId: string): Promise<RecordingMetadata[]> {
  try {
    const redis = await getRedisClient();
    if (!redis) return [];
    
    const indexKey = REDIS_KEYS.recordingIndex(deviceId);
    const recordingIds = await redis.zRange(indexKey, 0, -1, { REV: true }); // Newest first
    
    const recordings: RecordingMetadata[] = [];
    for (const recordingId of recordingIds) {
      const key = REDIS_KEYS.recording(deviceId, recordingId);
      const data = await redis.get(key);
      if (data) {
        recordings.push(JSON.parse(data));
      }
    }
    
    return recordings;
  } catch (error) {
    console.error("[Recordings] Failed to list from Redis:", error);
    return [];
  }
}

export async function deleteRecordingFromRedis(deviceId: string, recordingId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    if (!redis) return false;
    
    const key = REDIS_KEYS.recording(deviceId, recordingId);
    const indexKey = REDIS_KEYS.recordingIndex(deviceId);
    
    await redis.del(key);
    await redis.zRem(indexKey, recordingId);
    
    console.log(`[Recordings] Deleted from Redis: ${key}`);
    return true;
  } catch (error) {
    console.error("[Recordings] Failed to delete from Redis:", error);
    return false;
  }
}

// Export Redis keys for use in snapshot routes
export { REDIS_KEYS, TTL_SECONDS, RECORDINGS_DIR };

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

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const deviceId = formData.get("deviceId") as string | null;
    const commandId = formData.get("commandId") as string | null;

    if (!file) {
      return errorResponse("File is required", 400);
    }

    if (!deviceId || typeof deviceId !== "string") {
      return errorResponse("deviceId is required", 400);
    }

    if (!commandId || typeof commandId !== "string") {
      return errorResponse("commandId is required", 400);
    }

    // Validate file type
    if (!file.type.includes("mp4") && !file.name.endsWith(".mp4")) {
      return errorResponse("Only MP4 files are allowed", 400);
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return errorResponse(
        `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        400
      );
    }

    // Generate recording ID and filename
    const recordingId = generateRecordingId();
    const timestamp = Date.now();
    const filename = `${timestamp}_${commandId}.mp4`;

    // Create device-specific directory
    const deviceDir = join(RECORDINGS_DIR, deviceId);
    await mkdir(deviceDir, { recursive: true });

    // Save file to disk
    const filePath = join(deviceDir, filename);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // Store metadata in Redis (persistent storage)
    const metadata: RecordingMetadata = {
      recordingId,
      deviceId,
      commandId,
      filename,
      filePath,
      duration: 0, // Could be extracted from video metadata if needed
      fileSize: file.size,
      createdAt: timestamp,
      expiresAt: getExpiresAt(),
      type: "recording",
    };

    await saveRecordingMetadata(metadata);

    console.log(
      `[Recordings] Uploaded recording ${recordingId} for device ${deviceId}, size: ${(file.size / 1024 / 1024).toFixed(2)}MB`
    );

    return successResponse(
      {
        recordingId,
        deviceId,
        commandId,
        filename,
        fileSize: file.size,
        createdAt: timestamp,
        expiresAt: metadata.expiresAt,
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[/api/recordings/upload] POST error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to upload recording",
      500
    );
  }
}

