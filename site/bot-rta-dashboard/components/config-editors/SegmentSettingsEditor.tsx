"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import SmartConfigEditor from "./SmartConfigEditor";

interface SegmentSettingsEditorProps {
  networkConfig?: any;
  behaviourConfig?: any;
  screenConfig?: any;
  vmConfig?: any;
  programsConfig?: any; // programs_registry.json (master program list)
  programsConfigSettings?: any; // programs_config.json (process scanner specific settings)
  obfuscationConfig?: any;
  onSave: (category: string, updates: any) => Promise<void>;
}

// Segment definitions matching actual Python segments
const SEGMENTS = [
  {
    id: "automation",
    name: "Automation Detector",
    category: "auto",
    icon: "🤖",
    description: "Detects automation tools, scripting engines, and macro software",
    configKey: "programs_registry", // Uses programs_registry for automation programs
    configCategory: "programs_registry",
    details: [
      "Scans running processes for Python, AutoHotkey, AutoIt, and other automation tools",
      "Detects script files (.ahk, .py, .au3) being executed",
      "Monitors for known bot frameworks and macro software",
      "Interval: 20 seconds (light operation)",
    ],
  },
  {
    id: "behaviour",
    name: "Behaviour Detector",
    category: "behaviour",
    icon: "👤",
    description: "Analyzes mouse and keyboard patterns to detect bot-like behavior",
    configKey: "behaviour_config",
    configCategory: "behaviour_config",
    details: [
      "Tracks inter-keystroke intervals (IKI) and inter-click intervals (ICI)",
      "Detects constant velocity mouse movements",
      "Identifies repeated pixel clicks",
      "Analyzes directional variability and jitter patterns",
      "Interval: 10 seconds (configurable)",
    ],
  },
  {
    id: "web_monitor",
    name: "Web Monitor",
    category: "network",
    icon: "🌐",
    description: "Monitors browser windows and DNS queries for RTA sites",
    configKey: "network_config",
    configCategory: "network_config",
    details: [
      "Scans browser window titles for GTO Wizard, RTA.poker, and other solver sites",
      "Monitors DNS cache for suspicious domain lookups",
      "Detects RTA sites during CoinPoker sessions",
      "Interval: 20 seconds (light operation)",
    ],
  },
  {
    id: "telegram",
    name: "Telegram Detector",
    category: "network",
    icon: "📱",
    description: "Detects active Telegram connections when CoinPoker is running",
    configKey: "network_config",
    configCategory: "network_config",
    details: [
      "Monitors network connections to Telegram IP ranges",
      "Detects TDLib (Telegram library) usage",
      "Only reports when CoinPoker is active",
      "Interval: 20 seconds (light operation)",
    ],
  },
  {
    id: "traffic_monitor",
    name: "Traffic Monitor",
    category: "network",
    icon: "🔌",
    description: "Monitors network connections and traffic patterns",
    configKey: "network_config",
    configCategory: "network_config",
    details: [
      "Tracks active network connections",
      "Detects remote desktop (RDP/VNC) connections",
      "Monitors suspicious network activity",
      "Interval: 20 seconds (light operation)",
    ],
  },
  {
    id: "process_scanner",
    name: "Process Scanner",
    category: "programs",
    icon: "🔍",
    description: "Scans running processes for suspicious programs and renaming",
    configKey: "programs_config_settings", // Uses programs_config.json for scanner-specific settings
    configCategory: "programs_config",
    details: [
      "Detects CoinPoker process and triggers player name extraction",
      "Identifies suspicious process renaming",
      "Detects compiled macro/script signatures (AUT0HOOK, AUT0IT, CHEATENG)",
      "Monitors for unexpected program locations (drop zones)",
      "Configures ignored programs (false positives)",
      "Uses programs_registry.json for program definitions",
      "Interval: 20 seconds (light operation)",
    ],
  },
  {
    id: "hash_scanner",
    name: "Hash & Signature Scanner",
    category: "programs",
    icon: "🔐",
    description: "Analyzes file hashes and digital signatures via VirusTotal",
    configKey: "programs_registry",
    configCategory: "programs_registry",
    details: [
      "Calculates SHA-256 hashes of suspicious files",
      "Queries VirusTotal API for known malware signatures",
      "Verifies digital signatures",
      "Interval: 120 seconds (heavy operation)",
    ],
  },
  {
    id: "content_analyzer",
    name: "Content Analyzer",
    category: "programs",
    icon: "📄",
    description: "Analyzes file content for entropy, packers, and obfuscation",
    configKey: "programs_registry",
    configCategory: "programs_registry",
    details: [
      "Calculates file entropy to detect packed/encrypted files",
      "Detects common packer signatures",
      "Analyzes file structure for suspicious patterns",
      "Interval: 120 seconds (heavy operation)",
    ],
  },
  {
    id: "obfuscation",
    name: "Obfuscation Detector",
    category: "programs",
    icon: "🔒",
    description: "Detects code obfuscation and anti-analysis techniques",
    configKey: "obfuscation_config",
    configCategory: "obfuscation_config",
    details: [
      "Identifies obfuscated code patterns",
      "Detects anti-debugging techniques",
      "Analyzes code structure for obfuscation markers",
      "Interval: 120 seconds (heavy operation)",
    ],
  },
  {
    id: "screen",
    name: "Screen Detector",
    category: "screen",
    icon: "🖥️",
    description: "Monitors windows, overlays, and screen-based threats",
    configKey: "screen_config",
    configCategory: "screen_config",
    details: [
      "Detects overlay windows above CoinPoker",
      "Monitors HUD (Heads-Up Display) overlays",
      "Tracks window hierarchies and suspicious child windows",
      "Detects background automation (WinEvent hooks)",
      "Interval: 20 seconds (light operation)",
    ],
  },
  {
    id: "vm",
    name: "VM Detector",
    category: "vm",
    icon: "💻",
    description: "Detects virtual machines and virtualization software",
    configKey: "vm_config",
    configCategory: "vm_config",
    details: [
      "Uses WMI to check hardware manufacturer/model",
      "Detects VM guest tools (VMware, VirtualBox, etc.)",
      "Checks registry for VM markers",
      "Analyzes MAC addresses and CPUID for hypervisor presence",
      "Interval: 120 seconds (heavy operation)",
    ],
  },
];

export default function SegmentSettingsEditor({
  networkConfig,
  behaviourConfig,
  screenConfig,
  vmConfig,
  programsConfig, // programs_registry.json
  programsConfigSettings, // programs_config.json
  obfuscationConfig,
  onSave,
}: SegmentSettingsEditorProps) {
  // Group segments by category
  const segmentsByCategory = SEGMENTS.reduce((acc, segment) => {
    if (!acc[segment.category]) {
      acc[segment.category] = [];
    }
    acc[segment.category].push(segment);
    return acc;
  }, {} as Record<string, typeof SEGMENTS>);

  const categories = [
    { id: "auto", name: "Automation", icon: "🤖", color: "from-orange-500 to-red-600" },
    { id: "programs", name: "Programs", icon: "💻", color: "from-blue-500 to-cyan-600" },
    { id: "network", name: "Network", icon: "🌐", color: "from-green-500 to-emerald-600" },
    { id: "behaviour", name: "Behaviour", icon: "👤", color: "from-purple-500 to-pink-600" },
    { id: "screen", name: "Screen", icon: "🖥️", color: "from-indigo-500 to-blue-600" },
    { id: "vm", name: "Virtual Machines", icon: "💻", color: "from-gray-500 to-slate-600" },
  ];

  const [activeCategory, setActiveCategory] = useState<string>("auto");
  const [activeSegment, setActiveSegment] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["auto"])
  );

  // Get config for a segment
  const getSegmentConfig = (segment: typeof SEGMENTS[0]) => {
    switch (segment.configKey) {
      case "network_config":
        return networkConfig;
      case "behaviour_config":
        return behaviourConfig;
      case "screen_config":
        return screenConfig;
      case "vm_config":
        return vmConfig;
      case "programs_registry":
        return programsConfig; // programs_registry.json (master program list)
      case "programs_config_settings":
        return programsConfigSettings; // programs_config.json (process scanner settings)
      case "obfuscation_config":
        return obfuscationConfig;
      default:
        return null;
    }
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  return (
    <div className="space-y-6">
      {/* Category Navigation */}
      <div className="flex flex-wrap gap-3 mb-6">
        {categories.map((category) => {
          const segmentCount = segmentsByCategory[category.id]?.length || 0;
          const isActive = activeCategory === category.id;
          return (
            <motion.button
              key={category.id}
              onClick={() => {
                setActiveCategory(category.id);
                if (!expandedCategories.has(category.id)) {
                  setExpandedCategories((prev) => new Set(prev).add(category.id));
                }
              }}
              className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 relative ${
                isActive
                  ? `bg-gradient-to-r ${category.color} text-white shadow-lg`
                  : "bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 hover:text-white"
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="text-xl">{category.icon}</span>
              <span>{category.name}</span>
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded">
                {segmentCount}
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Segments List */}
      <div className="space-y-4">
        {categories
          .filter((cat) => segmentsByCategory[cat.id])
          .map((category) => {
            const segments = segmentsByCategory[category.id] || [];
            const isExpanded = expandedCategories.has(category.id);
            const isActiveCategory = activeCategory === category.id;

            return (
              <motion.div
                key={category.id}
                initial={false}
                animate={{
                  opacity: isActiveCategory ? 1 : 0.7,
                }}
                className="glass-card p-4"
              >
                {/* Category Header */}
                <button
                  onClick={() => toggleCategory(category.id)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{category.icon}</span>
                    <div>
                      <h3 className="text-lg font-semibold text-white">
                        {category.name} Detection
                      </h3>
                      <p className="text-sm text-slate-400">
                        {segments.length} segment{segments.length !== 1 ? "s" : ""}
                      </p>
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

                {/* Segments */}
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-4 space-y-3"
                  >
                    {segments.map((segment) => {
                      const config = getSegmentConfig(segment);
                      const isSegmentActive = activeSegment === segment.id;

                      return (
                        <div
                          key={segment.id}
                          className={`border rounded-lg p-4 transition-all ${
                            isSegmentActive
                              ? "border-indigo-500 bg-indigo-500/10"
                              : "border-slate-700 bg-slate-800/30 hover:border-slate-600"
                          }`}
                        >
                          {/* Segment Header */}
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xl">{segment.icon}</span>
                                <h4 className="font-semibold text-white">
                                  {segment.name}
                                </h4>
                                {config ? (
                                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
                                    Configured
                                  </span>
                                ) : (
                                  <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
                                    No Config
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-400 mb-2">
                                {segment.description}
                              </p>
                              <div className="text-xs text-slate-500 space-y-1">
                                {segment.details.map((detail, idx) => (
                                  <div key={idx} className="flex items-start gap-2">
                                    <span className="text-indigo-400 mt-0.5">•</span>
                                    <span>{detail}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Config Editor */}
                          {config && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{
                                opacity: isSegmentActive ? 1 : 0,
                                height: isSegmentActive ? "auto" : 0,
                              }}
                              className="overflow-hidden"
                            >
                              <div className="mt-4 pt-4 border-t border-slate-700">
                                <button
                                  onClick={() =>
                                    setActiveSegment(
                                      isSegmentActive ? null : segment.id
                                    )
                                  }
                                  className="text-sm text-indigo-400 hover:text-indigo-300 mb-3 flex items-center gap-1"
                                >
                                  {isSegmentActive ? "Hide" : "Show"} Configuration
                                  <motion.svg
                                    animate={{ rotate: isSegmentActive ? 180 : 0 }}
                                    className="w-4 h-4"
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
                                {isSegmentActive && (
                                  <SmartConfigEditor
                                    category={segment.configCategory}
                                    config={config}
                                    onSave={onSave}
                                  />
                                )}
                              </div>
                            </motion.div>
                          )}
                        </div>
                      );
                    })}
                  </motion.div>
                )}
              </motion.div>
            );
          })}
      </div>
    </div>
  );
}

