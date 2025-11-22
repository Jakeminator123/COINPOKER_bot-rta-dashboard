import { NextRequest } from 'next/server';
import * as fs from 'fs/promises';
import path from 'path';
import { successResponse, errorResponse, validateToken, parseJsonBody, type ConfigUpdateRequest } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin token (should be in environment variable in production)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-secret-2024';

export async function POST(request: NextRequest) {
  try {
    // Check authorization
    const tokenValidation = validateToken(request, ADMIN_TOKEN);
    if (!tokenValidation.valid) {
      return errorResponse(tokenValidation.error || 'Unauthorized', 401);
    }

    // Parse request body safely
    const parsed = await parseJsonBody<ConfigUpdateRequest>(request);
    if (!parsed.success) {
      return errorResponse(parsed.error, 400);
    }

    const body = parsed.data;
    const { category, updates, config, merge = true, test = false } = body;

    // Support both 'updates' and 'config' parameter names
    const configUpdates = (updates || config) as Record<string, unknown>;

    // If this is just a test, return success
    if (test) {
      return successResponse({ test: true });
    }

    if (!category || !configUpdates) {
      return errorResponse('Missing category or config', 400);
    }

    // Load existing config
    const configDir = path.join(process.cwd(), 'configs');
    const configFile = path.join(configDir, `${category}.json`);

    let existingConfig: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(configFile, 'utf-8');
      existingConfig = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // File might not exist, that's OK
      console.log(`Creating new config file: ${category}.json`);
    }

    // Merge or replace
    let newConfig: Record<string, unknown>;
    if (merge) {
      // Special handling for ignored_programs
      if (category === 'programs' && configUpdates.ignored_programs) {
        const currentIgnored = Array.isArray(existingConfig.ignored_programs) 
          ? existingConfig.ignored_programs as unknown[] 
          : [];
        const newIgnored = [...new Set([...currentIgnored, ...(Array.isArray(configUpdates.ignored_programs) ? configUpdates.ignored_programs : [])])];
        newConfig = { ...existingConfig, ignored_programs: newIgnored };
      } else {
        // Deep merge updates with existing
        // CRITICAL: For programs_registry, always preserve _meta and _points_mapping
        if (category === 'programs_registry') {
          newConfig = deepMerge(existingConfig, configUpdates);
          // Ensure _meta and _points_mapping are preserved
          if (existingConfig._meta) {
            newConfig._meta = existingConfig._meta;
          }
          if (existingConfig._points_mapping) {
            newConfig._points_mapping = existingConfig._points_mapping;
          }
        } else {
          // Deep merge updates with existing
          newConfig = deepMerge(existingConfig, configUpdates);
        }
      }
    } else {
      // Replace entirely, but preserve critical metadata for programs_registry
      if (category === 'programs_registry') {
        newConfig = { ...configUpdates } as Record<string, unknown>;
        // Preserve _meta and _points_mapping if they exist in existing config
        if (existingConfig._meta && !(newConfig as Record<string, unknown>)._meta) {
          (newConfig as Record<string, unknown>)._meta = existingConfig._meta;
        }
        if (existingConfig._points_mapping && !(newConfig as Record<string, unknown>)._points_mapping) {
          (newConfig as Record<string, unknown>)._points_mapping = existingConfig._points_mapping;
        }
      } else {
        newConfig = configUpdates as Record<string, unknown>;
      }
    }

    // Check if this config should be nested (wrapped in its category name)
    // This is needed for configs like automation_programs that have nested structure
    if (category === 'automation_programs' && !newConfig[category]) {
      newConfig = { [category]: newConfig };
    }

    // Validate config structure before saving
    if (typeof newConfig !== "object" || newConfig === null || Array.isArray(newConfig)) {
      return errorResponse("Invalid config structure: must be an object", 400);
    }
    
    // CRITICAL: For programs_registry, ensure _meta and _points_mapping exist
    if (category === 'programs_registry') {
      // Ensure programs object exists
      if (!newConfig.programs || typeof newConfig.programs !== "object") {
        newConfig.programs = {};
      }
      // Ensure _meta exists (preserve if exists, create default if not)
      if (!newConfig._meta) {
        newConfig._meta = {
          version: "2.0.0",
          schema: "unified_programs_registry",
          description: "Central registry for all programs - eliminates duplication"
        };
      }
      // Ensure _points_mapping exists (preserve if exists, create default if not)
      if (!newConfig._points_mapping) {
        newConfig._points_mapping = {
          "0": {"status": "INFO", "description": "Informational only, no threat"},
          "5": {"status": "WARN", "description": "General scripting, suspicious tools"},
          "10": {"status": "ALERT", "description": "RTA tools, macro frameworks"},
          "15": {"status": "CRITICAL", "description": "Known bots, high-risk automation"}
        };
      }
    }
    
    // CRITICAL: For behaviour_config, ensure required top-level keys exist
    if (category === 'behaviour_config') {
      if (!newConfig.polling || typeof newConfig.polling !== "object") {
        newConfig.polling = {
          frequency_hz: 200,
          window_seconds: 20,
          min_move_px: 6,
          jitter_px_threshold: 1.5,
          jitter_window: 0.3
        };
      }
      if (!newConfig.thresholds || typeof newConfig.thresholds !== "object") {
        newConfig.thresholds = {};
      }
      if (!newConfig.scoring_weights || typeof newConfig.scoring_weights !== "object") {
        newConfig.scoring_weights = {};
      }
      if (!newConfig.reporting || typeof newConfig.reporting !== "object") {
        newConfig.reporting = {
          report_cooldown_s: 30,
          interval_s: 20,
          min_events_threshold: 20
        };
      }
      // Preserve _points_mapping if it exists
      if (!newConfig._points_mapping && existingConfig._points_mapping) {
        newConfig._points_mapping = existingConfig._points_mapping;
      }
    }

    // Save updated config
    await fs.writeFile(
      configFile,
      JSON.stringify(newConfig, null, 2),
      'utf-8'
    );

    // CRITICAL: Clear cache to force reload on next request
    try {
      // Dynamically import and clear cache from route.ts (parent directory)
      const { clearCache } = await import('../route');
      if (clearCache) {
        clearCache();
        console.log('[ConfigUpdate] Cache cleared - next request will reload configs');
      }
    } catch {
      // Cache will expire naturally via TTL (fallback)
      console.log('[ConfigUpdate] Cache will refresh on next request (TTL-based)');
    }

    // Log the update
    console.log(`[ConfigUpdate] Updated ${category} by admin at ${new Date().toISOString()}`);

    return successResponse({
      message: `Configuration ${category} updated successfully`,
      category,
    });

  } catch (error) {
    console.error('Config update error:', error);
    return errorResponse(
      error instanceof Error ? error : 'Failed to update config',
      500
    );
  }
}

// Helper function for deep merge
 
function deepMerge(target: any, source: any): any {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }

  return output;
}

 
function isObject(item: any): boolean {
  return item && typeof item === 'object' && !Array.isArray(item);
}
