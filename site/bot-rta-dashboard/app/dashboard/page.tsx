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
} from "@/lib/detections/sections";
import {
  TIME_WINDOWS,
  getThreatColor,
  getThreatLabel,
  THREAT_WEIGHTS,
} from "@/lib/detections/threat-scoring";
import { CATEGORY_COLORS } from "@/components/charts/constants";
import dynamic from "next/dynamic";
import AnalysisModal from "@/components/AnalysisModal";
import EmergencyModal from "@/components/EmergencyModal";
import AuthGuard from "@/components/AuthGuard";
import SegmentHistoryModal from "@/components/SegmentHistoryModal";
import ReportExportModal from "@/components/ReportExportModal";
import { AnimatedBackground } from "@/components/AnimatedBackground";

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
    <div className="animate-pulse h-64 rounded-lg bg-white/10"></div>
  ),
});

const UnifiedHistoryChart = dynamic(
  () => import("@/components/UnifiedHistoryChart"),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse h-80 rounded-lg bg-white/10"></div>
    ),
  }
);

const IPLocationMap = dynamic(
  () => import("@/components/IPLocationMap"),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse h-64 rounded-lg bg-white/10"></div>
    ),
  }
);

// Stored type imported from sections.ts

type Snapshot = {
  serverTime: number;
  sections: Record<string, { items: Stored[] }>;
};

type DeviceCommandName = "take_snapshot" | "start_recording";

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
const REDIS_COMMANDS_ENABLED = process.env.NEXT_PUBLIC_USE_REDIS === "true";

type SessionDurationVariant = "panel" | "inline";

function SessionDurationDisplay({
  sessionStart,
  variant = "panel",
}: {
  sessionStart: number;
  variant?: SessionDurationVariant;
}) {
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

  const formattedDuration = formatDuration(duration);

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500 font-medium min-w-[100px]">
          Current Session:
        </span>
        <span className="text-indigo-300 font-semibold font-mono">
          {formattedDuration}
        </span>
      </div>
    );
  }

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
      <span className="text-slate-500 font-medium min-w-[80px]">
        Session Duration:
      </span>
      <span className="text-indigo-400 font-semibold font-mono">
        {formattedDuration}
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
    device_hostname?: string;
    is_online?: boolean;
    last_seen?: number;
    threat_level?: number;
    session_start?: number;
    session_duration?: number;
    ip_address?: string;
    player_nickname?: string;
    player_nickname_confidence?: number;
    player_email?: string;
    os_platform?: string;
    os_release?: string;
    os_version?: string;
    os_arch?: string;
  }

  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);
  const normalizeSnapshotResponse = useCallback((payload: any): Snapshot | null => {
    if (!payload) {
      return null;
    }
    if (payload.sections) {
      return payload as Snapshot;
    }
    if (payload.data && payload.data.sections) {
      return payload.data as Snapshot;
    }
    return null;
  }, []);

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
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(2);
  const [showRecordingModal, setShowRecordingModal] = useState(false);
  const [recordings, setRecordings] = useState<any[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);

  const wait = useCallback(
    (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    []
  );

  useEffect(() => {
    setTableInfo([]);
    if (playerId) {
      fetchRecordings();
    }
  }, [playerId]);

  const fetchRecordings = useCallback(async () => {
    if (!playerId) return;
    setRecordingsLoading(true);
    try {
      const res = await fetch(`/api/recordings?deviceId=${encodeURIComponent(playerId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.data) {
          setRecordings(data.data.recordings || []);
        }
      }
    } catch (error) {
      console.error("Failed to fetch recordings:", error);
    } finally {
      setRecordingsLoading(false);
    }
  }, [playerId]);

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

  // Detection method icons and labels for detailed view
  const DETECTION_METHOD_INFO: Record<string, { icon: string; label: string; color: string }> = {
    // Programs subsections
    file_names: { icon: "⚙️", label: "Process", color: "text-purple-400" },
    sha_hashes: { icon: "🔐", label: "SHA-256 Hash", color: "text-red-400" },
    window_titles: { icon: "🪟", label: "Window Title", color: "text-blue-400" },
    path_hints: { icon: "📁", label: "File Path", color: "text-yellow-400" },
    obfuscation: { icon: "🔒", label: "Obfuscated Code", color: "text-orange-400" },
    // Network subsections
    browser_urls: { icon: "🌐", label: "RTA Website", color: "text-cyan-400" },
    messengers: { icon: "💬", label: "Messenger", color: "text-indigo-400" },
    connections: { icon: "🔌", label: "Connection", color: "text-green-400" },
    dns_queries: { icon: "🔍", label: "DNS Query", color: "text-teal-400" },
    // Behaviour subsections
    mouse_patterns: { icon: "🖱️", label: "Mouse Pattern", color: "text-pink-400" },
    keyboard_patterns: { icon: "⌨️", label: "Keyboard", color: "text-violet-400" },
    action_timing: { icon: "⏱️", label: "Timing", color: "text-amber-400" },
    click_patterns: { icon: "👆", label: "Click Pattern", color: "text-rose-400" },
    // VM subsections
    vmware: { icon: "🖥️", label: "VMware", color: "text-emerald-400" },
    virtualbox: { icon: "📦", label: "VirtualBox", color: "text-sky-400" },
    hyperv: { icon: "🪟", label: "Hyper-V", color: "text-blue-400" },
    other_vm: { icon: "💻", label: "VM Detected", color: "text-slate-400" },
    // Auto subsections
    macros: { icon: "🎹", label: "Macro Tool", color: "text-fuchsia-400" },
    scripts: { icon: "📜", label: "Script", color: "text-lime-400" },
    automation: { icon: "🤖", label: "Automation", color: "text-orange-400" },
    clickers: { icon: "🔘", label: "Auto-Clicker", color: "text-red-400" },
    // Fallback
    general: { icon: "📋", label: "Detection", color: "text-slate-400" },
  };

  // Extract meaningful info from details string
  const parseDetectionDetails = useCallback((details?: string, subsection?: string): { 
    shortInfo: string | null; 
    extraTags: string[];
  } => {
    if (!details) return { shortInfo: null, extraTags: [] };
    
    const extraTags: string[] = [];
    let shortInfo: string | null = null;

    // Extract SHA hash (truncated)
    const shaMatch = details.match(/sha[=:]?\s*([a-fA-F0-9]{64})/i) || 
                     details.match(/^([a-fA-F0-9]{64})$/);
    if (shaMatch) {
      shortInfo = `SHA: ${shaMatch[1].substring(0, 12)}...`;
    }

    // Extract file path (show last 2 parts)
    const pathMatch = details.match(/(?:path[=:]?\s*)?([A-Z]:\\[^\s|,]+)/i) ||
                      details.match(/\\([^\\]+\\[^\\|,\s]+)/);
    if (pathMatch && !shortInfo) {
      const path = pathMatch[1] || pathMatch[0];
      const parts = path.split("\\");
      shortInfo = parts.length > 2 
        ? `...\\${parts.slice(-2).join("\\")}`
        : path;
    }

    // Extract process name if not already shown
    const procMatch = details.match(/process[=:]?\s*([^\s|,]+)/i);
    if (procMatch && !shortInfo) {
      shortInfo = procMatch[1];
    }

    // Extract URL/domain
    const urlMatch = details.match(/(https?:\/\/[^\s]+|[\w-]+\.(com|org|net|io)[^\s]*)/i);
    if (urlMatch && !shortInfo) {
      const url = urlMatch[1];
      shortInfo = url.length > 40 ? url.substring(0, 40) + "..." : url;
    }

    // Detect special tags
    if (details.toLowerCase().includes("packer") || details.toLowerCase().includes("packed")) {
      extraTags.push("Packed");
    }
    if (details.toLowerCase().includes("signature")) {
      extraTags.push("Signature");
    }
    if (details.toLowerCase().includes("registry")) {
      extraTags.push("Registry");
    }
    if (details.toLowerCase().includes("injected") || details.toLowerCase().includes("injection")) {
      extraTags.push("Injected");
    }
    if (details.toLowerCase().includes("hidden")) {
      extraTags.push("Hidden");
    }
    if (details.toLowerCase().includes("elevated") || details.toLowerCase().includes("admin")) {
      extraTags.push("Elevated");
    }

    // Fallback: show truncated details if nothing specific found
    if (!shortInfo && details.length > 0) {
      shortInfo = details.length > 50 ? details.substring(0, 50) + "..." : details;
    }

    return { shortInfo, extraTags };
  }, []);

  const statusBadgeStyles: Record<Status, string> = {
    CRITICAL: "bg-red-500/10 text-red-300 border border-red-400/30",
    ALERT: "bg-orange-500/10 text-orange-300 border border-orange-400/30",
    WARN: "bg-yellow-500/10 text-yellow-300 border border-yellow-400/30",
    INFO: "bg-blue-500/10 text-blue-300 border border-blue-400/30",
    OK: "bg-green-500/10 text-green-300 border border-green-400/30",
  OFF: "bg-white/10 text-slate-200 border border-white/15",
  UNK: "bg-white/5 text-slate-300 border border-white/10",
  };

  const queueDeviceCommand = useCallback(
    async (deviceId: string, command: DeviceCommandName, payload?: unknown) => {
      const request = async (path: string) => {
        const res = await fetch(path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deviceId, command, payload }),
        });

        let parsed: any = null;
        try {
          parsed = await res.json();
        } catch (error) {
          console.error("queueDeviceCommand JSON parse error", error);
        }

        return { res, parsed };
      };

      const primaryPath = REDIS_COMMANDS_ENABLED
        ? "/api/device-commands/redis"
        : "/api/device-commands";

      let { res, parsed } = await request(primaryPath);

      if (REDIS_COMMANDS_ENABLED && res.status === 503) {
        ({ res, parsed } = await request("/api/device-commands"));
      }

      if (!res.ok || !parsed?.ok) {
        const message = parsed?.error || "Failed to queue command";
        throw new Error(message);
      }

      return (parsed.data ?? {}) as {
        commandId: string;
        requireAdmin?: boolean;
      };
    },
    []
  );

  const fetchCommandResult = useCallback(
    async (commandId: string, timeoutMs = 20000) => {
      if (!playerId) {
        throw new Error("Device ID missing");
      }

      // Handle undefined explicitly (default parameters don't work when undefined is passed)
      const actualTimeout = timeoutMs ?? 20000;

      const request = async (url: string) => {
        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
        });

        let parsed: any = null;
        try {
          parsed = await res.json();
        } catch (error) {
          console.error("fetchCommandResult JSON parse error", error);
        }

        return { res, parsed };
      };

      const redisUrl = `/api/device-commands/redis?id=${encodeURIComponent(
        commandId
      )}&deviceId=${encodeURIComponent(playerId)}`;
      const httpUrl = `/api/device-commands/result?id=${encodeURIComponent(
        commandId
      )}`;

      const started = Date.now();

      while (Date.now() - started < actualTimeout) {
        let { res, parsed } = await request(
          REDIS_COMMANDS_ENABLED ? redisUrl : httpUrl
        );

        if (REDIS_COMMANDS_ENABLED && res.status === 503) {
          ({ res, parsed } = await request(httpUrl));
        }

        if (!res.ok || !parsed?.ok) {
          const message = parsed?.error || "Failed to fetch command result";
          throw new Error(message);
        }

        const status = parsed?.data?.status;
        if (status === "completed") {
          return {
            status: "completed" as const,
            result: parsed.data?.result,
          };
        }

        if (status === "unknown") {
          return { status: "unknown" as const };
        }

        await wait(1000);
      }

      return { status: "timeout" as const };
    },
    [wait, playerId]
  );

  const executeDeviceCommand = useCallback(
    async (
      command: DeviceCommandName,
      payload?: unknown,
      timeoutMs?: number
    ): Promise<CommandExecutionResult> => {
      if (!playerId) {
        throw new Error("Device ID missing");
      }

      const queued = await queueDeviceCommand(playerId, command, payload);
      const outcome = await fetchCommandResult(queued.commandId, timeoutMs);

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
  const normalizedCachedSnapshot = useMemo(
    () => normalizeSnapshotResponse(cachedData),
    [cachedData, normalizeSnapshotResponse],
  );

  useEffect(() => {
    if (normalizedCachedSnapshot && !data) {
      setData(normalizedCachedSnapshot);
    }
  }, [normalizedCachedSnapshot, data]);

  // Fallback polling
  const pollUrl = playerId
    ? `/api/snapshot?device=${playerId}`
    : "/api/snapshot";
  const { data: polled } = useSWR(!sseOk ? pollUrl : null, fetcher, {
    refreshInterval: 15000,
  });
  useEffect(() => {
    const normalizedPoll = normalizeSnapshotResponse(polled);
    if (normalizedPoll) {
      setData(normalizedPoll);
    }
  }, [polled, normalizeSnapshotResponse]);

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
              "bg-white/10 text-slate-200 border border-white/15",
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
    // Category breakdown should show each unique detection TYPE separately
    // e.g., OpenHoldem detected by process, hash, signature = 3 separate entries
    // But exact duplicates (same name + subsection) should be deduplicated
    const bucket: Record<
      string,
      Array<{
        name: string;
        status: Status;
        timestamp?: number;
        details?: string;
        subsection?: string; // Track detection method (processes, hash, signatures, etc.)
      }>
    > = {};

    // Use a Map to deduplicate by category:subsection:name
    // This preserves different detection methods while removing exact duplicates
    const dedupeMap = new Map<string, {
      name: string;
      status: Status;
      timestamp: number;
      details?: string;
      categoryKey: string;
      subsection: string;
    }>();

    Object.entries(grouped).forEach(([sectionKey, section]) => {
      if (!section?.items?.length) return;
      
      // Parse section key to get category and subsection (e.g., "programs_processes" → ["programs", "processes"])
      const parts = sectionKey.split("_");
      const categoryKey = parts[0];
      const subsection = parts.slice(1).join("_") || "general";
      
      if (!categoryKey || categoryKey === "system") return;

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

        // Deduplication key: category + subsection + name
        // This ensures same program detected by different methods shows separately
        // But same program detected by same method doesn't duplicate
        const dedupeKey = `${categoryKey}:${subsection}:${item.name}`;
        const existing = dedupeMap.get(dedupeKey);
        
        // Keep the most recent detection for each unique combination
        if (!existing || (item.timestamp || 0) > existing.timestamp) {
          dedupeMap.set(dedupeKey, {
            name: item.name,
            status: item.status || "INFO",
            timestamp: item.timestamp || 0,
            details: item.details,
            categoryKey,
            subsection,
          });
        }
      });
    });

    // Convert deduped map back to bucket format
    dedupeMap.forEach((item) => {
      bucket[item.categoryKey] = bucket[item.categoryKey] || [];
      bucket[item.categoryKey].push({
        name: item.name,
        status: item.status,
        timestamp: item.timestamp,
        details: item.details,
        subsection: item.subsection,
      });
    });

    // Sort by timestamp (most recent first) and limit to 6 per category
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
      nicknameInfo?.name ||
      deviceData?.player_nickname ||
      deviceData?.device_name ||
      (playerId ? playerId.split("_")[0] : "Unknown Player")
    );
  }, [
    nicknameInfo?.name,
    deviceData?.player_nickname,
    deviceData?.device_name,
    playerId,
  ]);
  const deviceHostLabel =
    deviceData?.device_hostname || deviceData?.device_name || "Unknown Device";
  const nicknameLabel =
    nicknameInfo?.name ||
    deviceData?.player_nickname ||
    deviceData?.device_name ||
    "Unknown Player";
  const nicknameConfidence =
    nicknameInfo?.confidencePercent || deviceData?.player_nickname_confidence;
  const hasExplicitNickname = Boolean(
    nicknameInfo?.name || deviceData?.player_nickname,
  );

  // Ignore detection function
  const handleIgnoreDetection = useCallback(async (detection: any) => {
    try {
      const response = await fetch("/api/configs/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
        alert(`Added "${detection.name}" to ignore list`);
      } else {
        const data = await response.json();
        console.error("Failed to add to ignore list:", data.error);
        alert(`Failed to add to ignore list: ${data.error || 'Unknown error'}`);
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
    <main className="aurora-background">
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
                  <motion.p
                    className="uppercase tracking-wide text-[11px] text-slate-500"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    Player Focus
                  </motion.p>
                  <motion.h1 
                    className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    {nicknameLabel}
                  </motion.h1>
                  <motion.p 
                    className="mt-2 text-sm text-slate-400"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    Bot & RTA Detection System · {deviceHostLabel}
                  </motion.p>
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
                  {deviceHostLabel}
                </h2>
                {/* Structured Player Information */}
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 font-medium min-w-[100px]">Device:</span>
                    <span className="text-slate-300">{deviceHostLabel}</span>
                  </div>

                  {playerId && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">Device ID:</span>
                      <span className="font-mono text-slate-400 break-all">{playerId}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 font-medium min-w-[100px]">Nickname:</span>
                    <span
                      className={`font-medium ${
                        hasExplicitNickname ? "text-green-400" : "text-slate-300"
                      }`}
                    >
                      {nicknameLabel}
                    </span>
                    {hasExplicitNickname && nicknameConfidence !== undefined && (
                      <span className="text-slate-500 text-xs">
                        ({Math.round(nicknameConfidence)}% confidence)
                      </span>
                    )}
                  </div>

                  {deviceData?.player_email && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">Email:</span>
                      <span className="text-slate-300">{deviceData.player_email}</span>
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

                  {isOnline && deviceData?.session_start && (
                    <SessionDurationDisplay
                      sessionStart={deviceData.session_start}
                      variant="inline"
                    />
                  )}

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

                  {(deviceData?.os_platform || deviceData?.os_release || deviceData?.os_arch) && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">OS:</span>
                      <span className="text-slate-300">
                        {(() => {
                          const p = (deviceData.os_platform || "").toLowerCase();
                          const icon =
                            p.includes("windows") ? "🪟" : p.includes("darwin") || p.includes("mac") ? "🍎" : p.includes("linux") ? "🐧" : "💻";
                          const platform = deviceData.os_platform || "Unknown";
                          const rel = deviceData.os_release ? ` ${deviceData.os_release}` : "";
                          const arch = deviceData.os_arch ? ` (${deviceData.os_arch})` : "";
                          return `${icon} ${platform}${rel}${arch}`;
                        })()}
                      </span>
                    </div>
                  )}

                  {!deviceData?.ip_address && !nicknameInfo?.device_ip && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">IP:</span>
                      <span className="text-slate-500 italic">N/A</span>
                    </div>
                  )}

                  {!isOnline && deviceData?.session_duration && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 font-medium min-w-[100px]">Last Session:</span>
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
      {/* Recordings List */}
      {playerId && (
        <div className="glass-card p-6 mb-8 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gradient">
              Recordings ({recordings.length})
            </h2>
            <button
              onClick={fetchRecordings}
              disabled={recordingsLoading}
              className="text-sm px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-50"
            >
              {recordingsLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
          {recordings.length === 0 ? (
            <p className="text-slate-400 text-center py-8">
              No recordings yet. Click &quot;Make Recording&quot; to start.
            </p>
          ) : (
            <div className="space-y-3">
              {recordings.map((recording: any) => (
                <div
                  key={recording.recordingId}
                  className="bg-slate-700/50 rounded-lg p-4 border border-slate-600"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-white">
                          {new Date(recording.createdAt).toLocaleString()}
                        </span>
                        <span className="text-xs text-slate-400">
                          • {(recording.fileSize / 1024 / 1024).toFixed(2)} MB
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Expires: {new Date(recording.expiresAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={recording.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium"
                      >
                        View
                      </a>
                      <a
                        href={recording.url}
                        download
                        className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded-lg text-sm font-medium"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
            {tableInfo.map((table, idx) => {
              // Check if this is the lobby - use explicit flag if available, otherwise check title
              // Only mark as lobby if it's explicitly flagged OR (first item AND title contains "lobby" AND has screenshot)
              const isLobby = 
                (table as any).isLobby === true || 
                (idx === 0 && table.title?.toLowerCase().includes("lobby") && table.screenshot);
              return (
              <div
                key={idx}
                className={`surface-panel p-4 ${isLobby ? "ring-2 ring-purple-500/50" : ""}`}
              >
                <div className="mb-3">
                  <h3 className="font-semibold text-white mb-1">
                    {isLobby ? "🎰 Lobby" : table.title || `Table ${idx + 1}`}
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
            );
            })}
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
                          ? "\nNote: scanner must be run as administrator on the Windows machine."
                          : "";

                      if (result?.success) {
                        const tables = result?.output?.tables || [];
                        const lobby = result?.output?.lobby || null;
                        const count =
                          result?.output?.count ??
                          (Array.isArray(tables) ? tables.length : 0);
                        
                        // Show lobby info if captured
                        const lobbyMsg = lobby ? `\nLobby captured: ${lobby.title}` : "";
                        alert(`Captured ${count} tables.${lobbyMsg}${adminHint}`);
                        
                        // Store lobby for display (prepend to tableInfo)
                        if (lobby && lobby.screenshot) {
                          // Add lobby as first item in tableInfo for display with explicit flag
                          setTableInfo([{ ...lobby, isLobby: true }, ...tables]);
                        } else {
                          setTableInfo(Array.isArray(tables) ? tables : []);
                        }
                      } else {
                        const errorMsg =
                          result?.error || "Failed to take snapshots.";
                        setSnapshotError(errorMsg);
                        alert(`Error: ${errorMsg}${adminHint}`);
                      }
                    } else if (execution.status === "timeout") {
                      const errorMsg =
                        "Snapshot command timed out: no response from scanner.";
                      setSnapshotError(errorMsg);
                      alert(`Error: ${errorMsg}`);
                    } else {
                      const errorMsg =
                        "Snapshot command could not be executed. Check that the scanner client is active.";
                      setSnapshotError(errorMsg);
                      alert(`Error: ${errorMsg}`);
                    }
                  } catch (error) {
                    console.error("Take Snapshot command error:", error);
                    const errorMsg =
                      error instanceof Error
                        ? error.message
                        : "Unknown error with snapshot command.";
                    setSnapshotError(errorMsg);
                    alert(`Error: ${errorMsg}`);
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
                  className="surface-panel p-3"
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
          <div className="md:col-span-1 surface-panel p-6">
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
          <div className="surface-panel p-6 border-red-500/40 bg-gradient-to-br from-red-500/15 via-transparent to-white/5">
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
          <div className="surface-panel p-6 border-orange-400/40 bg-gradient-to-br from-orange-400/15 via-transparent to-white/5">
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
          <div className="surface-panel p-6 border-yellow-300/40 bg-gradient-to-br from-yellow-300/20 via-transparent to-white/5">
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
          <div className="surface-panel p-6 border-blue-400/40 bg-gradient-to-br from-blue-400/15 via-transparent to-white/5">
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
        <div className="surface-panel p-6">
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
          <div className="relative h-4 bg-white/15 rounded-full overflow-hidden mb-3">
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
                      className="surface-panel shadow-black/10"
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
                          <div className="mt-2 h-2 w-full rounded-full bg-white/15 overflow-hidden">
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
                          {detections.map((item, index) => {
                            const methodInfo = DETECTION_METHOD_INFO[item.subsection || "general"] || DETECTION_METHOD_INFO.general;
                            const { shortInfo, extraTags } = parseDetectionDetails(item.details, item.subsection);
                            
                            return (
                              <div
                                key={`${item.name}-${item.subsection || ''}-${index}`}
                                className="rounded-xl bg-white/5 border border-white/10 p-3 hover:bg-white/[0.07] transition-colors"
                              >
                                {/* Top row: Detection method badge + Status */}
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/50 ${methodInfo.color}`}>
                                      <span className="text-sm">{methodInfo.icon}</span>
                                      <span className="text-[10px] font-semibold uppercase tracking-wide">
                                        {methodInfo.label}
                                      </span>
                                    </span>
                                    {extraTags.map((tag, tagIdx) => (
                                      <span 
                                        key={tagIdx}
                                        className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wide flex-shrink-0 ${statusBadgeStyles[item.status]}`}
                                  >
                                    {item.status}
                                  </span>
                                </div>
                                
                                {/* Middle row: Detection name */}
                                <p className="text-sm font-medium text-white mb-1">
                                  {item.name}
                                </p>
                                
                                {/* Bottom row: Details and timestamp */}
                                <div className="flex items-center justify-between gap-2">
                                  {shortInfo && (
                                    <p className="text-[11px] text-slate-400 font-mono truncate flex-1" title={item.details}>
                                      {shortInfo}
                                    </p>
                                  )}
                                  <p className="text-[10px] text-slate-500 flex-shrink-0">
                                    {formatDetectionTimestamp(item.timestamp)}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
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
                  className="mt-1 w-full px-3 py-2 rounded-lg text-sm text-white bg-slate-800 border border-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 hover:bg-slate-700 transition-colors"
                  >
                    <option value="" className="bg-slate-800 text-white">Select period…</option>
                    <option value="1h" className="bg-slate-800 text-white">Last 1 hour</option>
                    <option value="3h" className="bg-slate-800 text-white">Last 3 hours</option>
                    <option value="6h" className="bg-slate-800 text-white">Last 6 hours</option>
                    <option value="12h" className="bg-slate-800 text-white">Last 12 hours</option>
                    <option value="24h" className="bg-slate-800 text-white">Last 24 hours</option>
                    <option value="3d" className="bg-slate-800 text-white">Last 3 days</option>
                    <option value="7d" className="bg-slate-800 text-white">Last 7 days</option>
                    <option value="30d" className="bg-slate-800 text-white">Last 30 days</option>
                  </select>
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={!analysisTimePreset || isAnalyzing}
                  className={`w-full sm:w-auto px-4 py-3 min-h-[44px] rounded-lg transition-all hover:scale-105 text-left sm:text-center ${
                    analysisTimePreset
                      ? "bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30"
                      : "bg-white/10 cursor-not-allowed text-white/50"
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
                          ? "\nNote: scanner must be run as administrator on the Windows machine."
                          : "";

                      if (result?.success) {
                        const tables = result?.output?.tables || [];
                        const lobby = result?.output?.lobby || null;
                        const count =
                          result?.output?.count ??
                          (Array.isArray(tables) ? tables.length : 0);
                        
                        // Show lobby info if captured
                        const lobbyMsg = lobby ? `\nLobby captured: ${lobby.title}` : "";
                        alert(`Captured ${count} tables.${lobbyMsg}${adminHint}`);
                        
                        // Store lobby for display (prepend to tableInfo)
                        if (lobby && lobby.screenshot) {
                          // Add lobby as first item in tableInfo for display with explicit flag
                          setTableInfo([{ ...lobby, isLobby: true }, ...tables]);
                        } else {
                          setTableInfo(Array.isArray(tables) ? tables : []);
                        }
                      } else {
                        const errorMsg =
                          result?.error || "Failed to take snapshots.";
                        setSnapshotError(errorMsg);
                        alert(`Error: ${errorMsg}${adminHint}`);
                      }
                    } else if (execution.status === "timeout") {
                      const errorMsg =
                        "Snapshot command timed out: no response from scanner.";
                      setSnapshotError(errorMsg);
                      alert(`Error: ${errorMsg}`);
                    } else {
                      const errorMsg =
                        "Snapshot command could not be executed. Check that the scanner client is active.";
                      setSnapshotError(errorMsg);
                      alert(`Error: ${errorMsg}`);
                    }
                  } catch (error) {
                    console.error("Take Snapshot command error:", error);
                    const errorMsg =
                      error instanceof Error
                        ? error.message
                        : "Unknown error with snapshot command.";
                    setSnapshotError(errorMsg);
                    alert(`Error: ${errorMsg}`);
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
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0 1 10.07 4h3.86a2 2 0 0 1 1.664.89l.812 1.22A2 2 0 0 0 18.07 7H19a2 2 0 012 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"
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
              <button
                onClick={() => {
                  if (!playerId || isRecording) return;
                  setShowRecordingModal(true);
                }}
                disabled={isRecording}
                className="w-full p-3 min-h-[44px] bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 rounded-lg transition-all hover:scale-105 text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {isRecording ? "Recording..." : "Make Recording"}
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
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
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
        deviceLabel={deviceDisplayName}
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
        deviceName={deviceDisplayName}
      />
      <SegmentHistoryModal
        isOpen={false}
        onClose={() => {}}
        deviceId={playerId}
      />
      
      {/* Recording Modal */}
      {showRecordingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border border-slate-700">
            <h2 className="text-xl font-bold text-white mb-4">Start Recording</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Duration (minutes)
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={recordingDuration}
                onChange={(e) => setRecordingDuration(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                Enter duration between 1-10 minutes
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  if (!playerId) return;
                  setShowRecordingModal(false);
                  setIsRecording(true);
                  
                  // Store command ID to track this recording
                  let commandId: string | null = null;
                  
                  try {
                    // Calculate timeout dynamically: recording duration + upload time + buffer
                    // Upload time estimate: ~30s per minute of recording (for large files)
                    // Buffer: 60 seconds for safety
                    // Formula: (duration_minutes * 60) + (duration_minutes * 30) + 60
                    // Simplified: duration_minutes * 90 + 60 seconds
                    const uploadTimeSeconds = recordingDuration * 30; // 30s per minute for upload
                    const bufferSeconds = 60; // 1 minute buffer
                    const recordingTimeoutMs = (recordingDuration * 60 + uploadTimeSeconds + bufferSeconds) * 1000;
                    
                    // Queue command first to get command ID
                    const queued = await queueDeviceCommand(
                      playerId,
                      "start_recording",
                      { duration_minutes: recordingDuration }
                    );
                    commandId = queued.commandId;
                    
                    // Show immediate feedback popup
                    const adminHint = queued.requireAdmin
                      ? "\nNote: scanner must be run as administrator on the Windows machine."
                      : "";
                    alert(
                      `Recording started for ${recordingDuration} minute(s).${adminHint}\nThe video will be uploaded automatically when recording completes.\n\nYou can check the recordings list below once it's ready.`
                    );
                    
                    // Start polling for result in background (non-blocking)
                    const checkResult = async () => {
                      try {
                        const execution = await fetchCommandResult(commandId!, recordingTimeoutMs);
                        
                        if (execution.status === "completed") {
                          const result = execution.result ?? {};
                          if (result?.success) {
                            // Recording completed successfully - verify it's uploaded
                            // Wait a bit for upload to complete, then check
                            setTimeout(async () => {
                              try {
                                await fetchRecordings();
                                // Check if recording exists in list by commandId
                                const recordingsResponse = await fetch(`/api/recordings?deviceId=${encodeURIComponent(playerId!)}`).then(r => r.json());
                                const foundRecording = recordingsResponse?.data?.recordings?.find((r: any) => r.commandId === commandId);
                                
                                if (foundRecording) {
                                  // Verify file is accessible
                                  try {
                                    const testResponse = await fetch(foundRecording.url, { method: "HEAD" });
                                    if (testResponse.ok) {
                                      alert(
                                        `✅ Recording completed and uploaded successfully!\n\nFile size: ${(foundRecording.fileSize / 1024 / 1024).toFixed(2)} MB\nCreated: ${new Date(foundRecording.createdAt).toLocaleString()}\n\nYou can view or download it from the recordings list below.`
                                      );
                                    } else {
                                      alert(
                                        `⚠️ Recording uploaded but file may not be ready yet.\n\nPlease check the recordings list in a few moments or refresh manually.`
                                      );
                                    }
                                  } catch {
                                    // File check failed, but recording exists in metadata
                                    alert(
                                      `✅ Recording uploaded successfully!\n\nFile size: ${(foundRecording.fileSize / 1024 / 1024).toFixed(2)} MB\nCreated: ${new Date(foundRecording.createdAt).toLocaleString()}\n\nYou can view or download it from the recordings list below.`
                                    );
                                  }
                                } else {
                                  // Recording might still be uploading, check again later
                                  setTimeout(async () => {
                                    try {
                                      await fetchRecordings();
                                      const recordingsFinal = await fetch(`/api/recordings?deviceId=${encodeURIComponent(playerId!)}`).then(r => r.json());
                                      const foundFinal = recordingsFinal?.data?.recordings?.find((r: any) => r.commandId === commandId);
                                      if (foundFinal) {
                                        alert(
                                          `✅ Recording uploaded successfully!\n\nFile size: ${(foundFinal.fileSize / 1024 / 1024).toFixed(2)} MB\nCreated: ${new Date(foundFinal.createdAt).toLocaleString()}\n\nYou can view or download it from the recordings list below.`
                                        );
                                      } else {
                                        alert(
                                          `⚠️ Recording completed but may still be uploading.\n\nPlease check the recordings list in a few moments or refresh manually.`
                                        );
                                      }
                                    } catch (err) {
                                      console.error("Final recording check error:", err);
                                      alert(
                                        `⚠️ Recording completed. Please check the recordings list manually.`
                                      );
                                    }
                                  }, 10000); // Check again after 10s
                                }
                              } catch (err) {
                                console.error("Recording verification error:", err);
                                alert(
                                  `✅ Recording completed. Please check the recordings list to verify upload.`
                                );
                              }
                            }, 5000); // Wait 5s for upload to complete
                          } else {
                            const errorMsg = result?.error || "Recording failed.";
                            alert(`❌ Recording error: ${errorMsg}`);
                          }
                        } else if (execution.status === "timeout") {
                          // Timeout - recording might still be running
                          alert(
                            `⏱️ Recording command timed out after ${Math.round(recordingTimeoutMs / 1000)}s.\n\nThe recording is still running on the scanner and will upload automatically when complete.\n\nPlease check the recordings list below in a few minutes.`
                          );
                          // Refresh recordings list after delay
                          setTimeout(() => {
                            fetchRecordings();
                          }, (recordingDuration * 60 + 30) * 1000);
                        } else {
                          alert(
                            "⚠️ Recording command status unknown.\n\nPlease check the recordings list below or refresh manually."
                          );
                        }
                      } catch (error) {
                        console.error("Recording result check error:", error);
                        // Don't show error popup - user already got initial confirmation
                        // Just refresh recordings list in case it completed
                        setTimeout(() => {
                          fetchRecordings();
                        }, (recordingDuration * 60 + 30) * 1000);
                      } finally {
                        setIsRecording(false);
                      }
                    };
                    
                    // Start checking result in background
                    checkResult();
                    
                  } catch (error) {
                    console.error("Start Recording command error:", error);
                    const errorMsg =
                      error instanceof Error
                        ? error.message
                        : "Unknown error with recording command.";
                    alert(`❌ Error starting recording: ${errorMsg}`);
                    setIsRecording(false);
                  }
                }}
                disabled={isRecording}
                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start Recording
              </button>
              <button
                onClick={() => setShowRecordingModal(false)}
                disabled={isRecording}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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