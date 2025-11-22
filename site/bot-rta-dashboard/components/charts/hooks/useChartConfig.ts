/**
 * Hook for Chart.js configuration
 * Optimized for visual clarity and performance
 */

import { useMemo } from "react";
import { enUS } from "date-fns/locale";
import { getThreatColor } from "@/lib/threat-scoring";
import type { ChartDataPoint, TimePreset, DataType } from "../types";
import { CATEGORY_COLORS, CATEGORY_TITLES } from "../constants";
import { DETECTION_SECTIONS } from "@/lib/sections";
import type { Session } from "./useSessionData";

interface UseChartConfigProps {
  chartData: ChartDataPoint[];
  dataTypes: Set<DataType>;
  timePreset: TimePreset;
  isInitialLoad: boolean;
  sessions?: Session[];
}

const SESSION_TINTS = [
  {
    border: "#fb7185", // rose
    fill: "rgba(251, 113, 133, 0.08)",
    lineFill: "rgba(251, 113, 133, 0.25)",
  },
  {
    border: "#38bdf8", // sky
    fill: "rgba(56, 189, 248, 0.08)",
    lineFill: "rgba(56, 189, 248, 0.25)",
  },
  {
    border: "#a3e635", // lime
    fill: "rgba(163, 230, 53, 0.08)",
    lineFill: "rgba(163, 230, 53, 0.25)",
  },
  {
    border: "#f97316", // orange
    fill: "rgba(249, 115, 22, 0.08)",
    lineFill: "rgba(249, 115, 22, 0.25)",
  },
];

export function useChartConfig({
  chartData,
  dataTypes,
  timePreset,
  isInitialLoad,
  sessions = [],
}: UseChartConfigProps) {
  const categoryKeys = useMemo(
    () =>
      Object.keys(DETECTION_SECTIONS).filter(
        (category) => category !== "system",
      ),
    [],
  );

  const chartConfig = useMemo(() => {
    const datasets: any[] = [];

    // Sort data by timestamp to ensure correct rendering order
    const sortedData = [...chartData].sort((a, b) => a.timestamp - b.timestamp);

    const sessionMeta = sessions
      .map((session, index) => {
        const tint = SESSION_TINTS[index % SESSION_TINTS.length];
        return {
          start: session.session_start * 1000,
          end: session.session_end > 0 ? session.session_end * 1000 : Date.now(),
          tint,
        };
      })
      .sort((a, b) => a.start - b.start);

    const getSessionColor = (timestampMs: number) => {
      const meta = sessionMeta.find(
        (meta) => timestampMs >= meta.start && timestampMs <= meta.end,
      );
      return meta?.tint;
    };

    // Total risklinje – markerad tydligt som sum of categories
    if (dataTypes.has("threat")) {
      const threatData = sortedData.map((d) => ({
        x: d.timestamp * 1000,
        y: Math.min(100, Math.max(0, d.threatScore)), // Ensure 0-100 range
      }));

      // Calculate gradient color based on max threat in dataset
      const maxThreat = Math.max(...threatData.map((d) => d.y), 1);
      const gradientColor = getThreatColor(maxThreat);
      const gradientFillColor = gradientColor + "30";

      datasets.push({
        label: "Bot Detection % (Total)",
        data: threatData,
        borderColor: gradientColor,
        backgroundColor: gradientFillColor,
        fill: true,
        tension: 0.4, // Slightly smoother curve
        yAxisID: "y",
        pointRadius: sortedData.length < 50 ? 4 : 3, // Smaller points when many data points
        pointHoverRadius: 7,
        pointBackgroundColor: gradientColor,
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        borderWidth: 3.5,
        pointHitRadius: 10, // Larger hit area for better interaction
        spanGaps: false, // Don't connect points across gaps
        order: 3,
        segment: {
          borderColor: (ctx: any) => {
            const tint = getSessionColor(ctx.p0.parsed.x);
            return tint?.border || gradientColor;
          },
          backgroundColor: (ctx: any) => {
            const tint = getSessionColor(ctx.p0.parsed.x);
            return tint?.lineFill || gradientFillColor;
          },
        },
      });
    }

    // Stacked kategorier: exakt samma uppsättning som Category Breakdown (programs, network, behaviour, vm, auto)
    if (dataTypes.has("categories")) {
      categoryKeys.forEach((category) => {
        const color = CATEGORY_COLORS[category] || "#94a3b8";
        const categoryData = sortedData.map((d) => ({
          x: d.timestamp * 1000,
          y: Math.min(100, Math.max(0, d.categories?.[category] ?? 0)),
        }));

        datasets.push({
          label:
            CATEGORY_TITLES[category] ||
            DETECTION_SECTIONS[category as keyof typeof DETECTION_SECTIONS]
              ?.title ||
            category,
          data: categoryData,
          borderColor: color,
          backgroundColor: `${color}33`,
          fill: true,
          stack: "category-stack",
          tension: 0.35,
          yAxisID: "y",
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: color,
          pointBorderColor: color,
          borderWidth: 1.5,
          spanGaps: true,
          order: 2,
          hidden: categoryData.every((point) => point.y === 0), // visa i legend även om det saknas data
        });
      });
    }

    // Add session background shading and markers
    if (sessions.length > 0) {
      sessions.forEach((session, index) => {
        const sessionStart = session.session_start * 1000;
        const sessionEnd = session.session_end > 0 ? session.session_end * 1000 : Date.now();
        
        // Bakgrundsremsa för varje session – gör det tydligt vilken del av grafen som tillhör vilken inloggning
        datasets.push({
          label: `Session ${sessions.length - index} Background`,
          data: [
            { x: sessionStart, y: 0 },
            { x: sessionStart, y: 100 },
            { x: sessionEnd, y: 100 },
            { x: sessionEnd, y: 0 },
          ],
          borderColor: "transparent",
          backgroundColor: sessionMeta[index]?.tint.fill ||
            (index % 2 === 0
              ? "rgba(16, 185, 129, 0.06)"
              : "rgba(59, 130, 246, 0.06)"),
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 0,
          yAxisID: "y",
          order: -1, // Render behind all line data
          tension: 0,
        });

        // Session start line (green)
        datasets.push({
          label: `Session ${sessions.length - index} Start`,
          data: [
            { x: sessionStart, y: 0 },
            { x: sessionStart, y: 100 },
          ],
          borderColor: sessionMeta[index]?.tint.border || "#10b981", // Match tint
          backgroundColor: "transparent",
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 0,
          pointHoverRadius: 0,
          yAxisID: "y",
          order: 4, // Render above other datasets for clarity
        });

        // Session end line (red) - only if session has ended
        if (session.session_end > 0) {
          datasets.push({
            label: `Session ${sessions.length - index} End`,
            data: [
              { x: sessionEnd, y: 0 },
              { x: sessionEnd, y: 100 },
            ],
            borderColor: sessionMeta[index]?.tint.border || "#ef4444",
            backgroundColor: "transparent",
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            pointHoverRadius: 0,
            yAxisID: "y",
            order: 4,
          });
        }
      });
    }

    return {
      datasets: datasets,
    };
  }, [chartData, dataTypes, sessions]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: isInitialLoad ? 0 : 600, // Faster animation
        easing: "easeInOutQuart" as const,
      },
      interaction: {
        mode: "index" as const, // Show all datasets at same point
        axis: "x" as const,
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: "top" as const,
          labels: {
            color: "#e2e8f0",
            font: {
              size: 12,
              weight: 600,
            },
            usePointStyle: true,
            padding: 16,
            boxWidth: 12,
            boxHeight: 12,
            filter: function (item: any) {
              // Hide session markers and backgrounds from legend (they're just visual guides)
              if (item.text && item.text.includes("Session")) {
                return false;
              }
              // Only show legend for datasets with actual data
              return item.datasetIndex !== undefined;
            },
          },
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.98)",
          titleColor: "#e2e8f0",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(148, 163, 184, 0.3)",
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          displayColors: true,
          useBodySpacing: true,
          mode: "index" as const,
          intersect: false,
          position: "nearest" as const,
          filter: function (tooltipItem: any) {
            // Only show tooltip for datasets with non-zero values
            return tooltipItem.parsed.y !== null && tooltipItem.parsed.y > 0;
          },
          callbacks: {
            title: function (tooltipItems: any[]) {
              if (tooltipItems.length > 0 && tooltipItems[0].parsed.x) {
                const date = new Date(tooltipItems[0].parsed.x);
                // Format based on time preset for better readability
                if (timePreset === "5m" || timePreset === "1h" || timePreset === "3h") {
                  return date.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: timePreset === "5m" ? "2-digit" : undefined,
                  });
                } else if (timePreset === "6h" || timePreset === "12h") {
                  return date.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                } else {
                  return date.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: timePreset === "30d" ? "numeric" : undefined,
                  });
                }
              }
              return "";
            },
            label: function (context: any) {
              let label = context.dataset.label || "";
              if (label) {
                label += ": ";
              }
              const value = context.parsed.y;
              if (value !== null && !isNaN(value)) {
                label += value.toFixed(1) + "%";
              } else {
                label += "N/A";
              }
              return label;
            },
            labelColor: function (context: any) {
              return {
                borderColor: context.dataset.borderColor,
                backgroundColor: context.dataset.borderColor,
              };
            },
          },
        },
      },
      scales: {
        x: {
          type: "time" as const,
          time: {
            unit:
              timePreset === "5m"
                ? ("minute" as const)
                : timePreset === "1h" || timePreset === "3h"
                ? ("minute" as const)
                : timePreset === "6h" || timePreset === "12h"
                ? ("hour" as const)
                : timePreset === "24h" || timePreset === "3d"
                ? ("hour" as const)
                : ("day" as const),
            stepSize:
              timePreset === "5m"
                ? 1
                : timePreset === "1h"
                ? 5
                : timePreset === "3h"
                ? 15
                : undefined,
            displayFormats: {
              minute: timePreset === "5m" ? "HH:mm:ss" : "HH:mm",
              hour: "MMM d HH:mm",
              day: "MMM d",
            },
            tooltipFormat:
              timePreset === "5m"
                ? "MMM d, HH:mm:ss"
                : timePreset === "1h" || timePreset === "3h"
                ? "MMM d, HH:mm"
                : timePreset === "6h" || timePreset === "12h"
                ? "MMM d, HH:mm"
                : "MMM d, yyyy",
          },
          adapters: {
            date: {
              locale: enUS,
            },
          },
          grid: {
            color: "rgba(148, 163, 184, 0.1)",
            lineWidth: 1,
            drawBorder: true,
            borderColor: "rgba(148, 163, 184, 0.2)",
          },
          ticks: {
            color: "#94a3b8",
            font: {
              size: 11,
              weight: 500,
            },
            maxRotation: timePreset === "5m" || timePreset === "1h" ? 0 : 45,
            minRotation: timePreset === "5m" || timePreset === "1h" ? 0 : 45,
            maxTicksLimit:
              timePreset === "5m"
                ? 6
                : timePreset === "1h"
                ? 12
                : timePreset === "3h"
                ? 8
                : timePreset === "6h" || timePreset === "12h"
                ? 8
                : timePreset === "7d" || timePreset === "30d"
                ? 7
                : 12,
            source: "auto" as const,
            autoSkip: true,
            autoSkipPadding: 8,
          },
          bounds: "ticks" as const,
        },
        y: {
          type: "linear" as const,
          display: true,
          position: "left" as const,
          min: 0,
          max: 100,
          beginAtZero: true,
          grid: {
            color: "rgba(148, 163, 184, 0.1)",
            lineWidth: 1,
            drawBorder: true,
            borderColor: "rgba(148, 163, 184, 0.2)",
          },
          ticks: {
            color: "#94a3b8",
            font: {
              size: 11,
              weight: 500,
            },
            stepSize: 20, // Show ticks at 0, 20, 40, 60, 80, 100
            callback: function (value: any) {
              return value + "%";
            },
            maxTicksLimit: 6,
          },
        },
      },
    }),
    [dataTypes, isInitialLoad, chartData, timePreset, sessions]
  );

  return { chartConfig, chartOptions };
}

