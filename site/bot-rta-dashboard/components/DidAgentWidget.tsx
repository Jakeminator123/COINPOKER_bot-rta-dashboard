"use client";

import { useEffect, useMemo, useState } from "react";

type DidAgentWidgetProps = {
  agentUrl: string;
  title?: string;
};

export default function DidAgentWidget({
  agentUrl,
  title = "Intelligent Agent",
}: DidAgentWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [allowEmbed, setAllowEmbed] = useState(false);
  const [isIframeLoaded, setIsIframeLoaded] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAllowEmbed(true);
    } else {
      setIsIframeLoaded(false);
    }
  }, [isOpen]);

  const safeAgentUrl = useMemo(() => {
    try {
      const url = new URL(agentUrl);
      if (url.protocol !== "https:") {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  }, [agentUrl]);

  const iframeSrc = allowEmbed && safeAgentUrl ? safeAgentUrl : undefined;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {isOpen && (
        <div className="pointer-events-auto w-[min(360px,90vw)]">
          <div className="glass-card border border-white/10 bg-slate-950/80 backdrop-blur-xl rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
              <div>
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="text-xs text-slate-400">Live multimedia agent</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-200 transition"
                aria-label="Close D-ID agent"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-3 h-[min(480px,65vh)]">
              {iframeSrc ? (
                <div className="relative w-full h-full rounded-2xl overflow-hidden border border-white/5 bg-black/40">
                  {!isIframeLoaded && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-slate-300 bg-slate-950/60 gap-2">
                      <div className="loading-spinner"></div>
                      <p>Loading avatar stream…</p>
                    </div>
                  )}
                  <iframe
                    title="D-ID Interactive Agent"
                    src={iframeSrc}
                    className="w-full h-full border-0"
                    allow="camera; microphone; autoplay; clipboard-write; encrypted-media"
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onLoad={() => setIsIframeLoaded(true)}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center w-full h-full text-center text-sm text-slate-400 border border-dashed border-slate-700 rounded-2xl px-6">
                  <p>Could not load the agent because the embed URL is invalid.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-auto">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="w-14 h-14 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30 flex items-center justify-center hover:scale-105 active:scale-95 transition focus:outline-none focus:ring-2 focus:ring-white/50"
          aria-expanded={isOpen}
          aria-label={isOpen ? "Hide AI agent" : "Show AI agent"}
        >
          {isOpen ? (
            <svg
              className="w-6 h-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg
              className="w-6 h-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

