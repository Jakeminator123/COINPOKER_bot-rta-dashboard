/**
 * Constants for UnifiedHistoryChart
 */

import type { TimePreset } from "./types";

export const TIME_PRESETS: Record<TimePreset, { label: string; seconds: number }> = {
  "5m": { label: "5 min", seconds: 5 * 60 },
  "1h": { label: "1 hour", seconds: 3600 },
  "3h": { label: "3 hours", seconds: 3 * 3600 },
  "6h": { label: "6 hours", seconds: 6 * 3600 },
  "12h": { label: "12 hours", seconds: 12 * 3600 },
  "24h": { label: "24 hours", seconds: 24 * 3600 },
  "3d": { label: "3 days", seconds: 3 * 24 * 3600 },
  "7d": { label: "7 days", seconds: 7 * 24 * 3600 },
  "30d": { label: "30 days", seconds: 30 * 24 * 3600 },
};

export const CATEGORY_COLORS: Record<string, string> = {
  programs: "#ef4444",
  network: "#f97316",
  behaviour: "#eab308",
  vm: "#3b82f6",
  auto: "#8b5cf6",
  screen: "#ec4899",
};

export const CATEGORY_TITLES: Record<string, string> = {
  programs: "Programs",
  network: "Network",
  behaviour: "Behaviour",
  vm: "Virtual Machines",
  auto: "Automation",
  screen: "Screen Monitoring",
};

export const STATUS_COLORS: Record<string, string> = {
  CRITICAL: "#dc2626",
  ALERT: "#f97316",
  WARN: "#eab308",
  INFO: "#3b82f6",
};

