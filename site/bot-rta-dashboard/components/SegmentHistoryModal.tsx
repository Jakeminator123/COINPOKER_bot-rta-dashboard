'use client';

import { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import SegmentBarChart, { SegmentDataPoint } from './SegmentBarChart';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

type Daily = { day: string; avg: number; total: number };
type Monthly = { month: string; avg: number; total: number };

export default function SegmentHistoryModal({
  isOpen,
  onClose,
  deviceId,
}: {
  isOpen: boolean;
  onClose: () => void;
  deviceId?: string | null;
}) {
  const [mode, setMode] = useState<'daily' | 'monthly' | 'segments'>('daily');
  const [segmentMode, setSegmentMode] = useState<'category' | 'subsection'>('category');
  const [timeRange, setTimeRange] = useState<'hours' | 'days' | 'weeks' | 'months' | 'years'>('days');
  const [days, setDays] = useState(7); // Default 7 days (matches Redis TTL)
  const [months, setMonths] = useState(6);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [segmentLoading, setSegmentLoading] = useState(false);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [monthly, setMonthly] = useState<Monthly[]>([]);
  const [segmentData, setSegmentData] = useState<SegmentDataPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/history/score?device=${encodeURIComponent(deviceId)}&days=${days}&months=${months}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to fetch');
      setDaily(json.daily || []);
      setMonthly(json.monthly || []);
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function loadSegments() {
    if (!deviceId) return;
    setSegmentLoading(true);
    setError(null);
    try {
      // Calculate time range based on timeRange setting
      let hoursParam = 0;
      let daysParam = 0;

      if (timeRange === 'hours') {
        hoursParam = hours;
      } else if (timeRange === 'days') {
        daysParam = days;
      } else if (timeRange === 'weeks') {
        daysParam = days * 7;
      } else if (timeRange === 'months') {
        daysParam = days * 30;
      } else if (timeRange === 'years') {
        daysParam = days * 365;
      }

      // For segments view, prefer hourly data if available, otherwise daily
      const _dataType = timeRange === 'hours' ? 'hourly' : 'daily';
      const url = `/api/history/segment?device=${encodeURIComponent(deviceId)}&days=${daysParam}&hours=${hoursParam}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to fetch');

      // Filter and format segment data based on timeRange
      const filtered = (json.data || []).filter((d: any) => {
        if (timeRange === 'hours') {
          return d.type === 'hourly';
        } else {
          return d.type === 'daily';
        }
      });

      setSegmentData(filtered.map((d: any) => ({
        category: d.category,
        subsection: d.subsection,
        avg_score: d.avg_score,
        total_detections: d.total_detections,
        points_sum: d.points_sum,
        time_label: d.time_label,
        timestamp: d.timestamp,
      })));
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setSegmentLoading(false);
    }
  }

  async function exportXLSX() {
    if (!deviceId) return;
    try {
      const type = mode === 'segments' ? 'hourly' : mode === 'daily' ? 'daily' : 'session';
      const url = `/api/export/xlsx?device=${encodeURIComponent(deviceId)}&type=${type}&days=${days}`;
      window.open(url, '_blank');
    } catch (e: any) {
      alert(`Export failed: ${e.message}`);
    }
  }

  useEffect(() => {
    if (isOpen) {
      load();
    }
  }, [isOpen, days, months]);

  useEffect(() => {
    if (isOpen && mode === 'segments') {
      loadSegments();
    }
  }, [isOpen, mode, days, hours, timeRange]);

  // Chart data for daily/monthly
  const chartLabels = mode === 'daily' ? daily.map(d => d.day) : monthly.map(m => m.month);
  const chartValues = mode === 'daily' ? daily.map(d => d.avg) : monthly.map(m => m.avg);
  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        label: mode === 'daily' ? 'Daily Avg Score' : 'Monthly Avg Score',
        data: chartValues,
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        tension: 0.25,
        pointRadius: 2,
      },
    ],
  };
  const chartOptions = {
    responsive: true,
    plugins: { legend: { display: false }, tooltip: { enabled: true } },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.1)' } },
      y: {
        ticks: { color: '#94a3b8', stepSize: 5 },
        grid: { color: 'rgba(148,163,184,0.1)' },
        suggestedMin: 0,
        suggestedMax: 100,
      },
    },
  } as const;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg w-full max-w-4xl max-h-[85vh] overflow-hidden border border-slate-700/50">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-gradient">Score & Segment History</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg overflow-hidden border border-slate-700">
              <button
                onClick={() => setMode('daily')}
                className={`px-3 py-2 text-sm ${mode === 'daily' ? 'bg-slate-700 text-white' : 'text-slate-300'}`}
              >
                Daily
              </button>
              <button
                onClick={() => setMode('monthly')}
                className={`px-3 py-2 text-sm ${mode === 'monthly' ? 'bg-slate-700 text-white' : 'text-slate-300'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setMode('segments')}
                className={`px-3 py-2 text-sm ${mode === 'segments' ? 'bg-slate-700 text-white' : 'text-slate-300'}`}
              >
                Segments
              </button>
            </div>

            {mode === 'daily' ? (
              <label className="text-sm text-slate-300 flex items-center gap-2">
                Days:
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                />
              </label>
            ) : mode === 'monthly' ? (
              <label className="text-sm text-slate-300 flex items-center gap-2">
                Months:
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={months}
                  onChange={(e) => setMonths(Number(e.target.value))}
                  className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                />
              </label>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-sm text-slate-300 flex items-center gap-2">
                  View:
                  <select
                    value={segmentMode}
                    onChange={(e) => setSegmentMode(e.target.value as 'category' | 'subsection')}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                  >
                    <option value="category">By Category</option>
                    <option value="subsection">By Subsection</option>
                  </select>
                </label>
                <label className="text-sm text-slate-300 flex items-center gap-2">
                  Time Range:
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value as 'hours' | 'days' | 'weeks' | 'months' | 'years')}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                    <option value="years">Years</option>
                  </select>
                </label>
                {timeRange === 'hours' && (
                  <label className="text-sm text-slate-300 flex items-center gap-2">
                    Hours:
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={hours}
                      onChange={(e) => setHours(Number(e.target.value))}
                      className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                    />
                  </label>
                )}
              </div>
            )}

            <button onClick={mode === 'segments' ? loadSegments : load} className="ml-auto px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm">
              Refresh
            </button>
            <button onClick={exportXLSX} className="px-3 py-2 bg-green-700/60 hover:bg-green-600 rounded text-sm">Export XLSX</button>
          </div>


          {/* Chart or Segment Visualization */}
          {mode === 'segments' ? (
            <div className="bg-slate-700/30 rounded-lg p-3">
              {segmentLoading ? (
                <div className="text-slate-400">Loading segment data...</div>
              ) : segmentData.length === 0 ? (
                <div className="text-slate-400 text-sm">No segment data available. Segment data is generated from batch reports.</div>
              ) : (
                <SegmentBarChart data={segmentData} mode={segmentMode} maxValue={100} />
              )}
            </div>
          ) : (
            <div className="bg-slate-700/30 rounded-lg p-3">
              <Line data={chartData} options={chartOptions} />
            </div>
          )}

          {loading && <div className="text-slate-400">Loading...</div>}
          {error && <div className="text-red-400 text-sm">Error: {error}</div>}

          {/* Data tables */}
          {!loading && !error && mode === 'daily' && (
            <div className="space-y-2">
              {daily.length === 0 && <div className="text-slate-400 text-sm">No daily data.</div>}
              {daily.map((d) => (
                <div key={d.day} className="flex items-center justify-between p-3 bg-slate-700/40 rounded">
                  <span className="text-slate-300">{d.day}</span>
                  <div className="flex items-center gap-6">
                    <span className="text-slate-400 text-sm">avg</span>
                    <span className="text-white font-semibold">{d.avg.toFixed(1)} pts</span>
                    <span className="text-slate-500 text-sm">total {d.total}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && mode === 'monthly' && (
            <div className="space-y-2">
              {monthly.length === 0 && <div className="text-slate-400 text-sm">No monthly data.</div>}
              {monthly.map((m) => (
                <div key={m.month} className="flex items-center justify-between p-3 bg-slate-700/40 rounded">
                  <span className="text-slate-300">{m.month}</span>
                  <div className="flex items-center gap-6">
                    <span className="text-slate-400 text-sm">avg</span>
                    <span className="text-white font-semibold">{m.avg.toFixed(1)} pts</span>
                    <span className="text-slate-500 text-sm">total {m.total}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded">Close</button>
        </div>
      </div>
    </div>
  );
}

