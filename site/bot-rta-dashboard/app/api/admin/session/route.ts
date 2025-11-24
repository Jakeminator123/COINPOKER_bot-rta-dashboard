import { NextRequest } from "next/server";
import {
  errorResponse,
  parseJsonBody,
  successResponse,
} from "@/lib/utils/api-utils";
import {
  createAdminSession,
  getSessionHeader,
  getSessionTTL,
  invalidateAdminSession,
  validateAdminSession,
} from "@/lib/utils/admin-session";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin-secret-2024";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractSessionId(request: NextRequest): string | undefined {
  return getSessionHeader(request);
}

export async function GET(request: NextRequest) {
  const sessionId = extractSessionId(request);
  if (!sessionId) {
    return successResponse({ isAdmin: false });
  }

  const validation = validateAdminSession(sessionId);
  if (!validation.valid) {
    return successResponse({
      isAdmin: false,
      error: validation.error,
    });
  }

  return successResponse({
    isAdmin: true,
    sessionId,
    issuedAt: validation.session!.createdAt,
    ttlMs: getSessionTTL(),
  });
}

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody<{ token?: string }>(request);
  if (!parsed.success) {
    return errorResponse(parsed.error, 400);
  }

  const { token } = parsed.data;
  if (!token) {
    return errorResponse("Admin token is required", 400);
  }

  if (token !== ADMIN_TOKEN) {
    return errorResponse("Invalid admin token", 401);
  }

  const session = createAdminSession();
  return successResponse({
    isAdmin: true,
    sessionId: session.id,
    issuedAt: session.createdAt,
    ttlMs: getSessionTTL(),
  });
}

export async function DELETE(request: NextRequest) {
  const sessionId = extractSessionId(request);
  if (sessionId) {
    invalidateAdminSession(sessionId);
  }
  return successResponse({
    isAdmin: false,
    sessionCleared: Boolean(sessionId),
  });
}

