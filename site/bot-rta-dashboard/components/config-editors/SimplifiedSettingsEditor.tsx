"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import SmartConfigEditor from "./SmartConfigEditor";
import UnifiedProgramEditor from "./UnifiedProgramEditor";
import BehaviourConfigEditor from "./BehaviourConfigEditor";

interface AdvancedSettingsEditorProps {
  programsRegistry?: any;
  programsConfig?: any;
  networkConfig?: any;
  behaviourConfig?: any;
  screenConfig?: any;
  vmConfig?: any;
  obfuscationConfig?: any;
  sharedConfig?: any;
  onSave: (category: string, updates: any) => Promise<void>;
}

// Advanced configuration - detailed control over all settings
const SETTINGS_GROUPS = [
  {
    id: "detection_rules",
    title: "Detection Rules",
    icon: "🎯",
    description: "WHAT to detect: The list of programs, bots, and tools that trigger alerts",
    color: "from-red-500 to-orange-600",
    gradient: "bg-gradient-to-br from-red-500/20 to-orange-600/20",
    borderColor: "border-red-500/30",
    explanation: "This is the master database of all programs that the system will detect and report. Think of it as a 'blacklist' - when any of these programs are found running, the system generates a detection signal. Each program has a threat level (0-15 points) that determines how serious the alert is.",
    sections: [
      {
        id: "programs_registry",
        title: "Program Database",
        description:
          "Master list of all programs to detect: bots, RTA tools, automation software, macros. Each program has a threat level (0-15 points).",
        config: "programsRegistry",
        editor: "unified", // Use UnifiedProgramEditor
        details: [
          "Add/remove programs from detection list",
          "Set threat points: 0=Info, 5=Warning, 10=Alert, 15=Critical",
          "Categorize programs: bots, RTA tools, macros, automation",
          "Used by: Automation Detector, Process Scanner",
        ],
      },
    ],
  },
  {
    id: "detection_settings",
    title: "Detection Settings",
    icon: "⚙️",
    description: "HOW detection works: Sensitivity, thresholds, and detection methods",
    color: "from-blue-500 to-cyan-600",
    gradient: "bg-gradient-to-br from-blue-500/20 to-cyan-600/20",
    borderColor: "border-blue-500/30",
    explanation: "These settings control HOW the system detects threats. They define the sensitivity, thresholds, and patterns used by each detection method. For example: how fast mouse movements must be to trigger bot detection, which network patterns indicate RTA usage, or what screen overlays are suspicious. These are the 'rules of detection' - not what to detect, but how to detect it.",
    sections: [
      {
        id: "process_scanner",
        title: "Process Scanner Settings",
        description:
          "Settings for scanning running processes: what to ignore, where to look, how to detect suspicious behavior.",
        config: "programsConfig",
        editor: "smart",
        details: [
          "Configure ignored programs (false positives)",
          "Set expected program locations",
          "Define suspicious drop zones",
          "Macro header detection signatures",
        ],
      },
      {
        id: "network",
        title: "Network Detection",
        description:
          "Configure network monitoring: RTA sites, Telegram detection, DNS monitoring, traffic analysis.",
        config: "networkConfig",
        editor: "smart",
        details: [
          "RTA site keywords and patterns",
          "Telegram detection settings",
          "DNS monitoring thresholds",
          "Network connection analysis",
        ],
      },
      {
        id: "behaviour",
        title: "Behaviour Analysis",
        description:
          "Configure behavioral detection: mouse patterns, keyboard timing, click analysis, bot-like behavior detection.",
        config: "behaviourConfig",
        editor: "behaviour", // Use specialized BehaviourConfigEditor
        details: [
          "Data collection: polling frequency and analysis window",
          "Detection thresholds: sensitivity for keyboard/click timing, mouse speed, straight lines",
          "Scoring weights: how much each pattern contributes to bot score",
          "Reporting: when and how often to report detections",
        ],
      },
      {
        id: "screen",
        title: "Screen Monitoring",
        description:
          "Configure screen/window detection: overlays, HUD detection, window hierarchies, background automation.",
        config: "screenConfig",
        editor: "smart",
        details: [
          "Overlay detection settings",
          "HUD overlay patterns",
          "Window hierarchy analysis",
          "Background automation detection",
        ],
      },
      {
        id: "vm",
        title: "Virtual Machine Detection",
        description:
          "Configure VM detection: hypervisor detection, guest tools, hardware fingerprinting, VM probability scoring.",
        config: "vmConfig",
        editor: "smart",
        details: [
          "VM process detection",
          "Hardware fingerprinting",
          "Registry markers",
          "VM probability thresholds",
        ],
      },
      {
        id: "obfuscation",
        title: "Code Obfuscation Detection",
        description:
          "Configure obfuscation detection: packed files, encrypted code, anti-analysis techniques.",
        config: "obfuscationConfig",
        editor: "smart",
        details: [
          "Obfuscation patterns",
          "Packer signatures",
          "Anti-debugging detection",
          "Code structure analysis",
        ],
      },
    ],
  },
      {
        id: "system",
        title: "System Configuration",
        icon: "🔧",
        description: "REFERENCE DATA: Definitions and identifiers used by all detection segments",
        color: "from-purple-500 to-pink-600",
        gradient: "bg-gradient-to-br from-purple-500/20 to-pink-600/20",
        borderColor: "border-purple-500/30",
        explanation: "This is REFERENCE DATA - overarching definitions and identifiers used by all detection segments. It defines WHAT things are (e.g., 'this is CoinPoker', 'these are browsers', 'these are communication apps'), but it doesn't contain specific program definitions. All specific programs (including automation tools like AutoHotkey, Python, etc.) are managed in Detection Rules (programs_registry.json). System Configuration contains: Points mapping (what 0/5/10/15 points mean), Poker site identifiers (CoinPoker process name, window class), Browser process names (for context), Communication app names (for context).",
        sections: [
          {
            id: "shared",
            title: "Shared Settings",
            description:
              "Overarching reference definitions: points mapping, poker site identifiers, browser names, and communication app patterns. These are used by multiple detection segments to understand context. All specific program definitions (including automation tools) are managed in Detection Rules.",
            config: "sharedConfig",
            editor: "smart",
            details: [
              "Points mapping: What 0/5/10/15 points mean (INFO/WARN/ALERT/CRITICAL)",
              "Protected poker site (CoinPoker) process and window identifiers",
              "List of other poker sites (for context, not detection)",
              "Browser process names (to distinguish from suspicious apps)",
              "Communication app patterns (Telegram, Discord, etc.)",
              "Note: All specific programs are managed in Detection Rules (programs_registry.json)",
            ],
          },
        ],
      },
];

export default function AdvancedSettingsEditor({
  programsRegistry,
  programsConfig,
  networkConfig,
  behaviourConfig,
  screenConfig,
  vmConfig,
  obfuscationConfig,
  sharedConfig,
  onSave,
}: AdvancedSettingsEditorProps) {
  const [activeGroup, setActiveGroup] = useState<string>("detection_rules");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["programs_registry"])
  );

  const getConfigForSection = (configKey: string) => {
    switch (configKey) {
      case "programsRegistry":
        return programsRegistry;
      case "programsConfig":
        return programsConfig;
      case "networkConfig":
        return networkConfig;
      case "behaviourConfig":
        return behaviourConfig;
      case "screenConfig":
        return screenConfig;
      case "vmConfig":
        return vmConfig;
      case "obfuscationConfig":
        return obfuscationConfig;
      case "sharedConfig":
        return sharedConfig;
      default:
        return null;
    }
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  return (
    <div className="space-y-6">

      {/* Group Navigation */}
      <div className="flex flex-wrap gap-4 mb-8">
        {SETTINGS_GROUPS.map((group, index) => {
          const isActive = activeGroup === group.id;
          return (
            <motion.button
              key={group.id}
              onClick={() => setActiveGroup(group.id)}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`px-6 py-4 rounded-xl font-medium transition-all flex items-center gap-3 relative overflow-hidden group ${
                isActive
                  ? `bg-gradient-to-r ${group.color} text-white shadow-xl shadow-${group.color.split('-')[1]}-500/50`
                  : "bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 hover:text-white hover:scale-105"
              }`}
              whileHover={{ scale: isActive ? 1 : 1.05 }}
              whileTap={{ scale: 0.98 }}
            >
              {isActive && (
                <motion.div
                  layoutId="activeGroup"
                  className={`absolute inset-0 bg-gradient-to-r ${group.color} -z-10`}
                  transition={{
                    type: "spring",
                    bounce: 0.2,
                    duration: 0.6,
                  }}
                />
              )}
              <motion.span
                className="text-2xl"
                animate={isActive ? { rotate: [0, 10, -10, 0] } : {}}
                transition={{ duration: 0.5 }}
              >
                {group.icon}
              </motion.span>
              <div className="text-left">
                <div className="font-bold text-base">{group.title}</div>
                <div className="text-xs opacity-90 mt-0.5">{group.description}</div>
              </div>
              {isActive && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="ml-2"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Group Content */}
      <AnimatePresence mode="wait">
        {SETTINGS_GROUPS.map((group) => {
          if (activeGroup !== group.id) return null;

          return (
            <motion.div
              key={group.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <div className={`glass-card p-6 rounded-xl border-2 ${group.borderColor} ${group.gradient}`}>
                <div className="mb-6">
                  <div className="flex items-start gap-4 mb-4">
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="text-4xl flex-shrink-0"
                    >
                      {group.icon}
                    </motion.div>
                    <div className="flex-1">
                      <h2 className="text-2xl font-bold text-white mb-2">{group.title}</h2>
                      <p className="text-slate-300 mb-3">{group.description}</p>
                      {group.explanation && (
                        <div className="mt-4 p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
                          <div className="flex items-start gap-2">
                            <span className="text-yellow-400 text-lg flex-shrink-0">💡</span>
                            <div>
                              <p className="text-sm text-slate-200 font-medium mb-1">Why is this different?</p>
                              <p className="text-sm text-slate-300 leading-relaxed">{group.explanation}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sections */}
                <div className="space-y-3">
                  {group.sections.map((section, sectionIndex) => {
                    const config = getConfigForSection(section.config);
                    const isExpanded = expandedSections.has(section.id);

                    return (
                      <motion.div
                        key={section.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: sectionIndex * 0.1 }}
                        className={`border-2 rounded-xl transition-all overflow-hidden ${
                          isExpanded
                            ? `${group.borderColor} bg-slate-800/50 shadow-lg`
                            : "border-slate-700 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/40"
                        }`}
                      >
                        {/* Section Header */}
                        <button
                          onClick={() => toggleSection(section.id)}
                          className="w-full p-5 text-left flex items-start justify-between group"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-bold text-white text-lg group-hover:text-indigo-300 transition-colors">
                                {section.title}
                              </h3>
                              {config ? (
                                <motion.span
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  className="text-xs bg-green-500/20 text-green-400 px-3 py-1 rounded-full border border-green-500/30"
                                >
                                  ✓ Configured
                                </motion.span>
                              ) : (
                                <motion.span
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  className="text-xs bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full border border-yellow-500/30"
                                >
                                  ⚠ No Config
                                </motion.span>
                              )}
                            </div>
                            <p className="text-sm text-slate-300 mb-3 leading-relaxed">
                              {section.description}
                            </p>
                            <div className="text-xs text-slate-400 space-y-1.5">
                              {section.details.map((detail, idx) => (
                                <motion.div
                                  key={idx}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: idx * 0.05 }}
                                  className="flex items-start gap-2"
                                >
                                  <span className={`text-${group.color.split('-')[1]}-400 mt-0.5`}>▸</span>
                                  <span>{detail}</span>
                                </motion.div>
                              ))}
                            </div>
                          </div>
                          <motion.div
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            className="ml-4 flex-shrink-0"
                          >
                            <div className={`p-2 rounded-lg ${isExpanded ? 'bg-indigo-500/20' : 'bg-slate-700/50'} group-hover:bg-indigo-500/30 transition-colors`}>
                              <svg
                                className="w-6 h-6 text-slate-300 group-hover:text-indigo-300 transition-colors"
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
                              </svg>
                            </div>
                          </motion.div>
                        </button>

                        {/* Section Content */}
                        <AnimatePresence>
                          {isExpanded && config && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.3 }}
                              className="border-t-2 border-slate-700 overflow-hidden"
                            >
                              <div className="p-5 bg-slate-900/50">
                                {section.editor === "unified" && section.id === "programs_registry" ? (
                                  <UnifiedProgramEditor
                                    programs={config.programs || {}}
                                    categoryDefinitions={config.category_definitions || {}}
                                    onUpdate={async (updatedPrograms) => {
                                      const updatedRegistry = {
                                        ...config,
                                        programs: updatedPrograms,
                                      };
                                      await onSave("programs_registry", updatedRegistry);
                                    }}
                                  />
                                ) : section.editor === "behaviour" && section.id === "behaviour" ? (
                                  <BehaviourConfigEditor
                                    config={config}
                                    onSave={onSave}
                                  />
                                ) : (
                                  <SmartConfigEditor
                                    category={
                                      section.id === "process_scanner"
                                        ? "programs_config"
                                        : section.id === "shared"
                                        ? "shared_config"
                                        : section.id === "network"
                                        ? "network_config"
                                        : section.id === "behaviour"
                                        ? "behaviour_config"
                                        : section.id === "screen"
                                        ? "screen_config"
                                        : section.id === "vm"
                                        ? "vm_config"
                                        : section.id === "obfuscation"
                                        ? "obfuscation_config"
                                        : `${section.id}_config`
                                    }
                                    config={config}
                                    onSave={onSave}
                                  />
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
