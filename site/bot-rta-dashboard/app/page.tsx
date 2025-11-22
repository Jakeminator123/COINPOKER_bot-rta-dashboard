/**
 * Enhanced Player Overview Page
 * =============================
 * Matches the Settings page design with all animations and components
 */
"use client";

import { useDebouncedNavigation } from "@/lib/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import useSWR from "swr";
import AuthGuard from "@/components/AuthGuard";
import NavigationTabs from "@/components/NavigationTabs";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { SettingsGearIcon, DatabaseIcon, ShieldIcon, ArrowIcon, NetworkIcon, DetectionIcon } from "@/components/AnimatedIcons";
import { GlassCard, FeatureCard } from "@/components/GlassCard";
import { THREAT_THRESHOLDS } from "@/lib/threat-scoring";

type Player = {
  id: string;
  name: string;
  status: "online" | "offline" | "suspicious";
  lastSeen: number;
  threatLevel: number;
  avgScore?: number;
  scorePerHour?: number;
  sessionDuration?: number;
  ipAddress?: string;
  statusMessage?: string;
  statusColor?: string;
  detections: {
    critical: number;
    warnings: number;
    total: number;
  };
  isOnline: boolean;
};

type PlayerMeta = {
  totalPlayers?: number;
  onlinePlayers?: number;
  highRiskPlayers?: number;
  avgThreatLevel?: number;
};

type PlayersApiResponse =
  | Player[]
  | {
      ok: boolean;
      data?:
        | Player[]
        | {
            players: Player[];
            hasMore?: boolean;
            total?: number;
            meta?: PlayerMeta;
          };
    };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function PlayerCard({ player, onClick }: { player: Player; onClick: () => void }) {
  const getThreatColor = (level: number) => {
    if (level >= 70) return "from-red-500/20 to-red-600/20";
    if (level >= 40) return "from-yellow-500/20 to-yellow-600/20";
    if (level >= 20) return "from-blue-500/20 to-blue-600/20";
    return "from-green-500/20 to-green-600/20";
  };

  const threatColor = getThreatColor(player.threatLevel || 0);
  const isOffline = !player.isOnline;
  
  // Show abbreviated device ID only when it's different from the name
  const showDeviceId = player.name !== player.id && !player.name.includes(player.id.substring(0, 8));
  const truncatedId = showDeviceId && player.id.length > 12 
    ? `${player.id.substring(0, 12)}...` 
    : player.id;
  
  // Format last seen time for tooltip
  const formatLastSeen = (lastSeen: number) => {
    if (!lastSeen) return "Never";
    const diff = Date.now() - (lastSeen * 1000);
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (seconds < 60) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };
  
  const statusText = isOffline 
    ? `Offline - Last seen: ${formatLastSeen(player.lastSeen)}`
    : "Online - Active now";

  return (
    <motion.div
      whileHover={isOffline ? {} : { y: -5 }}
      whileTap={isOffline ? {} : { scale: 0.98 }}
      onClick={onClick}
      className={isOffline ? "cursor-default" : "cursor-pointer"}
    >
      <GlassCard 
        className={`p-6 transition-all duration-300 ${isOffline ? 'pointer-events-none' : ''}`} 
        hover={!isOffline} 
        gradient={!isOffline}
        title={statusText}
      >
        <div className={`relative transition-all duration-300 ${isOffline ? 'opacity-70' : ''}`}>
        {isOffline && (
          <div className="absolute inset-0 bg-slate-800/50 backdrop-blur-sm rounded-xl z-20 pointer-events-none" style={{ filter: 'grayscale(60%)' }} />
        )}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`p-3 rounded-xl bg-gradient-to-br ${threatColor} border border-white/10 flex-shrink-0 ${isOffline ? 'opacity-50' : ''}`} title={statusText}>
              <ShieldIcon className={`w-6 h-6 ${isOffline ? 'text-slate-500' : 'text-white'}`} isActive={player.isOnline} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className={`font-bold text-lg truncate ${isOffline ? 'text-slate-400' : 'text-white'}`} title={statusText}>{player.name}</h3>
              {showDeviceId && (
                <p className={`text-xs font-mono truncate ${isOffline ? 'text-slate-600' : 'text-slate-500'}`} title={`Device ID: ${player.id}\n${statusText}`}>
                  ID: {truncatedId}
                </p>
              )}
            </div>
          </div>
          
          {player.isOnline && (
            <motion.div
              className="w-3 h-3 bg-green-400 rounded-full"
              animate={{ scale: [1, 1.5, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              title="Online - Active now"
            />
          )}
          {isOffline && (
            <div className="w-3 h-3 bg-slate-500 rounded-full" title={statusText} />
          )}
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <span className={`text-sm ${isOffline ? 'text-slate-500' : 'text-slate-400'}`}>Threat Level</span>
            <span className={`font-semibold ${isOffline ? 'text-slate-400' : player.threatLevel >= 70 ? 'text-red-400' : player.threatLevel >= 40 ? 'text-yellow-400' : 'text-green-400'}`}>
              {player.threatLevel || 0}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className={`text-sm ${isOffline ? 'text-slate-500' : 'text-slate-400'}`}>Detections</span>
            <span className={isOffline ? 'text-slate-500' : 'text-white'}>{player.detections?.total || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className={`text-sm ${isOffline ? 'text-slate-500' : 'text-slate-400'}`}>Critical</span>
            <span className={isOffline ? 'text-slate-500' : 'text-red-400'}>{player.detections?.critical || 0}</span>
          </div>
        </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

const PAGE_SIZE = 20;

function unwrapPlayersPayload(
  data: PlayersApiResponse | undefined
): {
  players: Player[];
  hasMore?: boolean;
  total?: number;
  meta?: PlayerMeta;
} | null {
  if (!data) return null;

  if (Array.isArray(data)) {
    return {
      players: data,
      hasMore: data.length >= PAGE_SIZE,
    };
  }

  if (typeof data === "object" && data !== null && "ok" in data) {
    const payload = data.data;
    if (Array.isArray(payload)) {
      return {
        players: payload,
        hasMore: payload.length >= PAGE_SIZE,
      };
    }

    if (payload && typeof payload === "object") {
      const players = Array.isArray(payload.players) ? payload.players : [];
      return {
        players,
        hasMore: payload.hasMore,
        total: typeof payload.total === "number" ? payload.total : undefined,
        meta: payload.meta,
      };
    }
  }

  return null;
}

function HomePageContent() {
  const { navigateTo } = useDebouncedNavigation();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"threat" | "name" | "status">("threat");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [threatFilter, setThreatFilter] = useState<"all" | "low" | "medium" | "high" | "critical">("all");
  const [detectionTypeFilter, setDetectionTypeFilter] = useState<"all" | "critical" | "warnings" | "any">("all");
  const [currentPage, setCurrentPage] = useState(0);

  const {
    data: playersData,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<PlayersApiResponse>(
    `/api/players?offset=${currentPage * PAGE_SIZE}&limit=${PAGE_SIZE}`,
    fetcher,
    {
      refreshInterval: 120000, // 120s polling (matches batch report interval + timeout margin)
      revalidateOnFocus: true, // Update when user returns to tab
      dedupingInterval: 5000, // Allow requests more frequently (was 30s - too restrictive for debugging)
      keepPreviousData: false, // Don't keep old data - ensures offline status updates immediately
      onSuccess: (data) => {
        const players = unwrapPlayersPayload(data)?.players ?? [];
        const onlineCount = players.filter(p => p.isOnline).length;
        const targetPlayer = players.find(p => p.id === "462a6a3a5c173a1ea54e05b355ea1790");
        
        console.log(`[HomePage] ✅ Players updated: ${players.length} total, ${onlineCount} online`);
        if (targetPlayer) {
          console.log(`[HomePage] 🎯 Target player status:`, {
            id: targetPlayer.id,
            name: targetPlayer.name,
            isOnline: targetPlayer.isOnline,
            threatLevel: targetPlayer.threatLevel,
            lastSeen: targetPlayer.lastSeen,
            lastSeenFormatted: targetPlayer.lastSeen ? new Date(targetPlayer.lastSeen * 1000).toISOString() : "Never",
          });
        } else {
          console.log(`[HomePage] ⚠️ Target player NOT in list (may be filtered out)`);
        }
      },
      onError: (err) => {
        console.error('[HomePage] ❌ Error fetching players:', err);
      },
    }
  );

  // SSE disabled for player list page - rely on 120s polling instead
  // This reduces unnecessary re-renders when dealing with thousands of players
  // Individual player dashboards still get real-time updates
  // Uncomment below to re-enable SSE updates if needed for smaller deployments
  /*
  useEffect(() => {
    const es = new EventSource("/api/stream");

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.sections) {
          const now = Date.now();
          // Throttle SSE updates to once per 60s for player list
          if (now - lastSseMutateRef.current > 60000) {
            lastSseMutateRef.current = now;
            void mutate();
          }
        }
      } catch {
        // Ignore malformed SSE payloads
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [mutate]);
  */

  useEffect(() => {
    setCurrentPage(0);
  }, [searchTerm, statusFilter, sortBy, threatFilter, detectionTypeFilter]);

  const playersPayload = useMemo(
    () => unwrapPlayersPayload(playersData),
    [playersData]
  );

  const currentPagePlayers = playersPayload?.players ?? [];

  const totalPlayers = useMemo(() => {
    if (typeof playersPayload?.meta?.totalPlayers === "number") {
      return playersPayload.meta.totalPlayers;
    }
    if (typeof playersPayload?.total === "number") {
      return playersPayload.total;
    }
    return null;
  }, [playersPayload]);

  const globalOnlineCount = useMemo(() => {
    if (typeof playersPayload?.meta?.onlinePlayers === "number") {
      return playersPayload.meta.onlinePlayers;
    }
    return null;
  }, [playersPayload]);

  const hasMoreForPage = useMemo(() => {
    if (typeof playersPayload?.hasMore === "boolean") {
      return playersPayload.hasMore;
    }
    return currentPagePlayers.length === PAGE_SIZE;
  }, [playersPayload, currentPagePlayers.length]);

  const filteredPlayers = useMemo(() => {
    if (!currentPagePlayers) return [];

    return currentPagePlayers
      .filter(p => {
        // Status filter
        if (statusFilter !== "all") {
          if (statusFilter === "online" && !p.isOnline) return false;
          if (statusFilter === "offline" && p.isOnline) return false;
        }
        
        // Threat level filter
        if (threatFilter !== "all") {
          const threat = p.threatLevel || 0;
          switch (threatFilter) {
            case "low":
              if (threat >= 30) return false;
              break;
            case "medium":
              if (threat < 30 || threat >= 70) return false;
              break;
            case "high":
              if (threat < 70 || threat >= 90) return false;
              break;
            case "critical":
              if (threat < 90) return false;
              break;
          }
        }
        
        // Detection type filter
        if (detectionTypeFilter !== "all") {
          switch (detectionTypeFilter) {
            case "critical":
              if (!p.detections?.critical || p.detections.critical === 0) return false;
              break;
            case "warnings":
              if (!p.detections?.warnings || p.detections.warnings === 0) return false;
              break;
            case "any":
              if (!p.detections?.total || p.detections.total === 0) return false;
              break;
          }
        }
        
        // Search filter
        if (searchTerm) {
          return p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 p.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 (p.ipAddress && p.ipAddress.toLowerCase().includes(searchTerm.toLowerCase()));
        }
        return true;
      })
      .sort((a, b) => {
        // Priority 1: Online players ALWAYS come first, regardless of other sorting
        const aIsOnline = a.isOnline ? 1 : 0;
        const bIsOnline = b.isOnline ? 1 : 0;
        if (aIsOnline !== bIsOnline) {
          return bIsOnline - aIsOnline; // Online first
        }
        
        // Priority 2: Within same online status group (both online or both offline),
        // apply the selected sort method
        switch (sortBy) {
          case "threat": {
            // Sort by threat level (highest to lowest)
            const threatDiff = (b.threatLevel || 0) - (a.threatLevel || 0);
            if (threatDiff !== 0) {
              return threatDiff;
            }
            // Tiebreaker: sort by name
            return a.name.localeCompare(b.name);
          }
          case "name":
            // Sort alphabetically by name
            return a.name.localeCompare(b.name);
          case "status":
            // Already sorted by status (online first), so just use threat as secondary
            return (b.threatLevel || 0) - (a.threatLevel || 0);
          default:
            return 0;
        }
      });
  }, [currentPagePlayers, searchTerm, sortBy, statusFilter, threatFilter, detectionTypeFilter]);

  const displayedPlayers = filteredPlayers;

  const canGoNext = useMemo(() => {
    if (typeof hasMoreForPage === "boolean") {
      return hasMoreForPage;
    }
    return filteredPlayers.length === PAGE_SIZE;
  }, [hasMoreForPage, filteredPlayers.length]);

  const stats = useMemo(() => {
    const players = currentPagePlayers ?? [];
    const fallbackOnline = players.filter((p) => p.isOnline).length;
    const fallbackHighRisk = players.filter(
      (p) => (p.threatLevel || 0) >= THREAT_THRESHOLDS.HIGH_RISK
    ).length;
    const fallbackAvgThreat = players.length
      ? Math.round(
          players.reduce((sum, p) => sum + (p.threatLevel || 0), 0) /
            players.length
        )
      : 0;

    return {
      online: globalOnlineCount ?? fallbackOnline,
      total: totalPlayers ?? players.length,
      highRisk:
        typeof playersPayload?.meta?.highRiskPlayers === "number"
          ? playersPayload.meta.highRiskPlayers
          : fallbackHighRisk,
      avgThreat:
        typeof playersPayload?.meta?.avgThreatLevel === "number"
          ? playersPayload.meta.avgThreatLevel
          : fallbackAvgThreat,
    };
  }, [currentPagePlayers, totalPlayers, globalOnlineCount, playersPayload]);

  const canGoPrevious = currentPage > 0;

  const handlePreviousPage = () => {
    if (!canGoPrevious) return;
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    if (!canGoNext) return;
    setCurrentPage((prev) => prev + 1);
  };

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

        {/* Search and Filters */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <GlassCard className="p-6 mb-8">
            <div className="space-y-4">
              {/* Search Bar */}
            <div className="flex flex-wrap gap-4">
              <label htmlFor="player-search" className="sr-only">Search players</label>
              <input
                id="player-search"
                name="player-search"
                type="text"
                  placeholder="Search by name, ID, or IP address..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 min-w-[250px] px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
              />
              </div>
              
              {/* Filter Row */}
              <div className="flex flex-wrap gap-3">
              <label htmlFor="sort-by" className="sr-only">Sort by</label>
              <select
                id="sort-by"
                name="sort-by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
              >
                  <option value="threat" className="bg-slate-800 text-white">Sort: Threat Level</option>
                  <option value="name" className="bg-slate-800 text-white">Sort: Name</option>
                  <option value="status" className="bg-slate-800 text-white">Sort: Status</option>
              </select>
              
              <label htmlFor="status-filter" className="sr-only">Filter by status</label>
              <select
                id="status-filter"
                name="status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
              >
                  <option value="all" className="bg-slate-800 text-white">Status: All</option>
                  <option value="online" className="bg-slate-800 text-white">Status: Online</option>
                  <option value="offline" className="bg-slate-800 text-white">Status: Offline</option>
                </select>
                
                <label htmlFor="threat-filter" className="sr-only">Filter by threat level</label>
                <select
                  id="threat-filter"
                  name="threat-filter"
                  value={threatFilter}
                  onChange={(e) => setThreatFilter(e.target.value as any)}
                  className="px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="all" className="bg-slate-800 text-white">Threat: All</option>
                  <option value="low" className="bg-slate-800 text-white">Threat: Low (0-29%)</option>
                  <option value="medium" className="bg-slate-800 text-white">Threat: Medium (30-69%)</option>
                  <option value="high" className="bg-slate-800 text-white">Threat: High (70-89%)</option>
                  <option value="critical" className="bg-slate-800 text-white">Threat: Critical (90%+)</option>
                </select>
                
                <label htmlFor="detection-filter" className="sr-only">Filter by detection type</label>
                <select
                  id="detection-filter"
                  name="detection-filter"
                  value={detectionTypeFilter}
                  onChange={(e) => setDetectionTypeFilter(e.target.value as any)}
                  className="px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="all" className="bg-slate-800 text-white">Detections: All</option>
                  <option value="critical" className="bg-slate-800 text-white">Detections: Has Critical</option>
                  <option value="warnings" className="bg-slate-800 text-white">Detections: Has Warnings</option>
                  <option value="any" className="bg-slate-800 text-white">Detections: Has Any</option>
              </select>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Players Grid */}
        {isLoading && !playersData ? (
          <GlassCard className="p-12">
            <div className="flex flex-col items-center">
              <motion.div
                className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              />
              <p className="text-white/60 mt-4">Loading players...</p>
            </div>
          </GlassCard>
        ) : (
          <>
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              <AnimatePresence mode="popLayout">
                {displayedPlayers.map((player, index) => (
                  <motion.div
                    key={player.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <PlayerCard
                      player={player}
                      onClick={() => navigateTo(`/dashboard?device=${player.id}`)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>

            {displayedPlayers.length > 0 && (
              <motion.div
                className="mt-8 flex flex-wrap items-center justify-center gap-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
              >
                <motion.button
                  onClick={handlePreviousPage}
                  disabled={!canGoPrevious || isValidating}
                  className="px-5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-white font-semibold shadow-lg shadow-slate-900/30 transition-all disabled:opacity-50 flex items-center gap-2"
                  whileHover={{ scale: canGoPrevious && !isValidating ? 1.05 : 1 }}
                  whileTap={{ scale: canGoPrevious && !isValidating ? 0.95 : 1 }}
                >
                  <ArrowIcon direction="left" className="w-4 h-4" />
                  Previous
                </motion.button>

                <div className="text-sm text-slate-400">
                  Page <span className="text-white">{currentPage + 1}</span>
                  {typeof totalPlayers === "number" && totalPlayers > 0 && (
                    <span className="text-slate-500">
                      {" "}
                      • {Math.ceil(totalPlayers / PAGE_SIZE)} total pages
                    </span>
                  )}
                </div>

                <motion.button
                  onClick={handleNextPage}
                  disabled={!canGoNext || isValidating}
                  className="px-6 py-2.5 bg-gradient-to-r from-indigo-600/90 to-purple-600/90 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl font-semibold shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50 flex items-center gap-2"
                  whileHover={{ scale: canGoNext && !isValidating ? 1.05 : 1 }}
                  whileTap={{ scale: canGoNext && !isValidating ? 0.95 : 1 }}
                >
                  {isValidating ? (
                    <>
                      <motion.div
                        className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      />
                      <span>Loading…</span>
                    </>
                  ) : (
                    <>
                      <span>Next 20</span>
                      <ArrowIcon direction="right" className="w-4 h-4" />
                    </>
                  )}
                </motion.button>
              </motion.div>
            )}

            {displayedPlayers.length === 0 && !isLoading && !isValidating && (
              <GlassCard className="p-12">
                <div className="text-center">
                  <motion.div
                    className="text-6xl mb-4"
                    animate={{ rotate: [0, 10, -10, 0] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    🔍
                  </motion.div>
                  <h3 className="text-xl font-semibold text-white mb-2">No players found</h3>
                  <p className="text-slate-400">Try adjusting your filters or search terms</p>
                </div>
              </GlassCard>
            )}
          </>
        )}
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