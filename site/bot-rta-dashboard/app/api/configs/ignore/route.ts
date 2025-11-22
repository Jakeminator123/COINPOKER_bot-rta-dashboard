import { NextRequest } from "next/server";
import * as fs from "fs/promises";
import path from "path";
import { successResponse, errorResponse } from "@/lib/utils/api-utils";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lightweight cache for ignore list only
let ignoreCache: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute cache

async function loadIgnoreList(): Promise<string[]> {
  const now = Date.now();

  // Use cache if still valid
  if (ignoreCache && now - cacheTimestamp < CACHE_TTL) {
    return ignoreCache;
  }

  try {
    const configPath = path.join(
      process.cwd(),
      "configs",
      "programs_config.json"
    );
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content);

    const ignored = config.ignored_programs || [];

    // Update cache
    ignoreCache = ignored;
    cacheTimestamp = now;

    return ignored;
  } catch (error) {
    console.error("Failed to load ignore list:", error);
    return [];
  }
}

// Helper function to clear cache (internal use only)
function clearIgnoreCacheInternal() {
  ignoreCache = null;
  cacheTimestamp = 0;
}

export async function GET(_request: NextRequest) {
  try {
    const ignored = await loadIgnoreList();

    return successResponse({
      ignored_programs: ignored,
      count: ignored.length,
      cached: Date.now() - cacheTimestamp < CACHE_TTL,
    }, 200, { cache: 'public' });
  } catch (error) {
    console.error("Ignore list API error:", error);
    return errorResponse(
      error instanceof Error ? error : 'Failed to load ignore list',
      500
    );
  }
}

// POST endpoint to clear cache manually
export async function POST(_request: NextRequest) {
  try {
    clearIgnoreCacheInternal();

    return successResponse({
      message: "Ignore list cache cleared",
    });
  } catch (error) {
    console.error("Cache clear error:", error);
    return errorResponse(
      error instanceof Error ? error : 'Failed to clear cache',
      500
    );
  }
}
