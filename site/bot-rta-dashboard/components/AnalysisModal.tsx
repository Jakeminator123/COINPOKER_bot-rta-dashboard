'use client';

type TimePreset = '1h' | '3h' | '6h' | '12h' | '24h' | '3d' | '7d' | '30d';

interface AnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: string;
  threatLevel: number;
  signalCount: number;
  isLoading: boolean;
  timePreset?: TimePreset;
  onTimePresetChange?: (preset: TimePreset) => void;
  onReanalyze?: () => void;
  deviceLabel?: string | null;
}

const TIME_PRESETS: Record<TimePreset, { label: string; seconds: number }> = {
  '1h': { label: '1 hour', seconds: 3600 },
  '3h': { label: '3 hours', seconds: 3 * 3600 },
  '6h': { label: '6 hours', seconds: 6 * 3600 },
  '12h': { label: '12 hours', seconds: 12 * 3600 },
  '24h': { label: '24 hours', seconds: 24 * 3600 },
  '3d': { label: '3 days', seconds: 3 * 24 * 3600 },
  '7d': { label: '7 days', seconds: 7 * 24 * 3600 },
  '30d': { label: '30 days', seconds: 30 * 24 * 3600 },
};

export default function AnalysisModal({ 
  isOpen, 
  onClose, 
  analysis, 
  threatLevel, 
  signalCount, 
  isLoading,
  timePreset = '24h',
  onTimePresetChange,
  onReanalyze,
  deviceLabel,
}: AnalysisModalProps) {
  if (!isOpen) return null;

  const displayName = deviceLabel?.trim() || null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-700 gap-6">
          <div className="flex flex-col gap-1">
            {displayName && (
              <>
                <span className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  Player
                </span>
                <p className="text-2xl font-bold text-white leading-tight">
                  {displayName}
                </p>
              </>
            )}
            <h2 className="text-xl font-semibold text-gradient">
              AI Bot Analysis
            </h2>
            <p className="text-sm text-slate-400">
              Automated reasoning over recent detection signals
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="loading-spinner mx-auto mb-4"></div>
                <p className="text-slate-400">Analyzing signals...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Time Period Selector */}
              {onTimePresetChange && (
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <label className="block text-sm font-semibold text-slate-300 mb-3">
                    Analysis Time Period:
                  </label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(Object.keys(TIME_PRESETS) as TimePreset[]).map((preset) => (
                      <button
                        key={preset}
                        onClick={() => onTimePresetChange(preset)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                          timePreset === preset
                            ? 'bg-gradient-to-r from-indigo-500/90 via-purple-500/90 to-purple-600/90 text-white shadow-lg shadow-purple-500/25'
                            : 'bg-slate-700/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200 border border-slate-600/30'
                        }`}
                      >
                        {TIME_PRESETS[preset].label}
                      </button>
                    ))}
                  </div>
                  {onReanalyze && (
                    <button
                      onClick={onReanalyze}
                      disabled={isLoading}
                      className="w-full px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                    >
                      {isLoading ? "Analyzing..." : `Re-analyze with ${TIME_PRESETS[timePreset].label} period`}
                    </button>
                  )}
                  <p className="text-xs text-slate-400 mt-2">
                    Select the time period to analyze historical detection signals
                  </p>
                </div>
              )}

              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-red-400">{threatLevel}%</div>
                  <div className="text-sm text-slate-400">Bot Probability</div>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-400">{signalCount}</div>
                  <div className="text-sm text-slate-400">Signals Analyzed</div>
                </div>
              </div>

              {/* AI Analysis */}
              <div className="bg-slate-700/30 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3 text-green-400">Analysis Result</h3>
                <div className="prose prose-invert max-w-none">
                  <div className="whitespace-pre-wrap text-slate-300 leading-relaxed">
                    {analysis}
                  </div>
                </div>
              </div>

              {/* Disclaimer */}
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-yellow-400">Disclaimer</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      This analysis is based on detected signals and patterns. It should be used as a guide for further investigation, not as definitive proof of bot usage.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
