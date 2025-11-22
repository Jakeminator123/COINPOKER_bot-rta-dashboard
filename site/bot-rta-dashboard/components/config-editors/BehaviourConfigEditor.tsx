"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface BehaviourConfigEditorProps {
  config?: any;
  onSave: (category: string, updates: any) => Promise<void>;
}

// Grouped configuration sections for easier understanding
const CONFIG_GROUPS = [
  {
    id: "polling",
    title: "Data Collection",
    icon: "📊",
    description: "How often and how long to collect mouse/keyboard data",
    fields: [
      {
        key: "frequency_hz",
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
        label: "Jitter Threshold",
        description: "Maximum pixel movement considered as jitter (tiny movements)",
        type: "number",
        min: 0.5,
        max: 5,
        step: 0.1,
        unit: "px",
        tip: "Movements smaller than this are considered jitter. Recommended: 1.5px",
      },
      {
        key: "jitter_window",
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
    id: "thresholds",
    title: "Detection Thresholds",
    icon: "🎯",
    description: "Sensitivity levels for detecting bot-like patterns",
    fields: [
      {
        key: "iki_cv_alert",
        label: "Keyboard Timing Alert",
        description: "Alert when keyboard intervals are too consistent (lower = stricter)",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Coefficient of Variation (CV) for Inter-Keystroke Intervals. Lower = more consistent = more bot-like",
      },
      {
        key: "iki_cv_warn",
        label: "Keyboard Timing Warning",
        description: "Warning when keyboard intervals are somewhat consistent",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Less strict threshold for keyboard timing patterns",
      },
      {
        key: "ici_cv_alert",
        label: "Click Timing Alert",
        description: "Alert when click intervals are too consistent (lower = stricter)",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Coefficient of Variation for Inter-Click Intervals",
      },
      {
        key: "ici_cv_warn",
        label: "Click Timing Warning",
        description: "Warning when click intervals are somewhat consistent",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Less strict threshold for click timing patterns",
      },
      {
        key: "const_velocity_alert",
        label: "Constant Speed Alert",
        description: "Alert when mouse moves at constant speed (higher = stricter)",
        type: "number",
        min: 0.1,
        max: 1.0,
        step: 0.05,
        tip: "Fraction of movements that must be constant speed to trigger alert (0.75 = 75%)",
      },
      {
        key: "const_velocity_warn",
        label: "Constant Speed Warning",
        description: "Warning when mouse moves at somewhat constant speed",
        type: "number",
        min: 0.1,
        max: 1.0,
        step: 0.05,
        tip: "Lower threshold for constant speed detection",
      },
      {
        key: "dir_variability_alert",
        label: "Straight Line Alert",
        description: "Alert when mouse moves in very straight lines (lower = stricter)",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Direction variability threshold. Lower = straighter paths = more bot-like",
      },
      {
        key: "dir_variability_warn",
        label: "Straight Line Warning",
        description: "Warning when mouse moves in somewhat straight lines",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Less strict threshold for straight line detection",
      },
      {
        key: "min_reaction_ms",
        label: "Minimum Reaction Time",
        description: "Fastest possible human reaction time (milliseconds)",
        type: "number",
        min: 50,
        max: 300,
        unit: "ms",
        tip: "Reactions faster than this are considered bot-like. Recommended: 140ms",
      },
      {
        key: "repeated_pixel_threshold",
        label: "Repeated Clicks Threshold",
        description: "How many times clicking same pixel triggers alert",
        type: "number",
        min: 2,
        max: 10,
        tip: "Bots often click exact same pixels repeatedly",
      },
      {
        key: "repeated_pixel_fraction",
        label: "Repeated Clicks Fraction",
        description: "What fraction of clicks must be repeated to trigger alert",
        type: "number",
        min: 0.1,
        max: 1.0,
        step: 0.1,
        tip: "0.3 = 30% of clicks must be on same pixels",
      },
      {
        key: "repeated_pixel_radius_px",
        label: "Repeated Pixel Radius",
        description: "Pixel radius for grouping repeated clicks (allows small drift)",
        type: "number",
        min: 1,
        max: 10,
        unit: "px",
        tip: "Clicks within this radius are considered the same. Recommended: 2px",
      },
      {
        key: "const_velocity_tolerance",
        label: "Constant Speed Tolerance",
        description: "How much speed can vary and still be considered constant",
        type: "number",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        tip: "Lower = stricter constant speed detection. Recommended: 0.1",
      },
      {
        key: "jitter_rms_alert",
        label: "Low Jitter Alert",
        description: "Alert when jitter is suspiciously low (lower = stricter)",
        type: "number",
        min: 0.1,
        max: 2.0,
        step: 0.1,
        unit: "px",
        tip: "RMS jitter below this threshold triggers alert. Recommended: 0.25px",
      },
    ],
  },
  {
    id: "scoring",
    title: "Scoring Weights",
    icon: "⚖️",
    description: "How much each pattern contributes to bot score (0-100)",
    fields: [
      {
        key: "iki_very_low_variance",
        label: "Perfect Keyboard Timing",
        description: "Points for extremely consistent keyboard timing",
        type: "number",
        min: 0,
        max: 30,
        tip: "Weight for very low variance in keyboard intervals",
      },
      {
        key: "iki_low_variance",
        label: "Consistent Keyboard Timing",
        description: "Points for somewhat consistent keyboard timing",
        type: "number",
        min: 0,
        max: 20,
        tip: "Weight for low variance in keyboard intervals",
      },
      {
        key: "ici_very_low_variance",
        label: "Perfect Click Timing",
        description: "Points for extremely consistent click timing",
        type: "number",
        min: 0,
        max: 30,
        tip: "Weight for very low variance in click intervals",
      },
      {
        key: "ici_low_variance",
        label: "Consistent Click Timing",
        description: "Points for somewhat consistent click timing",
        type: "number",
        min: 0,
        max: 20,
        tip: "Weight for low variance in click intervals",
      },
      {
        key: "constant_velocity_high",
        label: "High Constant Speed",
        description: "Points for many constant-speed mouse movements",
        type: "number",
        min: 0,
        max: 30,
        tip: "Weight for high fraction of constant velocity movements",
      },
      {
        key: "constant_velocity_medium",
        label: "Medium Constant Speed",
        description: "Points for some constant-speed mouse movements",
        type: "number",
        min: 0,
        max: 20,
        tip: "Weight for medium fraction of constant velocity movements",
      },
      {
        key: "direction_very_straight",
        label: "Very Straight Lines",
        description: "Points for very straight mouse paths",
        type: "number",
        min: 0,
        max: 20,
        tip: "Weight for very straight directional movement",
      },
      {
        key: "direction_straight",
        label: "Straight Lines",
        description: "Points for somewhat straight mouse paths",
        type: "number",
        min: 0,
        max: 15,
        tip: "Weight for straight directional movement",
      },
      {
        key: "repeated_pixels",
        label: "Repeated Pixel Clicks",
        description: "Points for clicking same pixels repeatedly",
        type: "number",
        min: 0,
        max: 20,
        tip: "Weight for repeated pixel clicks",
      },
      {
        key: "too_fast_reactions",
        label: "Too Fast Reactions",
        description: "Points for reactions faster than humanly possible",
        type: "number",
        min: 0,
        max: 25,
        tip: "Weight for reactions faster than minimum reaction time",
      },
    ],
  },
  {
    id: "reporting",
    title: "Reporting Settings",
    icon: "📤",
    description: "When and how often to report detections",
    fields: [
      {
        key: "report_cooldown_s",
        label: "Report Cooldown",
        description: "Minimum seconds between reports",
        type: "number",
        min: 10,
        max: 300,
        unit: "seconds",
        tip: "Prevents spam. Recommended: 30 seconds",
      },
      {
        key: "interval_s",
        label: "Check Interval",
        description: "How often to check for bot patterns",
        type: "number",
        min: 5,
        max: 60,
        unit: "seconds",
        tip: "How often the detector analyzes collected data. Recommended: 20 seconds",
      },
      {
        key: "min_events_threshold",
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
    new Set(["polling"])
  );

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
      // Ensure we preserve _points_mapping and other metadata
      const configToSave = {
        ...editedConfig,
        // Preserve _points_mapping if it exists
        _points_mapping: editedConfig._points_mapping || config?._points_mapping,
        // Keep deprecated suspicious_tools for backward compatibility (but it's not used anymore)
        // The Behaviour Detector now reads from shared_config.automation_tools
      };
      
      await onSave("behaviour_config", configToSave);
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

  const handleFieldChange = (groupKey: string, fieldKey: string, value: any) => {
    setEditedConfig((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev));
      
      // Handle nested structure
      if (groupKey === "polling") {
        if (!updated.polling) updated.polling = {};
        updated.polling[fieldKey] = value;
      } else if (groupKey === "thresholds") {
        if (!updated.thresholds) updated.thresholds = {};
        updated.thresholds[fieldKey] = value;
      } else if (groupKey === "scoring") {
        if (!updated.scoring_weights) updated.scoring_weights = {};
        updated.scoring_weights[fieldKey] = value;
      } else if (groupKey === "reporting") {
        if (!updated.reporting) updated.reporting = {};
        updated.reporting[fieldKey] = value;
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

  const getFieldValue = (groupKey: string, fieldKey: string): any => {
    if (groupKey === "polling") {
      return editedConfig?.polling?.[fieldKey];
    } else if (groupKey === "thresholds") {
      return editedConfig?.thresholds?.[fieldKey];
    } else if (groupKey === "scoring") {
      return editedConfig?.scoring_weights?.[fieldKey];
    } else if (groupKey === "reporting") {
      return editedConfig?.reporting?.[fieldKey];
    }
    return undefined;
  };

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <p className="text-sm text-slate-300 mb-2">
          <strong>Note:</strong> These settings control how the system detects bot-like mouse and keyboard patterns. 
          Lower thresholds = more sensitive (more detections, but more false positives). 
          Higher thresholds = less sensitive (fewer detections, but fewer false positives).
        </p>
        <p className="text-xs text-slate-400">
          <strong>Important:</strong> Automation tools (like AutoHotkey, Python, etc.) are managed in Detection Rules (programs_registry.json), not in System Configuration. 
          Behaviour Detector automatically identifies suspicious input sources from the programs_registry.
        </p>
      </div>

      {/* Configuration Groups */}
      {CONFIG_GROUPS.map((group) => {
        const isExpanded = expandedGroups.has(group.id);
        const _groupConfig =
          group.id === "polling"
            ? editedConfig?.polling
            : group.id === "thresholds"
            ? editedConfig?.thresholds
            : group.id === "scoring"
            ? editedConfig?.scoring_weights
            : editedConfig?.reporting;

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
                <span className="text-2xl">{group.icon}</span>
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {group.fields.map((field) => {
                    const value = getFieldValue(group.id, field.key);
                    const displayValue = value ?? "";

                    return (
                      <div key={field.key} className="space-y-1">
                        <label className="block text-sm font-medium text-slate-300">
                          {field.label}
                          {field.unit && (
                            <span className="text-slate-500 ml-1">
                              ({field.unit})
                            </span>
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
                              handleFieldChange(group.id, field.key, newValue);
                            }}
                            min={field.min}
                            max={field.max}
                            step={field.step || 1}
                            className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          {field.tip && (
                            <div
                              className="text-slate-500 cursor-help"
                              title={field.tip}
                            >
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
                          <p className="text-xs text-slate-400">
                            {field.description}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
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

