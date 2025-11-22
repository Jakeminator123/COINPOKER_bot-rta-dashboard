'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Stored } from '@/lib/sections';

interface ThreatSummaryBoxProps {
  detections: Stored[];
}

// Helper function to format summary preview
function formatSummaryPreview(details: string | undefined): string {
  if (!details) return '';

  // Parse threat summary format from backend
  const match = details.match(/Active threats: (\d+) \| Alerts: (\d+) \| Warnings: (\d+)/);
  if (match) {
    const [, threats, alerts, warnings] = match;
    return `${threats} active threats (${alerts} alerts, ${warnings} warnings)`;
  }

  // Fallback to original details
  return details.length > 100 ? details.substring(0, 100) + '...' : details;
}

// Helper function to format detailed view
function formatSummaryDetails(details: string | undefined, _reportName: string): ReactNode {
  if (!details) return 'No details available';

  // Try to parse as JSON (new batch report format)
  try {
    const batchData = JSON.parse(details);

    // Check if this is a batch report
    if (batchData.scan_type && (batchData.threats || batchData.detections)) {
      // Support both old (detections) and new (threats) format
      const threats = batchData.threats || batchData.detections || [];
      const isUnified = batchData.scan_type === 'unified';
      const riskLevel = batchData.bot_probability >= 70 ? 'High Risk' :
                        batchData.bot_probability >= 40 ? 'Medium Risk' :
                        batchData.bot_probability >= 20 ? 'Low Risk' : 'Minimal Risk';
      const riskColor = batchData.bot_probability >= 70 ? 'text-red-400' :
                        batchData.bot_probability >= 40 ? 'text-yellow-400' :
                        batchData.bot_probability >= 20 ? 'text-blue-400' : 'text-green-400';

      return (
        <div className="space-y-3">
          {/* Bot Probability Header */}
          <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded">
            <span className="text-xs text-slate-400">Bot Probability:</span>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-bold ${riskColor}`}>{batchData.bot_probability}%</span>
              <span className="text-xs text-slate-500">({riskLevel})</span>
            </div>
          </div>

          {/* Summary Stats - 4-level system */}
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center p-2 bg-red-600/10 rounded border border-red-600/20">
              <div className="text-lg font-bold text-red-500">{batchData.summary.critical || 0}</div>
              <div className="text-[10px] text-slate-400">Critical (15pts)</div>
            </div>
            <div className="text-center p-2 bg-orange-500/10 rounded border border-orange-500/20">
              <div className="text-lg font-bold text-orange-400">{batchData.summary.alert || 0}</div>
              <div className="text-[10px] text-slate-400">Alert (10pts)</div>
            </div>
            <div className="text-center p-2 bg-yellow-500/10 rounded border border-yellow-500/20">
              <div className="text-lg font-bold text-yellow-400">{batchData.summary.warn || 0}</div>
              <div className="text-[10px] text-slate-400">Warn (5pts)</div>
            </div>
            <div className="text-center p-2 bg-blue-500/10 rounded border border-blue-500/20">
              <div className="text-lg font-bold text-blue-400">{batchData.summary.info || 0}</div>
              <div className="text-[10px] text-slate-400">Info (0pts)</div>
            </div>
          </div>

          {/* Threats List */}
          {threats && threats.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-2 flex items-center justify-between">
                <span>Threats ({threats.length}):</span>
                <span className="text-[10px] text-slate-500">Total: {batchData.summary?.raw_detection_score || 0} points</span>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                {threats.map((threat: any, idx: number) => (
                  <div key={idx} className="flex items-start justify-between gap-2 p-2 bg-slate-800/30 rounded text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          (threat.level || threat.status) === 'CRITICAL' ? 'bg-red-600' :
                          (threat.level || threat.status) === 'ALERT' ? 'bg-orange-500' :
                          (threat.level || threat.status) === 'WARN' ? 'bg-yellow-400' : 'bg-blue-400'
                        }`}></span>
                        <span className="text-slate-200 font-medium truncate">
                          {/* Remove multiplier from name since we show it separately */}
                          {(threat.name || '').replace(/\s*\(x\d+\)/gi, '').replace(/\s*\[x\d+\]/gi, '')}
                        </span>
                        {/* Show multiplier if present in threat name */}
                        {((threat.name || '').match(/\(x(\d+)\)/i) || (threat.name || '').match(/\[x(\d+)\]/i)) && (
                          <span className="px-1.5 py-0.5 text-xs font-bold rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            ×{((threat.name || '').match(/\(x(\d+)\)/i) || (threat.name || '').match(/\[x(\d+)\]/i))?.[1]}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 pl-3">
                        {threat.segment} • {threat.category}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        (threat.level || threat.status) === 'CRITICAL' ? 'bg-red-600/20 text-red-500' :
                        (threat.level || threat.status) === 'ALERT' ? 'bg-orange-500/20 text-orange-400' :
                        (threat.level || threat.status) === 'WARN' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {threat.level || threat.status}
                      </span>
                      <span className="text-[10px] text-slate-500">+{threat.points || threat.score_contribution} pts</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Categories Breakdown */}
          {batchData.categories && Object.keys(batchData.categories).length > 0 && (
            <div className="pt-2 border-t border-slate-700">
              <div className="text-xs text-slate-400 mb-1">Categories:</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(batchData.categories as Record<string, number>).map(([cat, count]) => (
                  <span key={cat} className="px-2 py-0.5 bg-slate-700/50 rounded text-xs text-slate-300">
                    {cat}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Batch Info Footer */}
          <div className="pt-2 border-t border-slate-700 text-[10px] text-slate-500">
            {isUnified ? '⚡ Unified' : '🔍 Legacy'} scan batch #{batchData.batch_number} • {batchData.summary?.total_threats || threats.length} threats processed
          </div>
        </div>
      );
    }
  } catch (e) {
    // Not JSON or parsing failed - try old format
  }

  // Try to parse the old "Raw: {}" format for backward compatibility
  const rawMatch = details.match(/Raw: ({.*})/);
  if (rawMatch) {
    try {
      const rawData = JSON.parse(rawMatch[1]);
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>Active Threats: <span className="text-yellow-400 font-semibold">{rawData.active_threats}</span></div>
            <div>Alerts: <span className="text-red-400 font-semibold">{rawData.alert_count}</span></div>
            <div>Warnings: <span className="text-orange-400 font-semibold">{rawData.warn_count}</span></div>
          </div>

          {rawData.categories && Object.keys(rawData.categories).length > 0 && (
            <div className="mt-2">
              <div className="text-xs text-slate-400 mb-1">By Category:</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(rawData.categories as Record<string, number>).map(([cat, count]) => (
                  <span key={cat} className="px-2 py-0.5 bg-slate-700/50 rounded text-xs">
                    {cat}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    } catch (e) {
      // If parsing fails, show original details
    }
  }

  // Fallback to plain text
  return details;
}

export default function ThreatSummaryBox({ detections }: ThreatSummaryBoxProps) {
  const [summaries, setSummaries] = useState<Stored[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newBatchIds, setNewBatchIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Filter for Threat Summary, Heartbeat, and Batch Report signals
    const summarySignals = detections.filter(d =>
      d.name === 'Threat Summary' ||
      d.name.includes('Heartbeat') ||
      d.name.includes('Summary') ||
      d.name.includes('Scan Report')  // Include Light/Deep Scan Reports
    );

    // Keep only the 10 most recent (more batches to show)
    const recent = summarySignals.slice(-10).reverse();

    // Detect new batches
    const currentIds = new Set(summaries.map(s => s.id));
    const newIds = new Set<string>();
    recent.forEach(r => {
      if (!currentIds.has(r.id) && r.name.includes('Scan Report')) {
        newIds.add(r.id);
      }
    });

    if (newIds.size > 0) {
      setNewBatchIds(newIds);
      // Clear "new" status after 3 seconds with cleanup
      const timer = setTimeout(() => setNewBatchIds(new Set()), 3000);
      return () => clearTimeout(timer);
    }

    setSummaries(recent);
  }, [detections]);  // Removed 'summaries' to prevent infinite loop

  // Always show the section, even if empty
  const hasReports = summaries.length > 0;

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-4 mb-6"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          System Summaries & Reports
        </h3>
        <span className="text-xs text-slate-500">
          {hasReports ? `${summaries.length} recent` : 'Waiting for reports...'}
        </span>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
        {!hasReports ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>No reports yet</p>
            <p className="text-xs mt-1 opacity-70">Reports will appear here every 20s (light) and 120s (deep)</p>
          </div>
        ) : summaries.map((summary, index) => (
          <motion.div
            key={summary.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{
              opacity: 1,
              x: 0,
              scale: newBatchIds.has(summary.id) ? [1, 1.02, 1] : 1
            }}
            transition={{
              delay: index * 0.05,
              scale: { duration: 0.5, repeat: newBatchIds.has(summary.id) ? 2 : 0 }
            }}
            className={`bg-slate-700/30 rounded-lg border-l-2 ${
              summary.name.includes('Unified Scan') ? 'border-blue-500/50' :
              summary.name.includes('Scan Report') ? 'border-purple-500/50' :
              summary.name === 'Threat Summary' ? 'border-purple-500/50' : 'border-green-500/50'
            } overflow-hidden ${
              newBatchIds.has(summary.id) ? 'shadow-lg shadow-blue-500/20' : ''
            }`}
          >
            <button
              onClick={() => toggleExpand(summary.id)}
              className="w-full p-3 text-left hover:bg-slate-700/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-300 mb-1 flex items-center gap-2">
                    {summary.name}
                    {summary.name.includes('Unified Scan') && (
                      <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">
                        ⚡ Unified
                      </span>
                    )}
                    {(summary.name.includes('Light Scan') || summary.name.includes('Deep Scan')) && (
                      <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">
                        🔍 Legacy
                      </span>
                    )}
                    {summary.name === 'Threat Summary' && (
                      <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">
                        Summary
                      </span>
                    )}
                  </div>
                  {!expandedId || expandedId !== summary.id ? (
                    <div className="text-xs text-slate-400 line-clamp-2">
                      {formatSummaryPreview(summary.details) || 'Click to view details'}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-500 whitespace-nowrap">
                    {new Date(summary.timestamp * 1000).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                  <svg
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      expandedId === summary.id ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </button>

            <AnimatePresence>
              {expandedId === summary.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="border-t border-slate-700"
                >
                  <div className="p-3 bg-slate-800/30">
                    <div className="text-xs text-slate-300">
                      {formatSummaryDetails(summary.details, summary.name)}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
