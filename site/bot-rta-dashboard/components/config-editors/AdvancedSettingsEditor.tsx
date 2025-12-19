"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import SmartConfigEditor from "./SmartConfigEditor";
import UnifiedProgramEditor from "./UnifiedProgramEditor";
import BehaviourConfigEditor from "./BehaviourConfigEditor";
import WebMonitoringEditor from "./WebMonitoringEditor";
import WhitelistEditor from "./WhitelistEditor";
import DetectionPointsEditor from "./DetectionPointsEditor";

interface AdvancedSettingsEditorProps {
  programsRegistry?: any;
  programsConfig?: any;
  networkConfig?: any;
  behaviourConfig?: any;
  screenConfig?: any;
  vmConfig?: any;
  obfuscationConfig?: any;
  sharedConfig?: any;
  securityConfig?: any;
  autoConfig?: any;
  onSave: (category: string, updates: any) => Promise<void>;
  initialGroup?: string;
  initialSection?: string;
}

// =============================================================================
// SEGMENT-BASED SETTINGS - Mirrors scanner segment structure (7 categories)
// =============================================================================
const SETTINGS_GROUPS = [
  // =========================================================================
  // SEGMENT 1: PROGRAMS - Process detection, hash scanning, signatures
  // =========================================================================
  {
    id: "programs",
    title: "Programs",
    icon: "🖥️",
    description: "Process scanning, hash detection, and executable analysis",
    color: "from-purple-500 to-violet-600",
    gradient: "bg-gradient-to-br from-purple-500/20 to-violet-600/20",
    borderColor: "border-purple-500/30",
    explanation:
      "Detects suspicious programs by scanning running processes. Includes:\n" +
      "• Process name matching against known threats\n" +
      "• SHA-256 hash lookups in the hash database\n" +
      "• Signature scanning for macro/script headers\n" +
      "• Code obfuscation detection (packers, entropy)",
    sections: [
      {
        id: "programs_registry",
        title: "🎯 Program Threat Registry",
        description: "Database of known threats - executables and their detection parameters.",
        config: "programsRegistry",
        editor: "unified",
        details: [
          "🤖 Bots: WarBot, HoldemBot, OpenHoldem (15 points - CRITICAL)",
          "📊 RTA Tools: PioSolver, GTO+, MonkerSolver (10 points - ALERT)",
          "⌨️ Macros: AutoHotkey, AutoIt, TinyTask (10 points - ALERT)",
        ],
      },
      {
        id: "process_scanner",
        title: "⚙️ Scanner Settings",
        description: "How the process scanner operates - paths, signatures, safe processes.",
        config: "programsConfig",
        editor: "smart",
        details: [
          "📁 Expected Locations: Where legitimate programs should be",
          "⚠️ Suspicious Paths: Temp folders, user downloads",
          "🔍 Macro Headers: Binary signatures for macro detection",
          "✅ Safe Processes: Windows system processes to ignore",
        ],
      },
      {
        id: "obfuscation",
        title: "🔐 Obfuscation Detection",
        description: "Detects packed, encrypted, or obfuscated executables.",
        config: "obfuscationConfig",
        editor: "smart",
        details: [
          "📦 Packer Signatures: UPX, Themida, VMProtect",
          "🔢 Entropy Analysis: High entropy = likely packed",
          "🛡️ Anti-Debug: Techniques to evade analysis",
        ],
      },
    ],
  },

  // =========================================================================
  // SEGMENT 2: NETWORK - DNS, browser monitoring, connections
  // =========================================================================
  {
    id: "network",
    title: "Network",
    icon: "🌐",
    description: "DNS queries, browser monitoring, and connection analysis",
    color: "from-blue-500 to-cyan-600",
    gradient: "bg-gradient-to-br from-blue-500/20 to-cyan-600/20",
    borderColor: "border-blue-500/30",
    explanation:
      "Monitors network activity for suspicious patterns:\n" +
      "• RTA website visits (GTO Wizard, etc.)\n" +
      "• DNS queries to known threat domains\n" +
      "• Browser window titles\n" +
      "• Suspicious port connections",
    sections: [
      {
        id: "network_threats",
        title: "🎯 Network Threats",
        description: "Websites and domains that trigger detection alerts.",
        config: "networkConfig",
        editor: "web",
        details: [
          "🎯 RTA Websites: gtowizard.com, rta.poker (CRITICAL)",
          "🔗 Tunneling: ngrok.io, .onion, tor2web (ALERT)",
          "💬 Communication: telegram.org, discord.com (WARN)",
          "🖥️ Remote Access: teamviewer, anydesk (WARN)",
        ],
      },
      {
        id: "network_settings",
        title: "⚙️ Network Scanner Settings",
        description: "How the network scanner operates - monitoring intervals, thresholds.",
        config: "networkConfig",
        editor: "smart",
        details: [
          "📡 DNS Monitoring: Query interception settings",
          "🌐 Browser Detection: Window title scanning",
          "🔌 Port Analysis: Suspicious connection detection",
        ],
      },
    ],
  },

  // =========================================================================
  // SEGMENT 3: BEHAVIOUR - Mouse, keyboard, click patterns
  // =========================================================================
  {
    id: "behaviour",
    title: "Behaviour",
    icon: "🎯",
    description: "Mouse movements, keyboard input, and timing analysis",
    color: "from-amber-500 to-orange-600",
    gradient: "bg-gradient-to-br from-amber-500/20 to-orange-600/20",
    borderColor: "border-amber-500/30",
    explanation:
      "Detects bot-like input patterns by analyzing:\n" +
      "• Mouse movement speed and trajectory\n" +
      "• Click timing and precision\n" +
      "• Keyboard input intervals\n" +
      "• Action timing consistency",
    sections: [
      {
        id: "behaviour_config",
        title: "🖱️ Behaviour Analysis",
        description: "Configure mouse, keyboard, and click pattern detection.",
        config: "behaviourConfig",
        editor: "behaviour",
        details: [
          "📊 Polling: How often to sample input (frequency)",
          "🎯 Thresholds: What patterns trigger alerts",
          "⚖️ Scoring: How much each pattern contributes",
          "📤 Reporting: Alert cooldowns and aggregation",
        ],
      },
    ],
  },

  // =========================================================================
  // SEGMENT 4: VM - Virtual machine detection
  // =========================================================================
  {
    id: "vm",
    title: "Virtual Machines",
    icon: "💻",
    description: "VMware, VirtualBox, Hyper-V, and sandbox detection",
    color: "from-emerald-500 to-teal-600",
    gradient: "bg-gradient-to-br from-emerald-500/20 to-teal-600/20",
    borderColor: "border-emerald-500/30",
    explanation:
      "Detects if the scanner is running inside a virtual machine:\n" +
      "• VM guest tools (VirtualBox additions, VMware tools)\n" +
      "• Virtual hardware fingerprints\n" +
      "• Registry markers from VM software\n" +
      "• Combined probability scoring",
    sections: [
      {
        id: "vm_config",
        title: "💻 VM Detection",
        description: "Configure virtual machine detection parameters.",
        config: "vmConfig",
        editor: "smart",
        details: [
          "🔧 VM Processes: VirtualBox, VMware, Hyper-V",
          "🖥️ Hardware Fingerprints: Virtual devices",
          "📝 Registry Markers: VM-specific entries",
          "📈 Probability Scoring: Likelihood calculation",
        ],
      },
    ],
  },

  // =========================================================================
  // SEGMENT 5: AUTO - Automation tools, macros, scripts
  // =========================================================================
  {
    id: "auto",
    title: "Automation",
    icon: "⚙️",
    description: "AutoHotkey, Python scripts, macro detection",
    color: "from-rose-500 to-pink-600",
    gradient: "bg-gradient-to-br from-rose-500/20 to-pink-600/20",
    borderColor: "border-rose-500/30",
    explanation:
      "Detects automation tools and scripting environments:\n" +
      "• AutoHotkey scripts and compiled macros\n" +
      "• Python automation (pyautogui, etc.)\n" +
      "• AutoIt scripts\n" +
      "• Generic auto-clicker patterns",
    sections: [
      {
        id: "auto_config",
        title: "⚙️ Automation Detection",
        description: "Configure macro and script detection parameters.",
        config: "autoConfig",
        editor: "smart",
        details: [
          "🎹 Macro Tools: AutoHotkey, AutoIt signatures",
          "📜 Script Detection: Python, Node.js patterns",
          "🔘 Auto-Clickers: Generic clicker detection",
          "⚡ Timing Analysis: Inhuman timing patterns",
        ],
      },
    ],
  },

  // =========================================================================
  // SEGMENT 6: SCREEN - Overlays, HUDs, window analysis
  // =========================================================================
  {
    id: "screen",
    title: "Screen",
    icon: "🖼️",
    description: "Overlay detection, HUD windows, screen capture",
    color: "from-sky-500 to-blue-600",
    gradient: "bg-gradient-to-br from-sky-500/20 to-blue-600/20",
    borderColor: "border-sky-500/30",
    explanation:
      "Detects suspicious screen activity:\n" +
      "• Transparent overlays on poker windows\n" +
      "• Known HUD window classes\n" +
      "• Window hierarchy analysis\n" +
      "• Hidden automation windows",
    sections: [
      {
        id: "screen_config",
        title: "🖼️ Screen Monitoring",
        description: "Configure overlay and HUD detection parameters.",
        config: "screenConfig",
        editor: "smart",
        details: [
          "🪟 Overlay Detection: Transparent windows",
          "📊 HUD Patterns: Known HUD classes/titles",
          "🔄 Window Hierarchy: Parent-child relationships",
          "🤖 Background Automation: Hidden windows",
        ],
      },
    ],
  },

  // =========================================================================
  // SEGMENT 7: SECURITY - MITM, certificates, proxy detection
  // =========================================================================
  {
    id: "security",
    title: "Security",
    icon: "🔒",
    description: "MITM detection, certificate analysis, proxy detection",
    color: "from-red-500 to-rose-600",
    gradient: "bg-gradient-to-br from-red-500/20 to-rose-600/20",
    borderColor: "border-red-500/30",
    explanation:
      "Detects security threats that could compromise traffic:\n" +
      "• MITM proxy tools (mitmproxy, Burp, Fiddler)\n" +
      "• Suspicious root certificates\n" +
      "• Corporate SSL inspection\n" +
      "• Traffic interception attempts",
    sections: [
      {
        id: "security_config",
        title: "🔒 Security Detection",
        description: "Configure MITM and certificate detection parameters.",
        config: "securityConfig",
        editor: "smart",
        details: [
          "🕵️ MITM Tools: mitmproxy, Burp Suite, Fiddler",
          "🏢 Corporate SSL: Zscaler, Blue Coat, Fortinet",
          "📜 Certificate Stores: Root and CA analysis",
          "⚠️ Traffic Interception: Proxy detection",
        ],
      },
    ],
  },

  // =========================================================================
  // SYSTEM: Shared configuration and whitelist
  // =========================================================================
  {
    id: "system",
    title: "System",
    icon: "📚",
    description: "Shared definitions, whitelist, and detection points",
    color: "from-slate-500 to-gray-600",
    gradient: "bg-gradient-to-br from-slate-500/20 to-gray-600/20",
    borderColor: "border-slate-500/30",
    explanation:
      "System-wide settings used by all detection modules:\n" +
      "• Whitelist for false positives\n" +
      "• Detection point configuration\n" +
      "• Shared reference data (browsers, poker sites)",
    sections: [
      {
        id: "whitelist",
        title: "✅ Whitelist / Ignore List",
        description: "Programs and websites that should NEVER trigger alerts.",
        config: "programsConfig",
        editor: "whitelist",
        details: [
          "🖥️ Program Whitelist: .exe files to never flag",
          "🌐 Website Whitelist: Domains to never flag",
          "⚠️ Use sparingly - only for false positives",
        ],
      },
      {
        id: "detection_points",
        title: "⚡ Detection Points",
        description: "Configure threat points for each detection type.",
        config: "all",
        editor: "points",
        details: [
          "0 = INFO (informational)",
          "5 = WARN (suspicious)",
          "10 = ALERT (likely threat)",
          "15 = CRITICAL (confirmed threat)",
        ],
      },
      {
        id: "shared",
        title: "🔧 Shared Configuration",
        description: "System-wide reference data and identifiers.",
        config: "sharedConfig",
        editor: "smart",
        details: [
          "🎰 Protected Poker: CoinPoker identifiers",
          "🌐 Browser List: Known browser processes",
          "📊 Points Mapping: Threat level definitions",
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
  securityConfig,
  autoConfig,
  onSave,
  initialGroup,
  initialSection,
}: AdvancedSettingsEditorProps) {
  const [activeGroup, setActiveGroup] = useState<string>(
    initialGroup || "programs"
  );
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(initialSection ? [initialSection] : ["programs_registry"])
  );

  useEffect(() => {
    if (initialGroup) {
      setActiveGroup(initialGroup);
    }
    if (initialSection) {
      setExpandedSections(new Set([initialSection]));
    }
  }, [initialGroup, initialSection]);

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
      case "securityConfig":
        return securityConfig;
      case "autoConfig":
        return autoConfig;
      case "all":
        // Return a truthy value for sections that need multiple configs
        return { loaded: true };
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

  // Get stats for a section
  const getSectionStats = (sectionId: string, config: any) => {
    if (!config) return null;

    switch (sectionId) {
      case "programs_registry": {
        const programCount = Object.keys(config.programs || {}).length;
        const categoryCount = Object.keys(config.category_definitions || {}).length;
        return `${programCount} programs in ${categoryCount} categories`;
      }
      case "network_threats": {
        const webMonitoring = config.web_monitoring || {};
        const rtaCount = Object.keys(webMonitoring.rta_websites || {}).length;
        const domainCount = Object.keys(webMonitoring.suspicious_domains || {}).length;
        const portCount = Object.keys(config.traffic_monitoring?.suspicious_ports || {}).length;
        return `${rtaCount} RTA sites, ${domainCount} domains, ${portCount} ports`;
      }
      case "behaviour_config":
        return "Mouse, keyboard, and click analysis";
      case "process_scanner": {
        const ignoredCount = (config.ignored_programs || []).length;
        const sysCount = (config.process_scanner?.windows_system_processes || []).length;
        const expectedLocations =
          config.process_scanner?.expected_program_locations ||
          config.process_scanner?.expected_locations ||
          {};
        const expectedCount = Object.keys(expectedLocations || {}).length;
        return `${ignoredCount} ignored, ${sysCount} system, ${expectedCount} expected locations`;
      }
      case "vm_config":
        return "VMware, VirtualBox, Hyper-V detection";
      case "auto_config":
        return "AutoHotkey, Python, script detection";
      case "screen_config":
        return "Overlay and HUD detection";
      case "security_config":
        return "MITM and certificate detection";
      case "obfuscation":
        return "Packer and entropy analysis";
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Quick Stats Banner - 7 Segment Categories */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-4 lg:grid-cols-7 gap-3 mb-6"
      >
        <div className="bg-gradient-to-br from-purple-500/10 to-violet-600/10 border border-purple-500/20 rounded-xl p-3">
          <div className="flex flex-col items-center text-center">
            <span className="text-xl mb-1">🖥️</span>
            <div className="text-xs text-slate-400">Programs</div>
            <div className="text-lg font-bold text-white">
              {Object.keys(programsRegistry?.programs || {}).length}
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-blue-500/10 to-cyan-600/10 border border-blue-500/20 rounded-xl p-3">
          <div className="flex flex-col items-center text-center">
            <span className="text-xl mb-1">🌐</span>
            <div className="text-xs text-slate-400">Network</div>
            <div className="text-lg font-bold text-white">
              {Object.keys(networkConfig?.web_monitoring?.rta_websites || {}).length +
                Object.keys(networkConfig?.web_monitoring?.suspicious_domains || {}).length}
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-amber-500/10 to-orange-600/10 border border-amber-500/20 rounded-xl p-3">
          <div className="flex flex-col items-center text-center">
            <span className="text-xl mb-1">🎯</span>
            <div className="text-xs text-slate-400">Behaviour</div>
            <div className="text-lg font-bold text-white">
              {behaviourConfig?.enabled !== false ? "ON" : "OFF"}
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500/10 to-teal-600/10 border border-emerald-500/20 rounded-xl p-3">
          <div className="flex flex-col items-center text-center">
            <span className="text-xl mb-1">💻</span>
            <div className="text-xs text-slate-400">VM</div>
            <div className="text-lg font-bold text-white">
              {vmConfig?.enabled !== false ? "ON" : "OFF"}
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-rose-500/10 to-pink-600/10 border border-rose-500/20 rounded-xl p-3">
          <div className="flex flex-col items-center text-center">
            <span className="text-xl mb-1">⚙️</span>
            <div className="text-xs text-slate-400">Auto</div>
            <div className="text-lg font-bold text-white">
              {autoConfig?.enabled !== false ? "ON" : "OFF"}
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-sky-500/10 to-blue-600/10 border border-sky-500/20 rounded-xl p-3">
          <div className="flex flex-col items-center text-center">
            <span className="text-xl mb-1">🖼️</span>
            <div className="text-xs text-slate-400">Screen</div>
            <div className="text-lg font-bold text-white">
              {screenConfig?.enabled !== false ? "ON" : "OFF"}
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-red-500/10 to-rose-600/10 border border-red-500/20 rounded-xl p-3">
          <div className="flex flex-col items-center text-center">
            <span className="text-xl mb-1">🔒</span>
            <div className="text-xs text-slate-400">Security</div>
            <div className="text-lg font-bold text-white">
              {securityConfig?.enabled !== false ? "ON" : "OFF"}
            </div>
          </div>
        </div>
      </motion.div>

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
                  ? `bg-gradient-to-r ${group.color} text-white shadow-xl`
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
                <div className="text-xs opacity-90 mt-0.5 max-w-[200px] truncate">
                  {group.description}
                </div>
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
              <div
                className={`glass-card p-6 rounded-xl border-2 ${group.borderColor} ${group.gradient}`}
              >
                {/* Group Header */}
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
                      <h2 className="text-2xl font-bold text-white mb-2">
                        {group.title}
                      </h2>
                      <p className="text-slate-300 mb-3">{group.description}</p>
                      {group.explanation && (
                        <div className="mt-4 p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
                          <div className="flex items-start gap-2">
                            <span className="text-yellow-400 text-lg flex-shrink-0">
                              💡
                            </span>
                            <div>
                              <p className="text-sm text-slate-200 font-medium mb-1">
                                What is this?
                              </p>
                              <p className="text-sm text-slate-300 leading-relaxed">
                                {group.explanation}
                              </p>
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
                    const stats = getSectionStats(section.id, config);

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
                                  ✓ Loaded
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

                            {/* Stats line */}
                            {stats && (
                              <div className="text-xs text-indigo-400 mb-3 font-medium">
                                📊 {stats}
                              </div>
                            )}

                            {/* Details */}
                            <div className="text-xs text-slate-400 space-y-1.5">
                              {section.details.map((detail, idx) => (
                                <motion.div
                                  key={idx}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: idx * 0.05 }}
                                  className="flex items-start gap-2"
                                >
                                  <span>{detail}</span>
                                </motion.div>
                              ))}
                            </div>
                          </div>
                          <motion.div
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            className="ml-4 flex-shrink-0"
                          >
                            <div
                              className={`p-2 rounded-lg ${
                                isExpanded
                                  ? "bg-indigo-500/20"
                                  : "bg-slate-700/50"
                              } group-hover:bg-indigo-500/30 transition-colors`}
                            >
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
                                {section.editor === "unified" &&
                                section.id === "programs_registry" ? (
                                  <UnifiedProgramEditor
                                    programs={config.programs || {}}
                                    categoryDefinitions={
                                      config.category_definitions || {}
                                    }
                                    onUpdate={async (updatedPrograms) => {
                                      const updatedRegistry = {
                                        ...config,
                                        programs: updatedPrograms,
                                      };
                                      await onSave(
                                        "programs_registry",
                                        updatedRegistry
                                      );
                                    }}
                                  />
                                ) : section.editor === "behaviour" &&
                                  section.id === "behaviour_config" ? (
                                  <BehaviourConfigEditor
                                    config={config}
                                    onSave={onSave}
                                  />
                                ) : section.editor === "web" &&
                                  section.id === "network_threats" ? (
                                  <WebMonitoringEditor
                                    config={config}
                                    onSave={async (updates) => {
                                      await onSave("network_config", updates);
                                    }}
                                  />
                                ) : section.editor === "whitelist" ? (
                                  <WhitelistEditor
                                    programWhitelist={programsConfig?.ignored_programs || []}
                                    websiteWhitelist={networkConfig?.ignored_websites || []}
                                    onSaveProgramWhitelist={async (programs) => {
                                      await onSave("programs_config", {
                                        ...programsConfig,
                                        ignored_programs: programs,
                                      });
                                    }}
                                    onSaveWebsiteWhitelist={async (websites) => {
                                      await onSave("network_config", {
                                        ...networkConfig,
                                        ignored_websites: websites,
                                      });
                                    }}
                                  />
                                ) : section.editor === "points" ? (
                                  <div className="space-y-4">
                                    <DetectionPointsEditor
                                      title="Behaviour Analysis"
                                      icon="🖱️"
                                      description="Points for bot-like mouse/keyboard patterns"
                                      detectionPoints={behaviourConfig?.detection_points || {}}
                                      onSave={async (points) => {
                                        await onSave("behaviour_config", {
                                          ...behaviourConfig,
                                          detection_points: points,
                                        });
                                      }}
                                    />
                                    <DetectionPointsEditor
                                      title="Screen Monitoring"
                                      icon="🖼️"
                                      description="Points for overlays and HUD detection"
                                      detectionPoints={screenConfig?.detection_points || {}}
                                      onSave={async (points) => {
                                        await onSave("screen_config", {
                                          ...screenConfig,
                                          detection_points: points,
                                        });
                                      }}
                                    />
                                    <DetectionPointsEditor
                                      title="Process Scanner"
                                      icon="⚙️"
                                      description="Points for suspicious processes and paths"
                                      detectionPoints={programsConfig?.detection_points || {}}
                                      onSave={async (points) => {
                                        await onSave("programs_config", {
                                          ...programsConfig,
                                          detection_points: points,
                                        });
                                      }}
                                    />
                                    <DetectionPointsEditor
                                      title="Network Detection"
                                      icon="🌐"
                                      description="Points for websites, domains, and traffic"
                                      detectionPoints={networkConfig?.detection_points || {}}
                                      onSave={async (points) => {
                                        await onSave("network_config", {
                                          ...networkConfig,
                                          detection_points: points,
                                        });
                                      }}
                                    />
                                    <DetectionPointsEditor
                                      title="Code Obfuscation"
                                      icon="🔐"
                                      description="Points for packed/encrypted code"
                                      detectionPoints={obfuscationConfig?.detection_points || {}}
                                      onSave={async (points) => {
                                        await onSave("obfuscation_config", {
                                          ...obfuscationConfig,
                                          detection_points: points,
                                        });
                                      }}
                                    />
                                    <DetectionPointsEditor
                                      title="Automation"
                                      icon="⚙️"
                                      description="Points for automation tools and scripts"
                                      detectionPoints={autoConfig?.detection_points || {}}
                                      onSave={async (points) => {
                                        await onSave("auto_config", {
                                          ...autoConfig,
                                          detection_points: points,
                                        });
                                      }}
                                    />
                                    <DetectionPointsEditor
                                      title="Security"
                                      icon="🔒"
                                      description="Points for MITM and certificate-based threats"
                                      detectionPoints={securityConfig?.detection_points || {}}
                                      onSave={async (points) => {
                                        await onSave("security_config", {
                                          ...securityConfig,
                                          detection_points: points,
                                        });
                                      }}
                                    />
                                  </div>
                                ) : (
                                  <SmartConfigEditor
                                    category={
                                      section.id === "process_scanner"
                                        ? "programs_config"
                                        : section.id === "shared"
                                        ? "shared_config"
                                        : section.id === "screen_config"
                                        ? "screen_config"
                                        : section.id === "vm_config"
                                        ? "vm_config"
                                        : section.id === "auto_config"
                                        ? "auto_config"
                                        : section.id === "security_config"
                                        ? "security_config"
                                        : section.id === "obfuscation"
                                        ? "obfuscation_config"
                                        : section.id === "network_settings"
                                        ? "network_config"
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
