import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  successResponse,
  errorResponse,
  corsOptions,
  validateToken,
} from "@/lib/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHA_DB_FILE = path.join(process.cwd(), "configs", "sha_database.json");

interface SHAEntry {
  sha256: string;
  program_name: string;
}

interface SHADatabase {
  programs: Record<string, string>; // sha256 -> program_name
  _meta: {
    version: string;
    last_updated: number;
  };
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
    
    return parsed as SHADatabase;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      // File doesn't exist, create it
      const initial: SHADatabase = {
        programs: {},
        _meta: {
          version: "1.0",
          last_updated: Date.now(),
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
  return corsOptions();
}

// GET: Retrieve all SHA entries with optional fuzzy matching
export async function GET(req: NextRequest) {
  try {
    const db = await ensureDatabase();
    const { searchParams } = new URL(req.url);
    const searchTerm = searchParams.get("search") || "";
    const similarityThreshold = parseFloat(searchParams.get("similarity") || "0.9"); // Default 90%
    
    // Convert to array format for easier frontend handling
    let entries: SHAEntry[] = Object.entries(db.programs).map(([sha256, program_name]) => ({
      sha256,
      program_name,
    }));
    
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
    const tokenValidation = validateToken(req, process.env.SIGNAL_TOKEN);
    if (!tokenValidation.valid) {
      return errorResponse("Unauthorized", 401);
    }

    const body = await req.json();
    const { sha256, program_name } = body;

    if (!sha256 || !program_name) {
      return errorResponse("sha256 and program_name are required", 400);
    }

    const db = await ensureDatabase();
    const normalizedSha = sha256.toLowerCase();

    // Add or update entry
    db.programs[normalizedSha] = program_name;
    db._meta.last_updated = Date.now();

    // Save to file
    await fs.writeFile(SHA_DB_FILE, JSON.stringify(db, null, 2));

    return successResponse({
      success: true,
      sha256: normalizedSha,
      program_name: program_name,
    });
  } catch (error: any) {
    console.error("[/api/sha-database] POST error:", error);
    return errorResponse(error.message || "Failed to save SHA entry", 500);
  }
}

// DELETE: Remove SHA entry
export async function DELETE(req: NextRequest) {
  try {
    const tokenValidation = validateToken(req, process.env.SIGNAL_TOKEN);
    if (!tokenValidation.valid) {
      // Also check admin token
      const authHeader = req.headers.get("authorization");
      const adminToken = process.env.ADMIN_TOKEN || "admin-secret-token-2024";
      if (authHeader !== `Bearer ${adminToken}`) {
        return errorResponse("Unauthorized", 401);
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
