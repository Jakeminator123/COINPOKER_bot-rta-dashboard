import { NextRequest } from "next/server";
import {
  errorResponse,
  successResponse,
} from "@/lib/utils/api-utils";
import { getAllRecordingsFromRedis, RecordingMetadata } from "../../recordings/upload/route";
import { getAllSnapshotsFromRedis, SnapshotMetadata } from "../../snapshots/upload/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MediaItem {
  id: string;
  type: "recording" | "snapshot";
  deviceId: string;
  commandId: string;
  filename: string;
  fileSize: number;
  createdAt: number;
  expiresAt: number;
  url: string;
  // Recording-specific
  duration?: number;
  // Snapshot-specific
  windowTitle?: string;
  windowType?: string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const deviceId = searchParams.get("deviceId");
    const type = searchParams.get("type"); // "recording", "snapshot", or undefined for all
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    if (!deviceId) {
      return errorResponse("deviceId query parameter is required", 400);
    }

    const mediaItems: MediaItem[] = [];
    const now = Date.now();

    // Get recordings if not filtered to snapshots only
    if (!type || type === "recording") {
      const recordings = await getAllRecordingsFromRedis(deviceId);
      for (const rec of recordings) {
        if (rec.expiresAt > now) {
          mediaItems.push({
            id: rec.recordingId,
            type: "recording",
            deviceId: rec.deviceId,
            commandId: rec.commandId,
            filename: rec.filename,
            fileSize: rec.fileSize,
            createdAt: rec.createdAt,
            expiresAt: rec.expiresAt,
            url: `/api/recordings/${rec.recordingId}?deviceId=${deviceId}`,
            duration: rec.duration,
          });
        }
      }
    }

    // Get snapshots if not filtered to recordings only
    if (!type || type === "snapshot") {
      const snapshots = await getAllSnapshotsFromRedis(deviceId);
      for (const snap of snapshots) {
        if (snap.expiresAt > now) {
          mediaItems.push({
            id: snap.snapshotId,
            type: "snapshot",
            deviceId: snap.deviceId,
            commandId: snap.commandId,
            filename: snap.filename,
            fileSize: snap.fileSize,
            createdAt: snap.createdAt,
            expiresAt: snap.expiresAt,
            url: `/api/snapshots/${snap.snapshotId}?deviceId=${deviceId}`,
            windowTitle: snap.windowTitle,
            windowType: snap.windowType,
          });
        }
      }
    }

    // Sort by creation date (newest first)
    mediaItems.sort((a, b) => b.createdAt - a.createdAt);

    // Apply limit
    const limitedItems = mediaItems.slice(0, limit);

    // Calculate totals
    const recordingCount = mediaItems.filter(m => m.type === "recording").length;
    const snapshotCount = mediaItems.filter(m => m.type === "snapshot").length;
    const totalSize = mediaItems.reduce((sum, m) => sum + m.fileSize, 0);

    return successResponse(
      {
        deviceId,
        media: limitedItems,
        count: limitedItems.length,
        total: mediaItems.length,
        recordings: recordingCount,
        snapshots: snapshotCount,
        totalSizeBytes: totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[/api/player/media] GET error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to list media",
      500
    );
  }
}
