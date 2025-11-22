import { NextRequest } from "next/server";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
