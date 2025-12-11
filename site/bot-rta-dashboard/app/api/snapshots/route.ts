import { NextRequest } from "next/server";
import {
  errorResponse,
  successResponse,
} from "@/lib/utils/api-utils";
import { getAllSnapshotsFromRedis } from "./upload/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const deviceId = searchParams.get("deviceId");

    if (!deviceId) {
      return errorResponse("deviceId query parameter is required", 400);
    }

    // Get all snapshots for device from Redis
    const snapshots = await getAllSnapshotsFromRedis(deviceId);

    // Filter out expired snapshots
    const now = Date.now();
    const activeSnapshots = snapshots.filter((s) => s.expiresAt > now);

    // Sort by creation date (newest first) - already sorted from Redis but ensure it
    activeSnapshots.sort((a, b) => b.createdAt - a.createdAt);

    // Format response
    const formatted = activeSnapshots.map((s) => ({
      snapshotId: s.snapshotId,
      deviceId: s.deviceId,
      commandId: s.commandId,
      filename: s.filename,
      fileSize: s.fileSize,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      windowTitle: s.windowTitle,
      windowType: s.windowType,
      url: `/api/snapshots/${s.snapshotId}?deviceId=${deviceId}`,
      type: "snapshot",
    }));

    return successResponse(
      {
        deviceId,
        snapshots: formatted,
        count: formatted.length,
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[/api/snapshots] GET error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to list snapshots",
      500
    );
  }
}
