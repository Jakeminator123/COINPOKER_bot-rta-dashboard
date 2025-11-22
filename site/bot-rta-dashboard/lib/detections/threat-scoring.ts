// Threat scoring configuration - 4-level system only
// Must match the scoring in core/api.py

export const THREAT_WEIGHTS = {
  CRITICAL: 15, // Highest threats - known bots, RTA tools
  ALERT: 10, // Serious threats - automation, suspicious tools
  WARN: 5, // Suspicious activity - minor concerns
  INFO: 0, // Informational only - no barometer impact
  OK: 0,
  OFF: 0,
  UNK: 0,
} as const;

export const THREAT_THRESHOLDS = {
  HIGH_RISK: 70, // >= 70% = High Risk
  MEDIUM_RISK: 40, // >= 40% = Medium Risk
  LOW_RISK: 20, // >= 20% = Low Risk
  MINIMAL_RISK: 0, // < 20% = Minimal Risk
} as const;

export const TIME_WINDOWS = {
  RECENT_SIGNALS: 300000, // 5 minutes in ms
  SESSION_TIMEOUT: 1800000, // 30 minutes in ms
  SIGNAL_COOLDOWN: 30000, // 30 seconds in ms
  HISTORICAL_TTL: 86400000, // 24 hours in ms
} as const;

export function getThreatColor(level: number): string {
  if (level >= THREAT_THRESHOLDS.HIGH_RISK) return "#ef4444"; // red
  if (level >= THREAT_THRESHOLDS.MEDIUM_RISK) return "#eab308"; // yellow
  if (level >= THREAT_THRESHOLDS.LOW_RISK) return "#3b82f6"; // blue
  return "#22c55e"; // green
}

export function getThreatLabel(level: number): string {
  if (level >= THREAT_THRESHOLDS.HIGH_RISK) return "High Risk";
  if (level >= THREAT_THRESHOLDS.MEDIUM_RISK) return "Medium Risk";
  if (level >= THREAT_THRESHOLDS.LOW_RISK) return "Low Risk";
  return "Minimal Risk";
}

export function getThreatLevel(level: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (level >= THREAT_THRESHOLDS.HIGH_RISK) return "CRITICAL";
  if (level >= THREAT_THRESHOLDS.MEDIUM_RISK) return "HIGH";
  if (level >= THREAT_THRESHOLDS.LOW_RISK) return "MEDIUM";
  return "LOW";
}

export function getRiskAssessment(level: number): "low" | "medium" | "high" {
  if (level >= THREAT_THRESHOLDS.HIGH_RISK) return "high";
  if (level >= THREAT_THRESHOLDS.MEDIUM_RISK) return "medium";
  return "low";
}
