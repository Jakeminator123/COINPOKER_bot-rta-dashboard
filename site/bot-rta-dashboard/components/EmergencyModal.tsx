'use client';

interface EmergencyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  playerId?: string | null;
}

export default function EmergencyModal({ isOpen, onClose, onConfirm, playerId }: EmergencyModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-red-500/30 rounded-xl max-w-lg w-full overflow-hidden shadow-xl">
        <div className="p-6 border-b border-red-500/20 flex items-center justify-between">
          <h2 className="text-xl font-bold text-red-400">Emergency Mode</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-red-400 mb-2">BLOCK PLAYER?</div>
            {playerId && (
              <div className="text-sm text-slate-400">Player: {playerId}</div>
            )}
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-slate-300">
            This action will restrict the player pending further review. Confirm only if risk is deemed high and immediate intervention is required.
          </div>
        </div>

        <div className="p-6 border-t border-red-500/20 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white">Cancel</button>
          <button
            onClick={() => { onConfirm?.(); onClose(); }}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white"
          >
            Confirm Block
          </button>
        </div>
      </div>
    </div>
  );
}


