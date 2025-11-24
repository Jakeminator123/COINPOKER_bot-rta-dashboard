import crypto from "crypto";

type AdminSessionRecord = {
  id: string;
  createdAt: number;
  lastSeen: number;
};

type ManagedUserRecord = {
  username: string;
  password: string;
  createdAt: number;
  updatedAt: number;
};

const SESSION_TTL_MS = 1000 * 60 * 30; // 30 minutes

const adminState: {
  sessions: Map<string, AdminSessionRecord>;
  users: Map<string, ManagedUserRecord>;
} = {
  sessions: new Map(),
  users: new Map(),
};

function ensureDefaultUser() {
  const defaultUsername = (process.env.ADMIN_USER || "admin").trim();
  const defaultPassword = process.env.ADMIN_PASS || "admin";
  if (!defaultUsername) {
    return;
  }
  const key = defaultUsername.toLowerCase();
  if (!adminState.users.has(key)) {
    const now = Date.now();
    adminState.users.set(key, {
      username: defaultUsername,
      password: defaultPassword,
      createdAt: now,
      updatedAt: now,
    });
  }
}

ensureDefaultUser();

function normalizeUsername(username: string): { key: string; label: string } | null {
  if (!username) return null;
  const trimmed = username.trim();
  if (!trimmed) return null;
  return { key: trimmed.toLowerCase(), label: trimmed };
}

function randomSessionId(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function createAdminSession(): AdminSessionRecord {
  const now = Date.now();
  const session: AdminSessionRecord = {
    id: randomSessionId(),
    createdAt: now,
    lastSeen: now,
  };
  adminState.sessions.set(session.id, session);
  return session;
}

export function validateAdminSession(sessionId?: string): {
  valid: boolean;
  session?: AdminSessionRecord;
  error?: string;
} {
  if (!sessionId) {
    return { valid: false, error: "Missing admin session" };
  }
  const session = adminState.sessions.get(sessionId);
  if (!session) {
    return { valid: false, error: "Unknown admin session" };
  }
  const now = Date.now();
  if (now - session.lastSeen >= SESSION_TTL_MS) {
    adminState.sessions.delete(sessionId);
    return { valid: false, error: "Admin session expired" };
  }
  session.lastSeen = now;
  adminState.sessions.set(sessionId, session);
  return { valid: true, session };
}

export function invalidateAdminSession(sessionId?: string) {
  if (!sessionId) return;
  adminState.sessions.delete(sessionId);
}

export function listManagedUsers(): Array<{
  username: string;
  createdAt: number;
  updatedAt: number;
}> {
  ensureDefaultUser();
  return Array.from(adminState.users.values())
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(({ username, createdAt, updatedAt }) => ({
      username,
      createdAt,
      updatedAt,
    }));
}

export function upsertManagedUser(username: string, password: string): {
  success: boolean;
  error?: string;
  action?: "created" | "updated";
} {
  ensureDefaultUser();
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return { success: false, error: "Username is required" };
  }
  if (!password || !password.trim()) {
    return { success: false, error: "Password is required" };
  }
  const now = Date.now();
  const existing = adminState.users.get(normalized.key);
  if (existing) {
    adminState.users.set(normalized.key, {
      ...existing,
      username: normalized.label,
      password: password.trim(),
      updatedAt: now,
    });
    return { success: true, action: "updated" };
  }
  adminState.users.set(normalized.key, {
    username: normalized.label,
    password: password.trim(),
    createdAt: now,
    updatedAt: now,
  });
  return { success: true, action: "created" };
}

export function removeManagedUser(username: string): {
  success: boolean;
  error?: string;
} {
  ensureDefaultUser();
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return { success: false, error: "Username is required" };
  }
  if (!adminState.users.has(normalized.key)) {
    return { success: false, error: "User not found" };
  }
  if (adminState.users.size <= 1) {
    return { success: false, error: "At least one admin user must remain" };
  }
  adminState.users.delete(normalized.key);
  return { success: true };
}

export function verifyManagedCredentials(username?: string, password?: string): boolean {
  ensureDefaultUser();
  if (!username || !password) return false;
  const normalized = normalizeUsername(username);
  if (!normalized) return false;
  const record = adminState.users.get(normalized.key);
  if (!record) return false;
  return record.password === password;
}

export function getSessionHeader(request: Request): string | undefined {
  return request.headers.get("x-admin-session") || undefined;
}

export function getSessionTTL(): number {
  return SESSION_TTL_MS;
}

