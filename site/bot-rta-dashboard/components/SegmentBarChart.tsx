'use client';

import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { DETECTION_SECTIONS } from '@/lib/detections/sections';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export interface SegmentDataPoint {
  category: string;
  subsection: string;
  avg_score: number;
  total_detections: number;
  points_sum: number;
  time_label: string;
  timestamp?: number;
}

interface SegmentBarChartProps {
  data: SegmentDataPoint[];
  mode: 'category' | 'subsection'; // Group by category or show subsections
  maxValue?: number; // Max value for scale (default 100)
  showStacked?: boolean; // Stack segments by color
}

const CATEGORY_COLORS: Record<string, string> = {
  programs: '#ef4444', // red
  network: '#3b82f6', // blue
  behaviour: '#f59e0b', // amber
  vm: '#8b5cf6', // purple
  auto: '#10b981', // green
};

export default function SegmentBarChart({
  data,
  mode = 'category',
  maxValue = 100,
  showStacked: _showStacked = false,
}: SegmentBarChartProps) {
  const chartData = useMemo(() => {
    if (mode === 'category') {
      // Group by category and calculate average scores
      const categoryMap = new Map<string, { sum: number; count: number; label: string }>();

      for (const point of data) {
        const existing = categoryMap.get(point.category) || { sum: 0, count: 0, label: point.category };
        existing.sum += point.avg_score;
        existing.count += 1;
        categoryMap.set(point.category, existing);
      }

      const categories = Array.from(categoryMap.keys());
      const values = categories.map(cat => {
        const item = categoryMap.get(cat)!;
        return item.count > 0 ? item.sum / item.count : 0;
      });

      return {
        labels: categories.map(cat => DETECTION_SECTIONS[cat]?.title || cat),
        datasets: [{
          label: 'Average Detection Score (%)',
          data: values,
          backgroundColor: categories.map(cat => CATEGORY_COLORS[cat] || '#6b7280'),
        }],
      };
    } else {
      // Show subsections with stacked or grouped bars
      const subsectionMap = new Map<string, SegmentDataPoint[]>();

      for (const point of data) {
        const key = `${point.category}:${point.subsection}`;
        if (!subsectionMap.has(key)) {
          subsectionMap.set(key, []);
        }
        subsectionMap.get(key)!.push(point);
      }

      const subsections = Array.from(subsectionMap.keys());
      const values = subsections.map(key => {
        const points = subsectionMap.get(key)!;
        const avg = points.reduce((sum, p) => sum + p.avg_score, 0) / points.length;
        return avg;
      });

      // Get category for color
      const colors = subsections.map(key => {
        const category = key && typeof key === 'string' && key.includes(':') 
          ? key.split(':')[0] 
          : key || 'unknown';
        return CATEGORY_COLORS[category] || '#6b7280';
      });

      return {
        labels: subsections.map(key => {
          const parts = key && typeof key === 'string' && key.includes(':') 
            ? key.split(':') 
            : [key || 'unknown'];
          const [cat, sub] = parts;
          const catTitle = DETECTION_SECTIONS[cat]?.title || cat;
          const subTitle = DETECTION_SECTIONS[cat]?.subsections?.[sub] || sub;
          return `${catTitle} - ${subTitle}`;
        }),
        datasets: [{
          label: 'Average Detection Score (%)',
          data: values,
          backgroundColor: colors,
        }],
      };
    }
  }, [data, mode]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}%`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: '#94a3b8',
          maxRotation: 45,
          minRotation: 45,
        },
        grid: {
          color: 'rgba(148,163,184,0.1)',
        },
      },
      y: {
        ticks: {
          color: '#94a3b8',
          stepSize: 10,
        },
        grid: {
          color: 'rgba(148,163,184,0.1)',
        },
        min: 0,
        max: maxValue,
      },
    },
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        No segment data available
      </div>
    );
  }

  return (
    <div className="w-full h-64">
      <Bar data={chartData} options={options} />
    </div>
  );
}

