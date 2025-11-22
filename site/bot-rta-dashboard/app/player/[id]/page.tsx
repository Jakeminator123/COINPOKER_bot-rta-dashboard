/**
 * Public Player History Page
 * ==========================
 * Public view of player historical data (no login required)
 * Shows historical threat analysis from Redis cache
 */
"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import useSWR from "swr";
import UnifiedHistoryChart from "@/components/UnifiedHistoryChart";
import ReportExportModal from "@/components/ReportExportModal";
import { getThreatColor, getThreatLevel } from "@/lib/detections/threat-scoring";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import AnimatedCounter from "@/components/AnimatedCounter";

type DeviceRecord = {
  device_id: string;
  device_name?: string | null;
  ip_address?: string | null;
  is_online?: boolean;
  last_seen?: number | null;
  session_start?: number | null;
  threat_level?: number;
};

const isDeviceRecord = (device: unknown): device is DeviceRecord => {
  if (!device || typeof device !== "object") return false;
  const candidate = device as { device_id?: unknown };
  return typeof candidate.device_id === "string";
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function PublicPlayerHistoryPage() {
  const params = useParams();
  const deviceId = params?.id as string;
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Fetch device info
  const { data: devicesData } = useSWR(
    deviceId ? "/api/devices" : null,
    fetcher,
    {
      refreshInterval: 5000,
      revalidateOnFocus: false,
    }
  );

  // Fetch player summary (historical stats)
  const { data: summaryData } = useSWR(
    deviceId
      ? `/api/player/summary?device=${encodeURIComponent(deviceId)}`
      : null,
    fetcher,
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
    }
  );

  const deviceList: DeviceRecord[] = Array.isArray(devicesData?.data?.devices)
    ? devicesData.data.devices.filter(isDeviceRecord)
    : [];

  const device = deviceList.find(
    (record) =>
      record.device_id === deviceId || record.device_id?.startsWith(deviceId)
  );

  const playerName =
    device?.device_id?.split("_")[0] ||
    deviceId?.split("_")[0] ||
    "Unknown Player";
  const isOnline = Boolean(device?.is_online);
  const lastSeen = device?.last_seen ?? null;
  const ipAddress = device?.ip_address || null;
  const deviceName = device?.device_name || summaryData?.data?.device_name || null;
  const accountName = summaryData?.data?.device_name || null;
  const sessionStart = device?.session_start ?? null;

  const toMilliseconds = (value: number | null | undefined) => {
    if (!value || typeof value !== "number") return null;
    return value < 10_000_000_000 ? value * 1000 : value;
  };

  // Calculate time since last seen
  const getTimeSinceLastSeen = () => {
    const lastSeenMs = toMilliseconds(lastSeen);
    if (!lastSeenMs) return "Never";
    const diff = Date.now() - lastSeenMs;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    return "Just now";
  };

  const summary = summaryData?.data;

  const parsePercent = (value: unknown): number | null => {
    const num =
      typeof value === "number"
        ? value
        : typeof value === "string"
        ? parseFloat(value)
        : NaN;
    if (Number.isFinite(num)) {
      return Math.min(100, Math.max(0, num));
    }
    return null;
  };

  const summaryThreatScore =
    parsePercent(summary?.avg_bot_probability) ??
    parsePercent(summary?.avg_score) ??
    parsePercent(summary?.avg_threat_score) ??
    0;

  const latestThreatScore =
    parsePercent(device?.threat_level) ?? summaryThreatScore;
  const threatLevel = getThreatLevel(latestThreatScore);
  const threatColor = getThreatColor(latestThreatScore);

  if (!deviceId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden flex items-center justify-center">
        <AnimatedBackground intensity="low" />
        <div className="text-center relative z-10">
          <h1 className="text-2xl font-bold text-white mb-4">
            Invalid Player ID
          </h1>
          <Link
            href="/"
            className="text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Return to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
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
                  <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </motion.div>
                
                <div>
                  <motion.h1 
                    className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    Player History
                  </motion.h1>
                  <motion.p 
                    className="text-white/60 mt-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    Historical threat analysis and detection data
                  </motion.p>
                </div>
              </div>
            </div>

            <Link
              href="/login"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              Login for Full Access
            </Link>
          </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        {/* Player Info Card */}
        <motion.div
          className="glass-card p-6 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          style={{ willChange: "opacity, transform" }}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl font-bold text-white">{playerName}</h2>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    isOnline
                      ? "bg-green-500/20 text-green-400"
                      : "bg-slate-600/20 text-slate-400"
                  }`}
                >
                  {isOnline ? "Online" : "Offline"}
                </span>
              </div>

              {/* Structured Player Information */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500 font-medium min-w-[100px]">Device ID:</span>
                  <span className="font-mono text-slate-300">{deviceId}</span>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500 font-medium min-w-[100px]">Nickname:</span>
                  <span className="text-slate-300">
                    {deviceName || playerName}
                  </span>
                </div>

                {accountName && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 font-medium min-w-[100px]">Account Name:</span>
                    <span className="text-slate-300">{accountName}</span>
                  </div>
                )}

                {ipAddress && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 font-medium min-w-[100px]">IP:</span>
                    <span className="font-mono text-slate-300">{ipAddress}</span>
                  </div>
                )}

                {!ipAddress && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 font-medium min-w-[100px]">IP:</span>
                    <span className="text-slate-500 italic">N/A</span>
                  </div>
                )}

                {!isOnline && lastSeen && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 font-medium min-w-[100px]">Last seen:</span>
                    <span className="text-slate-400">{getTimeSinceLastSeen()}</span>
                  </div>
                )}

                {isOnline && sessionStart && (
                  <SessionDurationDisplay startTime={sessionStart} />
                )}
              </div>
            </div>

            <div className="text-right">
              <div className="text-sm text-slate-400 mb-1">
                Current Threat
              </div>
              <div
                className="text-3xl font-bold"
                style={{ color: threatColor }}
              >
                <AnimatedCounter value={Math.round(latestThreatScore)} suffix="%" />
              </div>
              <div
                className={`text-sm font-semibold ${
                  threatLevel === "CRITICAL"
                    ? "text-red-400"
                    : threatLevel === "HIGH"
                    ? "text-orange-400"
                    : threatLevel === "MEDIUM"
                    ? "text-yellow-400"
                    : "text-green-400"
                }`}
              >
                {threatLevel}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Updated from latest batch report
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-700/50">
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Total Sessions
                </div>
                <div className="text-xl font-bold text-white">
                  {summary.total_sessions || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Total Detections
                </div>
                <div className="text-xl font-bold text-white">
                  {summary.total_detections || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Avg Session
                </div>
                <div className="text-xl font-bold text-white">
                  {Math.round((summary.avg_session_duration || 0) / 60)}m
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Data Period
                </div>
                <div className="text-xl font-bold text-white">
                  {summary.days_active || 0}d
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* Historical Chart */}
        <UnifiedHistoryChart
          deviceId={deviceId}
          deviceData={{
            is_online: isOnline,
            session_duration: summary?.avg_session_duration,
          }}
          onOpenDetailedHistory={() => setIsExportOpen(true)}
        />

        {/* Export Modal */}
        <ReportExportModal
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          deviceId={deviceId}
          deviceName={device?.device_name || playerName}
        />

        {/* Notice */}
        <div className="mt-6 p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-indigo-400 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <h3 className="text-sm font-semibold text-indigo-300 mb-1">
                Limited Access
              </h3>
              <p className="text-sm text-slate-400 mb-2">
                Player must log in to view their data.
              </p>
              <p className="text-sm text-slate-400">
                Admin users can{" "}
                <Link
                  href={`/devices?id=${deviceId}`}
                  className="text-indigo-400 hover:text-indigo-300 transition-colors underline"
                >
                  click here
                </Link>{" "}
                to access live monitoring and device controls.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionDurationDisplay({ startTime }: { startTime: number }) {
  const normalized = startTime < 10_000_000_000 ? startTime * 1000 : startTime;
  const [duration, setDuration] = useState(() => Math.max(0, Date.now() - normalized));

  useEffect(() => {
    const update = () => {
      setDuration(Math.max(0, Date.now() - normalized));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [normalized]);

  const hours = Math.floor(duration / 3_600_000);
  const minutes = Math.floor((duration % 3_600_000) / 60_000);
  const seconds = Math.floor((duration % 60_000) / 1000);

  const formatted =
    hours > 0
      ? `${hours}h ${minutes}m ${seconds}s`
      : minutes > 0
      ? `${minutes}m ${seconds}s`
      : `${seconds}s`;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500 font-medium min-w-[100px]">Session Time:</span>
      <span className="text-indigo-300 font-mono">{formatted}</span>
    </div>
  );
}
