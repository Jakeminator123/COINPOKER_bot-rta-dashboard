import { NextRequest } from 'next/server';
import { THREAT_WEIGHTS, THREAT_THRESHOLDS, TIME_WINDOWS } from '@/lib/detections/threat-scoring';
import { DETECTION_CONTEXT } from '@/lib/detections/detection-context';
import { successResponse, errorResponse, parseJsonBody, type SettingsPostRequest } from '@/lib/utils/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Config data using centralized detection context
const CONFIG_DATA = {
  detection_scoring: {
    risk_mapping: {
      "3": "ALERT",
      "2": "WARN",
      "1": "INFO",
      "0": "OK"
    },
    threat_weights: THREAT_WEIGHTS,
    thresholds: {
      high_risk: THREAT_THRESHOLDS.HIGH_RISK,
      medium_risk: THREAT_THRESHOLDS.MEDIUM_RISK,
      low_risk: THREAT_THRESHOLDS.LOW_RISK,
      recent_signals_window_ms: TIME_WINDOWS.RECENT_SIGNALS,
      session_timeout_ms: TIME_WINDOWS.SESSION_TIMEOUT,
      signal_cooldown_ms: TIME_WINDOWS.SIGNAL_COOLDOWN,
      historical_ttl_ms: TIME_WINDOWS.HISTORICAL_TTL
    },
    note: "These values are synchronized with panel.py and core/api.py"
  },

  programs: {
    known_bots: DETECTION_CONTEXT.knownBots,
    rta_tools: DETECTION_CONTEXT.rtaTools,
    automation: DETECTION_CONTEXT.automationTools,
    hash_scanner: {
      interval_seconds: 15.0,
      min_repeat_hours: 1.0,
      virustotal_cache_hours: 24.0,
      malware_threshold: 5,
      suspicious_threshold: 2
    }
  },

  behavior: {
    polling: {
      frequency_hz: 200,
      window_seconds: 10.0,
      min_move_px: 3,
      jitter_px_threshold: 2.0
    },
    thresholds: DETECTION_CONTEXT.behaviorThresholds,
    scoring_weights: {
      iki_very_low_variance: 22,
      ici_very_low_variance: 22,
      constant_velocity_high: 24,
      direction_very_straight: 16,
      repeated_pixels: 16,
      too_fast_reactions: 25
    }
  },

  network: {
    monitoring: {
      browser_min_repeat: 60.0,
      dns_alert_cooldown: 120.0,
      interval_s: 12.0
    },
    suspicious_patterns: DETECTION_CONTEXT.networkPatterns,
    suspicious_ports: DETECTION_CONTEXT.suspiciousPorts
  },

  automation_detection: {
    automation_programs: DETECTION_CONTEXT.automationTools,
    script_extensions: [".ahk", ".au3", ".py", ".js", ".vbs", ".ps1", ".bat"]
  },

  screen_detection: {
    overlay_detection: {
      overlay_classes: ["OverlayWindow", "Overlay", "DXOverlay"],
      hud_overlay_patterns: ["hm3", "holdemmanager", "pokertracker", "drivehud"],
      suspicious_keywords: ["cheat", "hack", "bot", "overlay", "inject"]
    },
    alert_settings: {
      alert_cooldown: 45.0,
      extended_focus_minutes: 10,
      detection_interval: 8.0
    }
  }
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    if (category && CONFIG_DATA[category as keyof typeof CONFIG_DATA]) {
      return successResponse({
        category,
        config: CONFIG_DATA[category as keyof typeof CONFIG_DATA]
      }, 200, { cache: 'no-store' });
    }

    // Return all config data
    return successResponse({
      config: CONFIG_DATA,
      categories: Object.keys(CONFIG_DATA)
    }, 200, { cache: 'no-store' });

  } catch (error) {
    console.error('Settings API error:', error);
    return errorResponse(
      error instanceof Error ? error : 'Failed to load settings',
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<SettingsPostRequest>(request);
    if (!parsed.success) {
      return errorResponse(parsed.error, 400);
    }

    const { category, config } = parsed.data;

    // For now, just return success (read-only mode)
    // In the future, this would validate and save config changes
    console.log(`Config update requested for ${category}:`, config);

    return successResponse({
      message: 'Configuration updated successfully (read-only mode)',
      category,
    });

  } catch (error) {
    console.error('Settings update error:', error);
    return errorResponse(
      error instanceof Error ? error : 'Failed to update settings',
      500
    );
  }
}
