import { NextRequest } from "next/server";
import {
  errorResponse,
  parseJsonBody,
  successResponse,
} from "@/lib/utils/api-utils";
import {
  getSessionHeader,
  listManagedUsers,
  removeManagedUser,
  upsertManagedUser,
  validateAdminSession,
} from "@/lib/utils/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureAdmin(request: NextRequest) {
  const sessionId = getSessionHeader(request);
  const validation = validateAdminSession(sessionId);
  if (!validation.valid) {
    return {
      ok: false as const,
      response: errorResponse(validation.error || "Unauthorized", 401),
    };
  }
  return { ok: true as const };
}

export async function GET(request: NextRequest) {
  const admin = await ensureAdmin(request);
  if (!admin.ok) return admin.response;

  return successResponse({
    users: listManagedUsers(),
  });
}

export async function POST(request: NextRequest) {
  const admin = await ensureAdmin(request);
  if (!admin.ok) return admin.response;

  const parsed = await parseJsonBody<{ username?: string; password?: string }>(
    request
  );
  if (!parsed.success) {
    return errorResponse(parsed.error, 400);
  }

  const { username, password } = parsed.data;
  const result = upsertManagedUser(username || "", password || "");
  if (!result.success) {
    return errorResponse(result.error || "Failed to update user", 400);
  }

  return successResponse({
    action: result.action,
    users: listManagedUsers(),
  });
}

export async function DELETE(request: NextRequest) {
  const admin = await ensureAdmin(request);
  if (!admin.ok) return admin.response;

  const parsed = await parseJsonBody<{ username?: string }>(request);
  if (!parsed.success) {
    return errorResponse(parsed.error, 400);
  }

  const result = removeManagedUser(parsed.data.username || "");
  if (!result.success) {
    return errorResponse(result.error || "Failed to remove user", 400);
  }

  return successResponse({
    removed: true,
    users: listManagedUsers(),
  });
}

