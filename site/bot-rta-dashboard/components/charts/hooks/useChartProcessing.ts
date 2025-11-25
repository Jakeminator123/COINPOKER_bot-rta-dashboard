/**
 * Hook for processing and transforming chart data
 * Optimized for performance, robustness, and maintainability
 */

import { useEffect, useState, useMemo } from "react";
import type { ChartDataPoint, TimePreset } from "../types";
import { TIME_PRESETS, CATEGORY_COLORS } from "../constants";
import { TIME_WINDOWS } from "@/lib/detections/threat-scoring";

interface UseChartProcessingProps {
  deviceId: string | null | undefined;
  timePreset: TimePreset;
  deviceData?: { is_online?: boolean } | null;
  snapshotData?: any;
  hourlyData?: any;
  segmentData?: any;
  segmentSummaryData?: any;
  dailyData?: any;
  hourData?: any;
}

// Constants for better maintainability
const DEBUG_MODE = process.env.NODE_ENV === "development";
const TIME_WINDOW_TOLERANCE_6H_12H = 3600; // 1 hour tolerance for 6h/12h
const DAILY_TIME_TOLERANCE = 86400; // 1 day tolerance for periods < 24h
const START_END_POINT_TOLERANCE = 5; // 5 seconds tolerance for start/end points
const MAX_INTERPOLATION_POINTS = 50;
const MIN_HOURLY_POINTS_6H_12H = 3;
const MIN_HOURLY_POINTS_24H_3D = 5;
const MIN_HOURLY_POINTS_7D = 5;

// Helper function for safe logging (only in development)
const debugLog = (...args: any[]) => {
  if (DEBUG_MODE) {
    console.log(...args);
  }
};

const debugWarn = (...args: any[]) => {
  if (DEBUG_MODE) {
    console.warn(...args);
  }
};

const BASE_CATEGORIES = Object.keys(CATEGORY_COLORS);

// Helper: make sure alla kategorier finns även om poängen är 0.
// Det gör att grafen aldrig tappar en färg bara för att senaste batchen saknade den.
const ensureCategoryBaselines = (categories: Record<string, number> = {}) => {
  const normalized: Record<string, number> = { ...categories };
  BASE_CATEGORIES.forEach((cat) => {
    if (normalized[cat] === undefined) {
      normalized[cat] = 0;
    }
  });
  return normalized;
};

// Helper function to parse timestamp safely
function parseTimestamp(hour: any): { timestamp: number; date: Date } {
  if (hour.timestamp && typeof hour.timestamp === "number" && hour.timestamp > 1000000000) {
    return {
      timestamp: hour.timestamp,
      date: new Date(hour.timestamp * 1000),
    };
  }

  if (hour.hour) {
    let date = new Date(hour.hour + ":00");
    if (isNaN(date.getTime())) {
      const parts = hour.hour.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
      if (parts) {
        date = new Date(
          parseInt(parts[1], 10),
          parseInt(parts[2], 10) - 1,
          parseInt(parts[3], 10),
          parseInt(parts[4], 10),
          parseInt(parts[5], 10)
        );
      } else {
        date = new Date(Date.now() - 3600000);
      }
    }
    return {
      timestamp: Math.floor(date.getTime() / 1000),
      date,
    };
  }

  const fallbackDate = new Date(Date.now() - 3600000);
  return {
    timestamp: Math.floor(fallbackDate.getTime() / 1000),
    date: fallbackDate,
  };
}

// Helper function to format label based on time preset
function formatLabel(date: Date, timePreset: TimePreset): string {
  if (timePreset === "5m" || timePreset === "1h" || timePreset === "3h") {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (timePreset === "6h" || timePreset === "12h") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (timePreset === "24h" || timePreset === "3d") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Helper function to calculate threat score from bot probability
function calculateThreatScore(botProbability: number | string | undefined, fallback: number = 0): number {
  const prob = typeof botProbability === "number" ? botProbability : parseFloat(String(botProbability || "0")) || 0;
  return Math.min(100, Math.max(0, prob || fallback));
}

// Helper function to get interpolation interval based on time preset
function getInterpolationInterval(timePreset: TimePreset): number {
  switch (timePreset) {
    case "5m":
      return 10; // 10 seconds
    case "1h":
      return 30; // 30 seconds
    case "3h":
      return 60; // 60 seconds
    case "6h":
    case "12h":
      return 1800; // 30 minutes
    case "24h":
    case "3d":
      return 3600; // 1 hour
    case "7d":
      return 21600; // 6 hours
    default:
      return 86400; // 1 day for 30d+
  }
}

export function useChartProcessing({
  deviceId,
  timePreset,
  deviceData,
  snapshotData,
  hourlyData,
  segmentData,
  segmentSummaryData,
  dailyData,
  hourData,
}: UseChartProcessingProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const timeSeconds = TIME_PRESETS[timePreset].seconds;

  // Memoize time window calculations
  const { now, windowStart } = useMemo(() => {
    const currentTime = Date.now() / 1000;
    return {
      now: currentTime,
      windowStart: currentTime - timeSeconds,
    };
  }, [timeSeconds]);

  useEffect(() => {
    if (!deviceId) {
      setChartData([]);
      setLoading(false);
      setIsInitialLoad(false);
      return;
    }

    if (!isInitialLoad) {
      setLoading(true);
    }
    setError(null);

    try {
      const timeMap = new Map<number, ChartDataPoint>();

      // Process hourly aggregates for threat scores (from Redis)
      const hasHourlyData = hourlyData?.ok && Array.isArray(hourlyData.data?.hours) && hourlyData.data.hours.length > 0;

      debugLog(`[useChartProcessing] Processing for ${timePreset}, device: ${deviceId}`);

      if (hasHourlyData) {
        const timeWindowTolerance =
          timePreset === "6h" || timePreset === "12h" ? TIME_WINDOW_TOLERANCE_6H_12H : 0;

        for (const hour of hourlyData.data.hours) {
          try {
            const { timestamp, date } = parseTimestamp(hour);
            const label = formatLabel(date, timePreset);

            // Use avg_bot_probability if available (now linear, matches Threat Meter)
            // Both avg_bot_probability and avg_score use the same linear calculation
            const threatScore = calculateThreatScore(hour.avg_bot_probability, parseFloat(String(hour.avg_score || "0")) || 0);

            // Process category data as percentage contribution to bot_probability
            // Normalize raw category scores to sum to threatScore (bot_probability)
            const categoryData: Record<string, number> = {};
            if (hour.segments && typeof hour.segments === "object") {
              // First, collect raw category scores
              const rawCategoryScores: Record<string, number> = {};
              let totalRawScore = 0;
              
              Object.entries(hour.segments).forEach(([category, segmentData]: [string, any]) => {
                if (segmentData && typeof segmentData === "object") {
                  const avgScore =
                    parseInt(String(segmentData.avg_score || "0"), 10) ||
                    parseInt(String(segmentData.critical || "0"), 10) * 15 +
                      parseInt(String(segmentData.alert || "0"), 10) * 10 +
                      parseInt(String(segmentData.warn || "0"), 10) * 5;
                  rawCategoryScores[category] = avgScore;
                  totalRawScore += avgScore;
                }
              });

              // Normalize to percentage of bot_probability
              // If totalRawScore > 0, distribute threatScore proportionally
              // Otherwise, all categories get 0
              if (totalRawScore > 0 && threatScore > 0) {
                Object.entries(rawCategoryScores).forEach(([category, rawScore]) => {
                  // Calculate this category's contribution as percentage of bot_probability
                  categoryData[category] = Math.round((rawScore / totalRawScore) * threatScore);
                });
              }
            }

            // Check if within time window (with tolerance for 6h/12h)
            const isInWindow =
              timestamp >= windowStart - timeWindowTolerance && timestamp <= now + timeWindowTolerance;

            if (isInWindow) {
              if (!timeMap.has(timestamp)) {
                timeMap.set(timestamp, {
                  timestamp,
                  label,
                  threatScore,
                  categories: categoryData,
                  status: {},
                });
              } else {
                const entry = timeMap.get(timestamp)!;
                entry.threatScore = Math.max(entry.threatScore, threatScore);
                entry.categories = { ...entry.categories, ...categoryData };
              }
            }
          } catch (err) {
            debugWarn(`[useChartProcessing] Error processing hour data:`, err);
          }
        }
        debugLog(`[useChartProcessing] Processed ${timeMap.size} hourly data points`);
      }

      // Process daily historical data
      // For 6h+, always try to use daily data as supplement/fallback
      // Daily data is more reliable for longer periods
      if (
        dailyData?.ok &&
        Array.isArray(dailyData.data?.data) &&
        dailyData.data.data.length > 0 &&
        timeSeconds >= 21600 // 6 hours or more
      ) {
        // For 6h/12h: ALWAYS use daily data if hourly data is sparse or missing
        // For 24h+: use daily data if hourly data is sparse
        const shouldUseDailyData =
          !hasHourlyData ||
          timeMap.size === 0 ||
          (timeSeconds >= 21600 && timeSeconds < 86400 && timeMap.size < MIN_HOURLY_POINTS_6H_12H) ||
          (timeSeconds >= 86400 && timeSeconds < 604800 && timeMap.size < MIN_HOURLY_POINTS_24H_3D) ||
          (timeSeconds >= 604800 && timeMap.size < MIN_HOURLY_POINTS_7D); // Max 7 days (matches Redis TTL)

        if (shouldUseDailyData) {
          // For 6h/12h, be very lenient with time window (include today's data even if slightly outside)
          // For 24h+, use normal tolerance
          const dailyTimeTolerance = timeSeconds < 86400 ? DAILY_TIME_TOLERANCE : 0;
          let addedPoints = 0;

          debugLog(`[useChartProcessing] Using daily data for ${timePreset} (hasHourlyData: ${hasHourlyData}, hourlyPoints: ${timeMap.size}, dailyDataPoints: ${dailyData.data.data.length})`);

          for (const day of dailyData.data.data) {
            try {
              if (!day?.day) continue;

              const dayDate = new Date(day.day + "T00:00:00");
              if (isNaN(dayDate.getTime())) continue;

              const timestamp = Math.floor(dayDate.getTime() / 1000);

              // Filter by time window with tolerance
              // For 6h/12h, include today's data even if it's slightly outside the exact window
              if (timestamp < windowStart - dailyTimeTolerance || timestamp > now + dailyTimeTolerance) {
                continue;
              }

              // Use avg_bot_probability if available (now linear, matches Threat Meter)
              // Both avg_bot_probability and avg_score use the same linear calculation
              const threatScore = calculateThreatScore(
                day.avg_bot_probability,
                parseFloat(String(day.avg_score || "0")) ||
                  (parseInt(String(day.by_status?.CRITICAL || "0"), 10) * 15 +
                    parseInt(String(day.by_status?.ALERT || "0"), 10) * 10 +
                    parseInt(String(day.by_status?.WARN || "0"), 10) * 5)
              );

              // Normalize category data to percentage contribution to bot_probability
              let normalizedCategories = day.by_category || {};
              if (day.by_category && threatScore > 0) {
                const totalRawScore = Object.values(day.by_category).reduce(
                  (sum: number, val: any) => sum + (typeof val === 'number' ? val : 0),
                  0
                );
                if (totalRawScore > 0) {
                  normalizedCategories = {};
                  Object.entries(day.by_category).forEach(([category, rawScore]: [string, any]) => {
                    if (typeof rawScore === 'number') {
                      normalizedCategories[category] = Math.round((rawScore / totalRawScore) * threatScore);
                    }
                  });
                }
              }

              // For periods shorter than 24h (6h/12h), create multiple points throughout the day
              // This fills gaps when hourly data is sparse
              if (timeSeconds < 86400) {
                const dayStart = Math.floor(dayDate.getTime() / 1000);
                const intervalHours = timeSeconds < 21600 ? 1 : 2; // 1 hour for 6h, 2 hours for 12h
                const windowStartHour = Math.max(0, Math.floor((windowStart - dayStart) / 3600));
                const windowEndHour = Math.min(24, Math.ceil((now - dayStart) / 3600));

                // Ensure we create at least some points even if window calculation is off
                const effectiveStartHour = Math.max(0, windowStartHour - 1); // Add 1 hour buffer
                const effectiveEndHour = Math.min(24, windowEndHour + 1); // Add 1 hour buffer

                for (let hour = effectiveStartHour; hour < effectiveEndHour; hour += intervalHours) {
                  const hourTimestamp = dayStart + hour * 3600;
                  
                  // Double-check it's within time window (with tolerance)
                  if (hourTimestamp < windowStart - dailyTimeTolerance || hourTimestamp > now + dailyTimeTolerance) {
                    continue;
                  }

                  const hourLabel = new Date(hourTimestamp * 1000).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                  });

                    if (!timeMap.has(hourTimestamp)) {
                      timeMap.set(hourTimestamp, {
                        timestamp: hourTimestamp,
                        label: hourLabel,
                        threatScore,
                        categories: normalizedCategories,
                        status: day.by_status || {},
                      });
                      addedPoints++;
                    } else {
                      const entry = timeMap.get(hourTimestamp)!;
                      // Prefer daily data if it has a higher score or if no hourly data exists
                      if (!hasHourlyData || threatScore > entry.threatScore) {
                        entry.threatScore = Math.max(entry.threatScore, threatScore);
                        // Update categories when we update threatScore to keep them in sync
                        entry.categories = normalizedCategories;
                      }
                      entry.status = { ...entry.status, ...(day.by_status || {}) };
                    }
                }
              } else {
                // For 24h+, use daily data as-is
                const label = dayDate.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                });

                if (!timeMap.has(timestamp)) {
                  timeMap.set(timestamp, {
                    timestamp,
                    label,
                    threatScore,
                    categories: normalizedCategories,
                    status: day.by_status || {},
                  });
                  addedPoints++;
                } else {
                  const entry = timeMap.get(timestamp)!;
                  // Prefer daily data if it has a higher score or if no hourly data exists
                  if (!hasHourlyData || threatScore > entry.threatScore) {
                    entry.threatScore = Math.max(entry.threatScore, threatScore);
                    // Update categories when we update threatScore to keep them in sync
                    entry.categories = normalizedCategories;
                  }
                  entry.status = { ...entry.status, ...(day.by_status || {}) };
                }
              }
            } catch (err) {
              debugWarn(`[useChartProcessing] Error processing daily data:`, err);
            }
          }

          debugLog(`[useChartProcessing] Added ${addedPoints} daily data points, total: ${timeMap.size}`);
        }
      }
      // Removed excessive warning logging for 6h/12h - only log if truly problematic
      // (dailyDataOk: true but dailyDataLength: 0 is normal if no data exists yet)

      // Process snapshot data for short periods
      if (
        snapshotData &&
        (timePreset === "5m" || timePreset === "1h" || timePreset === "3h") &&
        deviceData?.is_online !== false &&
        (!hasHourlyData || timeMap.size === 0 || (timePreset === "5m" && timeMap.size < 3) || (timePreset === "1h" && timeMap.size < 5))
      ) {
        try {
          const snapshotNow = snapshotData.serverTime || now;
          const snapshotNowMs = typeof snapshotNow === "number" && snapshotNow > 1000000000 ? snapshotNow * 1000 : Date.now();
          const windowMs = timeSeconds * 1000;
          const snapshotWindowStart = snapshotNowMs - windowMs;

          const getThreatValue = (status: string): number => {
            switch (status) {
              case "CRITICAL":
                return 15;
              case "ALERT":
                return 10;
              case "WARN":
                return 5;
              default:
                return 0;
            }
          };

          const intervalSeconds = timePreset === "5m" ? 30 : timePreset === "1h" ? 60 : 180;
          const intervalMap = new Map<
            number,
            {
              threatPoints: number[];
              botProbabilities: number[];
              categories: Record<string, number>;
              status: Record<string, number>;
            }
          >();

          const allItems = Object.entries(snapshotData.sections || {})
            .filter(([key]) => key !== "system_reports")
            .flatMap(([, section]) => {
              const sectionData = section as { items?: any[] } | undefined;
              return (sectionData?.items || []) as any[];
            });

          const filteredByDevice = allItems.filter((item: any) => {
            if (!item?.device_id || !deviceId) return false;
            return (
              item.device_id === deviceId ||
              item.device_id.startsWith(deviceId) ||
              deviceId.startsWith(item.device_id.substring(0, 8))
            );
          });

          const filteredByTime = filteredByDevice.filter((item: any) => {
            const itemTimestamp = typeof item.timestamp === "number" ? item.timestamp : 0;
            const itemMs = itemTimestamp > 1000000000 ? itemTimestamp * 1000 : itemTimestamp;
            return itemMs >= snapshotWindowStart && itemMs <= snapshotNowMs;
          });

          filteredByTime.forEach((item: any) => {
            const itemTimestamp = typeof item.timestamp === "number" ? item.timestamp : 0;
            const interval = Math.floor(itemTimestamp / intervalSeconds) * intervalSeconds;

            if (!intervalMap.has(interval)) {
              intervalMap.set(interval, {
                threatPoints: [],
                botProbabilities: [],
                categories: {},
                status: {},
              });
            }

            const entry = intervalMap.get(interval)!;

            if (typeof item.bot_probability === "number") {
              const botProb = item.bot_probability <= 1 ? item.bot_probability * 100 : item.bot_probability;
              entry.botProbabilities.push(Math.round(botProb));
            } else {
              entry.threatPoints.push(getThreatValue(item.status || "INFO"));
            }

            const category = item.category || item.section?.split("_")[0] || "unknown";
            entry.categories[category] = (entry.categories[category] || 0) + 1;
            entry.status[item.status || "INFO"] = (entry.status[item.status || "INFO"] || 0) + 1;
          });

          intervalMap.forEach((data, interval) => {
            const timestamp = interval;
            const date = new Date(timestamp * 1000);
            const label = date.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            let threatScore = 0;
            if (data.botProbabilities.length > 0) {
              const avgBotProb = data.botProbabilities.reduce((sum, p) => sum + p, 0) / data.botProbabilities.length;
              threatScore = Math.min(100, Math.round(avgBotProb));
            } else if (data.threatPoints.length > 0) {
              const totalPoints = data.threatPoints.reduce((sum, p) => sum + p, 0);
              threatScore = Math.min(100, totalPoints);
            }

            // Normalize category scores to percentage contribution to bot_probability
            // Count detections per category, then normalize to threatScore
            const categoryScores: Record<string, number> = {};
            const totalDetections = Object.values(data.categories).reduce(
              (sum, count) => sum + Number(count),
              0
            );
            
            if (totalDetections > 0 && threatScore > 0) {
              Object.entries(data.categories).forEach(([cat, count]) => {
                // Distribute threatScore proportionally based on detection count
                categoryScores[cat] = Math.round((Number(count) / totalDetections) * threatScore);
              });
            }

            if (!timeMap.has(timestamp)) {
              timeMap.set(timestamp, {
                timestamp,
                label,
                threatScore,
                categories: categoryScores,
                status: data.status,
              });
            } else {
              const entry = timeMap.get(timestamp)!;
              entry.threatScore = Math.max(entry.threatScore, threatScore);
              entry.categories = { ...entry.categories, ...categoryScores };
              entry.status = { ...entry.status, ...data.status };
            }
          });

          debugLog(`[useChartProcessing] Created ${intervalMap.size} intervals from snapshot data`);
        } catch (err) {
          debugWarn(`[useChartProcessing] Error processing snapshot data:`, err);
        }
      }

      // Process hour data for 5 min period (fallback)
      if (hourData?.ok && hourData.data && timePreset === "5m" && timeMap.size === 0) {
        try {
          const timestamp = Math.floor(now);
          const date = new Date();
          const label = date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          });

          const threatValue = Number(hourData.data.avg || 0);

          if (!timeMap.has(timestamp)) {
            timeMap.set(timestamp, {
              timestamp,
              label,
              threatScore: Math.min(100, Math.max(0, threatValue)),
              categories: {},
              status: {},
            });
          } else {
            timeMap.get(timestamp)!.threatScore = Math.min(100, Math.max(0, threatValue));
          }
        } catch (err) {
          debugWarn(`[useChartProcessing] Error processing hour data:`, err);
        }
      }

      // Process segment data for categories (detaljer per kategori)
      if (segmentData?.ok && Array.isArray(segmentData.data?.data)) {
        try {
          for (const item of segmentData.data.data) {
            if (!item?.timestamp || item.timestamp < windowStart || item.timestamp > now) {
              continue;
            }

            const category = item.category || "unknown";

            if (!timeMap.has(item.timestamp)) {
              const date = new Date(item.timestamp * 1000);
              const label =
                timePreset === "5m" || timePreset === "1h"
                  ? date.toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });

              timeMap.set(item.timestamp, {
                timestamp: item.timestamp,
                label,
                threatScore: 0,
                categories: {},
                status: {},
              });
            }

            const entry = timeMap.get(item.timestamp)!;
            // Note: Segment data doesn't have bot_probability, so we can't normalize here
            // This will be normalized later when we process all points
            const normalizedScore = Number(item.avg_score || 0);
            entry.categories[category] =
              (entry.categories[category] || 0) + normalizedScore;
          }
        } catch (err) {
          debugWarn(`[useChartProcessing] Error processing segment data:`, err);
        }
      }

      // Fallback: use segment summary daily breakdowns
      if (
        timeMap.size === 0 &&
        segmentSummaryData?.ok &&
        Array.isArray(segmentSummaryData.data?.segments) &&
        segmentSummaryData.data.segments.length > 0 &&
        timeSeconds >= 86400
      ) {
        try {
          const fallbackSegments = segmentSummaryData.data.segments;

          fallbackSegments.forEach((segment: any) => {
            if (Array.isArray(segment.daily_breakdown) && segment.daily_breakdown.length > 0) {
              segment.daily_breakdown.forEach((day: any) => {
                if (!day?.day) return;
                const date = new Date(day.day + "T00:00:00");
                if (isNaN(date.getTime())) return;

                const timestamp = Math.floor(date.getTime() / 1000);
                if (timestamp < windowStart || timestamp > now) return;

                const label = date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                });

                if (!timeMap.has(timestamp)) {
                  timeMap.set(timestamp, {
                    timestamp,
                    label,
                    threatScore: 0,
                    categories: {},
                    status: {},
                  });
                }

                const entry = timeMap.get(timestamp)!;
                const mainCategory = segment.category || "unknown";
                const avgScore = typeof day.avg_score === "number" ? day.avg_score : 0;
                entry.categories[mainCategory] =
                  (entry.categories[mainCategory] || 0) + avgScore;
                entry.threatScore = Math.max(entry.threatScore, avgScore);
              });
            }
          });
        } catch (err) {
          debugWarn(`[useChartProcessing] Error processing fallback segments:`, err);
        }
      }

      // Normalize all category scores to sum to threatScore (bot_probability)
      // This ensures categories represent percentage contribution to total bot detection
      const normalizedPoints = Array.from(timeMap.values()).map((point) => {
        const totalCategoryScore = Object.values(point.categories).reduce(
          (sum, val) => sum + (typeof val === 'number' ? val : 0),
          0
        );
        
        let normalizedCategories = { ...point.categories };
        if (totalCategoryScore > 0 && point.threatScore > 0) {
          normalizedCategories = {};
          Object.entries(point.categories).forEach(([category, rawScore]) => {
            if (typeof rawScore === 'number' && rawScore > 0) {
              normalizedCategories[category] = Math.round((rawScore / totalCategoryScore) * point.threatScore);
            } else {
              normalizedCategories[category] = 0;
            }
          });
        } else {
          // If no category data or no threat score, set all to 0
          normalizedCategories = {};
        }
        
        return {
          ...point,
          categories: ensureCategoryBaselines(normalizedCategories),
        };
      });

      // Konvertera till array och säkerställ att varje punkt har full kategori-baseline
      let sorted = normalizedPoints.sort((a, b) => a.timestamp - b.timestamp);

      // For ALL periods, ensure we have start and end points
      // This prevents empty gaps at the beginning of the chart
      if (sorted.length > 0) {
        const firstPoint = sorted[0];
        const lastPoint = sorted[sorted.length - 1];

        // Add start point if window starts before first data point (avoids vertical jumps)
        // Now applies to ALL time periods, not just short ones
        if (firstPoint.timestamp > windowStart + START_END_POINT_TOLERANCE) {
          // Format label based on time preset
          const startLabel = 
            timePreset === "5m" || timePreset === "1h" || timePreset === "3h"
              ? new Date(windowStart * 1000).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : timePreset === "6h" || timePreset === "12h" || timePreset === "24h" || timePreset === "3d"
                ? new Date(windowStart * 1000).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                  })
                : new Date(windowStart * 1000).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });

          // Use 0 as baseline for start if first point is much later (shows the trend from start)
          // But if first point is relatively close to start, use its value for continuity
          const timeDiff = firstPoint.timestamp - windowStart;
          const useZeroBaseline = timeDiff > timeSeconds * 0.3; // If first point is >30% into window, use 0

          sorted.unshift({
            timestamp: windowStart,
            label: startLabel,
            threatScore: useZeroBaseline ? 0 : firstPoint.threatScore,
            categories: ensureCategoryBaselines(useZeroBaseline ? {} : firstPoint.categories),
            status: {},
          });
        }

        // For the end point, use real-time data from snapshotData if available
        // This ensures the chart shows the same value as Bot Probability
        // Apply to all periods, but only if last point is recent (within 5 minutes)
        const shouldUpdateEndPoint = lastPoint.timestamp < now - START_END_POINT_TOLERANCE;
        const isRecentPoint = (now - lastPoint.timestamp) < 300; // Within 5 minutes

        if (shouldUpdateEndPoint && isRecentPoint) {
          const endLabel = 
            timePreset === "5m" || timePreset === "1h" || timePreset === "3h"
              ? new Date(now * 1000).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : new Date(now * 1000).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });

          // Hämta realtidsvärde från snapshot för att matcha Bot Probability-panelen
          let realTimeThreatScore = lastPoint.threatScore;
          let realTimeCategories = lastPoint.categories;
          let realTimeStatus = lastPoint.status;

          if (snapshotData && deviceData?.is_online !== false) {
            try {
              const snapshotNow = snapshotData.serverTime || now;
              const snapshotNowMs = typeof snapshotNow === "number" && snapshotNow > 1000000000 ? snapshotNow * 1000 : Date.now();
              const windowMs = TIME_WINDOWS.RECENT_SIGNALS / 1000; // Convert to seconds
              const snapshotWindowStart = snapshotNowMs / 1000 - windowMs;

              const allItems = Object.entries(snapshotData.sections || {})
                .filter(([key]) => key !== "system_reports")
                .flatMap(([, section]) => {
                  const sectionData = section as { items?: any[] } | undefined;
                  return (sectionData?.items || []) as any[];
                });

              const filteredByDevice = allItems.filter((item: any) => {
                if (!item?.device_id || !deviceId) return false;
                return (
                  item.device_id === deviceId ||
                  item.device_id.startsWith(deviceId) ||
                  deviceId.startsWith(item.device_id.substring(0, 8))
                );
              });

              const filteredByTime = filteredByDevice.filter((item: any) => {
                const itemTimestamp = typeof item.timestamp === "number" ? item.timestamp : 0;
                return itemTimestamp >= snapshotWindowStart && itemTimestamp <= snapshotNow;
              });

              // Deduplicate by uniqueKey or category:name:details
              const uniqueLatest = new Map<string, any>();
              for (const item of filteredByTime) {
                const key =
                  (item as any).uniqueKey ||
                  `${item.category}:${item.name}:${item.details || ""}`;
                const prev = uniqueLatest.get(key);
                if (!prev || item.timestamp > prev.timestamp) {
                  uniqueLatest.set(key, item);
                }
              }

              const deduped = Array.from(uniqueLatest.values());
              const criticalCount = deduped.filter((i: any) => i.status === "CRITICAL").length;
              const alertCount = deduped.filter((i: any) => i.status === "ALERT").length;
              const warnCount = deduped.filter((i: any) => i.status === "WARN").length;

              /**
               * REAL-TIME FALLBACK SCORING
               * This provides approximate threat scores between batch report updates.
               * Actual authoritative score comes from bot_probability in batch reports (every 92s).
               * Note: May overcount if same threat detected multiple ways.
               */
              realTimeThreatScore = Math.min(100, Math.max(0, criticalCount * 15 + alertCount * 10 + warnCount * 5));

              // Calculate categories breakdown as percentage contribution to bot_probability
              const rawCategoryScores: Record<string, number> = {};
              deduped.forEach((item: any) => {
                const category = item.category || item.section?.split("_")[0] || "unknown";
                const threatValue = item.status === "CRITICAL" ? 15 : item.status === "ALERT" ? 10 : item.status === "WARN" ? 5 : 0;
                rawCategoryScores[category] = (rawCategoryScores[category] || 0) + threatValue;
              });
              
              // Normalize to percentage of bot_probability
              const totalRawScore = Object.values(rawCategoryScores).reduce((sum, val) => sum + val, 0);
              realTimeCategories = {};
              if (totalRawScore > 0 && realTimeThreatScore > 0) {
                Object.entries(rawCategoryScores).forEach(([category, rawScore]) => {
                  realTimeCategories[category] = Math.round((rawScore / totalRawScore) * realTimeThreatScore);
                });
              }
              realTimeCategories = ensureCategoryBaselines(realTimeCategories);

              // Calculate status breakdown
              realTimeStatus = {};
              deduped.forEach((item: any) => {
                const status = item.status || "INFO";
                realTimeStatus[status] = (realTimeStatus[status] || 0) + 1;
              });
            } catch (err) {
              debugWarn(`[useChartProcessing] Error calculating real-time threat score:`, err);
            }
          }

          // Update or add the end point
          if (lastPoint.timestamp >= now - START_END_POINT_TOLERANCE) {
            // Update existing last point
            lastPoint.threatScore = realTimeThreatScore;
            lastPoint.categories = realTimeCategories;
            lastPoint.status = realTimeStatus;
            lastPoint.timestamp = now;
            lastPoint.label = endLabel;
          } else {
            // Add new end point
            sorted.push({
              timestamp: now,
              label: endLabel,
              threatScore: realTimeThreatScore,
              categories: ensureCategoryBaselines(realTimeCategories),
              status: realTimeStatus,
            });
          }
        }

        sorted.sort((a, b) => a.timestamp - b.timestamp);
      }

      // Interpolate between data points for smoother visualization
      if (sorted.length > 0 && sorted.length < MAX_INTERPOLATION_POINTS) {
        const interpolated: ChartDataPoint[] = [];
        const intervalSeconds = getInterpolationInterval(timePreset);

        if (timePreset === "5m" || timePreset === "1h" || timePreset === "3h") {
          const existingPointsMap = new Map<number, ChartDataPoint>();
          for (const point of sorted) {
            existingPointsMap.set(point.timestamp, point);
          }

          let currentTime = Math.floor(windowStart / intervalSeconds) * intervalSeconds;
          const endTime = Math.floor(now / intervalSeconds) * intervalSeconds;

          while (currentTime <= endTime) {
            if (existingPointsMap.has(currentTime)) {
              interpolated.push(existingPointsMap.get(currentTime)!);
            } else {
              let beforePoint: ChartDataPoint | null = null;
              let afterPoint: ChartDataPoint | null = null;

              for (const point of sorted) {
                if (point.timestamp <= currentTime) {
                  beforePoint = point;
                } else if (!afterPoint) {
                  afterPoint = point;
                  break;
                }
              }

              let interpolatedScore = 0;
              let categories: Record<string, number> = {};
              let status: Record<string, number> = {};

              if (beforePoint && afterPoint) {
                const ratio = (currentTime - beforePoint.timestamp) / (afterPoint.timestamp - beforePoint.timestamp);
                interpolatedScore = Math.round(
                  beforePoint.threatScore + (afterPoint.threatScore - beforePoint.threatScore) * ratio
                );
                // Interpolate categories proportionally, then normalize to interpolatedScore
                const interpolatedCategories: Record<string, number> = {};
                Object.keys({ ...beforePoint.categories, ...afterPoint.categories }).forEach((cat) => {
                  const beforeVal = beforePoint.categories[cat] || 0;
                  const afterVal = afterPoint.categories[cat] || 0;
                  interpolatedCategories[cat] = Math.round(beforeVal + (afterVal - beforeVal) * ratio);
                });
                // Normalize to interpolatedScore
                const totalInterpolated = Object.values(interpolatedCategories).reduce((sum, val) => sum + val, 0);
                if (totalInterpolated > 0 && interpolatedScore > 0) {
                  Object.keys(interpolatedCategories).forEach((cat) => {
                    categories[cat] = Math.round((interpolatedCategories[cat] / totalInterpolated) * interpolatedScore);
                  });
                }
                status = beforePoint.status;
              } else if (beforePoint) {
                interpolatedScore = beforePoint.threatScore;
                categories = beforePoint.categories;
                status = beforePoint.status;
              } else if (afterPoint) {
                interpolatedScore = afterPoint.threatScore;
                categories = afterPoint.categories;
                status = afterPoint.status;
              }

              const label = new Date(currentTime * 1000).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });

              interpolated.push({
                timestamp: currentTime,
                label,
                threatScore: interpolatedScore,
                categories,
                status,
              });
            }

            currentTime += intervalSeconds;
          }

          if (interpolated.length > sorted.length) {
            sorted = interpolated.sort((a, b) => a.timestamp - b.timestamp);
            debugLog(`[useChartProcessing] Interpolated to ${sorted.length} points`);
          }
        } else {
          // For longer periods, interpolate between existing points
          for (const point of sorted) {
            interpolated.push(point);
          }

          for (let i = 0; i < sorted.length - 1; i++) {
            const currentPoint = sorted[i];
            const nextPoint = sorted[i + 1];
            const timeDiff = nextPoint.timestamp - currentPoint.timestamp;

            if (timeDiff > intervalSeconds * 2) {
              let interpTime = currentPoint.timestamp + intervalSeconds;
              while (interpTime < nextPoint.timestamp) {
                const ratio = (interpTime - currentPoint.timestamp) / timeDiff;
                const interpolatedScore = Math.round(
                  currentPoint.threatScore + (nextPoint.threatScore - currentPoint.threatScore) * ratio
                );

                interpolated.push({
                  timestamp: interpTime,
                  label: formatLabel(new Date(interpTime * 1000), timePreset),
                  threatScore: interpolatedScore,
                  categories: currentPoint.categories,
                  status: currentPoint.status,
                });

                interpTime += intervalSeconds;
              }
            }
          }

          if (interpolated.length > sorted.length) {
            sorted = interpolated.sort((a, b) => a.timestamp - b.timestamp);
            debugLog(`[useChartProcessing] Interpolated to ${sorted.length} points`);
          }
        }
      }

      // Fallback: även om det saknas data (t.ex. långt sessiongap) ska grafen visa något
      // Also ensure we always have at least one point for these periods
      // Only log once per session to avoid spam
      if (sorted.length === 0 && (timePreset === "6h" || timePreset === "12h")) {
        const fallbackKey = `fallback_${timePreset}_${deviceId}`;
        const hasLoggedFallback = sessionStorage.getItem(fallbackKey);
        
        if (!hasLoggedFallback) {
          debugWarn(`[useChartProcessing] No data points for ${timePreset}, creating fallback point`);
          sessionStorage.setItem(fallbackKey, "true");
        }

        let fallbackScore = 0;
        let fallbackCategories: Record<string, number> = {};
        let fallbackStatus: Record<string, number> = {};

        // Use same linear calculation as Threat Meter for fallback
        // Priority: hourly data > daily data > segment data > snapshot data
        if (hourlyData?.ok && Array.isArray(hourlyData.data?.hours) && hourlyData.data.hours.length > 0) {
          // Use most recent hourly data point
          const mostRecentHour = hourlyData.data.hours[hourlyData.data.hours.length - 1];
          fallbackScore = calculateThreatScore(mostRecentHour.avg_bot_probability, parseFloat(String(mostRecentHour.avg_score || "0")) || 0);
          debugLog(`[useChartProcessing] Using hourly data for fallback: ${fallbackScore}%`);
        } else if (dailyData?.ok && Array.isArray(dailyData.data?.data) && dailyData.data.data.length > 0) {
          // Use most recent daily data point
          const mostRecentDay = dailyData.data.data[dailyData.data.data.length - 1];
          fallbackScore = calculateThreatScore(mostRecentDay.avg_bot_probability, parseFloat(String(mostRecentDay.avg_score || "0")) || 0);
          fallbackCategories = mostRecentDay.by_category || {};
          fallbackStatus = mostRecentDay.by_status || {};
          debugLog(`[useChartProcessing] Using daily data for fallback: ${fallbackScore}%`);
        } else if (segmentData?.ok && Array.isArray(segmentData.data?.data) && segmentData.data.data.length > 0) {
          // Use segment data
          const mostRecentSegment = segmentData.data.data[segmentData.data.data.length - 1];
          fallbackScore = calculateThreatScore(mostRecentSegment.avg_bot_probability, Number(mostRecentSegment.avg_score || 0));
          debugLog(`[useChartProcessing] Using segment data for fallback: ${fallbackScore}%`);
        } else if (snapshotData && deviceData?.is_online !== false) {
          // Calculate from snapshot data (same as Threat Meter)
          try {
            const snapshotNow = snapshotData.serverTime || now;
            const snapshotNowMs = typeof snapshotNow === "number" && snapshotNow > 1000000000 ? snapshotNow * 1000 : Date.now();
            const windowMs = TIME_WINDOWS.RECENT_SIGNALS / 1000;
            const snapshotWindowStart = snapshotNowMs / 1000 - windowMs;

            const allItems = Object.entries(snapshotData.sections || {})
              .filter(([key]) => key !== "system_reports")
              .flatMap(([, section]) => {
                const sectionData = section as { items?: any[] } | undefined;
                return (sectionData?.items || []) as any[];
              });

            const filteredByDevice = allItems.filter((item: any) => {
              if (!item?.device_id || !deviceId) return false;
              return (
                item.device_id === deviceId ||
                item.device_id.startsWith(deviceId) ||
                deviceId.startsWith(item.device_id.substring(0, 8))
              );
            });

            const filteredByTime = filteredByDevice.filter((item: any) => {
              const itemTimestamp = typeof item.timestamp === "number" ? item.timestamp : 0;
              return itemTimestamp >= snapshotWindowStart && itemTimestamp <= snapshotNow;
            });

            const uniqueLatest = new Map<string, any>();
            for (const item of filteredByTime) {
              const key =
                (item as any).uniqueKey ||
                `${item.category}:${item.name}:${item.details || ""}`;
              const prev = uniqueLatest.get(key);
              if (!prev || item.timestamp > prev.timestamp) {
                uniqueLatest.set(key, item);
              }
            }

            const deduped = Array.from(uniqueLatest.values());
            const criticalCount = deduped.filter((i: any) => i.status === "CRITICAL").length;
            const alertCount = deduped.filter((i: any) => i.status === "ALERT").length;
            const warnCount = deduped.filter((i: any) => i.status === "WARN").length;

            // FALLBACK: Count-based calculation when batch reports unavailable
            fallbackScore = Math.min(100, Math.max(0, criticalCount * 15 + alertCount * 10 + warnCount * 5));
            debugLog(`[useChartProcessing] Using snapshot data for fallback: ${fallbackScore}%`);
          } catch (err) {
            debugWarn(`[useChartProcessing] Error calculating fallback from snapshot:`, err);
          }
        }

        // Create a point at the middle of the time window
        const midTimestamp = Math.floor((windowStart + now) / 2);
        const midLabel = new Date(midTimestamp * 1000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        sorted.push({
          timestamp: midTimestamp,
          label: midLabel,
          threatScore: fallbackScore,
          categories: ensureCategoryBaselines(fallbackCategories),
          status: fallbackStatus,
        });

        debugLog(`[useChartProcessing] Created fallback point for ${timePreset}: ${midLabel}, score: ${fallbackScore}%`);
      }

      debugLog(`[useChartProcessing] Final result: ${sorted.length} data points for ${timePreset}`);

      setChartData(sorted);
      setIsInitialLoad(false);
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to process chart data";
      setError(errorMessage);
      console.error("[useChartProcessing] Error:", err);
      setChartData([]);
    } finally {
      setLoading(false);
      setIsInitialLoad(false);
    }
  }, [
    deviceId,
    timePreset,
    hourlyData,
    segmentData,
    segmentSummaryData,
    dailyData,
    hourData,
    snapshotData,
    deviceData,
    timeSeconds,
    now,
    windowStart,
    isInitialLoad,
  ]);

  return { chartData, loading, error, isInitialLoad };
}
