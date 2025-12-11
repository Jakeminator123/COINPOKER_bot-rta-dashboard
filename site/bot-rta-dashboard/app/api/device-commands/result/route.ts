import { NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import {
  corsOptions,
  errorResponse,
  parseJsonBody,
  successResponse,
  validateToken,
} from "@/lib/utils/api-utils";
import {
  consumeCommandResult,
  isCommandPending,
  saveCommandResult,
} from "@/lib/device/device-command-store";
import { getRedisClient } from "@/lib/redis/redis-client";
import { redisTtl } from "@/lib/redis/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNAPSHOTS_DIR = process.env.SNAPSHOTS_DIR || join(process.cwd(), "snapshots");
const RETENTION_DAYS = Number(process.env.MEDIA_RETENTION_DAYS) || 30;
const TTL_SECONDS = redisTtl.batchSeconds(RETENTION_DAYS * 24 * 60 * 60);

// Redis keys for snapshots
const snapshotKey = (deviceId: string, snapshotId: string) => `media:${deviceId}:snapshot:${snapshotId}`;
const snapshotIndexKey = (deviceId: string) => `media:${deviceId}:snapshots`;

interface SnapshotData {
  hwnd?: number;
  pid?: number;
  title?: string;
  screenshot?: string;
  screenshot_format?: string;
  width?: number;
  height?: number;
  rect?: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  error?: string;
}

interface SnapshotOutput {
  success?: boolean;
  tables?: SnapshotData[];
  lobby?: SnapshotData | null;
  count?: number;
  error?: string;
}

async function saveSnapshotToPersistentStorage(
  deviceId: string,
  commandId: string,
  snapshotData: SnapshotData,
  windowType: "table" | "lobby"
): Promise<void> {
  if (!snapshotData.screenshot) return;
  
  try {
    const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = Date.now();
    const filename = `${timestamp}_${windowType}_${commandId}.png`;
    
    // Create device-specific directory
    const deviceDir = join(SNAPSHOTS_DIR, deviceId);
    await mkdir(deviceDir, { recursive: true });
    
    // Decode base64 and save file
    const base64Data = snapshotData.screenshot.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    
    const filePath = join(deviceDir, filename);
    await writeFile(filePath, buffer);
    
    // Store metadata in Redis
    const metadata = {
      snapshotId,
      deviceId,
      commandId,
      filename,
      filePath,
      fileSize: buffer.length,
      createdAt: timestamp,
      expiresAt: timestamp + RETENTION_DAYS * 24 * 60 * 60 * 1000,
      type: "snapshot",
      windowTitle: snapshotData.title || undefined,
      windowType,
    };
    
    const redis = await getRedisClient();
    if (redis) {
      await redis.set(snapshotKey(deviceId, snapshotId), JSON.stringify(metadata), { EX: TTL_SECONDS });
      await redis.zAdd(snapshotIndexKey(deviceId), { score: timestamp, value: snapshotId });
      await redis.expire(snapshotIndexKey(deviceId), TTL_SECONDS);
    }
    
    console.log(`[Snapshots] Saved ${windowType} snapshot ${snapshotId} for device ${deviceId}`);
  } catch (error) {
    console.error(`[Snapshots] Failed to save ${windowType} snapshot:`, error);
  }
}

export async function OPTIONS() {
  return corsOptions();
}

export async function POST(req: NextRequest) {
  const signalToken = process.env.SIGNAL_TOKEN;
  const tokenValidation = validateToken(req, signalToken);
  if (!tokenValidation.valid) {
    return errorResponse(tokenValidation.error || "Unauthorized", 401);
  }

  try {
    const parsed = await parseJsonBody<{
      commandId?: string;
      deviceId?: string;
      command?: string;
      success?: boolean;
      output?: unknown;
      error?: string;
      adminRequired?: boolean;
      requireAdmin?: boolean;
    }>(req);

    if (!parsed.success) {
      return errorResponse(parsed.error, 400);
    }

    const {
      commandId,
      deviceId,
      command,
      success,
      output,
      error,
      adminRequired,
      requireAdmin,
    } = parsed.data;

    if (!commandId || typeof commandId !== "string") {
      return errorResponse("commandId is required", 400);
    }
    if (!deviceId || typeof deviceId !== "string") {
      return errorResponse("deviceId is required", 400);
    }
    if (!command || typeof command !== "string") {
      return errorResponse("command is required", 400);
    }
    if (typeof success !== "boolean") {
      return errorResponse("success must be boolean", 400);
    }

    // Save snapshots to persistent storage if this is a take_snapshot command
    if (command === "take_snapshot" && success && output) {
      const snapshotOutput = output as SnapshotOutput;
      
      // Save lobby snapshot
      if (snapshotOutput.lobby?.screenshot) {
        await saveSnapshotToPersistentStorage(deviceId, commandId, snapshotOutput.lobby, "lobby");
      }
      
      // Save table snapshots
      if (snapshotOutput.tables && Array.isArray(snapshotOutput.tables)) {
        for (const table of snapshotOutput.tables) {
          if (table.screenshot) {
            await saveSnapshotToPersistentStorage(deviceId, commandId, table, "table");
          }
        }
      }
    }

    saveCommandResult({
      id: commandId,
      deviceId,
      command,
      success,
      output,
      error,
      adminRequired,
      requireAdmin,
      executedAt: Date.now(),
    });

    return successResponse({ stored: true }, 200, { cache: "no-store" });
  } catch (error) {
    console.error("[/api/device-commands/result] POST error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to store command result",
      500
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const commandId = searchParams.get("id");

    if (!commandId) {
      return errorResponse("id query parameter is required", 400);
    }

    const result = consumeCommandResult(commandId);

    if (result) {
      return successResponse(
        {
          status: "completed",
          result,
        },
        200,
        { cache: "no-store" }
      );
    }

    if (isCommandPending(commandId)) {
      return successResponse(
        {
          status: "pending",
        },
        200,
        { cache: "no-store" }
      );
    }

    return successResponse(
      {
        status: "unknown",
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[/api/device-commands/result] GET error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch command result",
      500
    );
  }
}
