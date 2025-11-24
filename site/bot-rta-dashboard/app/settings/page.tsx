/**
 * Settings & Configuration Page
 * ========================================
 * Clean, modern design - authentication handled by NextAuth
 * If you're logged in, you can edit. No separate admin token needed.
 */
"use client";

import AuthGuard from "@/components/AuthGuard";
import NavigationTabs from "@/components/NavigationTabs";
import AdvancedSettingsEditor from "@/components/config-editors/AdvancedSettingsEditor";
import SimplifiedConfigurationEditor from "@/components/config-editors/SimplifiedConfigurationEditor";
import SHADatabaseViewer from "@/components/SHADatabaseViewer";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { SettingsGearIcon, DatabaseIcon, ShieldIcon, ConfigIcon, ArrowIcon, NetworkIcon, DetectionIcon } from "@/components/AnimatedIcons";
import { GlassCard, FeatureCard } from "@/components/GlassCard";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "next-auth/react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url)
    .then((r) => r.json())
    .then((response) => {
      if (response && typeof response === "object" && "ok" in response && "data" in response) {
        return response.data;
      }
      return response;
    });

type ConfigurationMode = "simplified" | "advanced";
type SettingsTab = "configuration" | "sha-database";

// Animated Floating Icons
function FloatingIcon({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      className="absolute"
      initial={{ x: Math.random() * 400 - 200, y: Math.random() * 400 - 200 }}
      animate={{
        x: [Math.random() * 100 - 50, Math.random() * 100 - 50, Math.random() * 100 - 50],
        y: [Math.random() * 100 - 50, Math.random() * 100 - 50, Math.random() * 100 - 50],
      }}
      transition={{
        duration: 20,
        repeat: Infinity,
        delay,
        ease: "linear",
      }}
      style={{ opacity: 0.1 }}
    >
      <ConfigIcon className="w-8 h-8 text-indigo-400" />
    </motion.div>
  );
}

function SettingsPageContent() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("configuration");
  const [configMode, setConfigMode] = useState<ConfigurationMode>("simplified");
  const [advancedGroup, setAdvancedGroup] = useState<string | undefined>(undefined);
  const [advancedSection, setAdvancedSection] = useState<string | undefined>(undefined);
  
  const { data: configData, error, isLoading, mutate } = useSWR("/api/configs", fetcher);

  const handleResetToDefault = async () => {
    if (!confirm("⚠️ Reset ALL configurations to default values?")) return;

    try {
      const response = await fetch("/api/configs/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Reset failed");
      }
      
      await mutate();
      alert("✅ Configurations reset successfully!");
    } catch (error) {
      console.error("Reset failed:", error);
      alert(`❌ Failed to reset configurations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleSaveConfig = async (category: string, updates: unknown) => {
    const response = await fetch("/api/configs/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        config: updates,
        merge: false,
      }),
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Save failed");
    }
    
    await mutate();
  };

  if (error) {
    return (
      <div className="aurora-background flex items-center justify-center relative">
        <AnimatedBackground intensity="low" />
        <GlassCard className="p-8 max-w-md relative z-10">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-red-400 mb-4">Configuration Error</h2>
            <p className="text-white/60 mb-6">{error.message || "Failed to load configuration"}</p>
            <button
              onClick={() => router.push("/")}
              className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-medium"
            >
              Back to Home
            </button>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="aurora-background">
      {/* Animated Background */}
      <AnimatedBackground intensity="low" particleCount={15} showFloatingDots={true} />
      
      {/* Floating Icons */}
      {[...Array(2)].map((_, i) => (
        <FloatingIcon key={i} delay={i * 2} />
      ))}

      {/* Header */}
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
                <ArrowIcon direction="left" className="w-5 h-5 text-white group-hover:text-indigo-400 transition-colors" />
              </motion.button>
              
              <div className="flex items-center gap-4">
                <motion.div 
                  className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-purple-500/30 border border-indigo-500/30 backdrop-blur-xl"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                >
                  <SettingsGearIcon className="w-10 h-10 text-indigo-400" />
                </motion.div>
                
                <div>
                  <motion.h1 
                    className="text-4xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    Settings & Configuration
                  </motion.h1>
                  <motion.p 
                    className="text-white/60 mt-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    Manage detection parameters and thresholds
                  </motion.p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Admin Status Badge */}
              <motion.div
                initial={{ scale: 0, opacity: 0, rotate: -180 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                className="relative"
              >
                <div className="absolute -inset-1 bg-gradient-to-r from-green-500 to-emerald-500 rounded-2xl blur-lg opacity-30" />
                <div className="relative px-5 py-3 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-2xl backdrop-blur-xl">
                  <div className="flex items-center gap-3">
                    <ShieldIcon className="w-6 h-6 text-green-400" isActive={true} />
                    <span className="text-green-400 font-semibold">Admin Mode</span>
                  </div>
                </div>
              </motion.div>

              {/* Logout Button */}
              <motion.button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="relative group px-6 py-3 bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 text-white rounded-2xl font-semibold transition-all duration-300"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <div className="relative flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Logout
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

        {/* Tab Selector */}
        <motion.div 
          className="mt-8 mb-8"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <GlassCard className="p-2" glow={true}>
            <div className="flex gap-2">
              <motion.button
                onClick={() => setActiveTab("configuration")}
                className={`flex-1 px-6 py-4 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-3 ${
                  activeTab === "configuration"
                    ? "bg-gradient-to-r from-indigo-500/40 to-purple-500/40 text-white border border-indigo-500/50 shadow-lg shadow-indigo-500/20"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <ConfigIcon className="w-6 h-6" />
                <span>Configuration</span>
                {activeTab === "configuration" && (
                  <motion.div
                    className="w-2 h-2 bg-green-400 rounded-full"
                    animate={{ scale: [1, 1.5, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                )}
              </motion.button>
              
              <motion.button
                onClick={() => setActiveTab("sha-database")}
                className={`flex-1 px-6 py-4 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-3 ${
                  activeTab === "sha-database"
                    ? "bg-gradient-to-r from-indigo-500/40 to-purple-500/40 text-white border border-indigo-500/50 shadow-lg shadow-indigo-500/20"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <DatabaseIcon className="w-6 h-6" />
                <span>SHA Database</span>
                {activeTab === "sha-database" && (
                  <motion.div
                    className="w-2 h-2 bg-green-400 rounded-full"
                    animate={{ scale: [1, 1.5, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                )}
              </motion.button>
            </div>
          </GlassCard>
        </motion.div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          {activeTab === "sha-database" ? (
            <motion.div
              key="sha-database"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <SHADatabaseViewer />
            </motion.div>
          ) : (
            <motion.div
              key="configuration"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Configuration Section */}
              <div className="space-y-6">
                {/* Configuration Header */}
                <GlassCard className="p-8" glow={true} gradient={true}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <motion.div
                        className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-purple-500/30 border border-indigo-500/30"
                        animate={{ rotate: [0, 5, -5, 0] }}
                        transition={{ duration: 4, repeat: Infinity }}
                      >
                        <DetectionIcon className="w-10 h-10 text-indigo-400" />
                      </motion.div>
                      <div>
                        <h2 className="text-3xl font-bold text-white">Configuration Center</h2>
                        <p className="text-white/60 mt-1">
                          Choose your configuration mode and manage detection settings
                        </p>
                      </div>
                    </div>
                    
                    {/* Quick Actions */}
                    <div className="flex gap-3">
                      <motion.button
                        onClick={handleResetToDefault}
                        className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 rounded-xl transition-all"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        Reset to Default
                      </motion.button>
                    </div>
                  </div>
                </GlassCard>

                {/* Mode Selector Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <motion.div
                    whileHover={{ y: -5 }}
                    onClick={() => setConfigMode("simplified")}
                    className="cursor-pointer"
                  >
                    <FeatureCard
                      icon={<NetworkIcon className="w-8 h-8 text-indigo-400" />}
                      title="Simplified Configuration"
                      description="Quick presets and easy-to-use controls for basic configuration"
                      isActive={configMode === "simplified"}
                    />
                  </motion.div>
                  
                  <motion.div
                    whileHover={{ y: -5 }}
                    onClick={() => setConfigMode("advanced")}
                    className="cursor-pointer"
                  >
                    <FeatureCard
                      icon={<ConfigIcon className="w-8 h-8 text-purple-400" />}
                      title="Advanced Configuration"
                      description="Full control over all detection parameters and thresholds"
                      isActive={configMode === "advanced"}
                    />
                  </motion.div>
                </div>

                {/* Configuration Content */}
                <motion.div
                  key={configMode}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {isLoading ? (
                    <GlassCard className="p-12">
                      <div className="flex flex-col items-center">
                        <motion.div
                          className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        />
                        <p className="text-white/60 mt-4">Loading configuration...</p>
                      </div>
                    </GlassCard>
                  ) : configData ? (
                    configMode === "simplified" ? (
                      <GlassCard className="p-8">
                        <SimplifiedConfigurationEditor
                          programsRegistry={configData.programs_registry}
                          programsConfig={configData.programs_config}
                          networkConfig={configData.network_config}
                          behaviourConfig={configData.behaviour_config}
                          screenConfig={configData.screen_config}
                          vmConfig={configData.vm_config}
                          obfuscationConfig={configData.obfuscation_config}
                          sharedConfig={configData.shared_config}
                          onNavigateToAdvanced={(group, section) => {
                            setConfigMode("advanced");
                            setAdvancedGroup(group);
                            setAdvancedSection(section);
                          }}
                          onSave={handleSaveConfig}
                        />
                      </GlassCard>
                    ) : (
                      <GlassCard className="p-8">
                        <AdvancedSettingsEditor
                          programsRegistry={configData.programs_registry}
                          programsConfig={configData.programs_config}
                          networkConfig={configData.network_config}
                          behaviourConfig={configData.behaviour_config}
                          screenConfig={configData.screen_config}
                          vmConfig={configData.vm_config}
                          obfuscationConfig={configData.obfuscation_config}
                          sharedConfig={configData.shared_config}
                          initialGroup={advancedGroup}
                          initialSection={advancedSection}
                          onSave={handleSaveConfig}
                        />
                      </GlassCard>
                    )
                  ) : (
                    <GlassCard className="p-12">
                      <div className="text-center text-white/60">
                        <p>No configuration data available</p>
                      </div>
                    </GlassCard>
                  )}
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <SettingsPageContent />
    </AuthGuard>
  );
}
