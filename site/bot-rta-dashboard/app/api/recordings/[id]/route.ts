import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { errorResponse } from "@/lib/utils/api-utils";
import {
  getRecordingMetadata,
  deleteRecordingMetadata,
} from "../upload/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const recordingId = id;

    if (!recordingId) {
      return errorResponse("Recording ID is required", 400);
    }

    // Get metadata
    const metadata = getRecordingMetadata(recordingId);
    if (!metadata) {
      return errorResponse("Recording not found", 404);
    }

    // Check if expired
    if (Date.now() > metadata.expiresAt) {
      // Clean up expired recording
      try {
        if (existsSync(metadata.filePath)) {
          const { unlink } = await import("fs/promises");
          await unlink(metadata.filePath);
        }
        deleteRecordingMetadata(recordingId);
      } catch (e) {
        // Ignore cleanup errors
      }
      return errorResponse("Recording has expired", 404);
    }

    // Check if file exists
    if (!existsSync(metadata.filePath)) {
      return errorResponse("Recording file not found", 404);
    }

    // Read and stream file
    const fileBuffer = await readFile(metadata.filePath);

    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": fileBuffer.length.toString(),
        "Content-Disposition": `inline; filename="${metadata.filename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[/api/recordings/[id]] GET error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to retrieve recording",
      500
    );
  }
}

