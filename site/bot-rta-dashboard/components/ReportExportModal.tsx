"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

type ExportFormat = 'xlsx' | 'csv' | 'json';
type DataType = 'hourly' | 'daily' | 'sessions' | 'all';
type TimePreset = '1h' | '3h' | '6h' | '12h' | '24h' | '7d' | '30d' | 'custom';

interface ReportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceId?: string | null;
  deviceName?: string;
}

export default function ReportExportModal({
  isOpen,
  onClose,
  deviceId,
  deviceName,
}: ReportExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [dataType, setDataType] = useState<DataType>('all');
  const [timePreset, setTimePreset] = useState<TimePreset>('7d');
  const [customDays, setCustomDays] = useState(7);
  const [customHours, setCustomHours] = useState(24);
  
  // Session filters
  const [includeSessions, setIncludeSessions] = useState(true);
  const [minDuration, setMinDuration] = useState<number | ''>('');
  const [maxDuration, setMaxDuration] = useState<number | ''>('');
  const [minThreatScore, setMinThreatScore] = useState<number | ''>('');
  const [maxThreatScore, setMaxThreatScore] = useState<number | ''>('');
  
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setFormat('xlsx');
      setDataType('all');
      setTimePreset('7d');
      setCustomDays(7);
      setCustomHours(24);
      setIncludeSessions(true);
      setMinDuration('');
      setMaxDuration('');
      setMinThreatScore('');
      setMaxThreatScore('');
      setError(null);
    }
  }, [isOpen]);

  const handleExport = async () => {
    if (!deviceId) {
      setError('Device ID is required');
      return;
    }

    setIsExporting(true);
    setError(null);

    try {
      // Calculate time range
      let days = 7;
      let hours = 0;
      
      if (timePreset === 'custom') {
        days = customDays;
        hours = customHours;
      } else {
        const presetMap: Record<Exclude<TimePreset, 'custom'>, { days: number; hours: number }> = {
          '1h': { days: 0, hours: 1 },
          '3h': { days: 0, hours: 3 },
          '6h': { days: 0, hours: 6 },
          '12h': { days: 0, hours: 12 },
          '24h': { days: 1, hours: 0 },
          '7d': { days: 7, hours: 0 },
          '30d': { days: 30, hours: 0 },
        };
        const preset = presetMap[timePreset];
        days = preset.days;
        hours = preset.hours;
      }

      // Determine export type
      let exportType = dataType;
      if (dataType === 'all') {
        exportType = includeSessions ? 'all' : 'daily';
      }

      // Build export URL
      const params = new URLSearchParams({
        device: deviceId,
        format,
        type: exportType,
        days: days.toString(),
        hours: hours.toString(),
      });

      // Add session filters if applicable
      if (includeSessions && (dataType === 'sessions' || dataType === 'all')) {
        if (minDuration !== '') params.set('minDuration', minDuration.toString());
        if (maxDuration !== '') params.set('maxDuration', maxDuration.toString());
        if (minThreatScore !== '') params.set('minThreatScore', minThreatScore.toString());
        if (maxThreatScore !== '') params.set('maxThreatScore', maxThreatScore.toString());
      }

      const url = `/api/export/report?${params.toString()}`;
      
      // Trigger download
      window.open(url, '_blank');
      
      // Close modal after a short delay
      setTimeout(() => {
        setIsExporting(false);
        onClose();
      }, 500);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Export failed";
      setError(message);
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-slate-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden border border-slate-700/50 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50 bg-gradient-to-r from-slate-800 to-slate-800/50">
            <div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Export Report
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Download player history data in your preferred format
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-700/50 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-180px)]">
            {/* Format Selection */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-3">
                Export Format
              </label>
              <div className="grid grid-cols-3 gap-3">
                {(['xlsx', 'csv', 'json'] as ExportFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
                    className={`px-4 py-3 rounded-lg border-2 transition-all ${
                      format === fmt
                        ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                        : 'border-slate-700 bg-slate-700/30 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-medium uppercase">{fmt}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      {fmt === 'xlsx' && 'Excel Spreadsheet'}
                      {fmt === 'csv' && 'Comma Separated'}
                      {fmt === 'json' && 'JSON Data'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Data Type Selection */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-3">
                Data Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(['hourly', 'daily', 'sessions', 'all'] as DataType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setDataType(type)}
                    className={`px-4 py-3 rounded-lg border-2 transition-all capitalize ${
                      dataType === type
                        ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                        : 'border-slate-700 bg-slate-700/30 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {type === 'all' ? 'All Data' : type}
                  </button>
                ))}
              </div>
            </div>

            {/* Time Range Selection */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-3">
                Time Range
              </label>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {(['1h', '3h', '6h', '12h', '24h', '7d', '30d'] as TimePreset[]).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setTimePreset(preset)}
                    className={`px-3 py-2 rounded-lg border transition-all text-sm ${
                      timePreset === preset
                        ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                        : 'border-slate-700 bg-slate-700/30 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
                <button
                  onClick={() => setTimePreset('custom')}
                  className={`px-3 py-2 rounded-lg border transition-all text-sm ${
                    timePreset === 'custom'
                      ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                      : 'border-slate-700 bg-slate-700/30 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  Custom
                </button>
              </div>

              {timePreset === 'custom' && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-slate-700/30 rounded-lg border border-slate-600/50">
                  <div>
                    <label htmlFor="customDays" className="block text-xs text-slate-400 mb-2">
                      Days
                    </label>
                    <input
                      id="customDays"
                      name="customDays"
                      type="number"
                      min="0"
                      max="365"
                      value={customDays}
                      onChange={(e) => setCustomDays(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200"
                    />
                  </div>
                  <div>
                    <label htmlFor="customHours" className="block text-xs text-slate-400 mb-2">
                      Hours
                    </label>
                    <input
                      id="customHours"
                      name="customHours"
                      type="number"
                      min="0"
                      max="23"
                      value={customHours}
                      onChange={(e) => setCustomHours(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Session Filters */}
            {(dataType === 'sessions' || dataType === 'all') && (
              <div className="p-4 bg-slate-700/20 rounded-lg border border-slate-600/30">
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="checkbox"
                    id="includeSessions"
                    checked={includeSessions}
                    onChange={(e) => setIncludeSessions(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 bg-slate-900 border-slate-600 rounded focus:ring-indigo-500"
                  />
                  <label htmlFor="includeSessions" className="text-sm font-semibold text-slate-300">
                    Include Session Data
                  </label>
                </div>

                {includeSessions && (
                  <div className="space-y-4 pl-6 border-l-2 border-slate-600/50">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="minSessionDuration" className="block text-xs text-slate-400 mb-2">
                          Min Duration (minutes)
                        </label>
                        <input
                          id="minSessionDuration"
                          name="minSessionDuration"
                          type="number"
                          min="0"
                          placeholder="Any"
                          value={minDuration}
                          onChange={(e) => setMinDuration(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200"
                        />
                      </div>
                      <div>
                        <label htmlFor="maxSessionDuration" className="block text-xs text-slate-400 mb-2">
                          Max Duration (minutes)
                        </label>
                        <input
                          id="maxSessionDuration"
                          name="maxSessionDuration"
                          type="number"
                          min="0"
                          placeholder="Any"
                          value={maxDuration}
                          onChange={(e) => setMaxDuration(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="minThreatScore" className="block text-xs text-slate-400 mb-2">
                          Min Threat Score (%)
                        </label>
                        <input
                          id="minThreatScore"
                          name="minThreatScore"
                          type="number"
                          min="0"
                          max="100"
                          placeholder="Any"
                          value={minThreatScore}
                          onChange={(e) => setMinThreatScore(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200"
                        />
                      </div>
                      <div>
                        <label htmlFor="maxThreatScore" className="block text-xs text-slate-400 mb-2">
                          Max Threat Score (%)
                        </label>
                        <input
                          id="maxThreatScore"
                          name="maxThreatScore"
                          type="number"
                          min="0"
                          max="100"
                          placeholder="Any"
                          value={maxThreatScore}
                          onChange={(e) => setMaxThreatScore(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Device Info */}
            {deviceName && (
              <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
                <div className="text-xs text-indigo-400 mb-1">Exporting for</div>
                <div className="text-sm font-semibold text-white">{deviceName}</div>
                <div className="text-xs text-slate-400 font-mono mt-1">{deviceId?.substring(0, 16)}...</div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="text-sm text-red-400">{error}</div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-slate-700/50 bg-slate-800/50 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || !deviceId}
              className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isExporting ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Report
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

