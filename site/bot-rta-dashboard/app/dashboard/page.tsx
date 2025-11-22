/**
 * Player Dashboard Page
 * =====================
 * Alias: "Player Profile" | "Dashboard" | "Player Detail" | "Player Dashboard"
 * Route: /dashboard
 * File: app/dashboard/page.tsx
 *
 * Shows detailed bot detection analysis for a specific player/device.
 * Displays real-time signals, threat visualization, detection sections,
 * and provides analysis tools.
 *
 * Query params:
 *   - ?device=<device_id> - Filter to specific device
 *   - ?player=<device_id> - Same as device (backward compatibility)
 *
 * Next.js App Router requires this file to be named "page.tsx" -
 * the route is determined by the folder structure (/app/dashboard/page.tsx = /dashboard)
 */
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
  useCallback,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { motion } from "framer-motion";
import {
  DETECTION_SECTIONS,
  type Stored,
  type Status,
} from "@/lib/sections";
import {
  TIME_WINDOWS,
  getThreatColor,
  getThreatLabel,
  THREAT_WEIGHTS,
} from "@/lib/threat-scoring";
import { CATEGORY_COLORS } from "@/components/charts/constants";
import dynamic from "next/dynamic";
import AnalysisModal from "@/components/AnalysisModal";
import EmergencyModal from "@/components/EmergencyModal";
import AuthGuard from "@/components/AuthGuard";
import SegmentHistoryModal from "@/components/SegmentHistoryModal";
import ReportExportModal from "@/components/ReportExportModal";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import DidAgentWidget from "@/components/DidAgentWidget";

// Dynamic imports for client-side components
const ThreatVisualization = dynamic(
  () => import("@/components/ThreatVisualization"),
  {
    ssr: false,
    loading: () => (
      <div className="w-[240px] h-[240px] flex items-center justify-center">
        <div className="loading-spinner"></div>
      </div>
    ),
  }
);

const AnimatedCounter = dynamic(() => import("@/components/AnimatedCounter"), {
  ssr: false,
  loading: () => <span>-</span>,
});

const DetectionFeed = dynamic(() => import("@/components/DetectionFeed"), {
  ssr: false,
  loading: () => (
    <div className="animate-pulse h-64 bg-slate-800/50 rounded-lg"></div>
  ),
});

const UnifiedHistoryChart = dynamic(
  () => import("@/components/UnifiedHistoryChart"),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse h-80 bg-slate-800/50 rounded-lg"></div>
    ),
  }
);

const IPLocationMap = dynamic(
  () => import("@/components/IPLocationMap"),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse h-64 bg-slate-800/50 rounded-lg"></div>
    ),
  }
);

// Stored type imported from sections.ts

type Snapshot = {
  serverTime: number;
  sections: Record<string, { items: Stored[] }>;
};

type DeviceCommandName = "kill_coinpoker" | "take_snapshot";

type CommandExecutionResult =
  | {
      commandId: string;
      requireAdmin: boolean;
      status: "completed";
      result: any;
    }
  | { commandId: string; requireAdmin: boolean; status: "timeout" }
  | { commandId: string; requireAdmin: boolean; status: "unknown" };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const DID_AGENT_URL =
  "https://studio.d-id.com/agents/share?id=v2_agt_JJZwZKuY&utm_source=copy&key=WjI5dloyeGxMVzloZFhSb01ud3hNVFV5TnpnMU56UXpORE0yTnpFMU9UUTVPRFU2VkZGclUxSTNTVU54V0hwdFpIZzNOSGxOVkhKMA==";

function SessionDurationDisplay({ sessionStart }: { sessionStart: number }) {
  const normalizedStart =
    sessionStart < 10_000_000_000 ? sessionStart * 1000 : sessionStart;
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const updateDuration = () => {
      const now = Date.now();
      const elapsed = Math.max(
        0,
        Math.floor((now - normalizedStart) / 1000)
      ); // Duration in seconds
      setDuration(elapsed);
    };

    // Update immediately
    updateDuration();

    // Update every second
    const interval = setInterval(updateDuration, 1000);

    return () => clearInterval(interval);
  }, [normalizedStart]);

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700/50">
      <svg
        className="w-4 h-4 text-indigo-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span className="text-slate-500 font-medium min-w-[80px]">Session Duration:</span>
      <span className="text-indigo-400 font-semibold font-mono">
        {formatDuration(duration)}
      </span>
    </div>
  );
}

function EnhancedDashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const playerId = searchParams.get("player") || searchParams.get("device");

  const [data, setData] = useState<Snapshot | null>(null);
  const [sseOk, setSseOk] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  interface DeviceData {
    device_id?: string;
    device_name?: string;
    is_online?: boolean;
    last_seen?: number;
    threat_level?: number;
    session_start?: number;
    session_duration?: number;
    ip_address?: string;
  }

  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);

  // Analysis modal state
  interface AnalysisResult {
    analysis?: string;
    threatLevel?: number;
    signalCount?: number;
    timestamp?: number;
  }
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisTimePreset, setAnalysisTimePreset] = useState<'1h' | '3h' | '6h' | '12h' | '24h' | '3d' | '7d' | '30d' | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [isEmergencyOpen, setIsEmergencyOpen] = useState(false);
  const [isScoreOpen, setIsScoreOpen] = useState(false);

  // Table info and snapshot state
  interface TableInfo {
    title?: string;
    pid?: string | number;
    width?: number;
    height?: number;
    screenshot?: string;
    screenshot_format?: string;
    error?: string;
  }
  const [tableInfo, setTableInfo] = useState<TableInfo[]>([]);
  const [isTakingSnapshot, setIsTakingSnapshot] = useState(false);
  const [_snapshotError, setSnapshotError] = useState<string | null>(null);
  const [isKillInProgress, setIsKillInProgress] = useState(false);

  const wait = useCallback(
    (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    []
  );

  const formatDetectionTimestamp = useCallback((timestamp?: number) => {
    if (!timestamp) return "Unknown time";
    const date = new Date(
      timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
    );
    return date.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
  }, []);

  const statusBadgeStyles: Record<Status, string> = {
    CRITICAL: "bg-red-500/10 text-red-300 border border-red-400/30",
    ALERT: "bg-orange-500/10 text-orange-300 border border-orange-400/30",
    WARN: "bg-yellow-500/10 text-yellow-300 border border-yellow-400/30",
    INFO: "bg-blue-500/10 text-blue-300 border border-blue-400/30",
    OK: "bg-green-500/10 text-green-300 border border-green-400/30",
    OFF: "bg-slate-700 text-slate-300 border border-slate-600/50",
    UNK: "bg-slate-800 text-slate-400 border border-slate-700/50",
  };

  const queueDeviceCommand = useCallback(
    async (deviceId: string, command: DeviceCommandName, payload?: unknown) => {
      const response = await fetch("/api/device-commands", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deviceId, command, payload }),
      });

      let json: any = null;
      try {
        json = await response.json();
      } catch (error) {
        console.error("queueDeviceCommand JSON parse error", error);
      }

      if (!response.ok || !json?.ok) {
        const message = json?.error || "Failed to queue command";
        throw new Error(message);
      }

      return (json.data ?? {}) as {
        commandId: string;
        requireAdmin?: boolean;
      };
    },
    []
  );

  const fetchCommandResult = useCallback(
    async (commandId: string, timeoutMs = 20000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const response = await fetch(
          `/api/device-commands/result?id=${encodeURIComponent(commandId)}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        let json: any = null;
        try {
          json = await response.json();
        } catch (error) {
          console.error("fetchCommandResult JSON parse error", error);
        }

        if (!response.ok || !json?.ok) {
          const message = json?.error || "Failed to fetch command result";
          throw new Error(message);
        }

        const status = json?.data?.status;
        if (status === "completed") {
          return {
            status: "completed" as const,
            result: json.data?.result,
          };
        }

        if (status === "unknown") {
          return { status: "unknown" as const };
        }

        await wait(1000);
      }

      return { status: "timeout" as const };
    },
    [wait]
  );

  const executeDeviceCommand = useCallback(
    async (
      command: DeviceCommandName,
      payload?: unknown
    ): Promise<CommandExecutionResult> => {
      if (!playerId) {
        throw new Error("Device ID saknas");
      }

      const queued = await queueDeviceCommand(playerId, command, payload);
      const outcome = await fetchCommandResult(queued.commandId);

      return {
        commandId: queued.commandId,
        requireAdmin: Boolean(queued.requireAdmin),
        ...outcome,
      } as CommandExecutionResult;
    },
    [playerId, queueDeviceCommand, fetchCommandResult]
  );

  // Fetch device data for consistent threat level
  // Poll more frequently (every 5s) to get updated threat_level from batch reports
  // Batch reports come every 92s, so polling every 5s ensures we catch updates quickly
  const { data: devicesData } = useSWR("/api/devices", fetcher, {
    refreshInterval: 5000, // Poll every 5 seconds for faster threat score updates
    revalidateOnFocus: false,
    dedupingInterval: 2000, // Reduce deduping to allow more frequent updates
  });

  // Also fetch player summary for accurate avg_bot_probability (primary source)
  const playerSummaryUrl = playerId ? `/api/player/summary?device=${playerId}` : null;
  const { data: playerSummaryData } = useSWR(playerSummaryUrl, fetcher, {
    refreshInterval: 5000, // Poll every 5 seconds to match devices polling
    revalidateOnFocus: false,
    dedupingInterval: 2000,
  });

  const deviceList = useMemo(() => {
    if (!devicesData) return undefined;

    const maybeArray = (value: unknown) =>
      Array.isArray(value) ? (value as any[]) : undefined;

    // successResponse wrapper: { ok, data: { devices: [...] }}
    if (
      typeof devicesData === "object" &&
      devicesData !== null &&
      "ok" in devicesData
    ) {
      const payload = (devicesData as { data?: unknown }).data;
      if (payload && typeof payload === "object") {
        const nestedDevices = maybeArray(
          (payload as { devices?: unknown }).devices
        );
        if (nestedDevices) return nestedDevices;
        return maybeArray(payload);
      }
    }

    // Raw payload already shaped as { devices: [...] }
    if (
      typeof devicesData === "object" &&
      devicesData !== null &&
      "devices" in devicesData
    ) {
      const nestedDevices = maybeArray(
        (devicesData as { devices?: unknown }).devices
      );
      if (nestedDevices) return nestedDevices;
    }

    // Direct array
    return maybeArray(devicesData);
  }, [devicesData]);

  useEffect(() => {
    if (!playerId) return;

    if (deviceList && deviceList.length > 0) {
      const device = deviceList.find((d: any) => {
        // Try exact match first
        if (d.device_id === playerId) return true;
        // Try prefix match (playerId might be truncated)
        if (d.device_id && d.device_id.startsWith(playerId)) return true;
        // Try reverse prefix match
        if (
          playerId.length >= 8 &&
          d.device_id &&
          d.device_id.startsWith(playerId.substring(0, 8))
        )
          return true;
        return false;
      });
      if (device) {
        setDeviceData(device);
      } else {
        // Clear deviceData if playerId exists but device not found
        setDeviceData(null);
      }
    } else if (deviceList !== undefined) {
      // Clear deviceData if no devices data available
      setDeviceData(null);
    }
  }, [deviceList, playerId]);

  // SSE subscribe for real-time snapshot updates
  useEffect(() => {
    const url = playerId ? `/api/stream?device=${playerId}` : "/api/stream";
    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (ev) => {
      try {
        const snap = JSON.parse(ev.data) as Snapshot;
        // Only update if we have valid sections data to prevent temporary drops
        if (snap && snap.sections && Object.keys(snap.sections).length > 0) {
          setData(snap);
          setSseOk(true);
        }
      } catch {
        // Ignore SSE parse errors
      }
    };
    es.onerror = () => {
      setSseOk(false);
    };
    return () => {
      es.close();
    };
  }, [playerId]);

  // Initial cached load for instant display (top 20 devices)
  const cachedUrl = playerId
    ? `/api/snapshot?device=${playerId}&cached=true`
    : null;
  const { data: cachedData } = useSWR(cachedUrl, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000, // Cache for 1 minute client-side
  });

  useEffect(() => {
    if (cachedData && !data) {
      setData(cachedData);
    }
  }, [cachedData, data]);

  // Fallback polling
  const pollUrl = playerId
    ? `/api/snapshot?device=${playerId}`
    : "/api/snapshot";
  const { data: polled } = useSWR(!sseOk ? pollUrl : null, fetcher, {
    refreshInterval: 15000,
  });
  useEffect(() => {
    if (polled) setData(polled);
  }, [polled]);

  const grouped = useMemo(() => {
    const sections = data?.sections ?? {};
    // Ensure we always return a valid object, even if empty
    return sections || {};
  }, [data]);
  const serverTime = data?.serverTime;

  // Calculate online status: use deviceData.is_online if available, otherwise check if we have active data
  const isOnline = useMemo(() => {
    if (deviceData?.is_online !== undefined) {
      return deviceData.is_online;
    }
    // Fallback: if we have recent snapshot data or SSE is active, consider online
    if (sseOk || (data && data.sections && Object.keys(data.sections).length > 0)) {
      return true;
    }
    return false;
  }, [deviceData?.is_online, sseOk, data]);

  const sessionStartMs = useMemo(() => {
    if (!deviceData?.session_start) return null;
    const raw = deviceData.session_start;
    return raw < 10_000_000_000 ? raw * 1000 : raw;
  }, [deviceData?.session_start]);

  const lastActivityLabel = useMemo(() => {
    if (!deviceData?.last_seen) {
      return "Unknown";
    }
    const diff = Date.now() - deviceData.last_seen;
    if (diff < 60_000) return "Just now";
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0
        ? `${hours}h ${remainingMinutes}m ago`
        : `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }, [deviceData?.last_seen]);

  // Unified recent window + dedupe (used by Threat Meter, stats, feed, etc.)
  // ------------------------------------------------------------------------
  // Backend batch reports already deduplicate threats when producing bot_probability.
  // However, the live SSE/poll stream may contain several detections describing the
  // same root cause (e.g. process name + entropy + hash for the same exe).
  // recentDeduped keeps only the newest instance per uniqueKey so that:
  //   • Threat Meter / risk cards don't over-count the same tool.
  //   • Live Detection Feed stays readable (one card per root cause).
  //   • Category Breakdown can still show multiple detection *types* per category,
  //     because it uses the raw grouped sections instead of this deduped slice.
  const recentDeduped = useMemo(() => {
    const now = serverTime ? serverTime * 1000 : Date.now();
    const windowMs = TIME_WINDOWS.RECENT_SIGNALS;
    const windowStart = now - windowMs;

    const items = Object.entries(grouped)
      .filter(([key]) => key !== "system_reports")
      .flatMap(([, section]) => section.items || [])
      .filter((i) => i.timestamp * 1000 >= windowStart)
      .filter((i) =>
        sessionStartMs ? i.timestamp * 1000 >= sessionStartMs : true,
      );

    const m = new Map<string, (typeof items)[number]>();
    for (const it of items) {
      const key =
        (it as any).uniqueKey ||
        `${it.category}:${it.name}:${it.details || ""}`;
      const prev = m.get(key);
      if (!prev || it.timestamp > prev.timestamp) m.set(key, it);
    }
    return Array.from(m.values());
  }, [grouped, serverTime, sessionStartMs]);

  // Calculations
  const overallThreat = useMemo(() => {
    // Priority 1: Use avg_bot_probability from player_summary (most accurate - calculated from batch reports)
    // This is the authoritative source as it's calculated from actual batch report data
    if (playerSummaryData?.ok && playerSummaryData?.data) {
      const summary = playerSummaryData.data as { avg_bot_probability?: number; avg_score?: number };
      const avgBotProb = summary?.avg_bot_probability ?? summary?.avg_score;
      if (avgBotProb !== undefined && avgBotProb !== null && !isNaN(avgBotProb) && avgBotProb >= 0 && avgBotProb <= 100) {
        return Math.round(avgBotProb);
      }
    }

    // Priority 2: Use threat_level from deviceData (from batch reports via Redis)
    // This is updated every 92s when batch reports arrive, providing accurate bot_probability
    if (deviceData?.threat_level !== undefined && deviceData.threat_level !== null) {
      const threatLevel = typeof deviceData.threat_level === 'number' 
        ? deviceData.threat_level 
        : parseFloat(String(deviceData.threat_level));
      if (!isNaN(threatLevel) && threatLevel >= 0 && threatLevel <= 100) {
        return Math.round(threatLevel);
      }
    }
    
    // Priority 2: Calculate from signals in MemoryStore (fallback)
    // Exclude system_reports; limit to recent window; deduplicate by uniqueKey (latest only)
    if (!grouped || Object.keys(grouped).length === 0) {
      return 0;
    }
    
    const now = serverTime ? serverTime * 1000 : Date.now();
    const windowMs = TIME_WINDOWS.RECENT_SIGNALS;
    const windowStart = now - windowMs;

    const recentItems = Object.entries(grouped)
      .filter(([key]) => key !== "system_reports")
      .flatMap(([, section]) => section?.items || [])
      .filter((i) => i && i.timestamp && i.timestamp * 1000 >= windowStart);

    // If no recent items, return 0 instead of calculating on stale data
    if (recentItems.length === 0) {
      return 0;
    }

    const uniqueLatest = new Map<string, (typeof recentItems)[number]>();
    for (const it of recentItems) {
      if (!it) continue;
      const key =
        (it as any).uniqueKey ||
        `${it.category}:${it.name}:${it.details || ""}`;
      const prev = uniqueLatest.get(key);
      if (!prev || it.timestamp > prev.timestamp) uniqueLatest.set(key, it);
    }

    const deduped = Array.from(uniqueLatest.values());
    const criticalCount = deduped.filter((i) => i.status === "CRITICAL").length;
    const alertCount = deduped.filter((i) => i.status === "ALERT").length;
    const warnCount = deduped.filter((i) => i.status === "WARN").length;
    const infoCount = deduped.filter((i) => i.status === "INFO").length;

    const totalPoints =
      criticalCount * 15 + alertCount * 10 + warnCount * 5 + infoCount * 0;
    return Math.min(100, Math.max(0, totalPoints)); // Ensure 0-100 range
  }, [grouped, serverTime, deviceData?.threat_level, playerSummaryData]);

  const threatColor = useMemo(() => getThreatColor(overallThreat), [overallThreat]);
  const threatStatusBadge = useMemo(
    () =>
      isOnline
        ? {
            label: "Live",
            className:
              "bg-green-500/10 text-green-300 border border-green-400/20",
          }
        : {
            label: "Last session",
            className:
              "bg-slate-700/70 text-slate-300 border border-slate-500/50",
          },
    [isOnline],
  );

  // Threat level tracking removed - will be handled by database in future

  const categoryThreats = useMemo(() => {
    const totals = Object.keys(DETECTION_SECTIONS).reduce((acc, key) => {
      if (key !== "system") {
        acc[key] = 0;
      }
      return acc;
    }, {} as Record<string, number>);

    for (const detection of recentDeduped) {
      const weight =
        THREAT_WEIGHTS[detection.status as keyof typeof THREAT_WEIGHTS] ?? 0;
      if (weight <= 0) continue;

      const categoryKey = (
        detection.section?.split("_")[0] ||
        detection.category ||
        "unknown"
      ).toLowerCase();
      if (totals[categoryKey] === undefined) {
        totals[categoryKey] = 0;
      }
      totals[categoryKey] = Math.min(100, totals[categoryKey] + weight);
    }

    return totals;
  }, [recentDeduped]);

  const categoryDetections = useMemo(() => {
    const bucket: Record<
      string,
      Array<{
        name: string;
        status: Status;
        timestamp?: number;
        details?: string;
      }>
    > = {};

    Object.entries(grouped).forEach(([sectionKey, section]) => {
      if (!section?.items?.length) return;
      const [categoryKey] = sectionKey.split("_");
      if (!categoryKey || categoryKey === "system") return;

      bucket[categoryKey] = bucket[categoryKey] || [];
      section.items.forEach((item) => {
        const itemMs =
          typeof item.timestamp === "number"
            ? (item.timestamp < 10_000_000_000
                ? item.timestamp * 1000
                : item.timestamp)
            : 0;
        if (sessionStartMs && itemMs < sessionStartMs) {
          return;
        }
        bucket[categoryKey].push({
          name: item.name,
          status: item.status || "INFO",
          timestamp: item.timestamp,
          details: item.details,
        });
      });
    });

    Object.keys(bucket).forEach((key) => {
      bucket[key].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      bucket[key] = bucket[key].slice(0, 6);
    });

    return bucket;
  }, [grouped, sessionStartMs]);

  // Memoize barometer data - 4-level system
  const barometerData = useMemo(() => {
    const criticalPoints =
      recentDeduped.filter((i) => i.status === "CRITICAL").length * 15;
    const alertPoints =
      recentDeduped.filter((i) => i.status === "ALERT").length * 10;
    const warnPoints =
      recentDeduped.filter((i) => i.status === "WARN").length * 5;
    const infoPoints =
      recentDeduped.filter((i) => i.status === "INFO").length * 0;
    const totalPoints = criticalPoints + alertPoints + warnPoints + infoPoints;

    const segments: any[] = [];
    if (criticalPoints)
      segments.push({
        category: "Critical",
        value: criticalPoints,
        color: "#dc2626",
      });
    if (alertPoints)
      segments.push({
        category: "Alerts",
        value: alertPoints,
        color: "#f97316",
      });
    if (warnPoints)
      segments.push({
        category: "Warnings",
        value: warnPoints,
        color: "#eab308",
      });

    const remainingPoints = Math.max(0, 100 - totalPoints);
    if (remainingPoints)
      segments.push({
        category: "Empty",
        value: remainingPoints,
        color: "rgba(100, 116, 139, 0.1)",
      });

    return segments.length
      ? segments
      : [
          {
            category: "No threats",
            value: 100,
            color: "rgba(100, 116, 139, 0.1)",
          },
        ];
  }, [recentDeduped]);

  const allDetections = useMemo(() => {
    // Show most recent, deduped items across the window
    return [...recentDeduped].sort((a, b) => b.timestamp - a.timestamp);
  }, [recentDeduped]);

  const stats = useMemo(() => {
    const items = recentDeduped;
    return {
      total: items.length,
      critical: items.filter((i) => i.status === "CRITICAL").length,
      alerts: items.filter((i) => i.status === "ALERT").length,
      warnings: items.filter((i) => i.status === "WARN").length,
      info: items.filter((i) => i.status === "INFO").length,
    };
  }, [recentDeduped]);

  // Extract table info from system signals
  const activeTablesInfo = useMemo(() => {
    if (!playerId || !data) return null;

    // Find latest "Active Tables Detected" signal for this device
    const systemSignals = Object.entries(data.sections || {})
      .filter(([key]) => key === "system")
      .flatMap(([, section]) => section.items || [])
      .filter((item) => {
        if (item.name === "Active Tables Detected") {
          // Match by device_id - check both exact match and prefix match
          if (item.device_id) {
            if (item.device_id === playerId) return true;
            if (item.device_id.startsWith(playerId)) return true;
            if (playerId.startsWith(item.device_id.substring(0, 8)))
              return true;
          }
          // Match by IP
          if (deviceData?.ip_address && item.device_ip) {
            if (item.device_ip === deviceData.ip_address) return true;
          }
        }
        return false;
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    if (systemSignals.length === 0) return null;

    const latestSignal = systemSignals[0];
    try {
      const details = JSON.parse(latestSignal.details || "{}");
      if (details.count && details.tables) {
        return {
          count: details.count,
          tables: details.tables,
        };
      }
    } catch {
      // Not JSON, ignore
    }

    return null;
  }, [playerId, data, deviceData]);

  // Extract nickname from system signals
  const nicknameInfo = useMemo(() => {
    if (!playerId || !data) return null;

    // Find latest "Player Name Detected" signal for this device (contains nickname)
    // Try matching by device_id first (exact match or starts with), then by IP if device_id doesn't match
    // Note: System signals are stored in 'system_reports' section, not 'system'
    const systemSignals = Object.entries(data.sections || {})
      .filter(([key]) => key === "system_reports" || key === "system") // Check both for compatibility
      .flatMap(([, section]) => section.items || [])
      .filter((item) => {
        if (item.name !== "Player Name Detected") return false;

        // Match by device_id - check both exact match and prefix match
        // (playerId might be truncated in URL but device_id is full MD5)
        if (item.device_id && playerId) {
          // Normalize both IDs to lowercase for comparison
          const normalizedItemId = item.device_id.toLowerCase();
          const normalizedPlayerId = playerId.toLowerCase();

          // Exact match
          if (normalizedItemId === normalizedPlayerId) {
            return true;
          }
          // Prefix match (playerId is truncated in URL)
          if (
            normalizedItemId.startsWith(normalizedPlayerId) &&
            normalizedPlayerId.length >= 8
          ) {
            return true;
          }
          // Reverse: playerId might be full but URL shows truncated
          if (
            normalizedPlayerId.length >= 8 &&
            normalizedPlayerId.startsWith(normalizedItemId.substring(0, 8))
          ) {
            return true;
          }
        }

        // Fallback: match by IP if device_id doesn't match but IP does
        if (deviceData?.ip_address && item.device_ip) {
          if (item.device_ip === deviceData.ip_address) {
            return true;
          }
        }

        // Also match by device_name if available
        if (deviceData?.device_name && item.device_name) {
          if (item.device_name === deviceData.device_name) {
            return true;
          }
        }

        return false;
      })
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

    if (systemSignals.length === 0) {
      return null;
    }

    const latestSignal = systemSignals[0];
    try {
      const details = JSON.parse(latestSignal.details || "{}");
      if (details.player_name) {
        return {
          name: details.player_name,
          confidence:
            details.confidence || details.confidence_percent / 100 || 0,
          confidencePercent:
            details.confidence_percent ||
            Math.round((details.confidence || 0) * 100),
          device_ip: (latestSignal as any).device_ip as string | undefined, // Include device_ip for IP display
        };
      }
    } catch {
      // If details is not JSON, try to extract from text
      const match = latestSignal.details?.match(
        /player_name[:\s]+([A-Za-z0-9_.-]+)/i
      );
      if (match) {
        return {
          name: match[1],
          confidence: 0.5,
          confidencePercent: 50,
          device_ip: (latestSignal as any).device_ip as string | undefined, // Include device_ip for IP display
        };
      }
    }

    return null;
  }, [playerId, data, deviceData]);

  const deviceDisplayName = useMemo(() => {
    return (
      deviceData?.device_name ||
      nicknameInfo?.name ||
      (playerId ? playerId.split("_")[0] : "Unknown Player")
    );
  }, [deviceData?.device_name, nicknameInfo?.name, playerId]);

  // Ignore detection function
  const handleIgnoreDetection = useCallback(async (detection: any) => {
    const token = localStorage.getItem("adminToken");
    if (!token) {
      alert(
        "Admin token required. Please go to Settings and log in as admin first."
      );
      return;
    }

    try {
      const response = await fetch("/api/configs/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category: "programs",
          config: {
            ignored_programs: [detection.name],
          },
          merge: true,
        }),
      });

      if (response.ok) {
        console.log(`Added ${detection.name} to ignore list`);
        // Show success feedback
        alert(`Added "${detection.name}" to ignore list`);
      } else {
        console.error("Failed to add to ignore list");
        alert("Failed to add to ignore list. Please check admin token.");
      }
    } catch (error) {
      console.error("Error adding to ignore list:", error);
      alert("Error adding to ignore list");
    }
  }, []);

  // Analysis function
  const handleAnalyze = useCallback(async () => {
    if (!analysisTimePreset) {
      alert("Please select a time range before running the analysis.");
      return;
    }
    setIsAnalyzing(true);
    setIsAnalysisOpen(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceId: playerId,
          signals: allDetections,
          threatLevel: overallThreat,
          categoryThreats,
          stats,
          timePreset: analysisTimePreset,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Analysis API error:", errorText);
        throw new Error(
          `Analysis failed: ${response.status} - ${errorText.substring(0, 100)}`
        );
      }

      const result = await response.json();
      setAnalysisResult(result.data || result);
    } catch (error) {
      console.error("Analysis error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Analysis failed";
      setAnalysisResult({
        analysis: `Error: ${errorMessage}. The AI analysis service encountered an issue. Please try again.`,
        threatLevel: overallThreat,
        signalCount: allDetections.length,
        timestamp: Date.now(),
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [allDetections, overallThreat, categoryThreats, stats, playerId, analysisTimePreset]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      {/* Animated Background - Same as home page */}
      <AnimatedBackground intensity="medium" particleCount={20} showFloatingDots={true} />
      
      {/* Enhanced Header - Sticky Frosted */}
      <motion.header 
        className="backdrop-blur-xl bg-white/5 border-b border-white/10 sticky top-0 z-40"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
      >
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <motion.button
                onClick={() => router.push("/")}
                className="group p-3 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 hover:from-white/20 hover:to-white/10 hover:border-white/20 transition-all duration-300"
                whileHover={{ scale: 1.05, rotate: -5 }}
                whileTap={{ scale: 0.95 }}
              >
                <svg
                  className="w-5 h-5 text-white group-hover:text-indigo-400 transition-colors"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
              </motion.button>
              
              <div className="flex items-center gap-4">
                <motion.div 
                  className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-purple-500/30 border border-indigo-500/30 backdrop-blur-xl"
                  animate={{ rotate: [0, 5, -5, 0] }}
                  transition={{ duration: 4, repeat: Infinity }}
                >
                  <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </motion.div>
                
                <div>
                  <motion.h1 
                    className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    Bot & RTA Detection System
                  </motion.h1>
                  <motion.div 
                    className="mt-3 space-y-1.5 text-xs sm:text-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    {/* Nickname and IP details moved to profile card to avoid duplication */}
                    {isOnline && deviceData?.session_start && (
                      <SessionDurationDisplay sessionStart={deviceData.session_start} />
                    )}
                  </motion.div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.header>

      <div className="px-4 sm:px-6 py-6 sm:py-8 relative z-10">
      {/* Player Profile Summary */}
      {playerId && deviceData && (
        <div className="glass-card p-6 mb-8 animate-slide-up">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-2xl font-bold">
                {deviceData.device_name?.charAt(0).toUpperCase() || "?"}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {deviceData.device_name || "Unknown Player"}
                </h2>
                {/* Structured Player Information */}
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 font-medium min-w-[100px]">Device:</span>
                    <span className="text-slate-300">{deviceDisplayName}</span>
                  </div>

                  {playerId && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">Device ID:</span>
                      <span className="font-mono text-slate-400 break-all">{playerId}</span>
                    </div>
                  )}

                  {nicknameInfo && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">Nickname:</span>
                      <span className="text-green-400 font-medium">{nicknameInfo.name}</span>
                      <span className="text-slate-500 text-xs">
                        ({nicknameInfo.confidencePercent}% confidence)
                      </span>
                    </div>
                  )}

                  {!nicknameInfo && deviceData?.device_name && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">Nickname:</span>
                      <span className="text-slate-300">{deviceData.device_name}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 font-medium min-w-[100px]">Status:</span>
                    <span className="flex items-center gap-2">
                      {isOnline ? (
                        <>
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                          </span>
                          <span className="text-green-400 font-medium">Online</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                          <span className="text-slate-400 font-medium">Offline</span>
                        </>
                      )}
                      {sseOk && (
                        <span className="flex items-center gap-1 text-cyan-400 ml-2">
                          <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                          Live Stream
                        </span>
                      )}
                      {!sseOk && isOnline && (
                        <span className="flex items-center gap-1 text-yellow-400 ml-2">
                          <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                          Polling
                        </span>
                      )}
                      {(data as any)?.cached && (
                        <span className="flex items-center gap-1 text-cyan-400 ml-2">
                          <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                          Cached
                        </span>
                      )}
                    </span>
                  </div>

                  {serverTime && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">Server Time:</span>
                      <span className="text-slate-300">
                        {new Date(serverTime * 1000).toLocaleTimeString()}
                      </span>
                    </div>
                  )}

                  {(deviceData?.ip_address || nicknameInfo?.device_ip) && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">IP:</span>
                      <span className="font-mono text-slate-300">
                        {deviceData?.ip_address || nicknameInfo?.device_ip}
                      </span>
                    </div>
                  )}

                  {!deviceData?.ip_address && !nicknameInfo?.device_ip && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">IP:</span>
                      <span className="text-slate-500 italic">N/A</span>
                    </div>
                  )}

                  {deviceData?.session_duration && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">Session:</span>
                      <span className="text-slate-300">
                        {Math.floor(
                          deviceData.session_duration / (1000 * 60)
                        )}m active
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 font-medium min-w-[100px]">Last Activity:</span>
                    <span className="text-slate-300">{lastActivityLabel}</span>
                  </div>

                  {(tableInfo.length > 0 || (activeTablesInfo && activeTablesInfo.count > 0)) && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">Tables:</span>
                      <span className="text-blue-400">
                        {tableInfo.length || activeTablesInfo?.count || 0} Active
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Stats - unified with Overall Risk */}
            <div className="flex gap-4">
              <div className="text-right space-y-1">
                <div className="text-xs text-slate-400 flex items-center gap-2 justify-end">
                  <span>Current Risk</span>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full ${threatStatusBadge.className}`}
                  >
                    {threatStatusBadge.label}
                  </span>
                </div>
                <div
                  className="text-2xl font-bold transition-opacity"
                  style={{
                    color: threatColor,
                    opacity: isOnline ? 1 : 0.45,
                  }}
                >
                  {overallThreat}%
                </div>
                {!isOnline && (
                  <p className="text-[11px] text-slate-500">
                    Player offline – showing last session value.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Tables Section */}
      {tableInfo.length > 0 && (
        <div className="glass-card p-6 mb-8 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gradient">
              Active Tables ({tableInfo.length})
            </h2>
            <button
              onClick={() => setTableInfo([])}
              className="text-sm text-slate-400 hover:text-slate-300"
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tableInfo.map((table, idx) => (
              <div
                key={idx}
                className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50"
              >
                <div className="mb-3">
                  <h3 className="font-semibold text-white mb-1">
                    {table.title || `Table ${idx + 1}`}
                  </h3>
                  <div className="text-xs text-slate-400 space-y-1">
                    <div>PID: {table.pid}</div>
                    {table.width && table.height && (
                      <div>
                        Size: {table.width} × {table.height}px
                      </div>
                    )}
                  </div>
                </div>
                {table.screenshot && (
                  <div className="mt-3">
                    <img
                      src={`data:image/${
                        table.screenshot_format || "png"
                      };base64,${table.screenshot}`}
                      alt={table.title || `Table ${idx + 1}`}
                      className="w-full rounded-lg border border-slate-700/50"
                      style={{ maxHeight: "400px", objectFit: "contain" }}
                    />
                  </div>
                )}
                {table.error && (
                  <div className="mt-3 text-sm text-red-400">{table.error}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detected Tables Info (when no snapshot taken yet) */}
      {tableInfo.length === 0 &&
        activeTablesInfo &&
        activeTablesInfo.count > 0 && (
          <div className="glass-card p-6 mb-8 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gradient">
                Active Tables ({activeTablesInfo.count})
              </h2>
              <button
                onClick={async () => {
                  if (!playerId || isTakingSnapshot) return;
                  setIsTakingSnapshot(true);
                  setSnapshotError(null);
                  try {
                    const execution = await executeDeviceCommand(
                      "take_snapshot"
                    );

                    if (execution.status === "completed") {
                      const result = execution.result ?? {};
                      const adminHint =
                        execution.requireAdmin || result?.adminRequired
                          ? "\nObservera: scanner måste köras som administratör på Windows-maskinen."
                          : "";

                      if (result?.success) {
                        const tables = result?.output?.tables || [];
                        const count =
                          result?.output?.count ??
                          (Array.isArray(tables) ? tables.length : 0);
                        setTableInfo(Array.isArray(tables) ? tables : []);
                        alert(`Fångade ${count} bord.${adminHint}`);
                      } else {
                        const errorMsg =
                          result?.error || "Misslyckades med att ta snapshots.";
                        setSnapshotError(errorMsg);
                        alert(`Fel: ${errorMsg}${adminHint}`);
                      }
                    } else if (execution.status === "timeout") {
                      const errorMsg =
                        "Snapshot-kommandot timeout: ingen respons från scanner.";
                      setSnapshotError(errorMsg);
                      alert(`Fel: ${errorMsg}`);
                    } else {
                      const errorMsg =
                        "Snapshot-kommandot kunde inte genomföras. Kontrollera att scanner-klienten är aktiv.";
                      setSnapshotError(errorMsg);
                      alert(`Fel: ${errorMsg}`);
                    }
                  } catch (error) {
                    console.error("Take Snapshot command error:", error);
                    const errorMsg =
                      error instanceof Error
                        ? error.message
                        : "Okänt fel vid snapshot-kommandot.";
                    setSnapshotError(errorMsg);
                    alert(`Fel: ${errorMsg}`);
                  } finally {
                    setIsTakingSnapshot(false);
                  }
                }}
                disabled={isTakingSnapshot}
                className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {isTakingSnapshot ? "Taking Snapshot..." : "Take Snapshot"}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeTablesInfo.tables.map((table: any, idx: number) => (
                <div
                  key={idx}
                  className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50"
                >
                  <div
                    className="text-sm font-medium text-white mb-1 truncate"
                    title={table.title}
                  >
                    {table.title || `Table ${idx + 1}`}
                  </div>
                  <div className="text-xs text-slate-400">
                    {table.width && table.height
                      ? `${table.width} × ${table.height}px`
                      : "Size unknown"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      {/* Overall Threat Analysis Section */}
      <div className="glass-card p-6 sm:p-8 mb-8 sm:mb-10 animate-slide-up">
        <h2 className="text-2xl sm:text-3xl font-bold mb-8 text-gradient">
          Threat Analysis
        </h2>

        {/* Main Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          {/* Bot Probability - Primary Metric */}
          <div className="md:col-span-1 bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl p-6 border border-slate-700/50 hover:border-slate-600 transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-400">
                Overall Risk
              </span>
              <span className="text-2xl">🎯</span>
            </div>
            <div
              className="text-5xl font-bold mb-2 transition-opacity"
              style={{ color: threatColor, opacity: isOnline ? 1 : 0.45 }}
            >
              <AnimatedCounter value={overallThreat} suffix="%" />
            </div>
            <div
              className={`text-xs font-semibold ${
                isOnline ? "text-slate-400" : "text-slate-500"
              }`}
            >
              {getThreatLabel(overallThreat)}
            </div>
          </div>

          {/* Critical Threats */}
          <div className="bg-gradient-to-br from-red-900/30 to-slate-900/50 rounded-xl p-6 border border-red-700/30 hover:border-red-600/50 transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-400">
                Critical
              </span>
              <span className="text-2xl">🔴</span>
            </div>
            <div className="text-4xl font-bold text-red-500 mb-2">
              <AnimatedCounter value={stats.critical} />
            </div>
            <div className="text-xs text-slate-500">
              <span className="text-red-500 font-medium">
                {stats.critical * 15}
              </span>{" "}
              pts
            </div>
          </div>

          {/* Alerts */}
          <div className="bg-gradient-to-br from-orange-900/30 to-slate-900/50 rounded-xl p-6 border border-orange-700/30 hover:border-orange-600/50 transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-400">
                Alerts
              </span>
              <span className="text-2xl">🟠</span>
            </div>
            <div className="text-4xl font-bold text-orange-400 mb-2">
              <AnimatedCounter value={stats.alerts} />
            </div>
            <div className="text-xs text-slate-500">
              <span className="text-orange-400 font-medium">
                {stats.alerts * 10}
              </span>{" "}
              pts
            </div>
          </div>

          {/* Warnings */}
          <div className="bg-gradient-to-br from-yellow-900/30 to-slate-900/50 rounded-xl p-6 border border-yellow-700/30 hover:border-yellow-600/50 transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-400">
                Warnings
              </span>
              <span className="text-2xl">⚠️</span>
            </div>
            <div className="text-4xl font-bold text-yellow-400 mb-2">
              <AnimatedCounter value={stats.warnings} />
            </div>
            <div className="text-xs text-slate-500">
              <span className="text-yellow-400 font-medium">
                {stats.warnings * 5}
              </span>{" "}
              pts
            </div>
          </div>

          {/* Info (optional display) */}
          <div className="bg-gradient-to-br from-blue-900/30 to-slate-900/50 rounded-xl p-6 border border-blue-700/30 hover:border-blue-600/50 transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-400">Info</span>
              <span className="text-2xl">ℹ️</span>
            </div>
            <div className="text-4xl font-bold text-blue-400 mb-2">
              <AnimatedCounter value={stats.info} />
            </div>
            <div className="text-xs text-slate-500">
              <span className="text-blue-400 font-medium">
                {stats.info * 0}
              </span>{" "}
              pts
            </div>
          </div>

          {/* Live Activity removed per request */}
        </div>

        {/* Risk Assessment Bar */}
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <span>Risk Assessment</span>
              <span
                className={`px-2 py-0.5 text-[10px] rounded-full uppercase tracking-wide ${threatStatusBadge.className}`}
              >
                {threatStatusBadge.label}
              </span>
            </div>
            <span className="text-sm font-mono text-slate-400">
              {overallThreat}% / 100%
            </span>
          </div>
          <div className="relative h-4 bg-slate-700/80 rounded-full overflow-hidden mb-3">
            <div
              className="h-full transition-all duration-1000 rounded-full shadow-lg"
              style={{
                width: `${overallThreat}%`,
                background: `linear-gradient(90deg, ${threatColor}88 0%, ${threatColor} 100%)`,
                opacity: isOnline ? 1 : 0.4,
              }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-500 font-mono">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
        {/* Left Column - Threat Overview */}
        <div className="lg:col-span-1 space-y-4 sm:space-y-6">
          {/* Threat Meter */}
          <div className="glass-card p-4 sm:p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-semibold">
                  Threat Meter
                </h2>
                <span
                  className={`text-[10px] sm:text-xs px-2 py-0.5 rounded-full border ${threatStatusBadge.className}`}
                >
                  {threatStatusBadge.label}
                </span>
              </div>
              <span className="text-[10px] sm:text-xs text-slate-400">
                Real-time analysis
              </span>
            </div>
            <div
              className={`flex justify-center mb-4 sm:mb-6 overflow-hidden transition-opacity ${
                isOnline ? "" : "opacity-45"
              }`}
            >
              <div className="w-[180px] h-[180px] sm:w-[240px] sm:h-[240px]">
                <ThreatVisualization
                  data={barometerData}
                  centerValue={overallThreat}
                  centerLabel="Bot Probability"
                />
              </div>
            </div>
            {!isOnline && (
              <p className="text-[11px] text-slate-500 text-center">
                Player offline – meter shows last session reading.
              </p>
            )}
          </div>

          {/* Category Breakdown */}
          <div
            className="glass-card p-4 sm:p-6 animate-slide-up"
            style={{ animationDelay: "100ms" }}
          >
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="text-base sm:text-lg font-semibold">
                Category Breakdown
              </h3>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-200 transition-colors"
                title="Shows per-category detection points (not combined with Threat Meter)."
                aria-label="Category breakdown info"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <circle cx="12" cy="12" r="9" strokeOpacity="0.6" />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 16v-4"
                  />
                  <circle cx="12" cy="8" r="0.75" fill="currentColor" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              {Object.entries(DETECTION_SECTIONS)
                .filter(([catKey]) => catKey !== "system")
                .map(([catKey, cat]) => {
                  const threat = categoryThreats[catKey] || 0;
                  const threatPoints = Math.round(threat);
                  const pointsLabel =
                    threatPoints === 1 ? "1 pt" : `${threatPoints} pts`;
                  const detections = categoryDetections[catKey] || [];
                  const isExpanded = expandedCategory === catKey;
                  const accentColor =
                    CATEGORY_COLORS[catKey] || "rgba(99,102,241,0.8)";

                  return (
                    <div
                      key={catKey}
                      className="rounded-2xl border border-slate-700/50 bg-slate-800/40 shadow-lg shadow-black/10"
                    >
                      <button
                        onClick={() =>
                          setExpandedCategory(isExpanded ? null : catKey)
                        }
                        className="w-full flex items-center justify-between gap-4 p-3 sm:p-4"
                      >
                        <div>
                          <p className="text-sm font-semibold text-white flex items-center gap-2">
                            {cat.title}
                            <span className="text-[11px] text-slate-400">
                              {detections.length} detections
                            </span>
                          </p>
                          <div className="mt-2 h-2 w-full rounded-full bg-slate-700/70 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(threat, 100)}%`,
                                background: `linear-gradient(90deg, ${accentColor}aa 0%, ${accentColor} 100%)`,
                              }}
                            />
                          </div>
                        </div>
                        <div className="text-right">
                          <p
                            className="text-xl font-bold"
                            style={{ color: accentColor }}
                          >
                            {pointsLabel}
                          </p>
                          <svg
                            className={`w-5 h-5 text-slate-400 transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
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
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-2">
                          {detections.length === 0 && (
                            <p className="text-xs text-slate-500">
                              No detections recorded in this session window.
                            </p>
                          )}
                          {detections.map((item, index) => (
                            <div
                              key={`${item.name}-${index}`}
                              className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/40 p-3"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-white truncate">
                                  {item.name}
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  {formatDetectionTimestamp(item.timestamp)}
                                </p>
                              </div>
                              <span
                                className={`px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wide ${statusBadgeStyles[item.status]}`}
                              >
                                {item.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* IP Location Map */}
          {playerId && (
            <IPLocationMap
              ipAddress={deviceData?.ip_address || nicknameInfo?.device_ip || ""}
            />
          )}
        </div>

        {/* Middle Column - Live Feed */}
        <div className="lg:col-span-1">
          <div
            className="glass-card p-4 sm:p-6 h-full animate-slide-up"
            style={{ animationDelay: "200ms" }}
          >
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="text-lg sm:text-xl font-semibold">
                Live Detection Feed
              </h3>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                </span>
                Real-time
              </div>
            </div>
            <div className="h-[calc(100%-3rem)] overflow-auto custom-scrollbar pr-2">
              <DetectionFeed
                detections={allDetections}
                maxItems={20}
                onIgnoreDetection={handleIgnoreDetection}
              />
            </div>
          </div>
        </div>

        {/* Right Column - Charts & Details */}
        <div className="lg:col-span-2 xl:col-span-1 space-y-4 sm:space-y-6">
          {/* Unified Historical Chart */}
          {playerId && (
            <UnifiedHistoryChart
              deviceId={playerId}
              deviceData={deviceData}
              snapshotData={data || undefined}
              onOpenDetailedHistory={() => setIsScoreOpen(true)}
            />
          )}

          {/* Quick Actions */}
          <div
            className="glass-card p-4 sm:p-6 animate-slide-up"
            style={{ animationDelay: "400ms" }}
          >
            <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">
              Quick Actions
            </h3>
            <div className="space-y-2 sm:space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Time Range
                  </label>
                  <select
                    value={analysisTimePreset ?? ""}
                    onChange={(e) =>
                      setAnalysisTimePreset(
                        (e.target.value || "") as
                          | "1h"
                          | "3h"
                          | "6h"
                          | "12h"
                          | "24h"
                          | "3d"
                          | "7d"
                          | "30d"
                          | null
                      )
                    }
                    className="mt-1 w-full px-3 py-2 bg-slate-900/60 border border-slate-700/60 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  >
                    <option value="">Select period…</option>
                    <option value="1h">Last 1 hour</option>
                    <option value="3h">Last 3 hours</option>
                    <option value="6h">Last 6 hours</option>
                    <option value="12h">Last 12 hours</option>
                    <option value="24h">Last 24 hours</option>
                    <option value="3d">Last 3 days</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                  </select>
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={!analysisTimePreset || isAnalyzing}
                  className={`w-full sm:w-auto px-4 py-3 min-h-[44px] rounded-lg transition-all hover:scale-105 text-left sm:text-center ${
                    analysisTimePreset
                      ? "bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30"
                      : "bg-slate-700/30 cursor-not-allowed text-slate-500"
                  }`}
                >
                  <div className="flex items-center justify-between sm:justify-center gap-2">
                    <span className="font-medium">
                      {isAnalyzing ? "Analyzing…" : "Analyze Bot Patterns"}
                    </span>
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
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                      />
                    </svg>
                  </div>
                </button>
              </div>
              <button
                onClick={() => setIsEmergencyOpen(true)}
                className="w-full p-3 min-h-[44px] bg-gradient-to-r from-red-500/20 to-pink-500/20 hover:from-red-500/30 hover:to-pink-500/30 rounded-lg transition-all hover:scale-105 text-left"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">Emergency Mode</span>
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
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
              </button>
              <button
                onClick={async () => {
                  if (!playerId || isKillInProgress) return;
                  if (
                    !confirm(
                      "Kill CoinPoker client for this player? This will terminate the CoinPoker process."
                    )
                  ) {
                    return;
                  }

                  setIsKillInProgress(true);
                  try {
                    const execution = await executeDeviceCommand(
                      "kill_coinpoker"
                    );

                    if (execution.status === "completed") {
                      const result = execution.result ?? {};
                      const adminHint =
                        execution.requireAdmin || result?.adminRequired
                          ? "\nObservera: scanner måste köras som administratör på Windows-maskinen."
                          : "";

                      if (result?.success) {
                        const message =
                          result?.output?.message ||
                          "CoinPoker-klienten stoppades.";
                        alert(`${message}${adminHint}`);
                      } else {
                        const errorMsg =
                          result?.error ||
                          "Misslyckades med att stänga CoinPoker-klienten.";
                        alert(`Fel: ${errorMsg}${adminHint}`);
                      }
                    } else if (execution.status === "timeout") {
                      alert(
                        "Kill-kommandot timeout: ingen respons från scanner (kontrollera att klienten är online)."
                      );
                    } else {
                      alert(
                        "Kill-kommandot kunde inte genomföras. Kontrollera att scanner-klienten är aktiv."
                      );
                    }
                  } catch (error) {
                    console.error("Kill CoinPoker command error:", error);
                    const message =
                      error instanceof Error
                        ? error.message
                        : "Okänt fel vid kill-kommandot.";
                    alert(`Fel: ${message}`);
                  } finally {
                    setIsKillInProgress(false);
                  }
                }}
                disabled={isKillInProgress}
                className="w-full p-3 min-h-[44px] bg-gradient-to-r from-red-500/20 to-orange-500/20 hover:from-red-500/30 hover:to-orange-500/30 rounded-lg transition-all hover:scale-105 text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {isKillInProgress
                      ? "Killing CoinPoker..."
                      : "Kill CoinPoker Client"}
                  </span>
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
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
              </button>
              <button
                onClick={async () => {
                  if (!playerId || isTakingSnapshot) return;
                  setIsTakingSnapshot(true);
                  setSnapshotError(null);
                  try {
                    const execution = await executeDeviceCommand(
                      "take_snapshot"
                    );

                    if (execution.status === "completed") {
                      const result = execution.result ?? {};
                      const adminHint =
                        execution.requireAdmin || result?.adminRequired
                          ? "\nObservera: scanner måste köras som administratör på Windows-maskinen."
                          : "";

                      if (result?.success) {
                        const tables = result?.output?.tables || [];
                        const count =
                          result?.output?.count ??
                          (Array.isArray(tables) ? tables.length : 0);
                        setTableInfo(Array.isArray(tables) ? tables : []);
                        alert(`Fångade ${count} bord.${adminHint}`);
                      } else {
                        const errorMsg =
                          result?.error || "Misslyckades med att ta snapshots.";
                        setSnapshotError(errorMsg);
                        alert(`Fel: ${errorMsg}${adminHint}`);
                      }
                    } else if (execution.status === "timeout") {
                      const errorMsg =
                        "Snapshot-kommandot timeout: ingen respons från scanner.";
                      setSnapshotError(errorMsg);
                      alert(`Fel: ${errorMsg}`);
                    } else {
                      const errorMsg =
                        "Snapshot-kommandot kunde inte genomföras. Kontrollera att scanner-klienten är aktiv.";
                      setSnapshotError(errorMsg);
                      alert(`Fel: ${errorMsg}`);
                    }
                  } catch (error) {
                    console.error("Take Snapshot command error:", error);
                    const errorMsg =
                      error instanceof Error
                        ? error.message
                        : "Okänt fel vid snapshot-kommandot.";
                    setSnapshotError(errorMsg);
                    alert(`Fel: ${errorMsg}`);
                  } finally {
                    setIsTakingSnapshot(false);
                  }
                }}
                disabled={isTakingSnapshot}
                className="w-full p-3 min-h-[44px] bg-gradient-to-r from-green-500/20 to-emerald-500/20 hover:from-green-500/30 hover:to-emerald-500/30 rounded-lg transition-all hover:scale-105 text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {isTakingSnapshot
                      ? "Taking Snapshot..."
                      : "Take Table Snapshot"}
                  </span>
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
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Analysis Modal */}
      <AnalysisModal
        isOpen={isAnalysisOpen}
        onClose={() => setIsAnalysisOpen(false)}
        analysis={analysisResult?.analysis || ""}
        threatLevel={analysisResult?.threatLevel || overallThreat}
        signalCount={analysisResult?.signalCount || allDetections.length}
        isLoading={isAnalyzing}
        timePreset={analysisTimePreset || undefined}
        onTimePresetChange={(preset) => {
          setAnalysisTimePreset(preset);
        }}
        onReanalyze={handleAnalyze}
      />

      {/* Emergency Modal */}
      <EmergencyModal
        isOpen={isEmergencyOpen}
        onClose={() => setIsEmergencyOpen(false)}
        playerId={playerId}
        onConfirm={() => {
          console.log("BLOCK PLAYER confirmed for", playerId);
        }}
      />
      <ReportExportModal
        isOpen={isScoreOpen}
        onClose={() => setIsScoreOpen(false)}
        deviceId={playerId}
        deviceName={deviceData?.device_name}
      />
      <SegmentHistoryModal
        isOpen={false}
        onClose={() => {}}
        deviceId={playerId}
      />
      <DidAgentWidget agentUrl={DID_AGENT_URL} title="D-ID Copilot" />
      </div>
    </main>
  );
}

export default function EnhancedDashboardPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center">
            <div className="loading-spinner"></div>
          </div>
        }
      >
        <EnhancedDashboardContent />
      </Suspense>
    </AuthGuard>
  );
}
