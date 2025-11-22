"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import SmartConfigEditor from "./SmartConfigEditor";

interface MonitoringSettingsEditorProps {
  networkConfig?: any;
  behaviourConfig?: any;
  screenConfig?: any;
  vmConfig?: any;
  onSave: (category: string, updates: any) => Promise<void>;
}

export default function MonitoringSettingsEditor({
  networkConfig,
  behaviourConfig,
  screenConfig,
  vmConfig,
  onSave,
}: MonitoringSettingsEditorProps) {
  const sections = [
    {
      id: "network",
      label: "Network Detection",
      icon: "🌐",
      config: networkConfig,
      description:
        "Telegram detection, traffic monitoring, and network-based RTA detection settings",
    },
    {
      id: "behaviour",
      label: "Behaviour Detection",
      icon: "👤",
      config: behaviourConfig,
      description: "Behavioral analysis thresholds and detection parameters",
    },
    {
      id: "screen",
      label: "Screen Detection",
      icon: "🖥️",
      config: screenConfig,
      description: "Screen monitoring and OCR-based detection settings",
    },
    {
      id: "vm",
      label: "VM Detection",
      icon: "💻",
      config: vmConfig,
      description:
        "Virtual machine detection and sandbox identification settings",
    },
  ].filter((section) => section.config); // Only show sections with config

  // Set initial active section to first available section
  const [activeSection, setActiveSection] = useState<string>("network");

  // Update activeSection when sections change
  useEffect(() => {
    if (sections.length > 0 && !sections.find((s) => s.id === activeSection)) {
      setActiveSection(sections[0].id);
    }
  }, [sections, activeSection]);

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-2">
          Monitoring Settings
        </h3>
        <p className="text-slate-400 text-sm mb-6">
          Configure detection thresholds and monitoring parameters for Network,
          Behaviour, Screen, and VM detection.
        </p>

        {sections.length === 0 ? (
          <div className="text-center text-slate-400 py-8">
            <p>No monitoring configuration data available</p>
          </div>
        ) : (
          <>
            {/* Section Tabs */}
            <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-700/50 pb-4">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                    activeSection === section.id
                      ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                      : "bg-slate-700/30 text-slate-400 hover:bg-slate-700/50 hover:text-white"
                  }`}
                >
                  <span>{section.icon}</span>
                  <span>{section.label}</span>
                </button>
              ))}
            </div>

            {/* Active Section Content */}
            {sections.map(
              (section) =>
                activeSection === section.id && (
                  <motion.div
                    key={section.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="mb-4">
                      <h4 className="text-white font-medium mb-1 flex items-center gap-2">
                        <span>{section.icon}</span>
                        <span>{section.label}</span>
                      </h4>
                      <p className="text-sm text-slate-400">
                        {section.description}
                      </p>
                    </div>
                    <SmartConfigEditor
                      category={`${section.id}_config`}
                      config={section.config}
                      onSave={onSave}
                    />
                  </motion.div>
                )
            )}
          </>
        )}
      </div>
    </div>
  );
}
