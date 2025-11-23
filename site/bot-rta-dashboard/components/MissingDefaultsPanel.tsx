'use client';

import { useState } from 'react';
import { ConfigDiff } from '@/lib/utils/config-diff';

interface MissingDefaultsPanelProps {
  category: string;
  diff: ConfigDiff;
  onRestore: (items: string[]) => Promise<void>;
}

export default function MissingDefaultsPanel({ category: _category, diff, onRestore }: MissingDefaultsPanelProps) {
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoredItems, setRestoredItems] = useState<Set<string>>(new Set());

  if (diff.removedItems.length === 0) {
    return null;
  }

  const handleRestoreAll = async () => {
    setIsRestoring(true);
    try {
      await onRestore(diff.removedItems);
      setRestoredItems(new Set(diff.removedItems));
    } catch (error) {
      console.error('Failed to restore items:', error);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRestoreItem = async (item: string) => {
    setIsRestoring(true);
    try {
      await onRestore([item]);
      setRestoredItems(prev => new Set([...prev, item]));
    } catch (error) {
      console.error('Failed to restore item:', error);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
          <span>⚠️</span>
          <span>Missing Default Items ({diff.removedItems.length})</span>
        </h3>
        <button
          onClick={handleRestoreAll}
          disabled={isRestoring}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
        >
          {isRestoring ? 'Restoring...' : 'Restore All'}
        </button>
      </div>

      <div className="space-y-2 max-h-40 overflow-y-auto">
        {diff.removedItems.map((item, index) => {
          const isRestored = restoredItems.has(item);
          return (
            <div key={index} className="flex items-center justify-between p-2 bg-slate-700 rounded">
              <span className="text-slate-300 text-sm font-mono">{item}</span>
              <button
                onClick={() => handleRestoreItem(item)}
                disabled={isRestoring || isRestored}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  isRestored
                    ? 'bg-green-600 text-white cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-500 text-white'
                }`}
              >
                {isRestored ? 'Restored' : 'Restore'}
              </button>
            </div>
          );
        })}
      </div>

      {diff.removedItems.length > 0 && (
        <div className="mt-3 text-xs text-slate-400">
          <p>These items were removed from the default configuration and may affect detection accuracy.</p>
        </div>
      )}
    </div>
  );
}
