'use client';

import { useEffect, useState, memo } from 'react';
import { STATUS_COLORS, type Status } from '@/lib/detections/sections';

interface Detection {
  id: string;
  timestamp: number;
  category: string;
  name: string;
  status: Status;
  details?: string;
  isNew?: boolean;
  confidence?: number;
  sources?: string[];
  detections?: number;
  displayName?: string;
  groupedTypes?: string[];
}

interface DetectionFeedProps {
  detections: Detection[];
  maxItems?: number;
  onIgnoreDetection?: (detection: Detection) => void;
}

function DetectionFeed({ detections, maxItems = 10, onIgnoreDetection }: DetectionFeedProps) {
  const [visibleDetections, setVisibleDetections] = useState<Detection[]>([]);
  const [newDetections, setNewDetections] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Filter out Threat Summary, Heartbeat, and Batch Reports (they should only appear in ThreatSummaryBox)
    const filteredDetections = detections.filter(d =>
      d.name !== 'Threat Summary' &&
      !d.name.includes('Heartbeat') &&
      !d.name.includes('Summary') &&
      !d.name.includes('Scan Report')  // Exclude Light/Deep Scan Reports
    );

    // Sort by timestamp and limit
    const sorted = [...filteredDetections].sort((a, b) => b.timestamp - a.timestamp).slice(0, maxItems);

    // Find new detections by comparing IDs
    setVisibleDetections(prev => {
      const prevIds = new Set(prev.map(d => d.id));
      const newIds = new Set<string>();

      sorted.forEach(detection => {
        if (!prevIds.has(detection.id)) {
          newIds.add(detection.id);
        }
      });

      setNewDetections(newIds);

      // Clear new status after animation
      if (newIds.size > 0) {
        setTimeout(() => {
          setNewDetections(new Set());
        }, 1000);
      }

      return sorted;
    });
  }, [detections, maxItems]);

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, string> = {
      programs: '🖥️',
      network: '🌐',
      behaviour: '🎯',
      vm: '💻',
      auto: '⚙️'
    };
    return icons[category] || '📋';
  };

  const getStatusBadge = (status: Status) => {
    const styles: Record<Status, string> = {
      CRITICAL: 'bg-red-600/20 text-red-500 border-red-600/30',
      ALERT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      WARN: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      INFO: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      OK: 'bg-green-500/20 text-green-400 border-green-500/30',
      OFF: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
      UNK: 'bg-slate-500/20 text-slate-400 border-slate-500/30'
    };

    return styles[status] || styles.UNK;
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 3) return { color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: '🔴', label: 'High Confidence' };
    if (confidence === 2) return { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: '🟡', label: 'Medium Confidence' };
    return { color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: '🟢', label: 'Low Confidence' };
  };

  return (
    <div className="space-y-3">
      {visibleDetections.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-6xl mb-4 animate-float opacity-20">🛡️</div>
          <p className="text-slate-500">No recent detections</p>
          <p className="text-slate-600 text-sm mt-1">System is clean</p>
        </div>
      ) : (
        visibleDetections.map((detection, index) => {
          const isNew = newDetections.has(detection.id);
          const age = Date.now() - (detection.timestamp * 1000);
          const isRecent = age < 60000; // Less than 1 minute

          return (
            <div
              key={detection.id}
              className={`
                glass-card p-4 transition-all duration-500
                ${isNew ? 'animate-slide-in-left scale-105' : ''}
                ${index === 0 && isRecent ? 'ring-2 ring-purple-500/30' : ''}
              `}
              style={{
                animationDelay: isNew ? `${index * 50}ms` : '0ms'
              }}
            >
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className="text-2xl mt-1 opacity-80">
                  {getCategoryIcon(detection.category)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-semibold text-white truncate" title={detection.name}>
                      {detection.displayName || detection.name}
                    </h4>
                    {/* Show multiplier if present in details (e.g., "(x2)") */}
                    {detection.details && /\(x\d+\)/i.test(detection.details) && (
                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        {detection.details.match(/\(x(\d+)\)/i)?.[1]}x detected
                      </span>
                    )}
                    <span className={`
                      px-2 py-0.5 text-xs font-medium rounded-full border
                      ${getStatusBadge(detection.status)}
                    `}>
                      {detection.status}
                    </span>
                    {detection.confidence && detection.confidence > 1 && (
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getConfidenceBadge(detection.confidence).color}`}
                        title={`Detected by ${detection.confidence} sources: ${(detection.sources || []).join(', ')}`}
                      >
                        {getConfidenceBadge(detection.confidence).icon} {detection.confidence}x
                      </span>
                    )}
                    {isRecent && (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        Live
                      </span>
                    )}
                  </div>

                  {detection.groupedTypes && detection.groupedTypes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {detection.groupedTypes.map((type) => (
                        <span
                          key={type}
                          className="px-2 py-0.5 text-[10px] rounded-full bg-slate-800/70 border border-slate-700/70 text-slate-300"
                        >
                          {type}
                        </span>
                      ))}
                    </div>
                  )}

                  {detection.details && (
                    <p className="text-sm text-slate-400 mb-2 line-clamp-2">
                      {detection.details.replace(/\s*\(x\d+\)/gi, '')}
                    </p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="font-mono">
                      {new Date(detection.timestamp * 1000).toLocaleTimeString()}
                    </span>
                    <span>•</span>
                    <span className="capitalize">{detection.category}</span>
                    {detection.sources && detection.sources.length > 1 && (
                      <>
                        <span>•</span>
                        <span className="text-purple-400" title="Detection sources">
                          📊 {detection.sources.join(', ')}
                        </span>
                      </>
                    )}
                    {detection.detections && detection.detections > 1 && (
                      <>
                        <span>•</span>
                        <span className="text-slate-400" title="Total detections">
                          ×{detection.detections}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-8">
                  {onIgnoreDetection && (
                    <button
                      onClick={() => onIgnoreDetection(detection)}
                      className="p-1 text-slate-400 hover:text-red-400 transition-all duration-300 hover:scale-110"
                      title="Add to ignore list (permanent)"
                    >
                      <div className="relative group">
                        <div className="text-lg animate-bounce group-hover:animate-pulse filter drop-shadow-[0_0_8px_rgba(239,68,68,0.8)] text-red-400 group-hover:text-red-300">💀</div>
                        <div className="absolute inset-0 bg-red-500/20 rounded-full scale-0 group-hover:scale-150 transition-transform duration-300 opacity-0 group-hover:opacity-100"></div>
                      </div>
                    </button>
                  )}

                  {/* Status Indicator */}
                  <div className="relative">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[detection.status] }}
                    >
                      {isRecent && (
                        <div
                          className="absolute inset-0 rounded-full animate-ping"
                          style={{ backgroundColor: STATUS_COLORS[detection.status] }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Progress bar for recent detections */}
              {isRecent && (
                <div className="mt-3 h-0.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-[60s] ease-linear"
                    style={{
                      width: `${100 - (age / 600)}%`
                    }}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// Export memoized component for better performance
export default memo(DetectionFeed, (prevProps, nextProps) => {
  // Only re-render if detections array changes
  return (
    prevProps.detections === nextProps.detections &&
    prevProps.maxItems === nextProps.maxItems
  );
});
