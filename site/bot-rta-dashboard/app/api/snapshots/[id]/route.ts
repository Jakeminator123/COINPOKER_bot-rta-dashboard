import { NextRequest } from "next/server";
import { readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { errorResponse, successResponse } from "@/lib/utils/api-utils";
import {
  getSnapshotMetadataFromRedis,
  deleteSnapshotFromRedis,
} from "../upload/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const snapshotId = id;

    if (!snapshotId) {
      return errorResponse("Snapshot ID is required", 400);
    }

    // Get deviceId from query params (needed for Redis key)
    const { searchParams } = req.nextUrl;
    const deviceId = searchParams.get("deviceId");
    
    if (!deviceId) {
      return errorResponse("deviceId query parameter is required", 400);
    }

    // Get metadata from Redis
    const metadata = await getSnapshotMetadataFromRedis(deviceId, snapshotId);
    if (!metadata) {
      return errorResponse("Snapshot not found", 404);
    }

    // Check if expired
    if (Date.now() > metadata.expiresAt) {
      // Clean up expired snapshot
      try {
        if (existsSync(metadata.filePath)) {
          await unlink(metadata.filePath);
        }
        await deleteSnapshotFromRedis(deviceId, snapshotId);
      } catch (e) {
        // Ignore cleanup errors
      }
      return errorResponse("Snapshot has expired", 404);
    }

    // Check if file exists
    if (!existsSync(metadata.filePath)) {
      return errorResponse("Snapshot file not found", 404);
    }

    // Read and stream file
    const fileBuffer = await readFile(metadata.filePath);

    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": fileBuffer.length.toString(),
        "Content-Disposition": `inline; filename="${metadata.filename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[/api/snapshots/[id]] GET error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to retrieve snapshot",
      500
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const snapshotId = id;

    if (!snapshotId) {
      return errorResponse("Snapshot ID is required", 400);
    }

    // Get deviceId from query params
    const { searchParams } = req.nextUrl;
    const deviceId = searchParams.get("deviceId");
    
    if (!deviceId) {
      return errorResponse("deviceId query parameter is required", 400);
    }

    // Get metadata from Redis
    const metadata = await getSnapshotMetadataFromRedis(deviceId, snapshotId);
    if (!metadata) {
      return errorResponse("Snapshot not found", 404);
    }

    // Delete file from disk
    try {
      if (existsSync(metadata.filePath)) {
        await unlink(metadata.filePath);
        console.log(`[Snapshots] Deleted file: ${metadata.filePath}`);
      }
    } catch (fileError) {
      console.error(`[Snapshots] Failed to delete file: ${fileError}`);
    }

    // Delete metadata from Redis
    await deleteSnapshotFromRedis(deviceId, snapshotId);

    return successResponse(
      {
        deleted: true,
        snapshotId,
        deviceId,
      },
      200
    );
  } catch (error) {
    console.error("[/api/snapshots/[id]] DELETE error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to delete snapshot",
      500
    );
  }
}
