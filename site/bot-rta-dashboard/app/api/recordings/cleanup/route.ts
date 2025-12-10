import { NextRequest } from "next/server";
import { unlink } from "fs/promises";
import { existsSync } from "fs";
import {
  errorResponse,
  successResponse,
  validateToken,
} from "@/lib/utils/api-utils";
import { getAllRecordings, deleteRecordingMetadata } from "../upload/route";

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
    const allRecordings = getAllRecordings();
    let deletedCount = 0;
    let errorCount = 0;

    for (const recording of allRecordings) {
      if (recording.expiresAt <= now) {
        try {
          // Delete file if it exists
          if (existsSync(recording.filePath)) {
            await unlink(recording.filePath);
          }
          // Remove metadata
          deleteRecordingMetadata(recording.recordingId);
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

