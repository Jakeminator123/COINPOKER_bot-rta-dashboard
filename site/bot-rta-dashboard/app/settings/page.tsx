/**
 * Enhanced Settings & Configuration Page
 * ========================================
 * Beautiful, modern design with animations and premium UI
 */
"use client";

import AdminTokenDialog from "@/components/AdminTokenDialog";
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
import { useEffect, useState } from "react";
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminDialog, setShowAdminDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("configuration");
  const [configMode, setConfigMode] = useState<ConfigurationMode>("simplified");
  const [advancedGroup, setAdvancedGroup] = useState<string | undefined>(undefined);
  const [advancedSection, setAdvancedSection] = useState<string | undefined>(undefined);
  
  const { data: configData, error, isLoading, mutate } = useSWR("/api/configs", fetcher);

  useEffect(() => {
    const token = localStorage.getItem("adminToken");
    setIsAdmin(!!token);
  }, []);

  const checkAdminStatus = () => {
    const token = localStorage.getItem("adminToken");
    setIsAdmin(!!token);
  };

  const handleResetToDefault = async () => {
    if (!confirm("⚠️ Reset ALL configurations to default values?")) return;
    
    const token = localStorage.getItem("adminToken");
    if (!token) {
      alert("Admin token required");
      return;
    }

    try {
      const response = await fetch("/api/configs/reset", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) throw new Error("Reset failed");
      
      await mutate();
      alert("✅ Configurations reset successfully!");
    } catch (error) {
      console.error("Reset failed:", error);
      alert("❌ Failed to reset configurations");
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center relative overflow-hidden">
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      {/* Animated Background - Toned down for settings */}
      <AnimatedBackground intensity="low" particleCount={15} showFloatingDots={true} />
      
      {/* Floating Icons - Reduced from 5 to 2 */}
      {[...Array(2)].map((_, i) => (
        <FloatingIcon key={i} delay={i * 2} />
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
              <AnimatePresence mode="wait">
                {isAdmin ? (
                  <motion.div
                    key="admin"
                    initial={{ scale: 0, opacity: 0, rotate: -180 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0, opacity: 0, rotate: 180 }}
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
                ) : (
                  <motion.div
                    key="readonly"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    className="px-5 py-3 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-2xl backdrop-blur-xl"
                  >
                    <div className="flex items-center gap-3">
                      <ShieldIcon className="w-6 h-6 text-yellow-400" isActive={false} />
                      <span className="text-yellow-400 font-semibold">Read-Only</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.button
                onClick={() => setShowAdminDialog(true)}
                className="relative group px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-2xl font-semibold shadow-2xl shadow-indigo-500/25 transition-all duration-300"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <div className="absolute -inset-1 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl blur-lg opacity-50 group-hover:opacity-75 transition-opacity" />
                <div className="relative flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  {isAdmin ? "Admin Settings" : "Login as Admin"}
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

        {/* Enhanced Tab Selector */}
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

        {/* Tab Content with Animation */}
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
              {/* Enhanced Configuration Section */}
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
                        className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl hover:bg-red-500/30 transition-all"
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
                          onSave={async (category, updates) => {
                            const token = localStorage.getItem("adminToken");
                            if (!token) {
                              alert("Admin token required");
                              return;
                            }
                            
                            const response = await fetch("/api/configs/update", {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({
                                category,
                                config: updates,
                                merge: false,
                              }),
                            });
                            
                            if (!response.ok) throw new Error("Save failed");
                            await mutate();
                          }}
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
                          onSave={async (category, updates) => {
                            const token = localStorage.getItem("adminToken");
                            if (!token) {
                              alert("Admin token required");
                              return;
                            }
                            
                            const response = await fetch("/api/configs/update", {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({
                                category,
                                config: updates,
                                merge: false,
                              }),
                            });
                            
                            if (!response.ok) throw new Error("Save failed");
                            await mutate();
                          }}
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

        {/* Admin Mode Reminder */}
        {!isAdmin && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-8"
          >
            <GlassCard className="p-6">
              <div className="flex items-center gap-4">
                <ShieldIcon className="w-8 h-8 text-yellow-400" />
                <div className="flex-1">
                  <h3 className="text-yellow-400 font-semibold text-lg">Enable Admin Mode</h3>
                  <p className="text-white/60 text-sm mt-1">
                    To edit configurations, you need admin access. Click the &quot;Login as Admin&quot; button above.
                  </p>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </div>

      {/* Admin Token Dialog */}
      <AdminTokenDialog
        isOpen={showAdminDialog}
        onClose={() => setShowAdminDialog(false)}
        onSuccess={() => {
          checkAdminStatus();
          mutate();
        }}
      />
    </div>
  );
}

export default function EnhancedSettingsPage() {
  return (
    <AuthGuard>
      <SettingsPageContent />
    </AuthGuard>
  );
}
