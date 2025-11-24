import { NextRequest } from "next/server";
import {
  corsOptions,
  errorResponse,
  parseJsonBody,
  successResponse,
} from "@/lib/utils/api-utils";
import { getRedisClient, redisKeys, redisTTL } from "@/lib/storage/redis-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMAND_REQUIRE_ADMIN: Record<string, boolean> = {
  kill_coinpoker: true,
  take_snapshot: false,
};

function normalizeCommand(command: string): string {
  return command.trim().toLowerCase();
}

export async function OPTIONS() {
  return corsOptions();
}

// POST: Queue a command to Redis for a device
export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody<{
      deviceId?: string;
      command?: string;
      payload?: unknown;
      requestedBy?: string;
    }>(req);

    if (!parsed.success) {
      return errorResponse(parsed.error, 400);
    }

    const { deviceId, command, payload, requestedBy } = parsed.data;

    if (!deviceId || typeof deviceId !== "string") {
      return errorResponse("deviceId is required", 400);
    }

    if (!command || typeof command !== "string") {
      return errorResponse("command is required", 400);
    }

    const normalized = normalizeCommand(command);
    const allowedCommands = new Set(Object.keys(COMMAND_REQUIRE_ADMIN));

    if (!allowedCommands.has(normalized)) {
      return errorResponse(`Unsupported command: ${command}`, 400);
    }

    const requireAdmin = COMMAND_REQUIRE_ADMIN[normalized] ?? false;

    // Get Redis client
    const redis = getRedisClient();
    if (!redis) {
      return errorResponse("Redis not available", 503);
    }

    // Create command object
    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const commandObj = {
      id: commandId,
      deviceId,
      command: normalized,
      payload,
      requireAdmin,
      requestedBy,
      requestedAt: Date.now(),
      status: "pending",
    };

    // Store command in Redis with TTL of 5 minutes
    const commandKey = redisKeys.deviceCommand(deviceId, commandId);
    await redis.set(commandKey, JSON.stringify(commandObj), { EX: redisTTL.command });

    // Add to device command queue (sorted set by timestamp)
    const queueKey = redisKeys.deviceCommandQueue(deviceId);
    await redis.zadd(queueKey, {
      [commandId]: Date.now(),
    });

    // Set TTL on queue
    await redis.expire(queueKey, redisTTL.command);

    console.log(`[Redis Commands] Queued command ${commandId} for device ${deviceId}`);

    return successResponse(
      {
        commandId,
        requireAdmin,
        queuedAt: commandObj.requestedAt,
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[/api/device-commands/redis] POST error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to queue command",
      500
    );
  }
}

// GET: Fetch command result from Redis
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const commandId = searchParams.get("id");
    const deviceId = searchParams.get("deviceId");

    if (!commandId || !deviceId) {
      return errorResponse("commandId and deviceId are required", 400);
    }

    // Get Redis client
    const redis = getRedisClient();
    if (!redis) {
      return errorResponse("Redis not available", 503);
    }

    // Check for command result
    const resultKey = redisKeys.deviceCommandResult(deviceId, commandId);
    const resultData = await redis.get(resultKey);

    if (!resultData) {
      // Check if command still exists (pending)
      const commandKey = redisKeys.deviceCommand(deviceId, commandId);
      const commandData = await redis.get(commandKey);
      
      if (!commandData) {
        return successResponse({
          status: "unknown",
          message: "Command not found or expired",
        });
      }

      return successResponse({
        status: "pending",
        message: "Command is still pending",
      });
    }

    const result = JSON.parse(resultData);
    return successResponse({
      status: "completed",
      result,
    });
  } catch (error) {
    console.error("[/api/device-commands/redis] GET error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch command result",
      500
    );
  }
}
