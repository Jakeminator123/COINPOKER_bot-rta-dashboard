"use client";

import { useState, useMemo, useCallback } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import "chartjs-adapter-date-fns";
import { enUS } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import type { UnifiedHistoryChartProps, TimePreset, DataType } from "@/components/charts/types";
import { TIME_PRESETS } from "@/components/charts/constants";
import {
  useChartData,
  useChartProcessing,
  useChartConfig,
  useSessionData,
  type Session,
} from "@/components/charts/hooks";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

// Ensure date adapter is properly configured globally
if (typeof window !== "undefined") {
  ChartJS.defaults.scales.time = ChartJS.defaults.scales.time || {};
  ChartJS.defaults.scales.time.adapters = {
    date: {
      locale: enUS,
    },
  };
}

export default function UnifiedHistoryChart({
  deviceId,
  deviceData,
  snapshotData,
  onOpenDetailedHistory,
}: UnifiedHistoryChartProps) {
  // Calculate default time period based on active session
  // For offline devices, use longer periods since recent data may not exist
  const defaultTimePreset = useMemo<TimePreset>(() => {
    // If device is offline and no session_duration, use longer default period
    if (!deviceData?.is_online && !deviceData?.session_duration) {
      // Try 24h first, then fall back to 7d if needed
      return "24h";
    }

    const sessionDurationMs = deviceData?.session_duration ?? 0;
    if (!sessionDurationMs) return "1h";

    const hours = Math.ceil(sessionDurationMs / (1000 * 3600));
    if (hours <= 1) return "1h";
    if (hours <= 3) return "3h";
    if (hours <= 6) return "6h";
    if (hours <= 12) return "12h";
    if (hours <= 24) return "24h";
    if (hours <= 72) return "3d";
    if (hours <= 168) return "7d";
    return "30d";
  }, [deviceData?.session_duration, deviceData?.is_online]);

  const [timePreset, setTimePreset] = useState<TimePreset>(defaultTimePreset);
  const [dataTypes, setDataTypes] = useState<Set<DataType>>(
    new Set(["threat"])
  );
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  // Fetch sessions data
  const timeRangeSeconds = TIME_PRESETS[timePreset].seconds;
  const { sessions, isLoading: _sessionsLoading } = useSessionData(
    deviceId,
    timeRangeSeconds
  );

  // Use hooks for data fetching and processing
  const chartDataResult = useChartData(
    deviceId,
    timePreset,
    deviceData,
    snapshotData
  );

  const { chartData: rawChartData, loading, error, isInitialLoad } = useChartProcessing({
    deviceId,
    timePreset,
    deviceData,
    snapshotData,
    hourlyData: chartDataResult.hourlyData,
    segmentData: chartDataResult.segmentData,
    segmentSummaryData: chartDataResult.segmentSummaryData,
    dailyData: chartDataResult.dailyData,
    hourData: chartDataResult.hourData,
  });

  // Filter chart data based on selected session
  const chartData = useMemo(() => {
    if (!selectedSession) return rawChartData;
    
    const sessionStart = selectedSession.session_start * 1000; // Convert to ms
    const sessionEnd = selectedSession.session_end > 0 
      ? selectedSession.session_end * 1000 
      : Date.now(); // If ongoing session, use current time
    
    return rawChartData.filter((point) => {
      const pointTime = point.timestamp * 1000;
      return pointTime >= sessionStart && pointTime <= sessionEnd;
    });
  }, [rawChartData, selectedSession]);

  const { chartConfig, chartOptions } = useChartConfig({
    chartData,
    dataTypes,
    timePreset,
    isInitialLoad,
    sessions: selectedSession ? [selectedSession] : sessions,
  });

  const toggleDataType = useCallback((type: DataType) => {
    setDataTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
        if (next.size === 0) {
          next.add("threat");
        }
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  if (!deviceId) {
    return (
      <div className="glass-card p-4 sm:p-6">
        <p className="text-slate-400 text-center">No device selected</p>
      </div>
    );
  }

  // Show historical data even for offline devices (but warn user)
  const isOffline = deviceData && !deviceData.is_online;

  return (
    <motion.div
      className="glass-card p-4 sm:p-6"
      initial={isInitialLoad ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: isInitialLoad ? 0 : 0.4 }}
    >
      {/* Header with controls */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-indigo-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg sm:text-xl font-bold text-white">
                Historical Analysis
              </h3>
              {isOffline && (
                <p className="text-xs text-yellow-400 mt-0.5 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></span>
                  Showing historical data (device offline)
                </p>
              )}
            </div>
          </div>

          {/* Time period selector */}
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TIME_PRESETS) as TimePreset[]).map((preset) => (
              <motion.button
                key={preset}
                onClick={() => setTimePreset(preset)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all relative overflow-hidden ${
                  timePreset === preset
                    ? "bg-gradient-to-r from-indigo-500/90 via-purple-500/90 to-purple-600/90 text-white shadow-lg shadow-purple-500/25"
                    : "bg-slate-700/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200 border border-slate-600/30"
                }`}
                whileHover={{ scale: 1.05, y: -1 }}
                whileTap={{ scale: 0.98 }}
              >
                {timePreset === preset && (
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-indigo-400/20 via-purple-400/20 to-purple-500/20"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                  />
                )}
                <span className="relative z-10">
                  {TIME_PRESETS[preset].label}
                </span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Session filter */}
        {sessions.length > 0 && (
          <div className="mb-3">
            <label className="block text-xs text-slate-400 font-semibold uppercase tracking-wide mb-2">
              Filter by Session:
            </label>
            <div className="relative">
              <select
                aria-label="Filter by Session"
                value={selectedSession ? selectedSession.session_start.toString() : ""}
                onChange={(e) => {
                  if (e.target.value === "") {
                    setSelectedSession(null);
                  } else {
                    const session = sessions.find(
                      (s) => s.session_start.toString() === e.target.value
                    );
                    setSelectedSession(session || null);
                  }
                }}
                className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 appearance-none cursor-pointer hover:bg-slate-800/70 transition-colors"
              >
                <option value="">All Sessions</option>
                {sessions.map((session, index) => {
                  const startDate = new Date(session.session_start * 1000);
                  const endDate = session.endDate;
                  const duration = session.durationMinutes;
                  const dateStr = startDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
                  const timeStr = startDate.toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  
                  return (
                    <option
                      key={session.session_start}
                      value={session.session_start.toString()}
                    >
                      Session {sessions.length - index}: {dateStr} {timeStr}
                      {endDate
                        ? ` - ${endDate.toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })} (${duration}m)`
                        : " (Active)"}
                      {session.final_bot_probability > 0 && ` - ${Math.round(session.final_bot_probability)}%`}
                    </option>
                  );
                })}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg
                  className="w-4 h-4 text-slate-400"
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
            </div>
            {selectedSession && (
              <div className="mt-2 px-3 py-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-indigo-300 font-semibold">
                    Selected Session:
                  </span>
                  <button
                    onClick={() => setSelectedSession(null)}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="mt-1 text-xs text-slate-300">
                  {selectedSession.startDate?.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {selectedSession.endDate
                    ? ` - ${selectedSession.endDate.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : " (Active)"}
                  {" • "}
                  {selectedSession.durationMinutes}m duration
                  {selectedSession.final_bot_probability > 0 && (
                    <>
                      {" • "}
                      <span className="text-indigo-300 font-semibold">
                        {Math.round(selectedSession.final_bot_probability)}% Bot Detection
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Data type toggles */}
        <div className="flex flex-wrap gap-3 items-center p-3 rounded-lg bg-slate-800/30 border border-slate-700/50">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wide">
            Show:
          </span>
          {[
            {
              key: "threat" as DataType,
              label: "Bot Detection %",
              bgColor: "bg-indigo-500/20",
              borderColor: "border-indigo-500/40",
            },
            {
              key: "categories" as DataType,
              label: "Categories",
              bgColor: "bg-purple-500/20",
              borderColor: "border-purple-500/40",
            },
          ].map(({ key, label, bgColor, borderColor }) => (
            <motion.label
              key={key}
              className={`flex items-center gap-2 cursor-pointer group px-3 py-1.5 rounded-lg transition-all border ${
                dataTypes.has(key)
                  ? `${bgColor} ${borderColor}`
                  : "bg-slate-700/20 border-slate-600/20 hover:bg-slate-700/30"
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <input
                name={`dataType-${key}`}
                type="checkbox"
                aria-label={label}
                checked={dataTypes.has(key)}
                onChange={() => toggleDataType(key)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-700/50 text-indigo-500 focus:ring-indigo-500 focus:ring-2 cursor-pointer"
              />
              <span
                className={`text-xs font-semibold transition-colors ${
                  dataTypes.has(key)
                    ? "text-white"
                    : "text-slate-400 group-hover:text-slate-300"
                }`}
              >
                {label}
              </span>
            </motion.label>
          ))}
        </div>
      </div>

      {/* Chart */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            className="h-64 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="loading-spinner"></div>
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            className="h-64 flex items-center justify-center text-red-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <p>{error}</p>
          </motion.div>
        ) : chartData.length === 0 ? (
          <motion.div
            key="empty"
            className="h-64 flex flex-col items-center justify-center text-slate-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <svg
              className="w-16 h-16 mb-4 text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <p className="text-sm font-medium">
              No historical data available
            </p>
            <p className="text-xs text-slate-500 mt-1 text-center">
              {isOffline
                ? "Historical data may not be available for offline devices"
                : "Try selecting a different time period or wait for data to be collected"}
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="chart"
            className="h-64 sm:h-80 relative"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          >
            <Line data={chartConfig} options={chartOptions} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Export Report Button */}
      {onOpenDetailedHistory && (
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <button
            onClick={onOpenDetailedHistory}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-gradient-to-r from-indigo-600/20 to-purple-600/20 hover:from-indigo-600/30 hover:to-purple-600/30 text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 hover:border-indigo-500/50 rounded-lg transition-all"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            <span>Export Report</span>
          </button>
        </div>
      )}
    </motion.div>
  );
}
