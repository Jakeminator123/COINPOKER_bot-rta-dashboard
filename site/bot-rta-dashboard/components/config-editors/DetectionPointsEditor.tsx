'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type PointsLevel = 0 | 5 | 10 | 15;

interface DetectionPointsConfig {
  [key: string]: number | string | object;
}

interface DetectionPointsEditorProps {
  configName: string;
  title: string;
  icon: string;
  description: string;
  detectionPoints: DetectionPointsConfig;
  onSave: (points: DetectionPointsConfig) => Promise<void>;
}

const POINTS_OPTIONS: { value: PointsLevel; label: string; color: string; bgColor: string }[] = [
  { value: 0, label: 'INFO', color: 'text-blue-400', bgColor: 'bg-blue-500/20 border-blue-500/30' },
  { value: 5, label: 'WARN', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20 border-yellow-500/30' },
  { value: 10, label: 'ALERT', color: 'text-orange-400', bgColor: 'bg-orange-500/20 border-orange-500/30' },
  { value: 15, label: 'CRITICAL', color: 'text-red-500', bgColor: 'bg-red-500/20 border-red-500/30' },
];

// Human-readable labels for detection point keys
const POINT_LABELS: Record<string, { label: string; description: string }> = {
  // Screen detection
  overlay_over_poker: { label: 'Overlay Over Poker Table', description: 'Transparent window detected over active poker table' },
  hud_detected: { label: 'HUD Detected', description: 'Poker HUD overlay (HM3, PT4, etc.) detected' },
  suspicious_overlay: { label: 'Suspicious Overlay', description: 'Unknown overlay with suspicious keywords' },
  background_automation: { label: 'Background Automation', description: 'Hidden window automation detected' },
  dangerous_child_window: { label: 'Dangerous Child Window', description: 'Child window with cheat/bot keywords' },
  extended_focus_loss: { label: 'Extended Focus Loss', description: 'Poker window lost focus for extended time' },
  multitable_activity: { label: 'Multi-table Activity', description: 'Activity across multiple poker tables' },
  
  // Behaviour detection
  score_15_24: { label: 'Bot Score 15-24', description: 'Low bot-like behavior detected' },
  score_25_44: { label: 'Bot Score 25-44', description: 'Moderate bot-like behavior detected' },
  score_45_69: { label: 'Bot Score 45-69', description: 'High bot-like behavior detected' },
  score_70_plus: { label: 'Bot Score 70+', description: 'Very high bot-like behavior detected' },
  
  // Obfuscation detection
  score_30_39: { label: 'Obfuscation Score 30-39', description: 'Possibly obfuscated code' },
  score_40_59: { label: 'Obfuscation Score 40-59', description: 'Suspicious obfuscated code' },
  score_60_79: { label: 'Obfuscation Score 60-79', description: 'Likely obfuscated code' },
  score_80_plus: { label: 'Obfuscation Score 80+', description: 'Heavily obfuscated code' },
  
  // Process scanner
  suspicious_path: { label: 'Suspicious Path', description: 'Program running from suspicious location' },
  macro_header_detected: { label: 'Macro Header Detected', description: 'AutoHotkey/AutoIt signature in executable' },
  renamed_executable: { label: 'Renamed Executable', description: 'Known program running with different name' },
  unknown_script_running: { label: 'Unknown Script', description: 'Unknown script/automation detected' },
  virustotal_malware: { label: 'VirusTotal: Malware', description: 'VirusTotal flagged as malware' },
  virustotal_suspicious: { label: 'VirusTotal: Suspicious', description: 'VirusTotal flagged as suspicious' },
  virustotal_poker_related: { label: 'VirusTotal: Poker Related', description: 'VirusTotal found poker-related keywords' },
  
  // Network detection
  rta_website_critical: { label: 'RTA Website (Critical)', description: 'Known RTA site like GTOWizard, RTA.poker' },
  rta_website_alert: { label: 'RTA Website (Alert)', description: 'GTO solver or trainer website' },
  suspicious_domain: { label: 'Suspicious Domain', description: 'Domain with suspicious TLD or pattern' },
  tunneling_service: { label: 'Tunneling Service', description: 'ngrok, Tor, or other tunnel detected' },
  communication_app: { label: 'Communication App', description: 'Telegram, Discord during poker' },
  remote_access: { label: 'Remote Access', description: 'TeamViewer, AnyDesk, etc.' },
  telegram_during_poker: { label: 'Telegram During Poker', description: 'Telegram active while playing' },
  custom_telegram_client: { label: 'Custom Telegram Client', description: 'Non-official Telegram client' },
  bot_token_detected: { label: 'Bot Token Detected', description: 'Telegram bot token found' },
  suspicious_port: { label: 'Suspicious Port', description: 'Connection on suspicious port' },
};

export default function DetectionPointsEditor({
  title,
  icon,
  description,
  detectionPoints,
  onSave,
}: DetectionPointsEditorProps) {
  const [localPoints, setLocalPoints] = useState<DetectionPointsConfig>(detectionPoints);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Filter out metadata keys
  const pointKeys = Object.keys(localPoints).filter(k => !k.startsWith('_'));

  const handlePointChange = async (key: string, value: PointsLevel) => {
    const updated = { ...localPoints, [key]: value };
    setLocalPoints(updated);
    
    setIsSaving(true);
    try {
      await onSave(updated);
      setMessage({ type: 'success', text: 'Points updated' });
      setTimeout(() => setMessage(null), 2000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to save' });
      setLocalPoints(localPoints); // Revert
    } finally {
      setIsSaving(false);
    }
  };

  const getPointInfo = (key: string) => {
    return POINT_LABELS[key] || { label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), description: '' };
  };

  const currentPoints = pointKeys.reduce((acc, key) => {
    const val = localPoints[key];
    if (typeof val === 'number') {
      acc[val] = (acc[val] || 0) + 1;
    }
    return acc;
  }, {} as Record<number, number>);

  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 bg-slate-800/50 hover:bg-slate-800 transition-colors flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div className="text-left">
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="text-sm text-slate-400">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Points summary */}
          <div className="flex gap-2">
            {POINTS_OPTIONS.map((opt) => (
              currentPoints[opt.value] ? (
                <span key={opt.value} className={`px-2 py-1 rounded text-xs font-medium ${opt.bgColor} ${opt.color}`}>
                  {currentPoints[opt.value]} {opt.label}
                </span>
              ) : null
            ))}
          </div>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            className="text-slate-400"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </motion.div>
        </div>
      </button>

      {/* Expandable content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-4 border-t border-slate-700 space-y-3">
              {/* Message */}
              <AnimatePresence>
                {message && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`p-2 rounded text-sm ${
                      message.type === 'success' 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {message.text}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Points grid */}
              <div className="space-y-2">
                {pointKeys.map((key) => {
                  const currentValue = localPoints[key];
                  if (typeof currentValue !== 'number') return null;
                  
                  const info = getPointInfo(key);
                  
                  return (
                    <div key={key} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                      <div className="flex-1">
                        <div className="font-medium text-white text-sm">{info.label}</div>
                        {info.description && (
                          <div className="text-xs text-slate-500">{info.description}</div>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {POINTS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => handlePointChange(key, opt.value)}
                            disabled={isSaving}
                            className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                              currentValue === opt.value
                                ? `${opt.bgColor} ${opt.color} border`
                                : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                            }`}
                          >
                            {opt.value}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

