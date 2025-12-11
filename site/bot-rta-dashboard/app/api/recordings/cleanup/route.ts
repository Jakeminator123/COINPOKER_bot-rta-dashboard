import { NextRequest } from "next/server";
import { unlink } from "fs/promises";
import { existsSync } from "fs";
import {
  errorResponse,
  successResponse,
  validateToken,
} from "@/lib/utils/api-utils";
import { getAllRecordingsFromRedis, deleteRecordingFromRedis } from "../upload/route";
import { getRedisClient } from "@/lib/redis/redis-client";
import { redisKeys } from "@/lib/redis/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Optional: Require authentication for cleanup endpoint
    const signalToken = process.env.SIGNAL_TOKEN;
    if (signalToken) {
      const tokenValidation = validateToken(req, signalToken);
      if (!tokenValidation.valid) {
        return errorResponse(tokenValidation.error || "Unauthorized", 401);
      }
    }

    const now = Date.now();
    let deletedCount = 0;
    let errorCount = 0;

    // Get all devices from Redis device index
    const redis = await getRedisClient();
    if (!redis) {
      return errorResponse("Redis not available", 500);
    }

    const deviceIndex = redisKeys.deviceIndex();
    const deviceIds = await redis.zRange(deviceIndex, 0, -1);

    // Iterate over all devices and check their recordings
    for (const deviceId of deviceIds) {
      try {
        const recordings = await getAllRecordingsFromRedis(deviceId);
        
        for (const recording of recordings) {
          if (recording.expiresAt <= now) {
            try {
              // Delete file if it exists
              if (existsSync(recording.filePath)) {
                await unlink(recording.filePath);
              }
              // Remove metadata from Redis
              await deleteRecordingFromRedis(deviceId, recording.recordingId);
              deletedCount++;
            } catch (error) {
              console.error(
                `[Cleanup] Failed to delete recording ${recording.recordingId}:`,
                error
              );
              errorCount++;
            }
          }
        }
      } catch (error) {
        console.error(`[Cleanup] Failed to process device ${deviceId}:`, error);
        errorCount++;
      }
    }

    console.log(
      `[Cleanup] Deleted ${deletedCount} expired recordings, ${errorCount} errors`
    );

    return successResponse(
      {
        deletedCount,
        errorCount,
        timestamp: now,
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[/api/recordings/cleanup] POST error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to cleanup recordings",
      500
    );
  }
}

