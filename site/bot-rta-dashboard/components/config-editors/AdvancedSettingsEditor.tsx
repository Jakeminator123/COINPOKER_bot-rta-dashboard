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
  onSave: (category: string, updates: any) => Promise<void>;
  initialGroup?: string;
  initialSection?: string;
}

// =============================================================================
// RESTRUCTURED SETTINGS - Clearer, more logical organization
// =============================================================================
const SETTINGS_GROUPS = [
  // =========================================================================
  // GROUP 1: THREAT DATABASE - What programs/sites trigger alerts
  // =========================================================================
  {
    id: "threats",
    title: "Threat Database",
    icon: "🎯",
    description: "Programs and websites that trigger detection alerts",
    color: "from-red-500 to-rose-600",
    gradient: "bg-gradient-to-br from-red-500/20 to-rose-600/20",
    borderColor: "border-red-500/30",
    explanation:
      "This database contains TWO SEPARATE categories of threats:\n\n" +
      "1️⃣ PROGRAMS (.exe files) - Detected by scanning running processes\n" +
      "2️⃣ WEBSITES/DOMAINS - Detected by monitoring browser titles and DNS\n\n" +
      "⚠️ IMPORTANT: Don't mix them! Websites go in 'Network Threats', programs go in 'Program Threats'.",
    sections: [
      {
        id: "programs_registry",
        title: "🖥️ Program Threats (.exe files)",
        description:
          "Executable programs detected by process scanning. Add ONLY .exe process names here - NOT websites!",
        config: "programsRegistry",
        editor: "unified",
        details: [
          "✅ CORRECT: warbot.exe, holdembot.exe, autohotkey.exe, piosolver.exe",
          "❌ WRONG: gtowizard.com, rta.poker (these are WEBSITES, not programs!)",
          "🤖 Bots: WarBot, HoldemBot, OpenHoldem (15 points - CRITICAL)",
          "📊 RTA Tools: PioSolver, GTO+, MonkerSolver (10 points - ALERT)",
          "⌨️ Macros: AutoHotkey, AutoIt, TinyTask (10 points - ALERT)",
          "⚠️ Kill Flag: If enabled, CoinPoker closes when this program is detected",
        ],
      },
      {
        id: "network_threats",
        title: "🌐 Network Threats (Websites & Domains)",
        description:
          "Websites and domains detected by browser monitoring and DNS. Add URLs and domain patterns here - NOT .exe files!",
        config: "networkConfig",
        editor: "web",
        details: [
          "✅ CORRECT: gtowizard.com, rta.poker, telegram.org, ngrok.io",
          "❌ WRONG: piosolver.exe, warbot.exe (these are PROGRAMS, not websites!)",
          "🎯 RTA Websites: gtowizard.com, rta.poker (CRITICAL)",
          "🔗 Tunneling: ngrok.io, .onion, tor2web (ALERT)",
          "💬 Communication: telegram.org, discord.com (WARN)",
          "🖥️ Remote Access: teamviewer, anydesk (WARN)",
        ],
      },
      {
        id: "whitelist",
        title: "✅ Whitelist / Ignore List",
        description:
          "Programs and websites that should NEVER trigger alerts. Use this for false positives or legitimate tools.",
        config: "programsConfig",
        editor: "whitelist",
        details: [
          "🖥️ Program Whitelist: .exe files to never flag",
          "🌐 Website Whitelist: Domains to never flag",
          "⚠️ Use sparingly - only for confirmed false positives",
        ],
      },
    ],
  },

  // =========================================================================
  // GROUP 2: DETECTION METHODS - How the scanner detects threats
  // =========================================================================
  {
    id: "detection_methods",
    title: "Detection Methods",
    icon: "🔍",
    description: "Configure HOW each detection method works: sensitivity, thresholds, and analysis parameters",
    color: "from-blue-500 to-cyan-600",
    gradient: "bg-gradient-to-br from-blue-500/20 to-cyan-600/20",
    borderColor: "border-blue-500/30",
    explanation:
      "These settings control the SENSITIVITY and BEHAVIOR of each detection method. They don't define WHAT to detect (that's in Threat Database), but HOW to detect it. For example: how fast mouse movements must be to trigger bot detection, what entropy level indicates obfuscated code, or which paths are suspicious for executables.",
    sections: [
      {
        id: "behaviour",
        title: "🖱️ Behavior Analysis",
        description:
          "Detects bot-like input patterns: robotic mouse movements, inhuman click timing, perfect keyboard intervals.",
        config: "behaviourConfig",
        editor: "behaviour",
        details: [
          "📊 Data Collection: How often to sample mouse/keyboard (polling frequency)",
          "🎯 Thresholds: What patterns are considered 'too perfect' or 'too fast'",
          "⚖️ Scoring: How much each pattern contributes to the bot score",
          "📤 Reporting: When to send alerts and cooldown periods",
        ],
      },
      {
        id: "process_scanner",
        title: "⚙️ Process Scanner",
        description:
          "Scans running processes for threats: checks executable names, paths, command lines, and PE headers.",
        config: "programsConfig",
        editor: "smart",
        details: [
          "📁 Expected Locations: Where legitimate programs should be installed",
          "⚠️ Suspicious Paths: Temp folders, user downloads (higher risk)",
          "🔍 Macro Headers: Binary signatures for AutoHotkey, AutoIt, CheatEngine",
          "✅ Safe Processes: Windows system processes to ignore",
          "🚫 Ignored Programs: False positives to skip",
        ],
      },
      {
        id: "screen",
        title: "🖼️ Screen Monitoring",
        description:
          "Detects suspicious overlays, HUD windows, and screen automation tools.",
        config: "screenConfig",
        editor: "smart",
        details: [
          "🪟 Overlay Detection: Transparent windows over poker tables",
          "📊 HUD Patterns: Known HUD window classes and titles",
          "🔄 Window Hierarchy: Parent-child window relationships",
          "🤖 Background Automation: Hidden windows with automation",
        ],
      },
      {
        id: "vm",
        title: "💻 VM Detection",
        description:
          "Detects if poker is running inside a virtual machine (often used to run bots).",
        config: "vmConfig",
        editor: "smart",
        details: [
          "🔧 VM Processes: VirtualBox, VMware, Hyper-V guest tools",
          "🖥️ Hardware Fingerprints: Virtual hardware identifiers",
          "📝 Registry Markers: VM-specific registry entries",
          "📈 Probability Scoring: Combined VM likelihood score",
        ],
      },
      {
        id: "obfuscation",
        title: "🔐 Code Obfuscation",
        description:
          "Detects packed, encrypted, or obfuscated executables (often indicates malicious intent).",
        config: "obfuscationConfig",
        editor: "smart",
        details: [
          "📦 Packer Signatures: UPX, Themida, VMProtect detection",
          "🔢 Entropy Analysis: High entropy = likely encrypted/packed",
          "🛡️ Anti-Debug: Techniques to evade analysis",
          "📊 Code Structure: Unusual PE sections and imports",
        ],
      },
      {
        id: "virustotal",
        title: "🦠 VirusTotal Integration",
        description:
          "Checks unknown executables against VirusTotal's database of 70+ antivirus engines.",
        config: "programsConfig",
        editor: "smart",
        details: [
          "🔑 API Key: Stored in config.txt (VirusTotalAPIKey) for security",
          "⏱️ Rate Limiting: Free tier = 4 requests/min (20s between lookups)",
          "💾 Caching: Results cached for 24h to avoid repeated lookups",
          "🎯 Thresholds: 5+ AV detections = CRITICAL, 2+ = ALERT",
          "🎰 Poker Keywords: Auto-detect poker-related tools in VT results",
        ],
      },
      {
        id: "detection_points",
        title: "⚡ Detection Points Configuration",
        description:
          "Configure how many threat points each type of detection generates. Higher points = more severe alert.",
        config: "all",
        editor: "points",
        details: [
          "0 = INFO (informational, no action)",
          "5 = WARN (suspicious, monitor)",
          "10 = ALERT (likely threat, investigate)",
          "15 = CRITICAL (confirmed threat, immediate action)",
        ],
      },
    ],
  },

  // =========================================================================
  // GROUP 3: SYSTEM REFERENCE - Shared definitions and identifiers
  // =========================================================================
  {
    id: "system",
    title: "System Reference",
    icon: "📚",
    description: "Shared definitions used by all detection modules: poker site identifiers, browser lists, point mappings",
    color: "from-purple-500 to-violet-600",
    gradient: "bg-gradient-to-br from-purple-500/20 to-violet-600/20",
    borderColor: "border-purple-500/30",
    explanation:
      "This is REFERENCE DATA - shared definitions that multiple detection modules use. It defines things like 'what is the CoinPoker process name?', 'what browsers exist?', and 'what do the threat levels mean?'. This is NOT where you add programs to detect - that's in Threat Database. This is for system-wide identifiers and mappings.",
    sections: [
      {
        id: "shared",
        title: "🔧 Shared Configuration",
        description:
          "System-wide reference data: protected poker site (CoinPoker), browser process names, point level definitions.",
        config: "sharedConfig",
        editor: "smart",
        details: [
          "🎰 Protected Poker: CoinPoker process name, window class, path hints",
          "🌐 Browser List: Known browser processes (for context, not detection)",
          "📱 Communication Apps: Telegram, Discord, etc. (reference list)",
          "📊 Points Mapping: What 0/5/10/15 points mean (INFO/WARN/ALERT/CRITICAL)",
          "🎲 Other Poker Sites: PokerStars, GGPoker, etc. (for context)",
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
  initialGroup,
  initialSection,
}: AdvancedSettingsEditorProps) {
  const [activeGroup, setActiveGroup] = useState<string>(
    initialGroup || "threats"
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
      case "behaviour":
        return "Mouse, keyboard, and click analysis";
      case "process_scanner": {
        const safeCount = Object.keys(config.ioc?.safe_processes || {}).length;
        const hashCount = Object.keys(config.ioc?.bad_hashes || {}).length;
        return `${safeCount} safe processes, ${hashCount} known bad hashes`;
      }
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Quick Stats Banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-3 gap-4 mb-6"
      >
        <div className="bg-gradient-to-br from-red-500/10 to-rose-600/10 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎯</span>
            <div>
              <div className="text-sm text-slate-400">Program Threats</div>
              <div className="text-xl font-bold text-white">
                {Object.keys(programsRegistry?.programs || {}).length}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-blue-500/10 to-cyan-600/10 border border-blue-500/20 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌐</span>
            <div>
              <div className="text-sm text-slate-400">Network Patterns</div>
              <div className="text-xl font-bold text-white">
                {Object.keys(networkConfig?.web_monitoring?.rta_websites || {}).length +
                  Object.keys(networkConfig?.web_monitoring?.suspicious_domains || {}).length +
                  Object.keys(networkConfig?.traffic_monitoring?.suspicious_ports || {}).length}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-purple-500/10 to-violet-600/10 border border-purple-500/20 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔍</span>
            <div>
              <div className="text-sm text-slate-400">Detection Methods</div>
              <div className="text-xl font-bold text-white">5</div>
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
                                  section.id === "behaviour" ? (
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
                                      configName="behaviour_config"
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
                                      configName="screen_config"
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
                                      configName="programs_config"
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
                                      configName="network_config"
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
                                      configName="obfuscation_config"
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
                                  </div>
                                ) : (
                                  <SmartConfigEditor
                                    category={
                                      section.id === "process_scanner"
                                        ? "programs_config"
                                        : section.id === "shared"
                                        ? "shared_config"
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
