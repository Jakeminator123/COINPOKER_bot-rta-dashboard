/**
 * Enhanced Player Overview Page
 * =============================
 * Matches the Settings page design with all animations and components
 */
"use client";

import { useDebouncedNavigation } from "@/lib/utils/navigation";
import { signOut } from "next-auth/react";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import useSWR from "swr";
import AuthGuard from "@/components/AuthGuard";
import DeviceListModule from "@/components/DeviceListModule";
import NavigationTabs from "@/components/NavigationTabs";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { DarkModeVideoBackground } from "@/components/DarkModeVideoBackground";
import { useDarkMode } from "@/lib/DarkModeContext";
import { DatabaseIcon, ShieldIcon, ArrowIcon, NetworkIcon, DetectionIcon } from "@/components/AnimatedIcons";
import { GlassCard, FeatureCard } from "@/components/GlassCard";
import {
  normalizeDevicesResponse,
  ACTIVE_DEVICE_THRESHOLD_MS,
  type DevicesResponse,
} from "@/lib/device/transform";
import { THREAT_THRESHOLDS } from "@/lib/detections/threat-scoring";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Segment filter configuration
const SEGMENT_FILTERS = [
  { id: "all", label: "All Players", icon: "👥", color: "slate" },
  { id: "programs", label: "Programs", icon: "🖥️", color: "purple" },
  { id: "network", label: "Network", icon: "🌐", color: "blue" },
  { id: "behaviour", label: "Behaviour", icon: "🎯", color: "yellow" },
  { id: "vm", label: "VM", icon: "💻", color: "green" },
  { id: "auto", label: "Automation", icon: "⚡", color: "orange" },
] as const;

type SegmentFilterId = (typeof SEGMENT_FILTERS)[number]["id"];

function HomePageContent() {
  const { navigateTo } = useDebouncedNavigation();
  const { isDarkMode, toggleDarkMode } = useDarkMode();
  const [activeSegmentFilter, setActiveSegmentFilter] = useState<SegmentFilterId>("all");

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR<DevicesResponse | { ok: boolean; data: DevicesResponse }>(
    "/api/devices",
    fetcher,
    {
      refreshInterval: 15000,
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    },
  );

  const { devices, total } = useMemo(
    () => normalizeDevicesResponse(data),
    [data],
  );

  // Filter devices by selected segment
  const filteredDevices = useMemo(() => {
    if (activeSegmentFilter === "all") {
      return devices;
    }
    return devices.filter(
      (device) =>
        device.detected_categories?.includes(activeSegmentFilter) ?? false
    );
  }, [devices, activeSegmentFilter]);

  // Count devices per segment for badges
  const segmentCounts = useMemo(() => {
    const counts: Record<string, number> = { all: devices.length };
    for (const device of devices) {
      for (const category of device.detected_categories ?? []) {
        counts[category] = (counts[category] || 0) + 1;
      }
    }
    return counts;
  }, [devices]);

  const stats = useMemo(() => {
    const now = Date.now();
    const totalCount = total || devices.length;
    const online = devices.filter(
      (device) => now - device.last_seen < ACTIVE_DEVICE_THRESHOLD_MS,
    ).length;
    const highRisk = devices.filter(
      (device) => (device.threat_level || 0) >= THREAT_THRESHOLDS.HIGH_RISK,
    ).length;
    const avgThreat = devices.length
      ? Math.round(
          devices.reduce(
            (sum, device) => sum + (device.threat_level || 0),
            0,
          ) / devices.length,
        )
      : 0;

    return {
      online,
      total: totalCount,
      highRisk,
      avgThreat,
    };
  }, [devices, total]);

  if (error) {
    return (
      <div className="aurora-background flex items-center justify-center">
        <GlassCard className="p-8 max-w-md">
          <h2 className="text-xl font-bold text-red-400 mb-4">Connection Error</h2>
          <p className="text-slate-300 mb-6">Failed to connect to the detection server.</p>
          <button onClick={() => mutate()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
            Retry
          </button>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className={isDarkMode ? "min-h-screen relative overflow-hidden bg-slate-950" : "aurora-background"}>
      {/* Background - switches between normal and dark mode video */}
      <AnimatePresence mode="wait">
        {isDarkMode ? (
          <motion.div
            key="dark-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <DarkModeVideoBackground />
          </motion.div>
        ) : (
          <motion.div
            key="light-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <AnimatedBackground intensity="medium" particleCount={20} showFloatingDots={true} />
          </motion.div>
        )}
      </AnimatePresence>
      
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
              <motion.div
                className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-purple-500/30 border border-indigo-500/30"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 4, repeat: Infinity }}
                style={{ 
                  isolation: 'isolate', // Create new stacking context
                  transformStyle: 'preserve-3d', // Preserve 3D transforms
                  position: 'relative',
                  overflow: 'visible' // Allow 3D logo to render properly
                }}
              >
                <div style={{ 
                  position: 'relative',
                  zIndex: 20,
                  transform: 'translateZ(0)', // Force hardware acceleration
                  isolation: 'isolate' // Separate stacking context for 3D logo
                }}>
                  <DetectionIcon className="w-10 h-10 text-indigo-400" />
                </div>
              </motion.div>
              
              <div>
                <motion.h1 
                  className="text-4xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  Bot & RTA Detection
                </motion.h1>
                <motion.p 
                  className="text-white/60 mt-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  Real-time player monitoring dashboard
                </motion.p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Dark Mode Toggle */}
              <motion.button
                onClick={toggleDarkMode}
                className="p-3 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 transition-all duration-300"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                <AnimatePresence mode="wait">
                  {isDarkMode ? (
                    <motion.svg
                      key="moon"
                      initial={{ rotate: -90, opacity: 0 }}
                      animate={{ rotate: 0, opacity: 1 }}
                      exit={{ rotate: 90, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                      />
                    </motion.svg>
                  ) : (
                    <motion.svg
                      key="sun"
                      initial={{ rotate: 90, opacity: 0 }}
                      animate={{ rotate: 0, opacity: 1 }}
                      exit={{ rotate: -90, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                      />
                    </motion.svg>
                  )}
                </AnimatePresence>
              </motion.button>

              <motion.button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="px-5 py-2.5 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500 text-white rounded-xl font-semibold shadow-lg shadow-red-500/20 transition-all duration-300"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <div className="flex items-center gap-2">
                  <ArrowIcon direction="right" className="w-5 h-5" />
                  <span>Logout</span>
                </div>
              </motion.button>
            </div>
          </div>
        </div>
      </motion.header>

      <div className="max-w-7xl mx-auto px-6 py-8 relative z-10">
        {/* Navigation */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <NavigationTabs />
        </motion.div>

        {/* Stats Cards */}
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 mt-8"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <FeatureCard
            icon={<ShieldIcon className="w-8 h-8 text-green-400" isActive={true} />}
            title={`${stats.online} Online`}
            description="Active players"
            isActive={true}
          />
          <FeatureCard
            icon={<DatabaseIcon className="w-8 h-8 text-blue-400" />}
            title={`${stats.total} Total`}
            description="Unique players"
            isActive={false}
          />
          <FeatureCard
            icon={
              <motion.svg
                className="w-8 h-8 text-red-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </motion.svg>
            }
            title={`${stats.highRisk} High Risk`}
            description="Players >= 70% threat"
            isActive={false}
          />
          <FeatureCard
            icon={<NetworkIcon className="w-8 h-8 text-yellow-400" />}
            title={`${stats.avgThreat}% Avg`}
            description="Avg threat score"
            isActive={false}
          />
        </motion.div>

        {/* Segment Filter Tabs */}
        <motion.div
          className="mb-6"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35 }}
        >
          <div className="flex flex-wrap gap-2">
            {SEGMENT_FILTERS.map((filter) => {
              const isActive = activeSegmentFilter === filter.id;
              const count = segmentCounts[filter.id] || 0;
              
              // Color mappings for each filter
              const colorClasses: Record<string, { active: string; inactive: string; badge: string }> = {
                slate: {
                  active: "bg-slate-600/50 border-slate-400/50 text-white",
                  inactive: "bg-white/5 border-white/10 text-white/70 hover:bg-white/10",
                  badge: "bg-slate-500/30 text-slate-300",
                },
                purple: {
                  active: "bg-purple-600/50 border-purple-400/50 text-white",
                  inactive: "bg-white/5 border-white/10 text-white/70 hover:bg-purple-500/20",
                  badge: "bg-purple-500/30 text-purple-300",
                },
                blue: {
                  active: "bg-blue-600/50 border-blue-400/50 text-white",
                  inactive: "bg-white/5 border-white/10 text-white/70 hover:bg-blue-500/20",
                  badge: "bg-blue-500/30 text-blue-300",
                },
                yellow: {
                  active: "bg-yellow-600/50 border-yellow-400/50 text-white",
                  inactive: "bg-white/5 border-white/10 text-white/70 hover:bg-yellow-500/20",
                  badge: "bg-yellow-500/30 text-yellow-300",
                },
                green: {
                  active: "bg-green-600/50 border-green-400/50 text-white",
                  inactive: "bg-white/5 border-white/10 text-white/70 hover:bg-green-500/20",
                  badge: "bg-green-500/30 text-green-300",
                },
                orange: {
                  active: "bg-orange-600/50 border-orange-400/50 text-white",
                  inactive: "bg-white/5 border-white/10 text-white/70 hover:bg-orange-500/20",
                  badge: "bg-orange-500/30 text-orange-300",
                },
              };
              
              const colors = colorClasses[filter.color] || colorClasses.slate;
              
              return (
                <motion.button
                  key={filter.id}
                  onClick={() => setActiveSegmentFilter(filter.id)}
                  className={`
                    flex items-center gap-2 px-4 py-2.5 rounded-xl border backdrop-blur-sm
                    transition-all duration-300 font-medium
                    ${isActive ? colors.active : colors.inactive}
                  `}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="text-lg">{filter.icon}</span>
                  <span>{filter.label}</span>
                  {count > 0 && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${isActive ? "bg-white/20 text-white" : colors.badge}`}>
                      {count}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <DeviceListModule
            devices={filteredDevices}
            isLoading={isLoading && devices.length === 0}
            onDeviceSelect={(deviceId) => navigateTo(`/dashboard?device=${deviceId}`)}
          />
        </motion.div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <AuthGuard>
      <HomePageContent />
    </AuthGuard>
  );
}