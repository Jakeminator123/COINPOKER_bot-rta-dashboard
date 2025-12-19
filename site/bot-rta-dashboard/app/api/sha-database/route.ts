import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  successResponse,
  errorResponse,
  validateToken,
  requireAuth,
} from "@/lib/utils/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHA_DB_FILE = path.join(process.cwd(), "configs", "sha_database.json");

interface SHAEntry {
  sha256: string;
  program_name: string;
  points: 0 | 5 | 10 | 15;
  comment?: string;
  first_seen?: number;
  last_seen?: number;
  source?: "signal" | "admin";
}

interface SHADatabase {
  programs: Record<
    string,
    | string
    | {
        program_name: string;
        points?: number;
        comment?: string;
        first_seen?: number;
        last_seen?: number;
        source?: "signal" | "admin";
      }
  >; // sha256 -> entry (v1 was string, v2 is object)
  _meta: {
    version: string;
    last_updated: number;
    total_entries?: number;
  };
}

function normalizePoints(value: unknown, fallback: 0 | 5 | 10 | 15 = 0): 0 | 5 | 10 | 15 {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (n === 0 || n === 5 || n === 10 || n === 15) return n;
  return fallback;
}

// Helper function to calculate similarity between two strings (Levenshtein distance)
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 1.0;
  
  const distance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
  return (longer.length - distance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[str2.length][str1.length];
}

// Initialize database file if it doesn't exist
async function ensureDatabase(): Promise<SHADatabase> {
  try {
    const data = await fs.readFile(SHA_DB_FILE, "utf-8");
    const parsed = JSON.parse(data);
    
    // Migrate old structure (entries) to new structure (programs)
    if (parsed.entries && !parsed.programs) {
      const migrated: SHADatabase = {
        programs: {},
        _meta: parsed._meta || {
          version: "1.0",
          last_updated: Date.now(),
        },
      };
      
      // Convert entries to programs format
      for (const [sha256, entry] of Object.entries(parsed.entries)) {
        const entryObj = entry as any;
        migrated.programs[sha256.toLowerCase()] = entryObj.program_name || entryObj.name || sha256;
      }
      
      // Save migrated structure
      await fs.writeFile(SHA_DB_FILE, JSON.stringify(migrated, null, 2));
      return migrated;
    }
    
    // Ensure programs exists (backward compatibility)
    if (!parsed.programs) {
      parsed.programs = {};
    }

    // Migrate v1 string values -> v2 objects (non-destructive)
    let migratedAny = false;
    const now = Date.now();
    for (const [sha256, v] of Object.entries(parsed.programs as Record<string, any>)) {
      if (typeof v === "string") {
        parsed.programs[sha256] = {
          program_name: v,
          points: 0,
          comment: "Auto-captured from scanner signals (unclassified)",
          first_seen: now,
          last_seen: now,
          source: "signal",
        };
        migratedAny = true;
      } else if (v && typeof v === "object") {
        // Normalize shape
        parsed.programs[sha256] = {
          program_name: String(v.program_name || v.name || sha256),
          points: normalizePoints(v.points, 0),
          comment: v.comment ? String(v.comment) : "",
          first_seen: typeof v.first_seen === "number" ? v.first_seen : undefined,
          last_seen: typeof v.last_seen === "number" ? v.last_seen : undefined,
          source: v.source === "admin" ? "admin" : "signal",
        };
      }
    }

    if (!parsed._meta) {
      parsed._meta = { version: "2.0", last_updated: now };
      migratedAny = true;
    }
    if (!parsed._meta.version) {
      parsed._meta.version = "2.0";
      migratedAny = true;
    }
    if (typeof parsed._meta.last_updated !== "number") {
      parsed._meta.last_updated = now;
      migratedAny = true;
    }
    parsed._meta.total_entries = Object.keys(parsed.programs).length;

    if (migratedAny) {
      await fs.writeFile(SHA_DB_FILE, JSON.stringify(parsed, null, 2));
    }

    return parsed as SHADatabase;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      // File doesn't exist, create it
      const initial: SHADatabase = {
        programs: {},
        _meta: {
          version: "2.0",
          last_updated: Date.now(),
          total_entries: 0,
        },
      };
      await fs.mkdir(path.dirname(SHA_DB_FILE), { recursive: true });
      await fs.writeFile(SHA_DB_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    throw error;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// GET: Retrieve all SHA entries with optional fuzzy matching
export async function GET(req: NextRequest) {
  try {
    const db = await ensureDatabase();
    const { searchParams } = new URL(req.url);
    const searchTerm = searchParams.get("search") || "";
    const similarityThreshold = parseFloat(searchParams.get("similarity") || "0.9"); // Default 90%
    
    // Convert to array format for easier frontend handling
    let entries: SHAEntry[] = Object.entries(db.programs).map(([sha256, raw]) => {
      if (typeof raw === "string") {
        return { sha256, program_name: raw, points: 0 };
      }
      const obj: any = raw || {};
      return {
        sha256,
        program_name: String(obj.program_name || obj.name || sha256),
        points: normalizePoints(obj.points, 0),
        comment: obj.comment ? String(obj.comment) : "",
        first_seen: typeof obj.first_seen === "number" ? obj.first_seen : undefined,
        last_seen: typeof obj.last_seen === "number" ? obj.last_seen : undefined,
        source: obj.source === "admin" ? "admin" : "signal",
      };
    });
    
    // Apply fuzzy matching if search term provided
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const results: Array<{ entry: SHAEntry; similarity: number }> = [];
      
      for (const entry of entries) {
        // Exact match in SHA256
        if (entry.sha256.toLowerCase().includes(searchLower)) {
          results.push({ entry, similarity: 1.0 });
          continue;
        }
        
        // Exact match in program name
        if (entry.program_name.toLowerCase().includes(searchLower)) {
          results.push({ entry, similarity: 1.0 });
          continue;
        }
        
        // Fuzzy match on program name
        const nameSimilarity = calculateSimilarity(entry.program_name, searchTerm);
        if (nameSimilarity >= similarityThreshold) {
          results.push({ entry, similarity: nameSimilarity });
          continue;
        }
        
        // Fuzzy match on SHA256 (compare character by character similarity)
        // For hashes, we compare prefix similarity (first N characters)
        const hashPrefix = entry.sha256.substring(0, Math.min(searchTerm.length, entry.sha256.length));
        const hashSimilarity = calculateSimilarity(hashPrefix, searchTerm);
        if (hashSimilarity >= similarityThreshold) {
          results.push({ entry, similarity: hashSimilarity });
        }
      }
      
      // Sort by similarity (highest first), then by name
      entries = results
        .sort((a, b) => {
          if (Math.abs(a.similarity - b.similarity) > 0.01) {
            return b.similarity - a.similarity;
          }
          return a.entry.program_name.localeCompare(b.entry.program_name);
        })
        .map((r) => r.entry);
    } else {
      // No search term, just sort by name
      entries = entries.sort((a, b) => a.program_name.localeCompare(b.program_name));
    }
    
    return successResponse({
      entries,
      meta: db._meta,
      searchApplied: !!searchTerm,
      similarityThreshold: searchTerm ? similarityThreshold : undefined,
    });
  } catch (error: any) {
    console.error("[/api/sha-database] GET error:", error);
    return errorResponse(error.message || "Failed to load SHA database", 500);
  }
}

// POST: Add or update SHA entry
export async function POST(req: NextRequest) {
  try {
    // Allow both scanner token and NextAuth session (admin UI)
    const tokenValidation = validateToken(req, process.env.SIGNAL_TOKEN);
    if (!tokenValidation.valid) {
      const auth = await requireAuth();
      if (!auth.authenticated) {
        return auth.response;
      }
    }

    const body = await req.json();
    const { sha256, program_name, points, comment, source } = body;

    if (!sha256 || !program_name) {
      return errorResponse("sha256 and program_name are required", 400);
    }

    const db = await ensureDatabase();
    const normalizedSha = sha256.toLowerCase();
    const now = Date.now();

    // Merge: do NOT overwrite admin classification unless explicitly provided.
    const existingRaw = db.programs[normalizedSha];
    const existing =
      typeof existingRaw === "string"
        ? { program_name: existingRaw, points: 0, comment: "" }
        : (existingRaw as any) || { program_name, points: 0, comment: "" };

    const nextPoints =
      points === undefined || points === null ? normalizePoints(existing.points, 0) : normalizePoints(points, 0);
    const nextComment =
      comment === undefined || comment === null ? String(existing.comment || "") : String(comment || "");

    const nextSource: "signal" | "admin" =
      source === "admin" || existing.source === "admin" ? "admin" : "signal";

    const firstSeen = typeof existing.first_seen === "number" ? existing.first_seen : now;

    // Throttle noisy "signal" updates to avoid constant disk writes.
    // If the entry is still unclassified (points=0) and we recently updated last_seen,
    // skip writing again (admins can still classify anytime).
    const lastSeenPrev = typeof existing.last_seen === "number" ? existing.last_seen : 0;
    const isUnclassified = normalizePoints(existing.points, 0) === 0 && nextPoints === 0 && nextSource === "signal";
    const minWriteIntervalMs = parseInt(process.env.SHA_DB_MIN_WRITE_MS || "600000", 10); // default 10 min
    if (
      isUnclassified &&
      lastSeenPrev > 0 &&
      Number.isFinite(minWriteIntervalMs) &&
      minWriteIntervalMs > 0 &&
      now - lastSeenPrev < minWriteIntervalMs
    ) {
      return successResponse({
        success: true,
        sha256: normalizedSha,
        program_name: program_name,
        points: nextPoints,
        comment: nextComment,
        source: nextSource,
        skippedWrite: true,
      });
    }

    db.programs[normalizedSha] = {
      program_name: String(program_name),
      points: nextPoints,
      comment: nextComment,
      first_seen: firstSeen,
      last_seen: now,
      source: nextSource,
    };

    db._meta.last_updated = now;
    db._meta.total_entries = Object.keys(db.programs).length;

    // Save to file
    await fs.writeFile(SHA_DB_FILE, JSON.stringify(db, null, 2));

    return successResponse({
      success: true,
      sha256: normalizedSha,
      program_name: program_name,
      points: nextPoints,
      comment: nextComment,
      source: nextSource,
    });
  } catch (error: any) {
    console.error("[/api/sha-database] POST error:", error);
    return errorResponse(error.message || "Failed to save SHA entry", 500);
  }
}

// DELETE: Remove SHA entry (requires NextAuth session or SIGNAL_TOKEN)
export async function DELETE(req: NextRequest) {
  try {
    // First check for SIGNAL_TOKEN (for scanner)
    const tokenValidation = validateToken(req, process.env.SIGNAL_TOKEN);
    if (!tokenValidation.valid) {
      // Check NextAuth session (for dashboard users)
      const auth = await requireAuth();
      if (!auth.authenticated) {
        return auth.response;
      }
    }

    const { searchParams } = new URL(req.url);
    const sha256 = searchParams.get("sha256");

    if (!sha256) {
      return errorResponse("sha256 parameter is required", 400);
    }

    const db = await ensureDatabase();
    const normalizedSha = sha256.toLowerCase();

    if (db.programs[normalizedSha]) {
      delete db.programs[normalizedSha];
      db._meta.last_updated = Date.now();
      db._meta.total_entries = Object.keys(db.programs).length;

      await fs.writeFile(SHA_DB_FILE, JSON.stringify(db, null, 2));

      return successResponse({
        success: true,
        message: "SHA entry deleted",
      });
    } else {
      return errorResponse("SHA entry not found", 404);
    }
  } catch (error: any) {
    console.error("[/api/sha-database] DELETE error:", error);
    return errorResponse(error.message || "Failed to delete SHA entry", 500);
  }
}
