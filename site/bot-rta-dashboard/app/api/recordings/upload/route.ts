import { NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import {
  corsOptions,
  errorResponse,
  successResponse,
  validateToken,
} from "@/lib/utils/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const RECORDINGS_DIR = join(process.cwd(), "recordings");
const RETENTION_DAYS = 7;

interface RecordingMetadata {
  recordingId: string;
  deviceId: string;
  commandId: string;
  filename: string;
  filePath: string;
  duration: number;
  fileSize: number;
  createdAt: number;
  expiresAt: number;
}

// In-memory storage for recording metadata (could be moved to Redis/DB later)
const recordingsMetadata = new Map<string, RecordingMetadata>();

function generateRecordingId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function getExpiresAt(): number {
  return Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000;
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

    // Save file
    const filePath = join(deviceDir, filename);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // Store metadata
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
    };

    recordingsMetadata.set(recordingId, metadata);

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

// Export metadata map for use in other endpoints
export function getRecordingMetadata(recordingId: string): RecordingMetadata | null {
  return recordingsMetadata.get(recordingId) || null;
}

export function getAllRecordings(deviceId?: string): RecordingMetadata[] {
  const all = Array.from(recordingsMetadata.values());
  if (deviceId) {
    return all.filter((r) => r.deviceId === deviceId);
  }
  return all;
}

export function deleteRecordingMetadata(recordingId: string): void {
  recordingsMetadata.delete(recordingId);
}

