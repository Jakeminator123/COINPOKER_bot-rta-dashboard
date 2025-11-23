'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Device = {
  device_id: string;
  device_name: string;
  last_seen: number;
  signal_count: number;
  threat_level?: number;
  score_per_hour?: number;
  ip_address?: string;
};

type PlayerSelectionModalProps = {
  isOpen: boolean;
  onClose: () => void;
  devices: Device[];
};

function getThreatColor(level: number): string {
  if (level >= 75) return '#dc2626'; // red-600
  if (level >= 50) return '#f97316'; // orange-500
  if (level >= 25) return '#eab308'; // yellow-500
  return '#22c55e'; // green-500
}

function getThreatLabel(level: number): string {
  if (level >= 75) return 'CRITICAL';
  if (level >= 50) return 'HIGH';
  if (level >= 25) return 'MEDIUM';
  return 'LOW';
}

export default function PlayerSelectionModal({ isOpen, onClose, devices }: PlayerSelectionModalProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredDevices, setFilteredDevices] = useState<Device[]>([]);
  const [hoveredDevice, setHoveredDevice] = useState<string | null>(null);

  // Filter devices based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredDevices(devices);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredDevices(
        devices.filter(
          (device) =>
            device.device_name.toLowerCase().includes(query) ||
            device.device_id.toLowerCase().includes(query) ||
            device.ip_address?.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, devices]);

  // Sort by threat level (highest first)
  const sortedDevices = [...filteredDevices].sort(
    (a, b) => (b.threat_level || 0) - (a.threat_level || 0)
  );

  const handleDeviceClick = (deviceId: string) => {
    router.push(`/dashboard?device=${deviceId}`);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal Container */}
      <div
        className="relative w-full max-w-4xl max-h-[90vh] glass-card rounded-2xl overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 p-6 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gradient">Select Player</h2>
              <p className="text-sm text-slate-400 mt-1">
                {filteredDevices.length} of {devices.length} devices
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-all hover:scale-110 p-2"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search by name, ID, or IP address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              autoFocus
            />
            <svg
              className="absolute right-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {/* Device Grid */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
          {sortedDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-semibold text-slate-400 mb-2">No devices found</h3>
              <p className="text-sm text-slate-500">
                {searchQuery ? 'Try a different search term' : 'No devices available'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedDevices.map((device, idx) => {
                const threatColor = getThreatColor(device.threat_level || 0);
                const isActive = Date.now() - device.last_seen < 60000; // Active if seen in last minute

                return (
                  <div
                    key={device.device_id}
                    className="glass-card p-5 cursor-pointer transition-all duration-300 animate-slide-up hover:scale-105"
                    style={{
                      animationDelay: `${idx * 30}ms`,
                      boxShadow:
                        hoveredDevice === device.device_id
                          ? `0 8px 16px ${threatColor}40`
                          : undefined,
                      border:
                        hoveredDevice === device.device_id
                          ? `1px solid ${threatColor}60`
                          : undefined,
                    }}
                    onClick={() => handleDeviceClick(device.device_id)}
                    onMouseEnter={() => setHoveredDevice(device.device_id)}
                    onMouseLeave={() => setHoveredDevice(null)}
                  >
                    {/* Device Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-semibold text-white truncate">
                            {device.device_name}
                          </h3>
                          {isActive && (
                            <span className="relative flex h-2 w-2 flex-shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 font-mono truncate">
                          {device.device_id.slice(0, 12)}...
                        </p>
                      </div>

                      {/* Threat Badge */}
                      {device.threat_level !== undefined && (
                        <div
                          className="px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0"
                          style={{
                            backgroundColor: `${threatColor}20`,
                            color: threatColor,
                            border: `1px solid ${threatColor}40`,
                          }}
                        >
                          {device.threat_level}%
                        </div>
                      )}
                    </div>

                    {/* Device Stats */}
                    <div className="space-y-2 pt-3 border-t border-slate-700/50">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-400">Last Seen</span>
                        <span className="text-xs font-mono text-slate-300">
                          {new Date(device.last_seen).toLocaleTimeString()}
                        </span>
                      </div>

                      {device.ip_address && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-slate-400">IP Address</span>
                          <span className="text-xs font-mono text-slate-300 truncate max-w-[120px]">
                            {device.ip_address}
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-400">Signals</span>
                        <span className="text-xs font-semibold text-cyan-400">
                          {device.signal_count}
                        </span>
                      </div>

                      {device.score_per_hour !== undefined && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-slate-400">Score/Hour</span>
                          <span
                            className="text-xs font-bold"
                            style={{ color: threatColor }}
                          >
                            {device.score_per_hour.toFixed(1)} pts/h
                          </span>
                        </div>
                      )}

                      {/* Threat Level Indicator */}
                      {device.threat_level !== undefined && (
                        <div className="pt-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-400">Threat Level</span>
                            <span className="text-xs font-semibold" style={{ color: threatColor }}>
                              {getThreatLabel(device.threat_level)}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full transition-all duration-300 rounded-full"
                              style={{
                                width: `${device.threat_level}%`,
                                backgroundColor: threatColor,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Click Indicator */}
                    <div className="mt-3 pt-3 border-t border-slate-700/50">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Click to view details →</span>
                        <svg
                          className={`w-4 h-4 transition-transform ${
                            hoveredDevice === device.device_id ? 'translate-x-1' : ''
                          }`}
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
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 p-4 border-t border-slate-700/50 bg-slate-900/80 backdrop-blur-sm">
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>
              {sortedDevices.length === 1
                ? '1 device selected'
                : `${sortedDevices.length} devices available`}
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm glass-card hover:bg-slate-700/50 rounded-lg transition-all"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

