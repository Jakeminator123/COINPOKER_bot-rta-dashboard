/**
 * Enhanced Player Overview Page
 * =============================
 * Matches the Settings page design with all animations and components
 */
"use client";

import { useDebouncedNavigation } from "@/lib/utils/navigation";
import { signOut } from "next-auth/react";
import { useMemo } from "react";
import { motion } from "framer-motion";
import useSWR from "swr";
import AuthGuard from "@/components/AuthGuard";
import DeviceListModule from "@/components/DeviceListModule";
import NavigationTabs from "@/components/NavigationTabs";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { SettingsGearIcon, DatabaseIcon, ShieldIcon, ArrowIcon, NetworkIcon, DetectionIcon } from "@/components/AnimatedIcons";
import { GlassCard, FeatureCard } from "@/components/GlassCard";
import {
  normalizeDevicesResponse,
  ACTIVE_DEVICE_THRESHOLD_MS,
  type DevicesResponse,
} from "@/lib/device/transform";
import { THREAT_THRESHOLDS } from "@/lib/detections/threat-scoring";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function HomePageContent() {
  const { navigateTo } = useDebouncedNavigation();

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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      {/* Animated Background - Medium intensity for home page */}
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
              <motion.button
                onClick={() => navigateTo("/settings")}
                className="p-3 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 transition-all duration-300"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <SettingsGearIcon className="w-6 h-6" />
              </motion.button>
              
              <motion.button
                onClick={() => signOut()}
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

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <DeviceListModule
            devices={devices}
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