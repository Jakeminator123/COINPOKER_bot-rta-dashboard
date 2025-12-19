"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { DeviceRecord } from "@/lib/device/transform";
import { ACTIVE_DEVICE_THRESHOLD_MS } from "@/lib/device/transform";
import CustomSelect from "@/components/CustomSelect";

export const DEVICES_PAGE_SIZE = 20;
export const DEVICES_PAGE_SIZE_COMPACT = 60;

type ViewMode = "normal" | "compact";

interface DeviceListModuleProps {
  devices?: DeviceRecord[] | null;
  isLoading?: boolean;
  onDeviceSelect?: (deviceId: string) => void;
  showInactive?: boolean;
}


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
    <svg className="w-full h-8" viewBox="0 0 100 100" preserveAspectRatio="none">
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

export function getThreatColor(level: number): string {
  if (level >= 75) return "#dc2626";
  if (level >= 50) return "#f97316";
  if (level >= 25) return "#eab308";
  return "#22c55e";
}

export function getThreatLabel(level: number): string {
  if (level >= 75) return "CRITICAL";
  if (level >= 50) return "HIGH";
  if (level >= 25) return "MEDIUM";
  return "LOW";
}

export default function DeviceListModule({
  devices = [],
  isLoading = false,
  onDeviceSelect,
  showInactive: _showInactive = true,
}: DeviceListModuleProps) {
  const [hoveredDevice, setHoveredDevice] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [threatFilter, setThreatFilter] = useState<
    "all" | "critical" | "high" | "medium" | "low"
  >("all");
  const [sortBy, setSortBy] = useState<
    "default" | "threat_desc" | "last_seen_desc" | "name_asc" | "duration_desc"
  >("default");
  const [viewMode, setViewMode] = useState<ViewMode>("normal");

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, threatFilter, sortBy, viewMode, devices?.length ?? 0]);

  const filteredDevices = useMemo(() => {
    if (!devices) return [];
    return devices.filter((device) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = device.device_name?.toLowerCase().includes(query);
        const matchesNickname = device.player_nickname
          ?.toLowerCase()
          .includes(query);
        const matchesId = device.device_id?.toLowerCase().includes(query);
        const matchesIp = device.ip_address?.toLowerCase().includes(query);
        if (!matchesName && !matchesNickname && !matchesId && !matchesIp) {
          return false;
        }
      }

      if (threatFilter !== "all") {
        const threat = device.threat_level || 0;
        if (threatFilter === "critical" && threat < 75) return false;
        if (threatFilter === "high" && (threat < 50 || threat >= 75)) return false;
        if (threatFilter === "medium" && (threat < 25 || threat >= 50)) return false;
        if (threatFilter === "low" && threat >= 25) return false;
      }

      return true;
    });
  }, [devices, searchQuery, threatFilter]);

  // Combine and sort devices
  const sortedDevices = useMemo(() => {
    let result = [...filteredDevices];

    switch (sortBy) {
      case "threat_desc":
        // Strict threat level sort (ignoring online status)
        result.sort((a, b) => (b.threat_level || 0) - (a.threat_level || 0));
        break;
      case "last_seen_desc":
        // Most recent first
        result.sort((a, b) => b.last_seen - a.last_seen);
        break;
      case "name_asc":
        // Alphabetical by name
        result.sort((a, b) => {
          const nameA = a.player_nickname || a.device_name || "";
          const nameB = b.player_nickname || b.device_name || "";
          return nameA.localeCompare(nameB);
        });
        break;
      case "duration_desc":
        // Longest session first
        result.sort((a, b) => (b.session_duration || 0) - (a.session_duration || 0));
        break;
      case "default":
      default: {
        // Original logic: Online first (by threat), then Offline (by threat)
        const now = Date.now();
        const online: DeviceRecord[] = [];
        const offline: DeviceRecord[] = [];

        for (const device of result) {
          if (now - device.last_seen < ACTIVE_DEVICE_THRESHOLD_MS) {
            online.push(device);
          } else {
            offline.push(device);
          }
        }

        // Sort online by current threat_level (highest first)
        online.sort((a, b) => (b.threat_level || 0) - (a.threat_level || 0));

        // Sort offline by threat_level (highest first)
        offline.sort((a, b) => (b.threat_level || 0) - (a.threat_level || 0));

        // Combine: online first, then offline
        result = [...online, ...offline];
        break;
      }
    }

    return result;
  }, [filteredDevices, sortBy]);

  // For backward compatibility, keep these variables
  const activeDevices = sortedDevices.filter(d => {
    const now = Date.now();
    return now - d.last_seen < ACTIVE_DEVICE_THRESHOLD_MS;
  });
  const inactiveDevices = sortedDevices.filter(d => {
    const now = Date.now();
    return now - d.last_seen >= ACTIVE_DEVICE_THRESHOLD_MS;
  });

  // Pagination for combined list - use different page size for compact mode
  const pageSize = viewMode === "compact" ? DEVICES_PAGE_SIZE_COMPACT : DEVICES_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(sortedDevices.length / pageSize));
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const pagedDevices = sortedDevices.slice(startIdx, endIdx);

  const threatOptions = [
    { value: "all", label: "All Threat Levels" },
    { value: "critical", label: "Critical (75%+)" },
    { value: "high", label: "High (50-74%)" },
    { value: "medium", label: "Medium (25-49%)" },
    { value: "low", label: "Low (<25%)" },
  ];

  const sortOptions = [
    { value: "default", label: "Default (Risk & Status)" },
    { value: "threat_desc", label: "Highest Risk First" },
    { value: "last_seen_desc", label: "Recently Active" },
    { value: "duration_desc", label: "Longest Session" },
    { value: "name_asc", label: "Name (A-Z)" },
  ];


  const handleSelect = useCallback(
    (deviceId: string) => {
      onDeviceSelect?.(deviceId);
    },
    [onDeviceSelect],
  );


  if (isLoading) {
    return (
      <div className="glass-card p-12 flex flex-col items-center justify-center">
        <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        <p className="text-white/60 mt-4">Loading devices...</p>
      </div>
    );
  }

  if (!devices || !devices.length) {
    return (
      <div className="glass-card p-12 text-center">
        <div className="text-6xl mb-4">🔍</div>
        <h3 className="text-xl font-semibold text-white mb-2">No devices found</h3>
        <p className="text-slate-400">Start the detection agent to populate data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="glass-card p-4 relative z-50">
        <div className="flex flex-col gap-4">
          {/* Top row: Search and View Mode */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label
                htmlFor="device-search-input"
                className="sr-only"
              >
                Search devices
              </label>
              <input
                id="device-search-input"
                name="device-search"
                type="text"
                placeholder="Search by name, ID, or IP address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 text-white rounded-lg px-4 py-2 border border-white/10 focus:border-indigo-500 focus:outline-none hover:bg-white/10 transition-colors placeholder-slate-400"
              />
            </div>
            {/* View Mode Toggle Buttons */}
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
              <button
                onClick={() => setViewMode("normal")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === "normal"
                    ? "bg-indigo-500 text-white shadow-lg"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
                title="Normal view - detailed cards"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("compact")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === "compact"
                    ? "bg-indigo-500 text-white shadow-lg"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
                title="Compact view - more players visible"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
          {/* Bottom row: Filters */}
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
            <div className="flex flex-col sm:flex-row gap-4 flex-1">
              <CustomSelect
                id="threat-filter-select"
                label="Threat filter"
                value={threatFilter}
                onChange={(value) => setThreatFilter(value as typeof threatFilter)}
                options={threatOptions}
              />
              <CustomSelect
                id="sort-by-select"
                label="Sort by"
                value={sortBy}
                onChange={(value) => setSortBy(value as typeof sortBy)}
                options={sortOptions}
              />
            </div>
            <button
              onClick={() => {
                setSearchQuery("");
                setThreatFilter("all");
                setSortBy("default");
              }}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm text-slate-300 hover:text-white"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {sortedDevices.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2 className="text-xl font-semibold flex items-center gap-3">
              All Devices
              <span className="text-sm text-slate-400 font-normal">
                ({activeDevices.length} online, {inactiveDevices.length} offline)
              </span>
            </h2>
            <div className="flex items-center gap-4">
              {totalPages > 1 && (
                <div className="text-sm text-slate-400">
                  Page {currentPage} of {totalPages}
                </div>
              )}
              <div className="text-xs text-slate-500">
                Showing {pagedDevices.length} of {sortedDevices.length}
              </div>
            </div>
          </div>

          {/* COMPACT VIEW */}
          {viewMode === "compact" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
              {pagedDevices.map((device, idx) => {
                const isOnline = Date.now() - device.last_seen < ACTIVE_DEVICE_THRESHOLD_MS;
                return (
                  <div
                    key={device.device_id}
                    className={`glass-card p-2.5 cursor-pointer transition-all duration-200 hover:scale-[1.02] ${
                      isOnline
                        ? "border-emerald-400/30 hover:border-emerald-400/50"
                        : "opacity-50 hover:opacity-80"
                    }`}
                    style={{
                      animationDelay: `${idx * 15}ms`,
                      borderLeft: `3px solid ${getThreatColor(device.threat_level || 0)}`,
                    }}
                    onClick={() => handleSelect(device.device_id)}
                    onMouseEnter={() => setHoveredDevice(device.device_id)}
                    onMouseLeave={() => setHoveredDevice(null)}
                  >
                    {/* Compact card content */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`relative flex h-1.5 w-1.5 shrink-0`}>
                        {isOnline ? (
                          <>
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                          </>
                        ) : (
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-slate-500" />
                        )}
                      </span>
                      <span className="text-xs font-medium text-white truncate flex-1">
                        {device.player_nickname ?? device.device_name ?? "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: `${getThreatColor(device.threat_level || 0)}20`,
                          color: getThreatColor(device.threat_level || 0),
                        }}
                      >
                        {device.threat_level || 0}%
                      </span>
                      <span className="text-[9px] text-slate-500">
                        {device.signal_count || 0} det
                      </span>
                    </div>
                    {/* Mini category indicators */}
                    {device.detected_categories && device.detected_categories.length > 0 && (
                      <div className="flex gap-0.5 mt-1.5 flex-wrap">
                        {device.detected_categories.slice(0, 3).map((cat) => (
                          <span
                            key={cat}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                cat === "programs" ? "#a855f7" :
                                cat === "network" ? "#3b82f6" :
                                cat === "behaviour" ? "#eab308" :
                                cat === "vm" ? "#22c55e" :
                                cat === "auto" ? "#f97316" : "#6b7280",
                            }}
                            title={cat}
                          />
                        ))}
                        {device.detected_categories.length > 3 && (
                          <span className="text-[8px] text-slate-500">+{device.detected_categories.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* NORMAL VIEW */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pagedDevices.map((device, idx) => {
                const isOnline = Date.now() - device.last_seen < ACTIVE_DEVICE_THRESHOLD_MS;
                const statusBadgeClasses = isOnline
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30"
                  : "bg-white/5 text-slate-400 border border-white/10";
                return (
                  <div
                    key={device.device_id}
                    className={`glass-card p-4 cursor-pointer animate-slide-up transition-all duration-300 ${
                      isOnline
                        ? "border-emerald-400/40 shadow-[0_0_20px_rgba(16,185,129,0.15)] hover:scale-[1.02]"
                        : "opacity-60 saturate-50 hover:opacity-90 hover:saturate-100"
                    }`}
                    style={{
                      animationDelay: `${idx * 30}ms`,
                      boxShadow:
                        hoveredDevice === device.device_id
                          ? `0 8px 20px ${getThreatColor(device.threat_level || 0)}30`
                          : undefined,
                    }}
                    onClick={() => handleSelect(device.device_id)}
                    onMouseEnter={() => setHoveredDevice(device.device_id)}
                    onMouseLeave={() => setHoveredDevice(null)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-semibold text-white truncate">
                            {device.player_nickname ?? device.device_name}
                          </h3>
                          <span className={`relative flex h-2 w-2 shrink-0`}>
                            {isOnline ? (
                              <>
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                              </>
                            ) : (
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-500" />
                            )}
                          </span>
                          <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-full uppercase tracking-wide shrink-0 ${statusBadgeClasses}`}>
                            {isOnline ? "Online" : "Offline"}
                          </span>
                        </div>
                        {(device.device_hostname || device.device_name) && (
                          <p className="text-[10px] text-slate-500 truncate">
                            {device.device_hostname ?? device.device_name}
                          </p>
                        )}
                      </div>
                      {device.threat_level !== undefined && (
                        <div
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0"
                          style={{
                            backgroundColor: `${getThreatColor(device.threat_level)}20`,
                            color: getThreatColor(device.threat_level),
                            border: `1px solid ${getThreatColor(device.threat_level)}40`,
                          }}
                        >
                          {device.threat_level}% {getThreatLabel(device.threat_level)}
                        </div>
                      )}
                    </div>
                    
                    {/* Category badges - compact */}
                    {device.detected_categories && device.detected_categories.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {device.detected_categories.includes("programs") && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-purple-500/20 text-purple-300">
                            Programs
                          </span>
                        )}
                        {device.detected_categories.includes("network") && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-500/20 text-blue-300">
                            Network
                          </span>
                        )}
                        {device.detected_categories.includes("behaviour") && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-yellow-500/20 text-yellow-300">
                            Behaviour
                          </span>
                        )}
                        {device.detected_categories.includes("vm") && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-green-500/20 text-green-300">
                            VM
                          </span>
                        )}
                        {device.detected_categories.includes("auto") && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-orange-500/20 text-orange-300">
                            Auto
                          </span>
                        )}
                      </div>
                    )}

                    {/* Stats row */}
                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-700/30">
                      <span>{device.signal_count || 0} detections</span>
                      <span>{device.session_duration ? Math.floor(device.session_duration / 60000) : 0}m session</span>
                      <span className="text-slate-600">ID: {device.device_id.slice(0, 6)}...</span>
                    </div>

                    {/* Sparkline for devices with history */}
                    {device.historical_threat_levels && device.historical_threat_levels.length > 1 && (
                      <div className="mt-2 h-6">
                        <MiniSparkline
                          data={device.historical_threat_levels.slice(-15)}
                          color={getThreatColor(device.threat_level || 0)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="glass-card px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
              >
                Previous
              </button>
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
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
                })}
              </div>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="glass-card px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}

      {/* Inactive devices are now shown in the main list above, sorted by threat score */}
    </div>
  );
}

