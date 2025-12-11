import { NextRequest } from "next/server";
import {
  errorResponse,
  successResponse,
} from "@/lib/utils/api-utils";
import { getAllRecordingsFromRedis } from "./upload/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const deviceId = searchParams.get("deviceId");

    if (!deviceId) {
      return errorResponse("deviceId query parameter is required", 400);
    }

    // Get all recordings for device from Redis
    const recordings = await getAllRecordingsFromRedis(deviceId);

    // Filter out expired recordings
    const now = Date.now();
    const activeRecordings = recordings.filter((r) => r.expiresAt > now);

    // Sort by creation date (newest first) - already sorted from Redis but ensure it
    activeRecordings.sort((a, b) => b.createdAt - a.createdAt);

    // Format response
    const formatted = activeRecordings.map((r) => ({
      recordingId: r.recordingId,
      deviceId: r.deviceId,
      commandId: r.commandId,
      filename: r.filename,
      fileSize: r.fileSize,
      duration: r.duration,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      url: `/api/recordings/${r.recordingId}`,
      type: "recording",
    }));

    return successResponse(
      {
        deviceId,
        recordings: formatted,
        count: formatted.length,
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[/api/recordings] GET error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to list recordings",
      500
    );
  }
}

