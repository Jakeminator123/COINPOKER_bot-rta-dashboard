/**
 * Hook for fetching chart data from APIs
 * Optimized with memoization and error handling
 */

import { useMemo } from "react";
import useSWR from "swr";
import type { TimePreset } from "../types";
import { TIME_PRESETS } from "../constants";

const fetcher = async (url: string) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  } catch (error) {
    console.error(`[useChartData] Fetch error for ${url}:`, error);
    throw error;
  }
};

export function useChartData(
  deviceId: string | null | undefined,
  timePreset: TimePreset,
  deviceData?: { is_online?: boolean } | null,
  _snapshotData?: any
) {
  const timeSeconds = TIME_PRESETS[timePreset].seconds;

  // Memoize API URL calculations
  const { hoursParam, minutesParam, summaryDays } = useMemo(() => {
    const hours = timeSeconds <= 7200
      ? Math.max(1, Math.ceil(timeSeconds / 3600))
      : Math.ceil(timeSeconds / 3600);
    const minutes = timeSeconds <= 7200
      ? Math.max(1, Math.ceil(timeSeconds / 60))
      : undefined;
    const days = Math.max(1, Math.ceil(timeSeconds / 86400));
    
    return {
      hoursParam: hours,
      minutesParam: minutes,
      summaryDays: days,
    };
  }, [timeSeconds]);

  // Memoize API URLs
  const hourlyApiUrl = useMemo(
    () =>
      deviceId
        ? `/api/history/hourly?device=${encodeURIComponent(deviceId)}&hours=${hoursParam}${minutesParam ? `&minutes=${minutesParam}` : ""}`
        : null,
    [deviceId, hoursParam, minutesParam]
  );

  const segmentApiUrl = useMemo(
    () =>
      deviceId
        ? `/api/history/segment?device=${encodeURIComponent(deviceId)}&hours=${Math.ceil(timeSeconds / 3600)}&days=${Math.ceil(timeSeconds / 86400)}`
        : null,
    [deviceId, timeSeconds]
  );

  const segmentSummaryApiUrl = useMemo(
    () =>
      deviceId
        ? `/api/history/segment-summary?device=${encodeURIComponent(deviceId)}&days=${summaryDays}`
        : null,
    [deviceId, summaryDays]
  );

  // Fetch daily data for periods >= 6h, or as fallback when hourly data is empty
  const dailyApiUrl = useMemo(
    () =>
      deviceId && timeSeconds >= 21600
        ? `/api/history?device=${encodeURIComponent(deviceId)}&days=${Math.min(7, Math.ceil(timeSeconds / 86400))}` // Max 7 days (matches Redis TTL)
        : null,
    [deviceId, timeSeconds]
  );

  const hourApiUrl = useMemo(
    () =>
      deviceId && timePreset === "5m" && deviceData?.is_online
        ? `/api/history/hour?device=${encodeURIComponent(deviceId)}&window=${timeSeconds}`
        : null,
    [deviceId, timePreset, deviceData?.is_online, timeSeconds]
  );

  // Fetch hourly aggregates from Redis - always fetch for all periods
  const { data: hourlyData } = useSWR(hourlyApiUrl, fetcher, {
    refreshInterval: 60000,
    dedupingInterval: 5000,
    revalidateOnFocus: false,
    revalidateOnMount: true,
    onError: (error) => {
      console.error("[useChartData] Error fetching hourly data:", error);
    },
  });

  // Fetch segment data for categories
  const { data: segmentData } = useSWR(segmentApiUrl, fetcher, {
    refreshInterval: timePreset === "5m" ? 30000 : 60000,
    dedupingInterval: 10000,
    revalidateOnFocus: false,
    onError: (error) => {
      console.error("[useChartData] Error fetching segment data:", error);
    },
  });

  // Fetch segment summary data
  const { data: segmentSummaryData } = useSWR(segmentSummaryApiUrl, fetcher, {
    refreshInterval: timeSeconds <= 3600 ? 30000 : 60000,
    dedupingInterval: 15000,
    revalidateOnFocus: false,
    onError: (error) => {
      console.error("[useChartData] Error fetching segment summary data:", error);
    },
  });

  // Fetch daily historical data for long periods (24h+) and as fallback for 6h/12h
  const { data: dailyData } = useSWR(dailyApiUrl, fetcher, {
    refreshInterval: 120000,
    dedupingInterval: 60000,
    revalidateOnFocus: false,
    onError: (error) => {
      console.error("[useChartData] Error fetching daily data:", error);
    },
  });

  // For very short periods (5 min), use hour API for real-time data
  const { data: hourData } = useSWR(hourApiUrl, fetcher, {
    refreshInterval: 10000,
    dedupingInterval: 5000,
    onError: (error) => {
      console.error("[useChartData] Error fetching hour data:", error);
    },
  });

  return {
    hourlyData,
    segmentData,
    segmentSummaryData,
    dailyData,
    hourData,
    hourlyApiUrl,
  };
}

