import {
  errorResponse,
  parseJsonBody,
  successResponse,
  validateToken,
  type ConfigPostRequest,
} from "@/lib/utils/api-utils";
import * as fs from "fs/promises";
import { NextRequest } from "next/server";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cache for config files with better structure
let configCache: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = process.env.NODE_ENV === "development" ? 10000 : 120000; // 10s in DEV, 2 min in PROD

// Export function to clear cache (used by update endpoint)
export function clearCache() {
  configCache = null;
  cacheTimestamp = 0;
}

async function loadConfigs() {
  const now = Date.now();

  // Use cache if still valid (skip cache in development)
  if (configCache && now - cacheTimestamp < CACHE_TTL && CACHE_TTL > 0) {
    return configCache;
  }

  const configDir = path.join(process.cwd(), "configs");
  const configs: any = {
    _meta: {
      version: "1.0.0",
      updated: new Date().toISOString(),
      timestamp: now,
    },
  };

  try {
    // Load all JSON config files
    const configFiles = [
      "programs_registry.json", // Master source for ALL programs
      "programs_config.json", // Process scanner settings ONLY (no programs)
      "network_config.json",
      "behaviour_config.json",
      "screen_config.json",
      "vm_config.json",
      "obfuscation_config.json",
      "shared_config.json",
      // automation_programs.json removed - deprecated, use programs_registry.json instead
    ];

    // Track which configs were successfully loaded
    const loadedConfigs = new Set<string>();
    
    for (const filename of configFiles) {
      const filePath = path.join(configDir, filename);
      const configName = filename.replace(".json", "");
      
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(content);

        // Validate that parsed content is an object
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          console.error(`Invalid JSON structure in ${filename}: expected object`);
          continue;
        }

        // Handle nested structure - if the JSON has a single key matching the filename, unwrap it
        if (parsed[configName] && Object.keys(parsed).length === 1) {
          configs[configName] = parsed[configName];
        } else {
          configs[configName] = parsed;
        }
        
        loadedConfigs.add(configName);
      } catch (err) {
        // File doesn't exist or is invalid - try to load from default_values as fallback
        try {
          const defaultPath = path.join(configDir, "default_values", filename);
          const defaultContent = await fs.readFile(defaultPath, "utf-8");
          const defaultParsed = JSON.parse(defaultContent);
          
          if (typeof defaultParsed === "object" && defaultParsed !== null && !Array.isArray(defaultParsed)) {
            // Handle nested structure
            if (defaultParsed[configName] && Object.keys(defaultParsed).length === 1) {
              configs[configName] = defaultParsed[configName];
            } else {
              configs[configName] = defaultParsed;
            }
            loadedConfigs.add(configName);
            console.warn(`[ConfigLoader] Using default values for ${configName} (main file missing/invalid)`);
          }
        } catch (_defaultErr) {
          // Both main and default files failed - log error but continue
          console.error(`[ConfigLoader] Failed to load ${filename} (main and default both failed):`, err);
        }
      }
    }
    
    // Update meta with loaded configs info
    configs._meta.loaded_configs = Array.from(loadedConfigs);
    configs._meta.total_configs = configFiles.length;

    // Update cache
    configCache = configs;
    cacheTimestamp = now;

    return configs;
  } catch (error) {
    console.error("Config loading error:", error);
    return configs;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");

    // Load all configs
    const configs = await loadConfigs();

    // Version/checksum endpoint for quick checks
    if (request.url.includes("/version")) {
      return successResponse(
        {
          version: configs._meta.version,
          updated: configs._meta.updated,
          checksum: generateChecksum(configs),
        },
        200,
        { cache: "public" }
      );
    }

    // Return specific category if requested
    if (category && configs[category]) {
      return successResponse(
        {
          category,
          config: configs[category],
          meta: configs._meta,
        },
        200,
        { cache: "no-store" }
      );
    }

    // Return all configs with appropriate caching headers
    return successResponse(configs, 200, {
      headers: {
        "Cache-Control":
          process.env.NODE_ENV === "production"
            ? "public, s-maxage=60, stale-while-revalidate=120"
            : "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Config API error:", error);
    return errorResponse(
      error instanceof Error ? error : "Failed to load configs",
      500
    );
  }
}

// POST endpoint for future config updates (admin only)
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<ConfigPostRequest>(request);
    if (!parsed.success) {
      return errorResponse(parsed.error, 400);
    }

    const { category, config, adminToken } = parsed.data;

    // Check admin token
    const tokenValidation = validateToken(request, process.env.ADMIN_TOKEN);
    if (!tokenValidation.valid && adminToken !== process.env.ADMIN_TOKEN) {
      return errorResponse("Unauthorized", 401);
    }

    // Save updated config
    const configDir = path.join(process.cwd(), "configs");
    const filePath = path.join(configDir, `${category}.json`);

    await fs.writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");

    // Clear cache
    configCache = null;

    return successResponse(
      {
        message: `Config ${category} updated successfully`,
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("Config update error:", error);
    return errorResponse(
      error instanceof Error ? error : "Failed to update config",
      500
    );
  }
}

function generateChecksum(data: any): string {
  // Simple checksum for change detection
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
