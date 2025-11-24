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
import { useDebouncedNavigation } from "@/lib/utils/navigation";
import NavigationTabs from "@/components/NavigationTabs";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { DatabaseIcon } from "@/components/AnimatedIcons";
import DeviceListModule, {
  getThreatColor,
  getThreatLabel,
} from "@/components/DeviceListModule";
import { normalizeDevicesResponse, ACTIVE_DEVICE_THRESHOLD_MS } from "@/lib/device/transform";
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

  // State management
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<
    "hour" | "day" | "week" | "month"
  >("day");
  const [leaderboardLimit, setLeaderboardLimit] = useState(20);
  const [viewMode, setViewMode] = useState<"list" | "leaderboard">(
    "leaderboard"
  );

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

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Normalize devices data - MUST be before conditional returns (Rules of Hooks)
  const { devices: normalizedDevices } = useMemo(
    () => normalizeDevicesResponse(rawData),
    [rawData],
  );

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
  const activeDevices = normalizedDevices.filter(
    (device) => now - device.last_seen < ACTIVE_DEVICE_THRESHOLD_MS,
  );
  const inactiveDevices = normalizedDevices.filter(
    (device) => now - device.last_seen >= ACTIVE_DEVICE_THRESHOLD_MS,
  );
  const totalDetections = normalizedDevices.reduce(
    (sum, device) => sum + (device.signal_count || 0),
    0,
  );
  const criticalThreats = normalizedDevices.filter(
    (device) => (device.threat_level || 0) >= 75,
  ).length;

  return (
    <main className="aurora-background">
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
            {activeDevices.length}
          </div>
          <div className="text-sm text-slate-400 mt-2">Active Devices</div>
          <div className="h-1 w-full mt-4 rounded-full bg-gradient-to-r from-green-500 to-emerald-500"></div>
        </div>
        <div
          className="glass-card p-6 animate-slide-up"
          style={{ animationDelay: "100ms" }}
        >
          <div className="text-3xl font-bold text-slate-400">
            {inactiveDevices.length}
          </div>
          <div className="text-sm text-slate-400 mt-2">Inactive Devices</div>
          <div className="h-1 w-full mt-4 rounded-full bg-gradient-to-r from-slate-500 to-slate-600"></div>
        </div>
        <div
          className="glass-card p-6 animate-slide-up"
          style={{ animationDelay: "200ms" }}
        >
          <div className="text-3xl font-bold text-blue-400">
            {totalDetections}
          </div>
          <div className="text-sm text-slate-400 mt-2">Total Detections</div>
          <div className="h-1 w-full mt-4 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500"></div>
        </div>
        <div
          className="glass-card p-6 animate-slide-up"
          style={{ animationDelay: "300ms" }}
        >
          <div className="text-3xl font-bold text-red-400">
            {criticalThreats}
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
        <DeviceListModule
          devices={normalizedDevices}
          onDeviceSelect={(deviceId) => navigateTo(`/dashboard?device=${deviceId}`)}
        />
      )}

      {/* Empty State */}
      {normalizedDevices.length === 0 && (
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
