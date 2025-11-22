import { NextRequest } from "next/server";
import {
  corsOptions,
  errorResponse,
  parseJsonBody,
  successResponse,
  validateToken,
} from "@/lib/api-utils";
import { enqueueCommand, dequeueCommands } from "@/lib/device-command-store";

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

    const queued = enqueueCommand({
      deviceId,
      command: normalized,
      payload,
      requireAdmin,
      requestedBy,
    });

    return successResponse(
      {
        commandId: queued.id,
        requireAdmin,
        queuedAt: queued.requestedAt,
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[/api/device-commands] POST error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to queue command",
      500
    );
  }
}

export async function GET(req: NextRequest) {
  const signalToken = process.env.SIGNAL_TOKEN;
  const tokenValidation = validateToken(req, signalToken);
  if (!tokenValidation.valid) {
    return errorResponse(tokenValidation.error || "Unauthorized", 401);
  }

  try {
    const { searchParams } = req.nextUrl;
    const deviceId = searchParams.get("deviceId");
    const limitParam = searchParams.get("limit");
    const limit = limitParam
      ? Math.max(1, Math.min(10, Number(limitParam)))
      : 5;

    if (!deviceId) {
      return errorResponse("deviceId is required", 400);
    }

    const commands = dequeueCommands(deviceId, limit);

    return successResponse(
      {
        deviceId,
        commands,
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[/api/device-commands] GET error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch commands",
      500
    );
  }
}
