"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface SimplifiedConfigurationEditorProps {
  programsRegistry?: any;
  programsConfig?: any;
  networkConfig?: any;
  behaviourConfig?: any;
  screenConfig?: any;
  vmConfig?: any;
  obfuscationConfig?: any;
  sharedConfig?: any;
  onSave: (category: string, updates: any) => Promise<void>;
  onNavigateToAdvanced?: (group: string, section: string) => void;
  onResetToDefault?: () => Promise<void>;
}

// Mapping from Simplified Configuration presets to Advanced Configuration sections
const ADVANCED_SECTION_MAP: Record<string, { group: string; section: string }> = {
  detection_sensitivity: { group: "detection_settings", section: "behaviour" },
  program_detection: { group: "detection_rules", section: "programs_registry" },
  behaviour_detection: { group: "detection_settings", section: "behaviour" },
  network_detection: { group: "detection_settings", section: "network" },
  screen_detection: { group: "detection_settings", section: "screen" },
  vm_detection: { group: "detection_settings", section: "vm" },
};

// Simplified presets - easy to understand settings
const SIMPLIFIED_PRESETS = {
  detection_sensitivity: {
    label: "Detection Sensitivity",
    description: "How strict should the detection be?",
    options: [
      {
        value: "low",
        label: "Low",
        description: "Fewer alerts, less false positives. Only detect obvious threats.",
        icon: "🟢",
      },
      {
        value: "medium",
        label: "Medium (Standard)",
        description: "Current default setting. Good balance between detection and false positives.",
        icon: "🟡",
      },
      {
        value: "high",
        label: "High",
        description: "More alerts, may have false positives. Detects more suspicious activity.",
        icon: "🔴",
      },
    ],
  },
  program_detection: {
    label: "Program Detection",
    description: "Which types of programs should be detected?",
    options: [
      {
        value: "all_detections",
        label: "All Detections",
        description: "Detect all types: bots, RTA tools, automation, macros, and everything else",
        icon: "🔍",
      },
      {
        value: "bots_only",
        label: "Bots Only",
        description: "Only detect known poker bots (WarBot, HoldemBot, etc.)",
        icon: "🤖",
      },
      {
        value: "rta_tools_only",
        label: "RTA Tools Only",
        description: "Only detect real-time assistance tools (GTO Wizard, RTA.poker, solvers, etc.)",
        icon: "🎯",
      },
      {
        value: "automation_only",
        label: "Automation Programs Only",
        description: "Detect automation tools including macros (AutoHotkey, Python, AutoIt, clickers, etc.)",
        icon: "⚙️",
      },
    ],
  },
  behaviour_detection: {
    label: "Behaviour Detection",
    description: "How strict should mouse/keyboard pattern detection be?",
    options: [
      {
        value: "disabled",
        label: "Disabled",
        description: "Don't analyze mouse/keyboard patterns",
        icon: "🚫",
      },
      {
        value: "relaxed",
        label: "Relaxed",
        description: "Only detect very obvious bot patterns",
        icon: "😌",
      },
      {
        value: "normal",
        label: "Normal",
        description: "Detect common bot patterns",
        icon: "👁️",
      },
      {
        value: "strict",
        label: "Strict",
        description: "Detect subtle bot patterns (may flag some legitimate users)",
        icon: "🔬",
      },
    ],
  },
  network_detection: {
    label: "Network Detection",
    description: "Monitor network activity and browser windows",
    options: [
      {
        value: "disabled",
        label: "Disabled",
        description: "Don't monitor network activity or browser windows",
        icon: "🚫",
      },
      {
        value: "enabled",
        label: "Enabled",
        description: "Monitor for RTA sites, Telegram connections, and suspicious network activity",
        icon: "🌐",
      },
    ],
  },
  screen_detection: {
    label: "Screen Detection",
    description: "Monitor for overlays and suspicious window patterns",
    options: [
      {
        value: "disabled",
        label: "Disabled",
        description: "Don't monitor screen overlays or window patterns",
        icon: "🚫",
      },
      {
        value: "enabled",
        label: "Enabled",
        description: "Detect overlays, HUDs, and suspicious window hierarchies",
        icon: "🖥️",
      },
    ],
  },
  vm_detection: {
    label: "VM Detection",
    description: "Detect virtual machines and virtualization software",
    options: [
      {
        value: "disabled",
        label: "Disabled",
        description: "Don't detect virtual machines",
        icon: "🚫",
      },
      {
        value: "enabled",
        label: "Enabled",
        description: "Detect VMs, containers, and virtualization software",
        icon: "💻",
      },
    ],
  },
};

export default function SimplifiedConfigurationEditor({
  programsRegistry,
  behaviourConfig,
  networkConfig,
  screenConfig,
  vmConfig,
  onSave,
  onNavigateToAdvanced,
  onResetToDefault,
}: SimplifiedConfigurationEditorProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Determine current settings from configs
  const getCurrentSensitivity = () => {
    // Analyze behaviour config thresholds to determine sensitivity
    if (!behaviourConfig?.thresholds) return "medium";
    const ikiAlert = behaviourConfig.thresholds.iki_cv_alert || 0.08;
    const constVelAlert = behaviourConfig.thresholds.const_velocity_alert || 0.8;
    
    // Match to one of three options: low, medium, high
    if (ikiAlert <= 0.05 && constVelAlert >= 0.9) return "high";
    if (ikiAlert >= 0.12 && constVelAlert <= 0.6) return "low";
    return "medium"; // Default/standard
  };

  const getCurrentProgramDetection = () => {
    if (!programsRegistry?.programs) return "all_detections";
    
    const programs = programsRegistry.programs;
    const hasAutomation = Object.values(programs).some((p: any) => 
      p.categories?.includes("automation") || p.categories?.includes("macros")
    );
    const hasRTA = Object.values(programs).some((p: any) => 
      p.categories?.includes("rta_tools")
    );
    const hasBots = Object.values(programs).some((p: any) => 
      p.categories?.includes("bots")
    );

    // If all categories exist, it means "all_detections" is active
    if (hasAutomation && hasRTA && hasBots) return "all_detections";
    
    // Determine which single category is active
    if (hasAutomation && !hasRTA && !hasBots) return "automation_only";
    if (hasRTA && !hasAutomation && !hasBots) return "rta_tools_only";
    if (hasBots && !hasAutomation && !hasRTA) return "bots_only";
    
    // Default to all_detections if multiple categories or none (changed from bots_only)
    return "all_detections";
  };

  const getCurrentNetworkDetection = () => {
    // Check if network detection is enabled
    if (!networkConfig) return "disabled";
    // Check enabled flag (defaults to true if not set for backward compatibility)
    return networkConfig.enabled === false ? "disabled" : "enabled";
  };

  const getCurrentScreenDetection = () => {
    // Check if screen detection is enabled
    if (!screenConfig) return "disabled";
    // Check enabled flag (defaults to true if not set for backward compatibility)
    return screenConfig.enabled === false ? "disabled" : "enabled";
  };

  const getCurrentVMDetection = () => {
    // Check if VM detection is enabled
    if (!vmConfig) return "disabled";
    // Check enabled flag (defaults to true if not set for backward compatibility)
    return vmConfig.enabled === false ? "disabled" : "enabled";
  };

  const getCurrentBehaviourDetection = () => {
    if (!behaviourConfig) return "normal";
    // Check if behaviour detection is effectively disabled
    const minEvents = behaviourConfig.reporting?.min_events_threshold || 20;
    if (minEvents > 100) return "disabled";
    
    const ikiAlert = behaviourConfig.thresholds?.iki_cv_alert || 0.08;
    if (ikiAlert > 0.15) return "relaxed";
    if (ikiAlert < 0.05) return "strict";
    return "normal";
  };

  const [sensitivity, setSensitivity] = useState(getCurrentSensitivity());
  const [programDetection, setProgramDetection] = useState(getCurrentProgramDetection());
  const [behaviourDetection, setBehaviourDetection] = useState(getCurrentBehaviourDetection());
  const [networkDetection, setNetworkDetection] = useState(getCurrentNetworkDetection());
  const [screenDetection, setScreenDetection] = useState(getCurrentScreenDetection());
  const [vmDetection, setVMDetection] = useState(getCurrentVMDetection());

  // Update state when props change (e.g., after reset or external updates)
  useEffect(() => {
    setSensitivity(getCurrentSensitivity());
    setProgramDetection(getCurrentProgramDetection());
    setBehaviourDetection(getCurrentBehaviourDetection());
    setNetworkDetection(getCurrentNetworkDetection());
    setScreenDetection(getCurrentScreenDetection());
    setVMDetection(getCurrentVMDetection());
  }, [programsRegistry, behaviourConfig, networkConfig, screenConfig, vmConfig]);

  const applyPreset = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      // Apply sensitivity preset to behaviour config
      // CRITICAL: Preserve all existing fields including polling, _points_mapping, etc.
      const behaviourUpdates: any = {
        ...behaviourConfig,
        thresholds: { ...(behaviourConfig?.thresholds || {}) },
        scoring_weights: { ...(behaviourConfig?.scoring_weights || {}) },
        reporting: { ...(behaviourConfig?.reporting || {}) },
        polling: { ...(behaviourConfig?.polling || {}) },
      };
      
      // Preserve metadata fields
      if (behaviourConfig?._points_mapping) {
        behaviourUpdates._points_mapping = behaviourConfig._points_mapping;
      }

      // Sensitivity presets (3 options: low, medium, high)
      switch (sensitivity) {
        case "low":
          behaviourUpdates.thresholds.iki_cv_alert = 0.12;
          behaviourUpdates.thresholds.iki_cv_warn = 0.18;
          behaviourUpdates.thresholds.const_velocity_alert = 0.6;
          behaviourUpdates.thresholds.const_velocity_warn = 0.4;
          behaviourUpdates.reporting.min_events_threshold = 50;
          break;
        case "medium":
          // Standard/default configuration
          behaviourUpdates.thresholds.iki_cv_alert = 0.08;
          behaviourUpdates.thresholds.iki_cv_warn = 0.12;
          behaviourUpdates.thresholds.const_velocity_alert = 0.75;
          behaviourUpdates.thresholds.const_velocity_warn = 0.5;
          behaviourUpdates.reporting.min_events_threshold = 20;
          break;
        case "high":
          behaviourUpdates.thresholds.iki_cv_alert = 0.05;
          behaviourUpdates.thresholds.iki_cv_warn = 0.08;
          behaviourUpdates.thresholds.const_velocity_alert = 0.9;
          behaviourUpdates.thresholds.const_velocity_warn = 0.75;
          behaviourUpdates.reporting.min_events_threshold = 10;
          break;
      }

      // Behaviour detection presets
      switch (behaviourDetection) {
        case "disabled":
          behaviourUpdates.reporting.min_events_threshold = 999999; // Effectively disable
          break;
        case "relaxed":
          behaviourUpdates.thresholds.iki_cv_alert = 0.15;
          behaviourUpdates.thresholds.const_velocity_alert = 0.6;
          behaviourUpdates.reporting.min_events_threshold = 40;
          break;
        case "normal":
          behaviourUpdates.thresholds.iki_cv_alert = 0.08;
          behaviourUpdates.thresholds.const_velocity_alert = 0.75;
          behaviourUpdates.reporting.min_events_threshold = 20;
          break;
        case "strict":
          behaviourUpdates.thresholds.iki_cv_alert = 0.05;
          behaviourUpdates.thresholds.const_velocity_alert = 0.9;
          behaviourUpdates.reporting.min_events_threshold = 10;
          break;
      }

      await onSave("behaviour_config", behaviourUpdates);

      // Apply program detection preset (filter programs_registry)
      // CRITICAL: Preserve _meta and _points_mapping fields
      let programDetectionMessage: { type: "success" | "error" | "info"; text: string } | null = null;
      
      if (programsRegistry) {
        const updatedRegistry: any = {
          ...programsRegistry,
        };
        
        // Preserve metadata fields
        if (programsRegistry._meta) {
          updatedRegistry._meta = programsRegistry._meta;
        }
        if (programsRegistry._points_mapping) {
          updatedRegistry._points_mapping = programsRegistry._points_mapping;
        }
        
        const programs = programsRegistry.programs || {};
        const currentDetection = getCurrentProgramDetection();
        
        // Only apply changes if the selection has actually changed
        if (programDetection !== currentDetection) {
          if (programDetection === "all_detections") {
            // When switching to "all_detections", we can't restore programs that were filtered out
            // The user needs to reset to default to restore all programs
            // For now, we'll keep the current programs (no filtering)
            updatedRegistry.programs = programs;
            
            // Show info message that reset may be needed
            programDetectionMessage = {
              type: "info",
              text: "Switched to 'All Detections'. Note: If programs were previously filtered, use 'Reset to Default' to restore all programs.",
            };
          } else {
            // Filter programs based on selected category
            const filteredPrograms: any = {};
            for (const [exeName, progData] of Object.entries(programs)) {
              const prog = progData as any;
              const categories = prog.categories || [];
              const progType = prog.type || "";

              let shouldInclude = false;
              
              switch (programDetection) {
                case "bots_only":
                  shouldInclude = categories.includes("bots") || progType === "bot";
                  break;
                case "rta_tools_only":
                  shouldInclude = categories.includes("rta_tools") || progType === "rta" || progType === "solver";
                  break;
                case "automation_only":
                  shouldInclude = 
                    categories.includes("automation") || 
                    categories.includes("macros") || 
                    progType === "macro" || 
                    progType === "script" || 
                    progType === "clicker" ||
                    progType === "automation";
                  break;
              }

              if (shouldInclude) {
                filteredPrograms[exeName] = prog;
              }
            }

            updatedRegistry.programs = filteredPrograms;
          }
          
          await onSave("programs_registry", updatedRegistry);
        }
      }

      // Apply Network/Screen/VM detection settings (enable/disable segments)
      // When disabled, set enabled: false in config so segments won't run their tick() method
      const currentNetworkDetection = getCurrentNetworkDetection();
      if (networkDetection !== currentNetworkDetection && networkConfig) {
        const updatedNetworkConfig: any = {
          ...networkConfig,
          enabled: networkDetection === "enabled",
        };
        await onSave("network_config", updatedNetworkConfig);
      }

      const currentScreenDetection = getCurrentScreenDetection();
      if (screenDetection !== currentScreenDetection && screenConfig) {
        const updatedScreenConfig: any = {
          ...screenConfig,
          enabled: screenDetection === "enabled",
        };
        await onSave("screen_config", updatedScreenConfig);
      }

      const currentVMDetection = getCurrentVMDetection();
      if (vmDetection !== currentVMDetection && vmConfig) {
        const updatedVMConfig: any = {
          ...vmConfig,
          enabled: vmDetection === "enabled",
        };
        await onSave("vm_config", updatedVMConfig);
      }

      // Set final message - prefer info message if exists, otherwise success
      if (programDetectionMessage) {
        setMessage(programDetectionMessage);
      } else {
        setMessage({
          type: "success",
          text: "Configuration saved successfully! Changes will take effect within 5 minutes.",
        });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to save configuration" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="p-5 bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl">
        <div className="flex items-start gap-3">
          <span className="text-3xl">✨</span>
          <div>
            <h3 className="text-blue-400 font-semibold text-lg mb-2">
              Simplified Configuration
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              This mode provides easy-to-understand presets for common scenarios. 
              For detailed control over individual settings, use Advanced Configuration mode.
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Presets */}
      <div className="space-y-6">
        {Object.entries(SIMPLIFIED_PRESETS).map(([key, preset]) => {
          const currentValue =
            key === "detection_sensitivity"
              ? sensitivity
              : key === "program_detection"
              ? programDetection
              : key === "behaviour_detection"
              ? behaviourDetection
              : key === "network_detection"
              ? networkDetection
              : key === "screen_detection"
              ? screenDetection
              : vmDetection;

          const setValue =
            key === "detection_sensitivity"
              ? setSensitivity
              : key === "program_detection"
              ? setProgramDetection
              : key === "behaviour_detection"
              ? setBehaviourDetection
              : key === "network_detection"
              ? setNetworkDetection
              : key === "screen_detection"
              ? setScreenDetection
              : setVMDetection;

          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-6 rounded-xl border-2 border-slate-700"
            >
              <div className="mb-4 flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-white mb-1">
                    {preset.label}
                  </h3>
                  <p className="text-sm text-slate-400">{preset.description}</p>
                </div>
                {onNavigateToAdvanced && ADVANCED_SECTION_MAP[key] && (
                  <button
                    onClick={() => {
                      const mapping = ADVANCED_SECTION_MAP[key];
                      onNavigateToAdvanced(mapping.group, mapping.section);
                    }}
                    className="ml-4 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 hover:border-indigo-500/30 rounded-lg transition-all flex items-center gap-1.5 flex-shrink-0"
                    title="View detailed settings in Advanced Configuration"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 7l5 5m0 0l-5 5m5-5H6"
                      />
                    </svg>
                    Advanced
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {preset.options.map((option) => {
                  const isSelected = currentValue === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setValue(option.value as any)}
                      className={`p-4 rounded-lg border-2 text-left transition-all ${
                        isSelected
                          ? "border-indigo-500 bg-indigo-500/20"
                          : "border-slate-700 bg-slate-800/30 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{option.icon}</span>
                        <div className="flex-1">
                          <div className="font-semibold text-white mb-1">
                            {option.label}
                          </div>
                          <div className="text-xs text-slate-400">
                            {option.description}
                          </div>
                        </div>
                        {isSelected && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="text-indigo-400"
                          >
                            ✓
                          </motion.div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>


      {/* Action Buttons */}
      <div className="flex justify-between items-center pt-4 border-t border-slate-700">
        <div className="text-sm text-slate-400">
          <p>💡 Tip: Use Advanced Configuration for detailed control</p>
        </div>
        <div className="flex gap-3">
          {onResetToDefault && (
            <button
              onClick={onResetToDefault}
              disabled={isSaving}
              className="px-5 py-3 bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-red-400 rounded-lg transition-all font-medium border border-red-500/30 hover:border-red-500/50 flex items-center gap-2"
              title="Reset all configurations to default values"
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
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Reset to Default
            </button>
          )}
          <button
            onClick={applyPreset}
            disabled={isSaving}
            className="px-8 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all font-semibold text-lg shadow-lg"
          >
            {isSaving ? "Saving..." : "Apply Settings"}
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-lg text-center ${
            message.type === "success"
              ? "bg-green-500/20 text-green-400"
              : message.type === "error"
              ? "bg-red-500/20 text-red-400"
              : "bg-blue-500/20 text-blue-400"
          }`}
        >
          {message.text}
        </motion.div>
      )}
    </div>
  );
}

