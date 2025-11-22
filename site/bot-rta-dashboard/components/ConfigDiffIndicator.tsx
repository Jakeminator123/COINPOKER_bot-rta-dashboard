'use client';

import { ConfigDiff } from '@/lib/config-diff';

interface ConfigDiffIndicatorProps {
  diff: ConfigDiff;
  category: string;
}

export default function ConfigDiffIndicator({ diff, category: _category }: ConfigDiffIndicatorProps) {
  if (!diff.hasChanges) {
    return (
      <div className="flex items-center gap-1 px-2 py-1 bg-green-500/20 border border-green-500/50 rounded text-green-400 text-xs">
        <span>✅</span>
        <span>Default</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 px-2 py-1 bg-red-500/20 border border-red-500/50 rounded text-red-400 text-xs">
        <span>⚠️</span>
        <span>Modified</span>
      </div>

      {diff.addedItems.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 bg-green-500/20 border border-green-500/50 rounded text-green-400 text-xs">
          <span>+</span>
          <span>{diff.addedItems.length}</span>
        </div>
      )}

      {diff.removedItems.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 border border-yellow-500/50 rounded text-yellow-400 text-xs">
          <span>-</span>
          <span>{diff.removedItems.length}</span>
        </div>
      )}

      {diff.modifiedItems.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 bg-blue-500/20 border border-blue-500/50 rounded text-blue-400 text-xs">
          <span>~</span>
          <span>{diff.modifiedItems.length}</span>
        </div>
      )}
    </div>
  );
}
