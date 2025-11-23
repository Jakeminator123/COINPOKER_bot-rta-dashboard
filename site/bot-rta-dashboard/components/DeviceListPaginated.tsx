"use client";

import { useState, useEffect, useCallback } from "react";
import { DeviceRecord } from "@/lib/types";
import useSWR from "swr";

interface PaginatedResponse {
  devices: DeviceRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

interface DeviceListPaginatedProps {
  onDeviceSelect?: (deviceId: string) => void;
  pageSize?: number;
  includeOffline?: boolean;
  sortBy?: "threat" | "last_seen";
}

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function DeviceListPaginated({
  onDeviceSelect,
  pageSize = 20,
  includeOffline = true,
  sortBy = "threat"
}: DeviceListPaginatedProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Build API URL with parameters
  const apiUrl = `/api/devices/paginated?page=${currentPage}&pageSize=${pageSize}&includeOffline=${includeOffline}&sortBy=${sortBy}`;
  
  // Fetch data with SWR for caching and revalidation
  const { data, error, isLoading, mutate } = useSWR<PaginatedResponse>(
    apiUrl,
    fetcher,
    {
      refreshInterval: 15000, // Refresh every 15 seconds
      revalidateOnFocus: true,
    }
  );
  
  // Filter devices client-side for search
  const filteredDevices = data?.devices.filter(device => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      device.device_name?.toLowerCase().includes(query) ||
      device.player_nickname?.toLowerCase().includes(query) ||
      device.device_id?.toLowerCase().includes(query) ||
      device.ip_address?.toLowerCase().includes(query)
    );
  }) || [];
  
  const totalPages = Math.ceil((data?.total || 0) / pageSize);
  
  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };
  
  const getThreatColor = (threat: number) => {
    if (threat >= 75) return "text-red-500";
    if (threat >= 50) return "text-orange-500";
    if (threat >= 25) return "text-yellow-500";
    return "text-green-500";
  };
  
  const getStatusColor = (isOnline: boolean) => {
    return isOnline ? "bg-green-500" : "bg-slate-500";
  };
  
  if (isLoading) {
    return (
      <div className="glass-card p-12 flex flex-col items-center justify-center">
        <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        <p className="text-white/60 mt-4">Loading devices...</p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="glass-card p-12 text-center">
        <div className="text-6xl mb-4">⚠️</div>
        <h3 className="text-xl font-semibold text-white mb-2">Error loading devices</h3>
        <p className="text-slate-400">{error.message}</p>
        <button 
          onClick={() => mutate()}
          className="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }
  
  if (!data?.devices.length) {
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
      {/* Search and Info Bar */}
      <div className="glass-card p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <input
            type="text"
            placeholder="Search devices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500"
          />
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span>Total: {data.total} devices</span>
            <span>Page {currentPage} of {totalPages}</span>
          </div>
        </div>
      </div>
      
      {/* Device Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredDevices.map((device) => (
          <div
            key={device.device_id}
            onClick={() => onDeviceSelect?.(device.device_id)}
            className="glass-card p-6 cursor-pointer hover:bg-slate-800/50 transition-all animate-slide-up"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  {device.device_name}
                  <span className={`w-2 h-2 rounded-full ${getStatusColor(device.is_online)}`} />
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  ID: {device.device_id.slice(0, 8)}...
                </p>
                {device.player_nickname && (
                  <p className="text-sm text-cyan-400 mt-1">
                    {device.player_nickname}
                  </p>
                )}
              </div>
            </div>
            
            {/* Stats */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">Threat</span>
                <span className={`text-sm font-bold ${getThreatColor(device.threat_level || 0)}`}>
                  {device.threat_level || 0}%
                </span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">Status</span>
                <span className={`text-sm ${device.is_online ? 'text-green-400' : 'text-slate-400'}`}>
                  {device.is_online ? 'Online' : 'Offline'}
                </span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">Last Seen</span>
                <span className="text-xs text-slate-400">
                  {new Date(device.last_seen).toLocaleString()}
                </span>
              </div>
              
              {device.signal_count > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Signals</span>
                  <span className="text-sm text-slate-400">
                    {device.signal_count}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          <button
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            First
          </button>
          
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Previous
          </button>
          
          {/* Page numbers */}
          <div className="flex gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pageNum = Math.max(1, Math.min(currentPage - 2 + i, totalPages - 4)) + i;
              if (pageNum > totalPages) return null;
              return (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                  className={`px-3 py-2 rounded-lg transition-colors ${
                    currentPage === pageNum
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                  }`}
                >
                  {pageNum}
                </button>
              );
            }).filter(Boolean)}
          </div>
          
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={!data?.hasMore}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Next
          </button>
          
          <button
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Last
          </button>
        </div>
      )}
    </div>
  );
}
