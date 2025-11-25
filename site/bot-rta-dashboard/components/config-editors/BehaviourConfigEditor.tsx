"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface BehaviourConfigEditorProps {
  config?: any;
  onSave: (category: string, updates: any) => Promise<void>;
}

// Helper to detect if config uses new structure
function isNewStructure(config: any): boolean {
  return config?.data_collection || config?.bot_detection_thresholds;
}

// Helper to get value from either structure (kept for future use)
function _getConfigValue(config: any, path: string): any {
  if (!config) return undefined;
  
  // Map old paths to new paths
  const pathMappings: Record<string, string[]> = {
    // Data collection
    "polling.frequency_hz": ["data_collection.polling_frequency_hz", "polling.frequency_hz"],
    "polling.window_seconds": ["data_collection.analysis_window_seconds", "polling.window_seconds"],
    "polling.min_move_px": ["data_collection.min_mouse_movement_px", "polling.min_move_px"],
    "polling.jitter_px_threshold": ["data_collection.jitter_threshold_px", "polling.jitter_px_threshold"],
    "polling.jitter_window": ["data_collection.jitter_window_seconds", "polling.jitter_window"],
    
    // Thresholds - keyboard
    "thresholds.iki_cv_alert": ["bot_detection_thresholds.keyboard_timing.cv_critical", "thresholds.iki_cv_alert"],
    "thresholds.iki_cv_warn": ["bot_detection_thresholds.keyboard_timing.cv_suspicious", "thresholds.iki_cv_warn"],
    
    // Thresholds - click
    "thresholds.ici_cv_alert": ["bot_detection_thresholds.click_timing.cv_critical", "thresholds.ici_cv_alert"],
    "thresholds.ici_cv_warn": ["bot_detection_thresholds.click_timing.cv_suspicious", "thresholds.ici_cv_warn"],
    
    // Thresholds - mouse
    "thresholds.const_velocity_alert": ["bot_detection_thresholds.mouse_movement.constant_velocity_critical", "thresholds.const_velocity_alert"],
    "thresholds.const_velocity_warn": ["bot_detection_thresholds.mouse_movement.constant_velocity_suspicious", "thresholds.const_velocity_warn"],
    "thresholds.const_velocity_tolerance": ["bot_detection_thresholds.mouse_movement.constant_velocity_tolerance", "thresholds.const_velocity_tolerance"],
    "thresholds.dir_variability_alert": ["bot_detection_thresholds.mouse_movement.straight_line_critical", "thresholds.dir_variability_alert"],
    "thresholds.dir_variability_warn": ["bot_detection_thresholds.mouse_movement.straight_line_suspicious", "thresholds.dir_variability_warn"],
    
    // Thresholds - reaction
    "thresholds.min_reaction_ms": ["bot_detection_thresholds.reaction_time.min_reaction_ms", "thresholds.min_reaction_ms"],
    
    // Thresholds - click position
    "thresholds.repeated_pixel_radius_px": ["bot_detection_thresholds.click_position.pixel_radius_px", "thresholds.repeated_pixel_radius_px"],
    "thresholds.repeated_pixel_threshold": ["bot_detection_thresholds.click_position.repeat_threshold", "thresholds.repeated_pixel_threshold"],
    "thresholds.repeated_pixel_fraction": ["bot_detection_thresholds.click_position.repeat_fraction", "thresholds.repeated_pixel_fraction"],
    
    // Thresholds - jitter
    "thresholds.jitter_rms_alert": ["bot_detection_thresholds.jitter.rms_critical", "thresholds.jitter_rms_alert"],
    
    // Scoring weights - keyboard
    "scoring_weights.iki_very_low_variance": ["scoring_weights.keyboard.very_consistent_timing", "scoring_weights.iki_very_low_variance"],
    "scoring_weights.iki_low_variance": ["scoring_weights.keyboard.consistent_timing", "scoring_weights.iki_low_variance"],
    
    // Scoring weights - click
    "scoring_weights.ici_very_low_variance": ["scoring_weights.click.very_consistent_timing", "scoring_weights.ici_very_low_variance"],
    "scoring_weights.ici_low_variance": ["scoring_weights.click.consistent_timing", "scoring_weights.ici_low_variance"],
    
    // Scoring weights - mouse
    "scoring_weights.constant_velocity_high": ["scoring_weights.mouse.constant_velocity_high", "scoring_weights.constant_velocity_high"],
    "scoring_weights.constant_velocity_medium": ["scoring_weights.mouse.constant_velocity_medium", "scoring_weights.constant_velocity_medium"],
    "scoring_weights.direction_very_straight": ["scoring_weights.mouse.very_straight_paths", "scoring_weights.direction_very_straight"],
    "scoring_weights.direction_straight": ["scoring_weights.mouse.straight_paths", "scoring_weights.direction_straight"],
    "scoring_weights.repeated_pixels": ["scoring_weights.mouse.repeated_pixels", "scoring_weights.repeated_pixels"],
    "scoring_weights.low_jitter": ["scoring_weights.mouse.no_jitter", "scoring_weights.low_jitter"],
    
    // Scoring weights - reaction
    "scoring_weights.too_fast_reactions": ["scoring_weights.reaction.superhuman_speed", "scoring_weights.too_fast_reactions"],
    
    // Reporting
    "reporting.report_cooldown_s": ["reporting.cooldown_seconds", "reporting.report_cooldown_s"],
    "reporting.interval_s": ["reporting.analysis_interval_seconds", "reporting.interval_s"],
    "reporting.min_events_threshold": ["reporting.min_input_events", "reporting.min_events_threshold"],
  };
  
  const paths = pathMappings[path] || [path];
  
  for (const p of paths) {
    const parts = p.split(".");
    let value = config;
    for (const part of parts) {
      if (value === undefined || value === null) break;
      value = value[part];
    }
    if (value !== undefined) return value;
  }
  
  return undefined;
}

// Grouped configuration sections for easier understanding
const CONFIG_GROUPS = [
  {
    id: "data_collection",
    oldId: "polling",
    title: "📊 Data Collection",
    description: "How often and how long to collect mouse/keyboard data",
    fields: [
      {
        key: "frequency_hz",
        newKey: "polling_frequency_hz",
        label: "Polling Frequency",
        description: "How many times per second to check mouse/keyboard (Hz)",
        type: "number",
        min: 50,
        max: 500,
        unit: "Hz",
        tip: "Higher = more accurate but uses more CPU. Recommended: 200-250 Hz",
      },
      {
        key: "window_seconds",
        newKey: "analysis_window_seconds",
        label: "Analysis Window",
        description: "How many seconds of data to analyze at once",
        type: "number",
        min: 5,
        max: 60,
        unit: "seconds",
        tip: "Longer = more data but slower detection. Recommended: 20 seconds",
      },
      {
        key: "min_move_px",
        newKey: "min_mouse_movement_px",
        label: "Minimum Movement",
        description: "Smallest mouse movement to track (pixels)",
        type: "number",
        min: 1,
        max: 20,
        unit: "px",
        tip: "Filters out tiny movements/jitter. Recommended: 6px",
      },
      {
        key: "jitter_px_threshold",
        newKey: "jitter_threshold_px",
        label: "Jitter Threshold",
        description: "Maximum pixel movement considered as jitter",
        type: "number",
        min: 0.5,
        max: 5,
        step: 0.1,
        unit: "px",
        tip: "Movements smaller than this are considered jitter. Recommended: 1.5px",
      },
      {
        key: "jitter_window",
        newKey: "jitter_window_seconds",
        label: "Jitter Analysis Window",
        description: "Time window for analyzing jitter patterns",
        type: "number",
        min: 0.1,
        max: 2.0,
        step: 0.1,
        unit: "seconds",
        tip: "How long to look back for jitter analysis. Recommended: 0.3 seconds",
      },
    ],
  },
  {
    id: "keyboard_timing",
    oldId: "thresholds",
    title: "⌨️ Keyboard Timing Detection",
    description: "Detect bots by analyzing keystroke timing consistency",
    isNested: true,
    parentKey: "bot_detection_thresholds",
    oldParentKey: "thresholds",
    fields: [
      {
        key: "cv_critical",
        oldKey: "iki_cv_alert",
        label: "Critical Threshold (CV)",
        description: "Alert when keyboard timing is extremely consistent (lower = stricter)",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Coefficient of Variation (CV) for Inter-Keystroke Intervals. Humans typically have CV > 0.20. Bots have CV < 0.10",
      },
      {
        key: "cv_suspicious",
        oldKey: "iki_cv_warn",
        label: "Suspicious Threshold (CV)",
        description: "Warning when keyboard timing is somewhat consistent",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Less strict threshold for keyboard timing patterns",
      },
    ],
  },
  {
    id: "click_timing",
    oldId: "thresholds",
    title: "🖱️ Click Timing Detection",
    description: "Detect bots by analyzing click timing consistency",
    isNested: true,
    parentKey: "bot_detection_thresholds",
    oldParentKey: "thresholds",
    fields: [
      {
        key: "cv_critical",
        oldKey: "ici_cv_alert",
        label: "Critical Threshold (CV)",
        description: "Alert when click timing is extremely consistent (lower = stricter)",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Coefficient of Variation for Inter-Click Intervals. Humans typically have CV > 0.20",
      },
      {
        key: "cv_suspicious",
        oldKey: "ici_cv_warn",
        label: "Suspicious Threshold (CV)",
        description: "Warning when click timing is somewhat consistent",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Less strict threshold for click timing patterns",
      },
    ],
  },
  {
    id: "mouse_movement",
    oldId: "thresholds",
    title: "↗️ Mouse Movement Detection",
    description: "Detect bots by analyzing mouse movement patterns",
    isNested: true,
    parentKey: "bot_detection_thresholds",
    oldParentKey: "thresholds",
    fields: [
      {
        key: "constant_velocity_critical",
        oldKey: "const_velocity_alert",
        label: "Constant Speed Critical",
        description: "Alert when mouse moves at constant speed (higher = stricter)",
        type: "number",
        min: 0.1,
        max: 1.0,
        step: 0.05,
        tip: "Fraction of movements that must be constant speed. 0.75 = 75% constant = very bot-like",
      },
      {
        key: "constant_velocity_suspicious",
        oldKey: "const_velocity_warn",
        label: "Constant Speed Suspicious",
        description: "Warning when mouse moves at somewhat constant speed",
        type: "number",
        min: 0.1,
        max: 1.0,
        step: 0.05,
        tip: "Lower threshold for constant speed detection",
      },
      {
        key: "constant_velocity_tolerance",
        oldKey: "const_velocity_tolerance",
        label: "Speed Tolerance",
        description: "How much speed can vary and still be considered constant",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Lower = stricter constant speed detection. Recommended: 0.1",
      },
      {
        key: "straight_line_critical",
        oldKey: "dir_variability_alert",
        label: "Straight Line Critical",
        description: "Alert when mouse moves in very straight lines (lower = stricter)",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Direction variability threshold. Lower = straighter paths = more bot-like",
      },
      {
        key: "straight_line_suspicious",
        oldKey: "dir_variability_warn",
        label: "Straight Line Suspicious",
        description: "Warning when mouse moves in somewhat straight lines",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Less strict threshold for straight line detection",
      },
    ],
  },
  {
    id: "reaction_time",
    oldId: "thresholds",
    title: "⚡ Reaction Time Detection",
    description: "Detect bots by analyzing reaction speed",
    isNested: true,
    parentKey: "bot_detection_thresholds",
    oldParentKey: "thresholds",
    fields: [
      {
        key: "min_reaction_ms",
        oldKey: "min_reaction_ms",
        label: "Minimum Reaction Time",
        description: "Fastest possible human reaction time (milliseconds)",
        type: "number",
        min: 50,
        max: 300,
        unit: "ms",
        tip: "Reactions faster than this are physically impossible for humans. Recommended: 140ms",
      },
    ],
  },
  {
    id: "click_position",
    oldId: "thresholds",
    title: "🎯 Click Position Detection",
    description: "Detect bots by analyzing repeated pixel clicks",
    isNested: true,
    parentKey: "bot_detection_thresholds",
    oldParentKey: "thresholds",
    fields: [
      {
        key: "pixel_radius_px",
        oldKey: "repeated_pixel_radius_px",
        label: "Pixel Radius",
        description: "Pixel radius for grouping repeated clicks (allows small drift)",
        type: "number",
        min: 1,
        max: 10,
        unit: "px",
        tip: "Clicks within this radius are considered the same. Recommended: 2px",
      },
      {
        key: "repeat_threshold",
        oldKey: "repeated_pixel_threshold",
        label: "Repeat Threshold",
        description: "How many times clicking same pixel triggers alert",
        type: "number",
        min: 2,
        max: 10,
        tip: "Bots often click exact same pixels repeatedly",
      },
      {
        key: "repeat_fraction",
        oldKey: "repeated_pixel_fraction",
        label: "Repeat Fraction",
        description: "What fraction of clicks must be repeated to trigger alert",
        type: "number",
        min: 0.1,
        max: 1.0,
        step: 0.1,
        tip: "0.3 = 30% of clicks must be on same pixels",
      },
    ],
  },
  {
    id: "jitter",
    oldId: "thresholds",
    title: "📳 Jitter Detection",
    description: "Detect bots by analyzing micro-movement (jitter)",
    isNested: true,
    parentKey: "bot_detection_thresholds",
    oldParentKey: "thresholds",
    fields: [
      {
        key: "rms_critical",
        oldKey: "jitter_rms_alert",
        label: "Low Jitter Alert",
        description: "Alert when jitter is suspiciously low (lower = stricter)",
        type: "number",
        min: 0.1,
        max: 2.0,
        step: 0.1,
        unit: "px",
        tip: "Humans have natural hand tremor. Very low jitter suggests synthetic input. Recommended: 0.25px",
      },
    ],
  },
  {
    id: "scoring_weights",
    oldId: "scoring_weights",
    title: "⚖️ Scoring Weights",
    description: "How much each detection pattern adds to bot score (max 100)",
    hasSubgroups: true,
    subgroups: [
      {
        id: "keyboard",
        title: "Keyboard",
        fields: [
          {
            key: "very_consistent_timing",
            oldKey: "iki_very_low_variance",
            label: "Perfect Timing",
            description: "Points for extremely consistent keyboard timing",
            type: "number",
            min: 0,
            max: 30,
          },
          {
            key: "consistent_timing",
            oldKey: "iki_low_variance",
            label: "Consistent Timing",
            description: "Points for somewhat consistent keyboard timing",
            type: "number",
            min: 0,
            max: 20,
          },
        ],
      },
      {
        id: "click",
        title: "Click",
        fields: [
          {
            key: "very_consistent_timing",
            oldKey: "ici_very_low_variance",
            label: "Perfect Timing",
            description: "Points for extremely consistent click timing",
            type: "number",
            min: 0,
            max: 30,
          },
          {
            key: "consistent_timing",
            oldKey: "ici_low_variance",
            label: "Consistent Timing",
            description: "Points for somewhat consistent click timing",
            type: "number",
            min: 0,
            max: 20,
          },
        ],
      },
      {
        id: "mouse",
        title: "Mouse",
        fields: [
          {
            key: "constant_velocity_high",
            oldKey: "constant_velocity_high",
            label: "High Constant Speed",
            description: "Points for many constant-speed movements",
            type: "number",
            min: 0,
            max: 30,
          },
          {
            key: "constant_velocity_medium",
            oldKey: "constant_velocity_medium",
            label: "Medium Constant Speed",
            description: "Points for some constant-speed movements",
            type: "number",
            min: 0,
            max: 20,
          },
          {
            key: "very_straight_paths",
            oldKey: "direction_very_straight",
            label: "Very Straight Lines",
            description: "Points for very straight mouse paths",
            type: "number",
            min: 0,
            max: 20,
          },
          {
            key: "straight_paths",
            oldKey: "direction_straight",
            label: "Straight Lines",
            description: "Points for somewhat straight mouse paths",
            type: "number",
            min: 0,
            max: 15,
          },
          {
            key: "repeated_pixels",
            oldKey: "repeated_pixels",
            label: "Repeated Pixels",
            description: "Points for clicking same pixels repeatedly",
            type: "number",
            min: 0,
            max: 20,
          },
          {
            key: "no_jitter",
            oldKey: "low_jitter",
            label: "No Jitter",
            description: "Points for suspiciously low jitter",
            type: "number",
            min: 0,
            max: 15,
          },
        ],
      },
      {
        id: "reaction",
        title: "Reaction",
        fields: [
          {
            key: "superhuman_speed",
            oldKey: "too_fast_reactions",
            label: "Superhuman Speed",
            description: "Points for reactions faster than humanly possible",
            type: "number",
            min: 0,
            max: 25,
          },
        ],
      },
    ],
  },
  {
    id: "reporting",
    oldId: "reporting",
    title: "📤 Reporting Settings",
    description: "When and how often to report detections",
    fields: [
      {
        key: "cooldown_seconds",
        oldKey: "report_cooldown_s",
        label: "Report Cooldown",
        description: "Minimum seconds between reports",
        type: "number",
        min: 10,
        max: 300,
        unit: "seconds",
        tip: "Prevents spam. Recommended: 30 seconds",
      },
      {
        key: "analysis_interval_seconds",
        oldKey: "interval_s",
        label: "Analysis Interval",
        description: "How often to check for bot patterns",
        type: "number",
        min: 5,
        max: 60,
        unit: "seconds",
        tip: "How often the detector analyzes collected data. Recommended: 20 seconds",
      },
      {
        key: "min_input_events",
        oldKey: "min_events_threshold",
        label: "Minimum Events",
        description: "Minimum mouse/keyboard events needed before reporting",
        type: "number",
        min: 5,
        max: 100,
        tip: "Prevents false positives from too little data. Recommended: 20 events",
      },
    ],
  },
];

export default function BehaviourConfigEditor({
  config,
  onSave,
}: BehaviourConfigEditorProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [editedConfig, setEditedConfig] = useState(config || {});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["data_collection"])
  );

  const useNewStructure = isNewStructure(config);

  useEffect(() => {
    if (config) {
      setEditedConfig(config);
    }
  }, [config]);

  const handleSave = async () => {
    if (!editedConfig) return;

    setIsSaving(true);
    setMessage(null);
    try {
      await onSave("behaviour_config", editedConfig);
      setMessage({
        type: "success",
        text: "Behaviour configuration saved successfully",
      });
    } catch (error) {
      setMessage({ type: "error", text: "Failed to save configuration" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleFieldChange = (groupId: string, fieldKey: string, value: any, subgroupId?: string) => {
    setEditedConfig((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev));
      const group = CONFIG_GROUPS.find(g => g.id === groupId);
      if (!group) return updated;

      if (useNewStructure) {
        // New structure
        if (groupId === "data_collection") {
          if (!updated.data_collection) updated.data_collection = {};
          updated.data_collection[fieldKey] = value;
        } else if (group.isNested && group.parentKey) {
          if (!updated[group.parentKey]) updated[group.parentKey] = {};
          if (!updated[group.parentKey][groupId]) updated[group.parentKey][groupId] = {};
          updated[group.parentKey][groupId][fieldKey] = value;
        } else if (groupId === "scoring_weights" && subgroupId) {
          if (!updated.scoring_weights) updated.scoring_weights = {};
          if (!updated.scoring_weights[subgroupId]) updated.scoring_weights[subgroupId] = {};
          updated.scoring_weights[subgroupId][fieldKey] = value;
        } else if (groupId === "reporting") {
          if (!updated.reporting) updated.reporting = {};
          updated.reporting[fieldKey] = value;
        }
      } else {
        // Old structure
        const field = group.fields?.find(f => f.key === fieldKey || ('oldKey' in f && f.oldKey === fieldKey));
        const oldKey = (field && 'oldKey' in field ? field.oldKey : undefined) || fieldKey;
        
        if (groupId === "data_collection") {
          if (!updated.polling) updated.polling = {};
          updated.polling[oldKey] = value;
        } else if (group.isNested) {
          if (!updated.thresholds) updated.thresholds = {};
          updated.thresholds[oldKey] = value;
        } else if (groupId === "scoring_weights") {
          if (!updated.scoring_weights) updated.scoring_weights = {};
          // Find the old key from subgroups
          const subgroup = group.subgroups?.find(s => s.id === subgroupId);
          const subField = subgroup?.fields.find(f => f.key === fieldKey);
          const subFieldOldKey = subField && 'oldKey' in subField ? subField.oldKey : undefined;
          updated.scoring_weights[subFieldOldKey || fieldKey] = value;
        } else if (groupId === "reporting") {
          if (!updated.reporting) updated.reporting = {};
          updated.reporting[oldKey] = value;
        }
      }

      return updated;
    });
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const getFieldValue = (groupId: string, fieldKey: string, oldKey?: string, subgroupId?: string): any => {
    if (!editedConfig) return undefined;
    const group = CONFIG_GROUPS.find(g => g.id === groupId);
    if (!group) return undefined;

    if (useNewStructure) {
      // New structure
      if (groupId === "data_collection") {
        return editedConfig?.data_collection?.[fieldKey];
      } else if (group.isNested && group.parentKey) {
        return editedConfig?.[group.parentKey]?.[groupId]?.[fieldKey];
      } else if (groupId === "scoring_weights" && subgroupId) {
        return editedConfig?.scoring_weights?.[subgroupId]?.[fieldKey];
      } else if (groupId === "reporting") {
        return editedConfig?.reporting?.[fieldKey];
      }
    } else {
      // Old structure
      if (groupId === "data_collection") {
        return editedConfig?.polling?.[oldKey || fieldKey];
      } else if (group.isNested) {
        return editedConfig?.thresholds?.[oldKey || fieldKey];
      } else if (groupId === "scoring_weights") {
        return editedConfig?.scoring_weights?.[oldKey || fieldKey];
      } else if (groupId === "reporting") {
        return editedConfig?.reporting?.[oldKey || fieldKey];
      }
    }

    return undefined;
  };

  const renderField = (field: any, groupId: string, subgroupId?: string) => {
    const value = getFieldValue(groupId, field.key, field.oldKey, subgroupId);
    const displayValue = value ?? "";

    return (
      <div key={`${groupId}-${subgroupId || ""}-${field.key}`} className="space-y-1">
        <label className="block text-sm font-medium text-slate-300">
          {field.label}
          {field.unit && (
            <span className="text-slate-500 ml-1">({field.unit})</span>
          )}
        </label>
        <div className="flex items-center gap-2">
          <input
            type={field.type}
            value={displayValue}
            onChange={(e) => {
              const newValue =
                field.type === "number"
                  ? parseFloat(e.target.value) || 0
                  : e.target.value;
              handleFieldChange(groupId, field.key, newValue, subgroupId);
            }}
            min={field.min}
            max={field.max}
            step={field.step || 1}
            className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {field.tip && (
            <div className="text-slate-500 cursor-help" title={field.tip}>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          )}
        </div>
        {field.description && (
          <p className="text-xs text-slate-400">{field.description}</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <div className="flex items-start gap-2">
          <span className="text-blue-400 text-lg">💡</span>
          <div>
            <p className="text-sm text-slate-300 mb-2">
              <strong>How Bot Detection Works:</strong> The system polls mouse and keyboard input at high frequency, 
              then analyzes patterns to calculate a bot-likelihood score (0-100).
            </p>
            <p className="text-xs text-slate-400">
              <strong>Key Insight:</strong> Bots have very consistent timing (low CV values), move in straight lines at constant speed, 
              and click exact same pixels repeatedly. Humans have natural variation in all these metrics.
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Groups */}
      {CONFIG_GROUPS.map((group) => {
        const isExpanded = expandedGroups.has(group.id);

        return (
          <motion.div
            key={group.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-2 border-slate-700 rounded-xl overflow-hidden bg-slate-800/30"
          >
            {/* Group Header */}
            <button
              onClick={() => toggleGroup(group.id)}
              className="w-full p-4 text-left flex items-center justify-between hover:bg-slate-700/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="font-semibold text-white text-lg">
                    {group.title}
                  </h3>
                  <p className="text-sm text-slate-400">{group.description}</p>
                </div>
              </div>
              <motion.svg
                animate={{ rotate: isExpanded ? 180 : 0 }}
                className="w-5 h-5 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </motion.svg>
            </button>

            {/* Group Content */}
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-slate-700 p-4 bg-slate-900/50"
              >
                {group.hasSubgroups && group.subgroups ? (
                  // Render subgroups (for scoring_weights)
                  <div className="space-y-6">
                    {group.subgroups.map((subgroup) => (
                      <div key={subgroup.id}>
                        <h4 className="text-sm font-medium text-indigo-400 mb-3 uppercase tracking-wide">
                          {subgroup.title}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {subgroup.fields.map((field) =>
                            renderField(field, group.id, subgroup.id)
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // Render regular fields
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {group.fields?.map((field) => renderField(field, group.id))}
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        );
      })}

      {/* Save Button */}
      <div className="flex justify-end gap-3 pt-4">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {/* Message */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-3 rounded-lg text-center ${
            message.type === "success"
              ? "bg-green-500/20 text-green-400"
              : "bg-red-500/20 text-red-400"
          }`}
        >
          {message.text}
        </motion.div>
      )}
    </div>
  );
}
