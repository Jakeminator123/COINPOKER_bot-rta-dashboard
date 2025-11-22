import { Signal, Stored } from "@/lib/sections";

export interface AggregateSegmentStats {
  critical: number;
  alert: number;
  warn: number;
  total_points: number;
}

export interface AggregatePoint {
  hour: string;
  timestamp: number;
  segments: Record<string, AggregateSegmentStats>;
  total_points: number;
  avg_score: number;
  avg_bot_probability?: number;
  sample_count: number;
  active_minutes: number;
}

export interface DeviceListEntry {
  device_id: string;
  device_name: string;
  last_seen: number;
  signal_count: number;
  unique_detection_count: number;
  threat_level?: number;
  is_online?: boolean;
  status_message?: string;
  status_color?: string;
  ip_address?: string;
  historical_threat_levels?: number[];
  session_start?: number;
  session_duration?: number;
  threat_trend?: "up" | "down" | "stable";
}

/**
 * Storage adapter interface for signal storage.
 * Supports both in-memory and Redis implementations.
 */
export interface StorageAdapter {
  /**
   * Add a single signal to storage
   */
  addSignal(sig: Signal): Promise<void>;

  /**
   * Add multiple signals to storage
   */
  addSignals(sigs: Signal[]): Promise<void>;

  /**
   * Get snapshot of all signals, optionally filtered by device
   */
  getSnapshot(device_id?: string): Promise<{
    serverTime: number;
    sections: Record<string, { items: Stored[] }>;
  }>;

  /**
   * Get cached snapshot (instant if available, top 20 devices)
   */
  getCachedSnapshot?(device_id: string): Promise<{
    serverTime: number;
    sections: Record<string, { items: Stored[] }>;
    cached?: boolean;
  } | null>;

  /**
   * Get hourly aggregation data with segment breakdown
   */
  getHourlyAggregates?(
    device_id: string,
    hours?: number,
    minutesOverride?: number
  ): Promise<AggregatePoint[]>;

  /**
   * Get minute aggregation data
   */
  getMinuteAggregates?(device_id: string, minutes?: number): Promise<
    Array<
      AggregatePoint & {
        hour: string;
      }
    >
  >;

  /**
   * Get list of active devices
   */
  getDevices(): Promise<{
    devices: DeviceListEntry[];
    total: number;
  }>;

  /**
   * Get cached devices list (instant if available, for homepage)
   */
  getCachedDevicesList?(): Promise<{
    devices: DeviceListEntry[];
    total: number;
    cached?: boolean;
  } | null>;

  /**
   * Get global statistics (optimized for large datasets)
   */
  getGlobalStats?(): Promise<{
    totalPlayers: number;
    onlinePlayers: number;
    highRiskPlayers: number;
    avgThreatLevel: number;
  }>;
}
