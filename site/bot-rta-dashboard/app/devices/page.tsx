/**
 * Device Manager Page
 * ==================
 * Alias: "Device List" | "Devices" | "Device Manager" | "Device Management"
 * Route: /devices
 * File: app/devices/page.tsx
 *
 * Shows detailed view of all devices with pagination, filters, and statistics.
 * Provides device management and monitoring capabilities.
 *
 * Next.js App Router requires this file to be named "page.tsx" -
 * the route is determined by the folder structure (/app/devices/page.tsx = /devices)
 */
"use client";

import useSWR from "swr";
import { useState, useEffect, useMemo } from "react";
import AuthGuard from "@/components/AuthGuard";
import { useDebouncedNavigation } from "@/lib/navigation";
import NavigationTabs from "@/components/NavigationTabs";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { DatabaseIcon } from "@/components/AnimatedIcons";
import { motion } from "framer-motion";

// ============================================================================
// Types
// ============================================================================

type Device = {
  device_id: string;
  device_name: string;
  last_seen: number;
  signal_count: number;
  threat_level?: number;
  score_per_hour?: number;
  ip_address?: string;
  session_duration?: number;
  historical_threat_levels?: number[];
  threat_trend?: "up" | "down" | "stable";
};

type DevicesResponse = {
  devices: Device[];
  total: number;
};

type LeaderboardEntry = {
  rank: number;
  device_id: string;
  device_name: string;
  score: number;
  bot_probability: number;
};

type LeaderboardResponse = {
  period: string;
  date: string;
  leaderboard: LeaderboardEntry[];
  total: number;
};

// ============================================================================
// Utilities
// ============================================================================

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function getThreatColor(level: number): string {
  if (level >= 75) return "#dc2626"; // red-600
  if (level >= 50) return "#f97316"; // orange-500
  if (level >= 25) return "#eab308"; // yellow-500
  return "#22c55e"; // green-500
}

function getThreatLabel(level: number): string {
  if (level >= 75) return "CRITICAL";
  if (level >= 50) return "HIGH";
  if (level >= 25) return "MEDIUM";
  return "LOW";
}

// ============================================================================
// Components
// ============================================================================

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null;

  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((val, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 100 - ((val - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      className="w-full h-8"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  );
}

// ============================================================================
// Main Component
// ============================================================================

function DevicesPageContent() {
  const { navigateTo, cleanup } = useDebouncedNavigation();
  const {
    data: rawData,
    error,
    isLoading,
  } = useSWR<DevicesResponse | { ok: boolean; data: DevicesResponse }>(
    "/api/devices",
    fetcher,
    {
      refreshInterval: 15000,
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  );

  // Extract data from API response wrapper
  const data: DevicesResponse | undefined =
    rawData && "ok" in rawData && rawData.ok
      ? rawData.data
      : (rawData as DevicesResponse | undefined);

  // State management
  const [hoveredDevice, setHoveredDevice] = useState<string | null>(null);
  const [hourMap, setHourMap] = useState<
    Record<
      string,
      { avg: number; total: number; activeMinutes: number; loading: boolean }
    >
  >({});
  const [currentPage, setCurrentPage] = useState(1);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<
    "hour" | "day" | "week" | "month"
  >("day");
  const [leaderboardLimit, setLeaderboardLimit] = useState(20);
  const [viewMode, setViewMode] = useState<"list" | "leaderboard">(
    "leaderboard"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [threatFilter, setThreatFilter] = useState<
    "all" | "critical" | "high" | "medium" | "low"
  >("all");

  const itemsPerPage = 20;

  // Fetch leaderboard data
  const { data: leaderboardData } = useSWR<{
    ok: boolean;
    data: LeaderboardResponse;
  }>(
    `/api/leaderboard?period=${leaderboardPeriod}&limit=${leaderboardLimit}`,
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: false }
  );

  const leaderboard = leaderboardData?.ok
    ? leaderboardData.data?.leaderboard || []
    : [];

  const loadHour = async (deviceId: string) => {
    setHourMap((m) => ({
      ...m,
      [deviceId]: {
        avg: m[deviceId]?.avg ?? 0,
        total: m[deviceId]?.total ?? 0,
        activeMinutes: m[deviceId]?.activeMinutes ?? 0,
        loading: true,
      },
    }));
    try {
      const res = await fetch(
        `/api/history/hour?device=${encodeURIComponent(deviceId)}&window=3600`
      );
      const json = await res.json();
      if (json?.ok) {
        setHourMap((m) => ({
          ...m,
          [deviceId]: {
            avg: json.avg ?? 0,
            total: json.total ?? 0,
            activeMinutes: json.activeMinutes ?? 0,
            loading: false,
          },
        }));
      } else {
        setHourMap((m) => ({
          ...m,
          [deviceId]: { avg: 0, total: 0, activeMinutes: 0, loading: false },
        }));
      }
    } catch {
      setHourMap((m) => ({
        ...m,
        [deviceId]: { avg: 0, total: 0, activeMinutes: 0, loading: false },
      }));
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Normalize devices data - MUST be before conditional returns (Rules of Hooks)
  const devices = useMemo(() => {
    if (!data) return [] as any[];

    if (Array.isArray(data)) return data;

    const extracted = (data as any).devices ?? (data as any).data ?? data;

    if (Array.isArray(extracted)) return extracted;

    if (extracted && typeof extracted === "object") {
      return Object.values(extracted);
    }

    return [] as any[];
  }, [data]);

  const normalizedDevices = useMemo(() => {
    return devices
      .map((device: any) => {
        const rawId =
          device?.device_id ??
          device?.id ??
          device?.deviceId ??
          device?.deviceID;
        if (!rawId) return null;

        const deviceId = String(rawId);
        const lastSeenMs = Number(device?.last_seen ?? device?.lastSeen ?? 0);
        const threatLevel =
          Number(device?.threat_level ?? device?.threatLevel ?? 0);

        return {
          ...device,
          device_id: deviceId,
          device_name: device?.device_name ?? device?.name ?? deviceId,
          last_seen: lastSeenMs,
          threat_level: threatLevel,
          is_online: device?.is_online ?? false,
          ip_address: device?.ip_address ?? device?.ipAddress,
          signal_count: Number(device?.signal_count ?? device?.signalCount ?? 0),
        };
      })
      .filter(Boolean) as any[];
  }, [devices]);

  // Conditional returns AFTER all hooks
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card p-8 text-center animate-fade-in">
          <div className="text-red-400 text-xl mb-2">
            Failed to load devices
          </div>
          <p className="text-slate-400">Please check your connection</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  const now = Date.now();

  // Filter devices based on search and threat level
  const filteredDevices = normalizedDevices.filter((device) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesName = device.device_name?.toLowerCase().includes(query);
      const matchesId = device.device_id?.toLowerCase().includes(query);
      const matchesIp = device.ip_address?.toLowerCase().includes(query);
      if (!matchesName && !matchesId && !matchesIp) return false;
    }

    // Threat filter
    if (threatFilter !== "all") {
      const threat = device.threat_level || 0;
      if (threatFilter === "critical" && threat < 75) return false;
      if (threatFilter === "high" && (threat < 50 || threat >= 75))
        return false;
      if (threatFilter === "medium" && (threat < 25 || threat >= 50))
        return false;
      if (threatFilter === "low" && threat >= 25) return false;
    }

    return true;
  });

  // Use 120s (2 mins) as active threshold to match scanner's 92s batch interval
  const ACTIVE_THRESHOLD_MS = 120000;

  const allActiveDevices = filteredDevices.filter(
    (d) => now - d.last_seen < ACTIVE_THRESHOLD_MS
  );
  const allInactiveDevices = filteredDevices.filter(
    (d) => now - d.last_seen >= ACTIVE_THRESHOLD_MS
  );

  // Pagination for active devices
  const totalActivePages = Math.ceil(allActiveDevices.length / itemsPerPage);
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const activeDevices = allActiveDevices.slice(startIdx, endIdx);
  const inactiveDevices = allInactiveDevices.slice(0, itemsPerPage);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      {/* Animated Background - Same as home page */}
      <AnimatedBackground intensity="medium" particleCount={20} showFloatingDots={true} />
      
      {/* Floating Icons - Same as home page */}
      {[...Array(3)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute"
          initial={{ x: Math.random() * 400 - 200, y: Math.random() * 400 - 200 }}
          animate={{
            x: [Math.random() * 100 - 50, Math.random() * 100 - 50, Math.random() * 100 - 50],
            y: [Math.random() * 100 - 50, Math.random() * 100 - 50, Math.random() * 100 - 50],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            delay: i * 2,
            ease: "linear",
          }}
          style={{ opacity: 0.05 }}
        >
          <DatabaseIcon className="w-8 h-8 text-indigo-400" />
        </motion.div>
      ))}
      
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
                onClick={() => window.history.back()}
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
                  <DatabaseIcon className="w-10 h-10 text-indigo-400" />
                </motion.div>
                
                <div>
                  <motion.h1 
                    className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    Device Management & Analytics
                  </motion.h1>
                  <motion.p 
                    className="text-white/60 mt-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    Leaderboards, rankings, and advanced device analysis
                  </motion.p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.header>

      <div className="px-4 sm:px-6 py-6 sm:py-8 relative z-10">
        {/* Navigation Tabs */}
        <NavigationTabs />

      {/* View Mode Toggle */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex gap-2 bg-slate-800/50 rounded-lg p-1">
            <button
              onClick={() => setViewMode("leaderboard")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                viewMode === "leaderboard"
                  ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg"
                  : "text-slate-400 hover:text-slate-300"
              }`}
            >
              🏆 Leaderboard
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                viewMode === "list"
                  ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg"
                  : "text-slate-400 hover:text-slate-300"
              }`}
            >
              📋 Device List
            </button>
          </div>
        </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 mb-8 sm:mb-12">
        <div className="glass-card p-6 animate-slide-up">
          <div className="text-3xl font-bold text-green-400">
            {allActiveDevices.length}
          </div>
          <div className="text-sm text-slate-400 mt-2">Active Devices</div>
          <div className="h-1 w-full mt-4 rounded-full bg-gradient-to-r from-green-500 to-emerald-500"></div>
        </div>
        <div
          className="glass-card p-6 animate-slide-up"
          style={{ animationDelay: "100ms" }}
        >
          <div className="text-3xl font-bold text-slate-400">
            {allInactiveDevices.length}
          </div>
          <div className="text-sm text-slate-400 mt-2">Inactive Devices</div>
          <div className="h-1 w-full mt-4 rounded-full bg-gradient-to-r from-slate-500 to-slate-600"></div>
        </div>
        <div
          className="glass-card p-6 animate-slide-up"
          style={{ animationDelay: "200ms" }}
        >
          <div className="text-3xl font-bold text-blue-400">
            {normalizedDevices.reduce(
              (sum, d) => sum + (d.signal_count || 0),
              0
            )}
          </div>
          <div className="text-sm text-slate-400 mt-2">Total Detections</div>
          <div className="h-1 w-full mt-4 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500"></div>
        </div>
        <div
          className="glass-card p-6 animate-slide-up"
          style={{ animationDelay: "300ms" }}
        >
          <div className="text-3xl font-bold text-red-400">
            {
              normalizedDevices.filter((d) => (d.threat_level || 0) >= 75)
                .length
            }
          </div>
          <div className="text-sm text-slate-400 mt-2">Critical Threats</div>
          <div className="h-1 w-full mt-4 rounded-full bg-gradient-to-r from-red-500 to-red-600"></div>
        </div>
      </div>

      {/* Leaderboard View */}
      {viewMode === "leaderboard" && (
        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold flex items-center gap-3">
              <span>🏆</span>
              Top Players Leaderboard
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={leaderboardPeriod}
                onChange={(e) =>
                  setLeaderboardPeriod(
                    e.target.value as "hour" | "day" | "week" | "month"
                  )
                }
                className="bg-slate-700/50 text-slate-300 rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-indigo-500 focus:outline-none"
              >
                <option value="hour">Last Hour</option>
                <option value="day">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
              </select>
              <select
                value={leaderboardLimit}
                onChange={(e) => setLeaderboardLimit(Number(e.target.value))}
                className="bg-slate-700/50 text-slate-300 rounded-lg px-3 py-2 text-sm border border-slate-600 focus:border-indigo-500 focus:outline-none"
              >
                <option value="10">Top 10</option>
                <option value="20">Top 20</option>
                <option value="50">Top 50</option>
                <option value="100">Top 100</option>
              </select>
            </div>
          </div>

          <div className="glass-card p-6">
            {leaderboard.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <div className="text-4xl mb-4">📊</div>
                <p>No leaderboard data available for this period</p>
              </div>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((entry, idx) => {
                  const medal =
                    idx === 0
                      ? "🥇"
                      : idx === 1
                      ? "🥈"
                      : idx === 2
                      ? "🥉"
                      : "🏅";
                  const threatColor = getThreatColor(entry.bot_probability);
                  return (
                    <div
                      key={entry.device_id}
                      className="flex items-center justify-between p-4 rounded-lg bg-slate-800/30 hover:bg-slate-800/50 transition-all cursor-pointer group"
                      onClick={() =>
                        navigateTo(`/dashboard?device=${entry.device_id}`)
                      }
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div className="text-2xl w-10 text-center">{medal}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="text-slate-400 text-sm font-mono w-8">
                              #{entry.rank}
                            </span>
                            <h3 className="font-semibold text-white group-hover:text-indigo-400 transition-colors">
                              {entry.device_name}
                            </h3>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            ID: {entry.device_id.slice(0, 8)}...
                          </p>
                        </div>
                        <div className="text-right">
                          <div
                            className="text-2xl font-bold"
                            style={{ color: threatColor }}
                          >
                            {entry.bot_probability}%
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            {getThreatLabel(entry.bot_probability)}
                          </div>
                        </div>
                      </div>
                      <svg
                        className="w-5 h-5 text-slate-400 group-hover:text-indigo-400 transition-colors ml-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 7l5 5m0 0l-5 5m5-5H6"
                        />
                      </svg>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Device List View */}
      {viewMode === "list" && (
        <>
          {/* Filters */}
          <div className="glass-card p-4 mb-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search by name, ID, or IP address..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-800/50 text-slate-300 rounded-lg px-4 py-2 border border-slate-600 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <select
                value={threatFilter}
                onChange={(e) =>
                  setThreatFilter(e.target.value as typeof threatFilter)
                }
                className="bg-slate-800/50 text-slate-300 rounded-lg px-4 py-2 border border-slate-600 focus:border-indigo-500 focus:outline-none"
              >
                <option value="all">All Threat Levels</option>
                <option value="critical">Critical (75%+)</option>
                <option value="high">High (50-74%)</option>
                <option value="medium">Medium (25-49%)</option>
                <option value="low">Low (&lt;25%)</option>
              </select>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setThreatFilter("all");
                }}
                className="px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors text-sm"
              >
                Clear Filters
              </button>
            </div>
          </div>

          {/* Active Devices */}
          {allActiveDevices.length > 0 && (
            <section className="mb-12">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  Active Devices
                  <span className="text-base text-slate-400 font-normal ml-2">
                    ({allActiveDevices.length} filtered)
                  </span>
                </h2>
                {totalActivePages > 1 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400">
                      Page {currentPage} of {totalActivePages}
                    </span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeDevices.map((device, idx) => (
                  <div
                    key={device.device_id}
                    className="glass-card p-6 cursor-pointer animate-slide-up hover:scale-105 transition-all duration-300"
                    style={{
                      animationDelay: `${idx * 50}ms`,
                      boxShadow:
                        hoveredDevice === device.device_id
                          ? `0 12px 24px ${getThreatColor(
                              device.threat_level || 0
                            )}40`
                          : undefined,
                    }}
                    onClick={() =>
                      navigateTo(`/dashboard?device=${device.device_id}`)
                    }
                    onMouseEnter={() => {
                      setHoveredDevice(device.device_id);
                      if (!hourMap[device.device_id])
                        loadHour(device.device_id);
                    }}
                    onMouseLeave={() => setHoveredDevice(null)}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            {device.device_name}
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                          </h3>
                          {device.threat_level !== undefined && (
                            <div
                              className="px-3 py-1 rounded-full text-xs font-bold animate-pulse"
                              style={{
                                backgroundColor: `${getThreatColor(
                                  device.threat_level
                                )}20`,
                                color: getThreatColor(device.threat_level),
                                border: `1px solid ${getThreatColor(
                                  device.threat_level
                                )}40`,
                              }}
                            >
                              {device.threat_level}%{" "}
                              {getThreatLabel(device.threat_level)}
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-slate-400">
                          ID: {device.device_id.slice(0, 8)}...
                        </p>
                      </div>
                      <div
                        className={`transition-transform ${
                          hoveredDevice === device.device_id ? "scale-110" : ""
                        }`}
                      >
                        <svg
                          className="w-5 h-5 text-slate-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 7l5 5m0 0l-5 5m5-5H6"
                          />
                        </svg>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-400">
                          Last Seen
                        </span>
                        <span className="text-sm font-mono text-green-400">
                          {new Date(device.last_seen).toLocaleTimeString()}
                        </span>
                      </div>
                      {device.ip_address && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-slate-400">
                            IP Address
                          </span>
                          <span className="text-sm font-mono text-slate-300">
                            {device.ip_address}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-400">
                          Last hour avg
                        </span>
                        <span className="text-sm font-semibold text-white">
                          {hourMap[device.device_id]?.loading
                            ? "…"
                            : `${(hourMap[device.device_id]?.avg ?? 0).toFixed(
                                1
                              )} pts`}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-400">
                          Total Signals
                        </span>
                        <span className="text-sm font-semibold text-cyan-400">
                          {device.signal_count}
                        </span>
                      </div>
                      {device.score_per_hour !== undefined && (
                        <div className="pt-2 border-t border-slate-700/50 space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-400">
                              Avg Score/Hour
                            </span>
                            <div className="flex items-center gap-2">
                              <span
                                className="text-sm font-bold"
                                style={{
                                  color: getThreatColor(device.score_per_hour),
                                }}
                              >
                                {device.score_per_hour.toFixed(1)} pts/h
                              </span>
                              {device.threat_trend && (
                                <span className="text-xs">
                                  {device.threat_trend === "up" && "📈"}
                                  {device.threat_trend === "down" && "📉"}
                                  {device.threat_trend === "stable" && "➡️"}
                                </span>
                              )}
                            </div>
                          </div>
                          {device.historical_threat_levels &&
                            device.historical_threat_levels.length > 1 && (
                              <div className="relative">
                                <MiniSparkline
                                  data={device.historical_threat_levels.slice(
                                    -20
                                  )}
                                  color={getThreatColor(
                                    device.threat_level || 0
                                  )}
                                />
                                <div className="flex justify-between text-xs text-slate-600 mt-1">
                                  <span>Activity trend</span>
                                  {device.session_duration && (
                                    <span>
                                      {Math.floor(
                                        device.session_duration / (1000 * 60)
                                      )}
                                      m active
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                        </div>
                      )}
                      <div className="flex justify-end gap-3 text-xs text-slate-500">
                        <span>
                          samples {hourMap[device.device_id]?.total ?? 0}
                        </span>
                        <span>
                          active {hourMap[device.device_id]?.activeMinutes ?? 0}{" "}
                          min
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalActivePages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-8">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="glass-card px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
                  >
                    Previous
                  </button>
                  <div className="flex gap-2">
                    {Array.from(
                      { length: Math.min(5, totalActivePages) },
                      (_, i) => {
                        let pageNum: number;
                        if (totalActivePages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalActivePages - 2) {
                          pageNum = totalActivePages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }

                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`px-4 py-2 rounded-lg transition-all ${
                              currentPage === pageNum
                                ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold"
                                : "glass-card hover:bg-slate-700"
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      }
                    )}
                  </div>
                  <button
                    onClick={() =>
                      setCurrentPage(
                        Math.min(totalActivePages, currentPage + 1)
                      )
                    }
                    disabled={currentPage === totalActivePages}
                    className="glass-card px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Inactive Devices - Only show in list view */}
          {viewMode === "list" && inactiveDevices.length > 0 && (
            <section>
              <h2 className="text-2xl font-semibold mb-6 text-slate-400">
                Inactive Devices
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {inactiveDevices.map((device, idx) => (
                  <div
                    key={device.device_id}
                    className="glass-card p-6 opacity-60 animate-slide-up"
                    style={{
                      animationDelay: `${(activeDevices.length + idx) * 50}ms`,
                    }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-300 flex items-center gap-2">
                          {device.device_name}
                          <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">
                          ID: {device.device_id.slice(0, 8)}...
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-500">
                          Last Seen
                        </span>
                        <span className="text-sm font-mono text-slate-500">
                          {new Date(device.last_seen).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-500">
                          Last hour avg
                        </span>
                        <span className="text-sm font-semibold text-slate-400">
                          —
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Empty State */}
      {(!devices || devices.length === 0) && (
        <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
          <div className="text-6xl mb-4 animate-float">🔍</div>
          <h3 className="text-xl font-semibold text-slate-400 mb-2">
            No devices found
          </h3>
          <p className="text-sm text-slate-500">
            Start the detection agent on a device to see it here
          </p>
        </div>
      )}
      </div>
    </main>
  );
}

export default function DevicesPage() {
  return (
    <AuthGuard>
      <DevicesPageContent />
    </AuthGuard>
  );
}
