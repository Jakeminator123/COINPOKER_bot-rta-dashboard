// LEGACY: Detection context helper for AI analysis
// =================================================
// NOTE: This file is LEGACY and uses deprecated "risk" values (1,2,3) for backward compatibility with AI analysis.
// The primary source of truth for programs is now programs_registry.json which uses points (0,5,10,15).
//
// This file is still used by:
// - app/api/analyze/route.ts (AI analysis functions)
// - app/api/settings/route.ts (settings API endpoint)
//
// TODO: Migrate AI analysis functions to use programs_registry.json instead of this legacy file.
// TODO: Consider deprecating this file once all AI analysis functions are updated.

import { getProgramExplanation, getDetectionInfo } from "./detection-info";
import type { Signal } from "@/lib/sections";

export interface DetectionContext {
  knownBots: Record<string, { label: string; risk: number; type: string }>; // risk: 1=low, 2=med, 3=high
  rtaTools: Record<string, { label: string; risk: number; type: string }>;
  automationTools: Record<string, { display: string; risk: number; kind: string }>;
  behaviorThresholds: {
    iki_cv_alert: number;
    iki_cv_warn: number;
    ici_cv_alert: number;
    ici_cv_warn: number;
    const_velocity_alert: number;
    const_velocity_warn: number;
    dir_variability_alert: number;
    dir_variability_warn: number;
    min_reaction_ms: number;
    jitter_rms_alert: number;
  };
  networkPatterns: Record<string, [string, string]>;
  suspiciousPorts: Record<string, string>;
}

// Static detection context from config files
export const DETECTION_CONTEXT: DetectionContext = {
  knownBots: {
    "warbot.exe": { label: "WarBot", risk: 3, type: "bot" },
    "holdembot.exe": { label: "HoldemBot", risk: 3, type: "bot" },
    "shankybot.exe": { label: "ShankyBot BonusBot", risk: 3, type: "bot" },
    "bonusbot.exe": { label: "ShankyBot BonusBot", risk: 3, type: "bot" },
    "openholdem.exe": { label: "OpenHoldem", risk: 3, type: "bot" },
    "oh.exe": { label: "OpenHoldem", risk: 3, type: "bot" },
    "pokerbotai.exe": { label: "PokerBotAI", risk: 3, type: "bot" },
    "pokerbot.exe": { label: "Generic PokerBot", risk: 3, type: "bot" },
    "inhuman.exe": { label: "InHuman Poker Bot", risk: 3, type: "bot" },
    "deepermind.exe": { label: "DeeperMind Bot", risk: 3, type: "bot" }
  },

  rtaTools: {
    "rta.poker.exe": { label: "RTA.poker (Nefton)", risk: 2, type: "rta" },
    "rtapoker.exe": { label: "RTA Poker", risk: 2, type: "rta" },
    "gtohero.exe": { label: "GTO Hero", risk: 2, type: "rta" },
    "piosolver.exe": { label: "PioSolver", risk: 2, type: "solver" },
    "piosolver-edge.exe": { label: "PioSolver Edge", risk: 2, type: "solver" },
    "pioviewer.exe": { label: "PioViewer", risk: 2, type: "solver" },
    "monkersolver.exe": { label: "MonkerSolver", risk: 2, type: "solver" },
    "monkerviewer.exe": { label: "MonkerViewer", risk: 2, type: "solver" },
    "gto+.exe": { label: "GTO+", risk: 2, type: "solver" },
    "simple postflop.exe": { label: "Simple Postflop", risk: 2, type: "solver" },
    "simple gto.exe": { label: "Simple GTO Trainer", risk: 2, type: "solver" },
    "icmizer.exe": { label: "ICMizer", risk: 2, type: "solver" },
    "icmizer3.exe": { label: "ICMizer 3", risk: 2, type: "solver" }
  },

  automationTools: {
    "autohotkey.exe": { display: "AutoHotkey", risk: 3, kind: "macro" },
    "autoit3.exe": { display: "AutoIt", risk: 3, kind: "macro" },
    "python.exe": { display: "Python", risk: 2, kind: "script" },
    "pythonw.exe": { display: "Python (no window)", risk: 2, kind: "script" },
    "powershell.exe": { display: "PowerShell", risk: 1, kind: "script" },
    "sikuli.exe": { display: "Sikuli", risk: 3, kind: "bot_framework" },
    "clickermann.exe": { display: "Clickermann", risk: 3, kind: "clicker" },
    "tinytask.exe": { display: "TinyTask", risk: 3, kind: "macro" }
  },

  behaviorThresholds: {
    iki_cv_alert: 0.12,
    iki_cv_warn: 0.18,
    ici_cv_alert: 0.12,
    ici_cv_warn: 0.18,
    const_velocity_alert: 0.50,
    const_velocity_warn: 0.30,
    dir_variability_alert: 0.10,
    dir_variability_warn: 0.18,
    min_reaction_ms: 150,
    jitter_rms_alert: 0.6
  },

  networkPatterns: {
    "rta.poker": ["RTA.poker Service", "ALERT"],
    "rtapoker.com": ["RTA Poker", "ALERT"],
    "warbotpoker": ["WarBot", "ALERT"],
    "holdembot": ["HoldemBot", "ALERT"],
    "pokerbotai": ["PokerBotAI", "ALERT"],
    "gtowizard": ["GTO Wizard", "ALERT"],
    "simplegto": ["Simple GTO", "WARN"],
    "visiongto": ["Vision GTO", "WARN"],
    "odinpoker": ["Odin Poker", "WARN"],
    "gtohero": ["GTO Hero", "WARN"],
    "piosolver": ["PioSolver", "WARN"],
    "monkersolver": ["MonkerSolver", "WARN"],
    "telegram.org": ["Telegram", "WARN"],
    "api.telegram": ["Telegram API", "WARN"],
    "t.me": ["Telegram Link", "WARN"]
  },

  suspiciousPorts: {
    "3389": "RDP (Remote Desktop)",
    "5900": "VNC",
    "8291": "TeamViewer",
    "7070": "AnyDesk",
    "1935": "RTMP (Streaming)",
    "3478": "STUN/WebRTC",
    "19302": "Google STUN",
    "25565": "Minecraft (bot hosting)"
  }
};

const hasName = (signal: Signal): signal is Signal & { name: string } =>
  typeof signal.name === "string" && signal.name.length > 0;

export function buildDetectionContext(signals: Signal[]): string {
  const context: string[] = [];

  // Analyze detected processes with detailed explanations
  const detectedProcesses = signals
    .filter((s): s is Signal & { name: string } => s.category === 'programs' && hasName(s))
    .map(s => s.name.toLowerCase());

  const detectedBots = Object.entries(DETECTION_CONTEXT.knownBots)
    .filter(([process]) => detectedProcesses.some(p => p.includes(process.replace('.exe', ''))))
    .map(([process, info]) => {
      const explanation = getProgramExplanation(process) || getProgramExplanation(info.label);
      return `${info.label} (${info.type}, risk level: ${info.risk})${explanation ? ` - ${explanation}` : ''}`;
    });

  const detectedRTA = Object.entries(DETECTION_CONTEXT.rtaTools)
    .filter(([process]) => detectedProcesses.some(p => p.includes(process.replace('.exe', ''))))
    .map(([process, info]) => {
      const explanation = getProgramExplanation(process) || getProgramExplanation(info.label);
      return `${info.label} (${info.type}, risk level: ${info.risk})${explanation ? ` - ${explanation}` : ''}`;
    });

  const detectedAutomation = Object.entries(DETECTION_CONTEXT.automationTools)
    .filter(([process]) => detectedProcesses.some(p => p.includes(process.replace('.exe', ''))))
    .map(([process, info]) => {
      const explanation = getProgramExplanation(process) || getProgramExplanation(info.display);
      return `${info.display} (${info.kind}, risk level: ${info.risk})${explanation ? ` - ${explanation}` : ''}`;
    });

  // Also check for any program names in signals that might have explanations
  const programSignals = signals.filter((s): s is Signal & { name: string } => s.category === 'programs' && hasName(s));
  const additionalExplanations: string[] = [];
  programSignals.forEach(signal => {
    const explanation = getProgramExplanation(signal.name);
    if (explanation && !detectedBots.concat(detectedRTA).concat(detectedAutomation).some(e => e.includes(signal.name))) {
      additionalExplanations.push(`${signal.name}: ${explanation}`);
    }
  });

  // Analyze network patterns with detection info
  const networkSignals = signals
    .filter(s => s.category === 'network')
    .map(s => s.details || s.name || '')
    .join(' ').toLowerCase();

  const detectedNetworkPatterns = Object.entries(DETECTION_CONTEXT.networkPatterns)
    .filter(([, [label]]) => networkSignals.includes(label.toLowerCase()))
    .map(([, [label, severity]]) => {
      const networkInfo = getDetectionInfo('network_keywords');
      return `${label} (${severity})${networkInfo ? ` - ${networkInfo.description}` : ''}`;
    });

  // Analyze behavior patterns with detection info
  const behaviorSignals = signals.filter(s => s.category === 'behaviour');
  const hasBotBehavior = behaviorSignals.some(s =>
    s.name.toLowerCase().includes('bot') ||
    s.name.toLowerCase().includes('synthetic') ||
    s.details?.toLowerCase().includes('low variance')
  );

  const behaviorInfo = getDetectionInfo('automation_programs');
  const behaviorContext = behaviorInfo ? `\nBehavioral Detection Method: ${behaviorInfo.description}` : '';

  // Build context string with enhanced information
  if (detectedBots.length > 0) {
    context.push(`KNOWN BOTS DETECTED:\n${detectedBots.map(b => `  • ${b}`).join('\n')}`);
  }

  if (detectedRTA.length > 0) {
    context.push(`RTA/SOLVER TOOLS DETECTED:\n${detectedRTA.map(r => `  • ${r}`).join('\n')}`);
  }

  if (detectedAutomation.length > 0) {
    context.push(`AUTOMATION TOOLS DETECTED:\n${detectedAutomation.map(a => `  • ${a}`).join('\n')}`);
  }

  if (additionalExplanations.length > 0) {
    context.push(`ADDITIONAL DETECTED PROGRAMS:\n${additionalExplanations.map(e => `  • ${e}`).join('\n')}`);
  }

  if (detectedNetworkPatterns.length > 0) {
    context.push(`NETWORK PATTERNS DETECTED:\n${detectedNetworkPatterns.map(n => `  • ${n}`).join('\n')}`);
  }

  if (hasBotBehavior) {
    context.push(`BEHAVIORAL INDICATORS:${behaviorContext}\n  • Robotic input patterns detected (low variance, synthetic inputs, consistent timing)\n  • Thresholds: IKI/ICI variance alert < ${DETECTION_CONTEXT.behaviorThresholds.iki_cv_alert}, constant velocity alert > ${DETECTION_CONTEXT.behaviorThresholds.const_velocity_alert}`);
  } else {
    context.push(`BEHAVIOR THRESHOLDS: IKI/ICI variance alert < ${DETECTION_CONTEXT.behaviorThresholds.iki_cv_alert}, constant velocity alert > ${DETECTION_CONTEXT.behaviorThresholds.const_velocity_alert}`);
  }

  // Add detection method explanations
  const detectedCategories = new Set(signals.map(s => s.category));
  const methodExplanations: string[] = [];

  detectedCategories.forEach(category => {
    let infoKey = '';
    if (category === 'programs') infoKey = 'automation_programs';
    else if (category === 'network') infoKey = 'network_keywords';
    else if (category === 'behaviour') infoKey = 'automation_programs';
    else if (category === 'screen') infoKey = 'overlay_classes';

    if (infoKey) {
      const info = getDetectionInfo(infoKey);
      if (info) {
        methodExplanations.push(`${category.toUpperCase()} Detection: ${info.description}${info.prohibitedUse ? ` | Prohibited Use: ${info.prohibitedUse}` : ''}`);
      }
    }
  });

  if (methodExplanations.length > 0) {
    context.push(`DETECTION METHOD EXPLANATIONS:\n${methodExplanations.map(e => `  • ${e}`).join('\n')}`);
  }

  return context.length > 0 ? context.join('\n\n') : 'No specific detection patterns matched known signatures.';
}

export interface CategorizedSignals {
  bots: string[];
  rta: string[];
  automation: string[];
  network: string[];
  behavior: string[];
}

export function categorizeSignals(signals: Signal[]): CategorizedSignals {
  const categories: CategorizedSignals = {
    bots: [],
    rta: [],
    automation: [],
    network: [],
    behavior: []
  };

  signals.forEach(signal => {
    const nameLower = signal.name?.toLowerCase() || '';
    const details = signal.details?.toLowerCase() || '';
    const combined = `${nameLower} ${details}`.trim();
    const displayName = signal.name ?? signal.details ?? 'Unknown detection';

    // Check for known bots
    if (Object.keys(DETECTION_CONTEXT.knownBots).some(bot =>
      combined.includes(bot.replace('.exe', '')))) {
      categories.bots.push(displayName);
    }

    // Check for RTA tools
    else if (Object.keys(DETECTION_CONTEXT.rtaTools).some(tool =>
      combined.includes(tool.replace('.exe', '')))) {
      categories.rta.push(displayName);
    }

    // Check for automation
    else if (Object.keys(DETECTION_CONTEXT.automationTools).some(tool =>
      combined.includes(tool.replace('.exe', '')))) {
      categories.automation.push(displayName);
    }

    // Network patterns
    else if (signal.category === 'network') {
      categories.network.push(displayName);
    }

    // Behavior patterns
    else if (signal.category === 'behaviour') {
      categories.behavior.push(displayName);
    }
  });

  return categories;
}
