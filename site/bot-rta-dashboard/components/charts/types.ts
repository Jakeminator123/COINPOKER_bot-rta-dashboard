/**
 * TypeScript types and interfaces for UnifiedHistoryChart
 */

export type TimePreset =
  | "5m"
  | "1h"
  | "3h"
  | "6h"
  | "12h"
  | "24h"
  | "3d"
  | "7d"
  | "30d";

export type DataType = "threat" | "categories" | "status";

export interface ChartDataPoint {
  timestamp: number;
  label: string;
  threatScore: number;
  categories: Record<string, number>;
  status: Record<string, number>;
}

export interface UnifiedHistoryChartProps {
  deviceId: string | null | undefined;
  deviceData?: {
    session_duration?: number;
    is_online?: boolean;
  } | null;
  snapshotData?: {
    serverTime: number;
    sections: Record<
      string,
      {
        items: Array<{
          timestamp: number;
          status: string;
          category: string;
          name: string;
          device_id?: string;
        }>;
      }
    >;
  } | null;
  onOpenDetailedHistory?: () => void;
}

