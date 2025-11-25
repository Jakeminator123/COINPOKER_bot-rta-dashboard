"use client";

import { useMemo } from "react";
import { Doughnut, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { motion } from "framer-motion";
import type { DeviceRecord } from "@/lib/device/transform";

// Register Chart.js components
ChartJS.register(
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend
);

interface DeviceAnalyticsSectionProps {
  devices: DeviceRecord[];
}

// Threat level colors matching the rest of the app
const THREAT_COLORS = {
  critical: { bg: "rgba(220, 38, 38, 0.8)", border: "#dc2626" }, // red-600
  high: { bg: "rgba(249, 115, 22, 0.8)", border: "#f97316" }, // orange-500
  medium: { bg: "rgba(234, 179, 8, 0.8)", border: "#eab308" }, // yellow-500
  low: { bg: "rgba(34, 197, 94, 0.8)", border: "#22c55e" }, // green-500
};

function getThreatCategory(level: number): keyof typeof THREAT_COLORS {
  if (level >= 75) return "critical";
  if (level >= 50) return "high";
  if (level >= 25) return "medium";
  return "low";
}

export default function DeviceAnalyticsSection({ devices }: DeviceAnalyticsSectionProps) {
  // Calculate threat distribution
  const threatDistribution = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    devices.forEach((device) => {
      const category = getThreatCategory(device.threat_level || 0);
      counts[category]++;
    });
    return counts;
  }, [devices]);

  // Calculate activity distribution (last 24 hours, grouped by hour)
  const activityDistribution = useMemo(() => {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const hours: number[] = new Array(24).fill(0);
    
    devices.forEach((device) => {
      const hoursAgo = Math.floor((now - device.last_seen) / hourMs);
      if (hoursAgo >= 0 && hoursAgo < 24) {
        hours[hoursAgo]++;
      }
    });
    
    return hours;
  }, [devices]);

  // Calculate top threats (devices with highest threat levels)
  const topThreats = useMemo(() => {
    return [...devices]
      .filter((d) => (d.threat_level || 0) > 0)
      .sort((a, b) => (b.threat_level || 0) - (a.threat_level || 0))
      .slice(0, 5);
  }, [devices]);

  // Calculate aggregate stats
  const stats = useMemo(() => {
    const totalDetections = devices.reduce((sum, d) => sum + (d.signal_count || 0), 0);
    const totalSessionTime = devices.reduce((sum, d) => sum + (d.session_duration || 0), 0);
    const avgThreat = devices.length > 0 
      ? Math.round(devices.reduce((sum, d) => sum + (d.threat_level || 0), 0) / devices.length)
      : 0;
    const onlineCount = devices.filter((d) => d.is_online).length;
    
    return {
      totalDetections,
      totalSessionTime,
      avgThreat,
      onlineCount,
      totalDevices: devices.length,
    };
  }, [devices]);

  // Doughnut chart config for threat distribution
  const doughnutData = useMemo(() => ({
    labels: ["Critical (75%+)", "High (50-74%)", "Medium (25-49%)", "Low (<25%)"],
    datasets: [
      {
        data: [
          threatDistribution.critical,
          threatDistribution.high,
          threatDistribution.medium,
          threatDistribution.low,
        ],
        backgroundColor: [
          THREAT_COLORS.critical.bg,
          THREAT_COLORS.high.bg,
          THREAT_COLORS.medium.bg,
          THREAT_COLORS.low.bg,
        ],
        borderColor: [
          THREAT_COLORS.critical.border,
          THREAT_COLORS.high.border,
          THREAT_COLORS.medium.border,
          THREAT_COLORS.low.border,
        ],
        borderWidth: 2,
        hoverOffset: 8,
      },
    ],
  }), [threatDistribution]);

  const doughnutOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: "60%",
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: {
          color: "rgba(255, 255, 255, 0.7)",
          padding: 16,
          font: { size: 12 },
        },
      },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        titleColor: "#fff",
        bodyColor: "rgba(255, 255, 255, 0.8)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        callbacks: {
          label: (context: any) => {
            const total = devices.length;
            const value = context.raw || 0;
            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
            return ` ${value} devices (${percentage}%)`;
          },
        },
      },
    },
  }), [devices.length]);

  // Bar chart config for activity distribution
  const barData = useMemo(() => {
    const labels = activityDistribution.map((_, i) => {
      if (i === 0) return "Now";
      if (i === 1) return "1h";
      return `${i}h`;
    });
    
    return {
      labels,
      datasets: [
        {
          label: "Active Devices",
          data: activityDistribution,
          backgroundColor: "rgba(99, 102, 241, 0.6)",
          borderColor: "rgb(99, 102, 241)",
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    };
  }, [activityDistribution]);

  const barOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        titleColor: "#fff",
        bodyColor: "rgba(255, 255, 255, 0.8)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        borderWidth: 1,
        padding: 12,
        callbacks: {
          title: (items: any[]) => {
            const index = items[0]?.dataIndex;
            if (index === 0) return "Currently active";
            return `${index} hour${index > 1 ? "s" : ""} ago`;
          },
          label: (context: any) => ` ${context.raw} devices`,
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: "rgba(255, 255, 255, 0.05)",
        },
        ticks: {
          color: "rgba(255, 255, 255, 0.5)",
          font: { size: 10 },
          maxRotation: 0,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: "rgba(255, 255, 255, 0.05)",
        },
        ticks: {
          color: "rgba(255, 255, 255, 0.5)",
          stepSize: 1,
        },
      },
    },
  }), []);

  // Format session time
  const formatSessionTime = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // Get threat color for inline use
  const getThreatColor = (level: number) => {
    if (level >= 75) return "#dc2626";
    if (level >= 50) return "#f97316";
    if (level >= 25) return "#eab308";
    return "#22c55e";
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="mb-12"
    >
      <h2 className="text-2xl font-semibold flex items-center gap-3 mb-6">
        <span>📊</span>
        Analytics Overview
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Threat Distribution Doughnut Chart */}
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
        >
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-red-400">⚠️</span>
            Threat Distribution
          </h3>
          <div className="h-64">
            <Doughnut data={doughnutData} options={doughnutOptions} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-slate-400">Critical: {threatDistribution.critical}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-slate-400">High: {threatDistribution.high}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="text-slate-400">Medium: {threatDistribution.medium}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-slate-400">Low: {threatDistribution.low}</span>
            </div>
          </div>
        </motion.div>

        {/* Activity Timeline Bar Chart */}
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
        >
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-blue-400">📈</span>
            Activity Timeline (24h)
          </h3>
          <div className="h-64">
            <Bar data={barData} options={barOptions} />
          </div>
          <p className="mt-4 text-sm text-slate-400 text-center">
            Device activity distribution over the last 24 hours
          </p>
        </motion.div>

        {/* Top Threats & Quick Stats */}
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
        >
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-purple-400">🎯</span>
            Top Threats
          </h3>
          
          {topThreats.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-500">
              <div className="text-center">
                <div className="text-4xl mb-2">✅</div>
                <p>No significant threats detected</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {topThreats.map((device, idx) => (
                <div
                  key={device.device_id}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 border border-slate-700/50"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">
                      {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "🔴"}
                    </span>
                    <div>
                      <p className="font-medium text-white text-sm">
                        {device.player_nickname || device.device_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {device.signal_count || 0} detections
                      </p>
                    </div>
                  </div>
                  <div
                    className="text-lg font-bold"
                    style={{ color: getThreatColor(device.threat_level || 0) }}
                  >
                    {device.threat_level || 0}%
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick Stats */}
          <div className="mt-6 pt-4 border-t border-slate-700/50">
            <h4 className="text-sm font-semibold text-slate-400 mb-3">Quick Stats</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-800/30 rounded-lg p-3">
                <div className="text-slate-400">Total Detections</div>
                <div className="text-xl font-bold text-blue-400">
                  {stats.totalDetections.toLocaleString()}
                </div>
              </div>
              <div className="bg-slate-800/30 rounded-lg p-3">
                <div className="text-slate-400">Avg Threat</div>
                <div
                  className="text-xl font-bold"
                  style={{ color: getThreatColor(stats.avgThreat) }}
                >
                  {stats.avgThreat}%
                </div>
              </div>
              <div className="bg-slate-800/30 rounded-lg p-3">
                <div className="text-slate-400">Online Now</div>
                <div className="text-xl font-bold text-green-400">
                  {stats.onlineCount}/{stats.totalDevices}
                </div>
              </div>
              <div className="bg-slate-800/30 rounded-lg p-3">
                <div className="text-slate-400">Total Session</div>
                <div className="text-xl font-bold text-purple-400">
                  {formatSessionTime(stats.totalSessionTime)}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}

