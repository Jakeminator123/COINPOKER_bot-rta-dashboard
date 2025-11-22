"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ConfigFlowTooltip from "./ConfigFlowTooltip";

interface ConfigurationHelpOverlayProps {
  triggerElement?: React.ReactNode;
}

export default function ConfigurationHelpOverlay({
  triggerElement,
}: ConfigurationHelpOverlayProps) {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Set new timeout for 1.5 seconds
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      timeoutRef.current = null;
    }, 1500); // 1.5 seconds delay
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Don't close immediately on mouse leave - let user interact with overlay
    // Only close if mouse leaves the trigger area AND overlay is not being hovered
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Close overlay when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        overlayRef.current &&
        !overlayRef.current.contains(event.target as Node)
      ) {
        setIsVisible(false);
      }
    };

    if (isVisible) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isVisible]);

  const defaultTrigger = (
    <button
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="text-slate-400 hover:text-blue-400 transition-colors cursor-help p-2 rounded-lg hover:bg-slate-700/50"
      aria-label="Configuration help"
    >
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    </button>
  );

  return (
    <>
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-block"
      >
        {triggerElement || defaultTrigger}
      </div>

      <AnimatePresence>
        {isVisible && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setIsVisible(false)}
            />

            {/* Overlay */}
            <motion.div
              ref={overlayRef}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              onMouseEnter={() => {
                // Keep overlay open when hovering over it
                if (timeoutRef.current) {
                  clearTimeout(timeoutRef.current);
                  timeoutRef.current = null;
                }
                setIsVisible(true);
              }}
              onMouseLeave={() => {
                // Close when mouse leaves overlay
                setIsVisible(false);
              }}
            >
              <div className="bg-slate-900/95 backdrop-blur-xl border-2 border-slate-700 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-slate-900/95 backdrop-blur-xl border-b border-slate-700 p-6 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
                      <span className="text-2xl">⚙️</span>
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white">
                        Configuration
                      </h2>
                      <p className="text-slate-400 text-sm mt-1">
                        Manage all detection settings in one place. Changes are
                        automatically downloaded by scanners within 5 minutes.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsVisible(false)}
                    className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-700/50 rounded-lg"
                    aria-label="Close"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                  {/* How Configuration Works */}
                  <div className="bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <span className="text-2xl">ℹ️</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-blue-400 font-semibold text-lg">
                            How Configuration Works
                          </h3>
                          <ConfigFlowTooltip
                            explanation="Configuration Flow Explained:\n\nWhen you save changes in this interface, they are stored as JSON files in the dashboard's /configs folder. Python scanners running on player machines use the ConfigLoader component to automatically check for updates every 5 minutes. The ConfigLoader fetches configurations from the dashboard API, caches them in RAM (and optionally encrypted on disk), and makes them available to all detection segments.\n\nThe diagram below shows the complete flow from admin panel → dashboard storage → scanner download → segment usage."
                            position="bottom"
                            delay={200}
                          >
                            <button className="text-blue-400 hover:text-blue-300 transition-colors cursor-help">
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                            </button>
                          </ConfigFlowTooltip>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                          When you save changes here, they are stored in JSON
                          files. All scanners automatically download these
                          configurations when they connect to the dashboard.
                          Changes take effect within 5 minutes (scanners check
                          for updates every 5 minutes).
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Quick Guide */}
                  <div>
                    <p className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                      Quick Guide:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                        <div className="font-bold text-red-400 mb-2 flex items-center gap-2">
                          <span className="text-xl">🎯</span>
                          <span>Detection Rules</span>
                        </div>
                        <div className="text-sm text-slate-300">
                          WHAT to detect (the blacklist)
                        </div>
                        <div className="text-xs text-slate-400 mt-2">
                          Master list of programs, bots, and tools that trigger
                          alerts when detected.
                        </div>
                      </div>
                      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                        <div className="font-bold text-blue-400 mb-2 flex items-center gap-2">
                          <span className="text-xl">⚙️</span>
                          <span>Detection Settings</span>
                        </div>
                        <div className="text-sm text-slate-300">
                          HOW to detect (sensitivity & methods)
                        </div>
                        <div className="text-xs text-slate-400 mt-2">
                          Controls sensitivity, thresholds, and detection
                          methods for each segment.
                        </div>
                      </div>
                      <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                        <div className="font-bold text-purple-400 mb-2 flex items-center gap-2">
                          <span className="text-xl">🔧</span>
                          <span>System Configuration</span>
                        </div>
                        <div className="text-sm text-slate-300">
                          REFERENCE DATA (definitions & context)
                        </div>
                        <div className="text-xs text-slate-400 mt-2">
                          Reference definitions used by all segments for
                          context and identification.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

