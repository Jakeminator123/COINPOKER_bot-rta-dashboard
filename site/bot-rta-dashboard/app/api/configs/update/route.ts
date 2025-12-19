import { NextRequest } from 'next/server';
import * as fs from 'fs/promises';
import path from 'path';
import { successResponse, errorResponse, requireAuth, parseJsonBody, type ConfigUpdateRequest } from '@/lib/utils/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Check authentication via NextAuth session
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return auth.response;
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
      const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);

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

      // ---- Sync old/new behaviour schema to avoid drift ----
      // New schema keys used by Python:
      // - data_collection
      // - bot_detection_thresholds
      // - scoring_weights (nested)
      // - reporting (new keys)
      //
      // Old schema keys used by legacy dashboard logic:
      // - polling
      // - thresholds (flat)
      // - scoring_weights (flat)
      // - reporting (old keys)

      const hasNew =
        isObj((newConfig as any).data_collection) || isObj((newConfig as any).bot_detection_thresholds);

      // If new structure exists, mirror into old fields.
      if (hasNew) {
        const dc = (newConfig as any).data_collection || {};
        const bt = (newConfig as any).bot_detection_thresholds || {};
        const sw = (newConfig as any).scoring_weights || {};
        const rep = (newConfig as any).reporting || {};

        // polling mirror
        (newConfig as any).polling = {
          frequency_hz: dc.polling_frequency_hz ?? (newConfig as any).polling.frequency_hz ?? 200,
          window_seconds: dc.analysis_window_seconds ?? (newConfig as any).polling.window_seconds ?? 20,
          min_move_px: dc.min_mouse_movement_px ?? (newConfig as any).polling.min_move_px ?? 6,
          jitter_px_threshold: dc.jitter_threshold_px ?? (newConfig as any).polling.jitter_px_threshold ?? 1.5,
          jitter_window: dc.jitter_window_seconds ?? (newConfig as any).polling.jitter_window ?? 0.3,
        };

        // thresholds mirror
        const kb = bt.keyboard_timing || {};
        const ck = bt.click_timing || {};
        const mm = bt.mouse_movement || {};
        const rt = bt.reaction_time || {};
        const cp = bt.click_position || {};
        const jt = bt.jitter || {};
        (newConfig as any).thresholds = {
          iki_cv_alert: kb.cv_critical,
          iki_cv_warn: kb.cv_suspicious,
          ici_cv_alert: ck.cv_critical,
          ici_cv_warn: ck.cv_suspicious,
          const_velocity_alert: mm.constant_velocity_critical,
          const_velocity_warn: mm.constant_velocity_suspicious,
          const_velocity_tolerance: mm.constant_velocity_tolerance,
          dir_variability_alert: mm.straight_line_critical,
          dir_variability_warn: mm.straight_line_suspicious,
          min_reaction_ms: rt.min_reaction_ms,
          repeated_pixel_radius_px: cp.pixel_radius_px,
          repeated_pixel_threshold: cp.repeat_threshold,
          repeated_pixel_fraction: cp.repeat_fraction,
          jitter_rms_alert: jt.rms_critical,
        };

        // scoring_weights mirror (flat)
        const swKeyboard = sw.keyboard || {};
        const swClick = sw.click || {};
        const swMouse = sw.mouse || {};
        const swReaction = sw.reaction || {};
        (newConfig as any).scoring_weights_flat = {
          iki_very_low_variance: swKeyboard.very_consistent_timing,
          iki_low_variance: swKeyboard.consistent_timing,
          ici_very_low_variance: swClick.very_consistent_timing,
          ici_low_variance: swClick.consistent_timing,
          constant_velocity_high: swMouse.constant_velocity_high,
          constant_velocity_medium: swMouse.constant_velocity_medium,
          direction_very_straight: swMouse.very_straight_paths,
          direction_straight: swMouse.straight_paths,
          repeated_pixels: swMouse.repeated_pixels,
          low_jitter: swMouse.no_jitter,
          too_fast_reactions: swReaction.superhuman_speed,
        };

        // reporting mirror (old keys)
        (newConfig as any).reporting = {
          ...rep,
          report_cooldown_s: rep.cooldown_seconds ?? (newConfig as any).reporting.report_cooldown_s ?? 30,
          interval_s: rep.analysis_interval_seconds ?? (newConfig as any).reporting.interval_s ?? 20,
          min_events_threshold: rep.min_input_events ?? (newConfig as any).reporting.min_events_threshold ?? 20,
        };
      } else {
        // If only old structure exists, mirror into new fields so the Python segment stays stable.
        const p = (newConfig as any).polling || {};
        const th = (newConfig as any).thresholds || {};
        const swf = (newConfig as any).scoring_weights || {};
        const rep = (newConfig as any).reporting || {};

        (newConfig as any).data_collection = {
          polling_frequency_hz: p.frequency_hz ?? 200,
          analysis_window_seconds: p.window_seconds ?? 20,
          min_mouse_movement_px: p.min_move_px ?? 6,
          jitter_threshold_px: p.jitter_px_threshold ?? 1.5,
          jitter_window_seconds: p.jitter_window ?? 0.3,
        };

        (newConfig as any).bot_detection_thresholds = {
          keyboard_timing: { cv_critical: th.iki_cv_alert ?? 0.07, cv_suspicious: th.iki_cv_warn ?? 0.1 },
          click_timing: { cv_critical: th.ici_cv_alert ?? 0.07, cv_suspicious: th.ici_cv_warn ?? 0.1 },
          mouse_movement: {
            constant_velocity_critical: th.const_velocity_alert ?? 0.75,
            constant_velocity_suspicious: th.const_velocity_warn ?? 0.5,
            constant_velocity_tolerance: th.const_velocity_tolerance ?? 0.1,
            straight_line_critical: th.dir_variability_alert ?? 0.045,
            straight_line_suspicious: th.dir_variability_warn ?? 0.09,
          },
          reaction_time: { min_reaction_ms: th.min_reaction_ms ?? 140 },
          click_position: {
            pixel_radius_px: th.repeated_pixel_radius_px ?? 2,
            repeat_threshold: th.repeated_pixel_threshold ?? 3,
            repeat_fraction: th.repeated_pixel_fraction ?? 0.3,
          },
          jitter: { rms_critical: th.jitter_rms_alert ?? 0.25 },
        };

        (newConfig as any).scoring_weights = {
          keyboard: {
            very_consistent_timing: swf.iki_very_low_variance ?? 12,
            consistent_timing: swf.iki_low_variance ?? 6,
          },
          click: {
            very_consistent_timing: swf.ici_very_low_variance ?? 12,
            consistent_timing: swf.ici_low_variance ?? 6,
          },
          mouse: {
            constant_velocity_high: swf.constant_velocity_high ?? 20,
            constant_velocity_medium: swf.constant_velocity_medium ?? 10,
            very_straight_paths: swf.direction_very_straight ?? 12,
            straight_paths: swf.direction_straight ?? 6,
            repeated_pixels: swf.repeated_pixels ?? 12,
            no_jitter: swf.low_jitter ?? 0,
          },
          reaction: { superhuman_speed: swf.too_fast_reactions ?? 10 },
        };

        (newConfig as any).reporting = {
          ...rep,
          cooldown_seconds: rep.report_cooldown_s ?? 30,
          analysis_interval_seconds: rep.interval_s ?? 20,
          min_input_events: rep.min_events_threshold ?? 20,
        };
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
