"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { DeviceRecord } from "@/lib/device/transform";
import { ACTIVE_DEVICE_THRESHOLD_MS } from "@/lib/device/transform";

export const DEVICES_PAGE_SIZE = 20;

interface DeviceListModuleProps {
  devices?: DeviceRecord[] | null;
  isLoading?: boolean;
  onDeviceSelect?: (deviceId: string) => void;
  showInactive?: boolean;
}

interface HourStats {
  avg: number;
  total: number;
  activeMinutes: number;
  loading: boolean;
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
  showInactive = true,
}: DeviceListModuleProps) {
  const [hoveredDevice, setHoveredDevice] = useState<string | null>(null);
  const [hourMap, setHourMap] = useState<Record<string, HourStats>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [threatFilter, setThreatFilter] = useState<
    "all" | "critical" | "high" | "medium" | "low"
  >("all");

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, threatFilter, devices?.length ?? 0]);

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

  const { activeDevices, inactiveDevices } = useMemo(() => {
    const now = Date.now();
    const active: DeviceRecord[] = [];
    const inactive: DeviceRecord[] = [];

    for (const device of filteredDevices) {
      if (now - device.last_seen < ACTIVE_DEVICE_THRESHOLD_MS) {
        active.push(device);
      } else {
        inactive.push(device);
      }
    }

    return {
      activeDevices: active,
      inactiveDevices: inactive.slice(0, DEVICES_PAGE_SIZE),
    };
  }, [filteredDevices]);

  const totalActivePages = Math.max(
    1,
    Math.ceil(activeDevices.length / DEVICES_PAGE_SIZE),
  );
  const startIdx = (currentPage - 1) * DEVICES_PAGE_SIZE;
  const endIdx = startIdx + DEVICES_PAGE_SIZE;
  const pagedActiveDevices = activeDevices.slice(startIdx, endIdx);

  const handleSelect = useCallback(
    (deviceId: string) => {
      onDeviceSelect?.(deviceId);
    },
    [onDeviceSelect],
  );

  const loadHourStats = useCallback(async (deviceId: string) => {
    setHourMap((prev) => ({
      ...prev,
      [deviceId]: {
        avg: prev[deviceId]?.avg ?? 0,
        total: prev[deviceId]?.total ?? 0,
        activeMinutes: prev[deviceId]?.activeMinutes ?? 0,
        loading: true,
      },
    }));

    try {
      const res = await fetch(
        `/api/history/hour?device=${encodeURIComponent(deviceId)}&window=3600`,
      );
      const json = await res.json();
      if (json?.ok) {
        setHourMap((prev) => ({
          ...prev,
          [deviceId]: {
            avg: json.avg ?? 0,
            total: json.total ?? 0,
            activeMinutes: json.activeMinutes ?? 0,
            loading: false,
          },
        }));
      } else {
        setHourMap((prev) => ({
          ...prev,
          [deviceId]: { avg: 0, total: 0, activeMinutes: 0, loading: false },
        }));
      }
    } catch {
      setHourMap((prev) => ({
        ...prev,
        [deviceId]: { avg: 0, total: 0, activeMinutes: 0, loading: false },
      }));
    }
  }, []);

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
    <div className="space-y-12">
      <div className="glass-card p-4">
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
              className="w-full bg-slate-800/50 text-slate-300 rounded-lg px-4 py-2 border border-slate-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col">
            <label
              htmlFor="threat-filter-select"
              className="sr-only"
            >
              Threat filter
            </label>
            <select
              id="threat-filter-select"
              name="threat-filter"
              value={threatFilter}
              onChange={(e) => setThreatFilter(e.target.value as typeof threatFilter)}
              className="bg-slate-800/50 text-slate-300 rounded-lg px-4 py-2 border border-slate-600 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">All Threat Levels</option>
              <option value="critical">Critical (75%+)</option>
              <option value="high">High (50-74%)</option>
              <option value="medium">Medium (25-49%)</option>
              <option value="low">Low (&lt;25%)</option>
            </select>
          </div>
          <button
            onClick={() => {
              setSearchQuery("");
              setThreatFilter("all");
            }}
            className="px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors text-sm"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {activeDevices.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2 className="text-2xl font-semibold flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
              Active Devices
              <span className="text-base text-slate-400 font-normal ml-2">
                ({activeDevices.length} filtered)
              </span>
            </h2>
            {totalActivePages > 1 && (
              <div className="text-sm text-slate-400">
                Page {currentPage} of {totalActivePages}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pagedActiveDevices.map((device, idx) => (
              <div
                key={device.device_id}
                className="glass-card p-6 cursor-pointer animate-slide-up hover:scale-105 transition-all duration-300"
                style={{
                  animationDelay: `${idx * 50}ms`,
                  boxShadow:
                    hoveredDevice === device.device_id
                      ? `0 12px 24px ${getThreatColor(device.threat_level || 0)}40`
                      : undefined,
                }}
                onClick={() => handleSelect(device.device_id)}
                onMouseEnter={() => {
                  setHoveredDevice(device.device_id);
                  if (!hourMap[device.device_id]) {
                    void loadHourStats(device.device_id);
                  }
                }}
                onMouseLeave={() => setHoveredDevice(null)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div>
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                          {device.player_nickname ?? device.device_name}
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                          </span>
                        </h3>
                        {(device.device_hostname || device.device_name) && (
                          <p className="text-xs text-slate-500">
                            Device: {device.device_hostname ?? device.device_name}
                          </p>
                        )}
                      </div>
                      {device.threat_level !== undefined && (
                        <div
                          className="px-3 py-1 rounded-full text-xs font-bold animate-pulse"
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
                    <p className="text-sm text-slate-400">
                      ID: {device.device_id.slice(0, 8)}...
                    </p>
                  </div>
                  <div
                    className={`transition-transform ${
                      hoveredDevice === device.device_id ? "scale-110" : ""
                    }`}
                  >
                    <svg
                      className="w-5 h-5 text-slate-400"
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
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-400">Nickname</span>
                    <span className="text-sm font-semibold text-white">
                      {device.player_nickname ?? "—"}
                    </span>
                  </div>
                  {(device.device_hostname || device.device_name) && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-400">Device</span>
                      <span className="text-sm font-semibold text-slate-300">
                        {device.device_hostname ?? device.device_name}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-400">Last Seen</span>
                    <span className="text-sm font-mono text-green-400">
                      {new Date(device.last_seen).toLocaleTimeString()}
                    </span>
                  </div>
                  {device.ip_address && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-400">IP Address</span>
                      <span className="text-sm font-mono text-slate-300">
                        {device.ip_address}
                      </span>
                    </div>
                  )}

                  {device.score_per_hour !== undefined && (
                    <div className="pt-2 border-t border-slate-700/50 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-400">Avg Score/Hour</span>
                        <div className="flex items-center gap-2">
                          <span
                            className="text-sm font-bold"
                            style={{
                              color: getThreatColor(device.score_per_hour),
                            }}
                          >
                            {device.score_per_hour.toFixed(1)} pts/h
                          </span>
                          {device.threat_trend && (
                            <span className="text-xs">
                              {device.threat_trend === "up" && "📈"}
                              {device.threat_trend === "down" && "📉"}
                              {device.threat_trend === "stable" && "➡️"}
                            </span>
                          )}
                        </div>
                      </div>
                      {device.historical_threat_levels &&
                        device.historical_threat_levels.length > 1 && (
                          <div className="relative">
                            <MiniSparkline
                              data={device.historical_threat_levels.slice(-20)}
                              color={getThreatColor(device.threat_level || 0)}
                            />
                            <div className="flex justify-between text-xs text-slate-600 mt-1">
                              <span>Activity trend</span>
                              {device.session_duration && (
                                <span>
                                  {Math.floor(device.session_duration / (1000 * 60))}m active
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                    </div>
                  )}

                  <div className="flex justify-end gap-3 text-xs text-slate-500">
                    <span>samples {hourMap[device.device_id]?.total ?? 0}</span>
                    <span>active {hourMap[device.device_id]?.activeMinutes ?? 0} min</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalActivePages > 1 && (
            <div className="flex justify-center items-center gap-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="glass-card px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
              >
                Previous
              </button>
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: Math.min(5, totalActivePages) }, (_, i) => {
                  let pageNum: number;
                  if (totalActivePages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalActivePages - 2) {
                    pageNum = totalActivePages - 4 + i;
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
                onClick={() => setCurrentPage(Math.min(totalActivePages, currentPage + 1))}
                disabled={currentPage === totalActivePages}
                className="glass-card px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}

      {showInactive && inactiveDevices.length > 0 && (
        <section>
          <h2 className="text-2xl font-semibold mb-6 text-slate-400">Inactive Devices</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {inactiveDevices.map((device, idx) => (
              <div
                key={device.device_id}
                className="glass-card p-6 opacity-60 animate-slide-up cursor-pointer hover:opacity-80 transition-opacity"
                style={{ animationDelay: `${idx * 50}ms` }}
                onClick={() => handleSelect(device.device_id)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-300 flex items-center gap-2">
                      {device.device_name}
                      <span className="w-2 h-2 rounded-full bg-slate-500" />
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                      ID: {device.device_id.slice(0, 8)}...
                    </p>
                    {device.player_nickname && (
                      <p className="text-xs text-slate-500 mt-1">
                        Nickname: {device.player_nickname}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500">Last Seen</span>
                    <span className="text-sm font-mono text-slate-500">
                      {new Date(device.last_seen).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 italic">
                    Click to view historical data
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

