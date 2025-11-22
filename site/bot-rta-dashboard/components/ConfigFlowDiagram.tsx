"use client";

import { motion } from "framer-motion";

interface ConfigFlowDiagramProps {
  className?: string;
}

export default function ConfigFlowDiagram({ className = "" }: ConfigFlowDiagramProps) {
  return (
    <div className={`bg-slate-800/50 rounded-lg p-4 ${className}`}>
      <div className="text-xs text-slate-300 space-y-3">
        {/* Title */}
        <div className="text-sm font-semibold text-white mb-2 text-center">
          Configuration Flow Diagram
        </div>

        {/* Flow Steps */}
        <div className="space-y-2">
          {/* Step 1: Admin saves */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/50 flex items-center justify-center text-blue-400 font-bold text-xs flex-shrink-0">
              1
            </div>
            <div className="flex-1">
              <div className="font-medium text-blue-400">Admin Panel</div>
              <div className="text-slate-400">Admin saves configuration changes</div>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex items-center gap-2 ml-3">
            <div className="w-6"></div>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-green-500/50"></div>
            <motion.div
              animate={{ x: [0, 4, 0] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="text-green-400"
            >
              →
            </motion.div>
          </div>

          {/* Step 2: Dashboard stores */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-green-500/20 border border-green-500/50 flex items-center justify-center text-green-400 font-bold text-xs flex-shrink-0">
              2
            </div>
            <div className="flex-1">
              <div className="font-medium text-green-400">Dashboard Storage</div>
              <div className="text-slate-400">JSON files saved in /configs folder</div>
              <div className="text-slate-500 text-xs mt-0.5">
                (programs_registry.json, network_config.json, etc.)
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex items-center gap-2 ml-3">
            <div className="w-6"></div>
            <div className="flex-1 h-px bg-gradient-to-r from-green-500/50 to-purple-500/50"></div>
            <motion.div
              animate={{ x: [0, 4, 0] }}
              transition={{ repeat: Infinity, duration: 2, delay: 0.5 }}
              className="text-purple-400"
            >
              →
            </motion.div>
          </div>

          {/* Step 3: Scanner requests */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/50 flex items-center justify-center text-purple-400 font-bold text-xs flex-shrink-0">
              3
            </div>
            <div className="flex-1">
              <div className="font-medium text-purple-400">Python Scanner</div>
              <div className="text-slate-400">ConfigLoader checks for updates</div>
              <div className="text-slate-500 text-xs mt-0.5">
                (Every 5 minutes or on startup)
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex items-center gap-2 ml-3">
            <div className="w-6"></div>
            <div className="flex-1 h-px bg-gradient-to-r from-purple-500/50 to-orange-500/50"></div>
            <motion.div
              animate={{ x: [0, 4, 0] }}
              transition={{ repeat: Infinity, duration: 2, delay: 1 }}
              className="text-orange-400"
            >
              →
            </motion.div>
          </div>

          {/* Step 4: API serves */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-orange-500/20 border border-orange-500/50 flex items-center justify-center text-orange-400 font-bold text-xs flex-shrink-0">
              4
            </div>
            <div className="flex-1">
              <div className="font-medium text-orange-400">Dashboard API</div>
              <div className="text-slate-400">GET /api/configs returns all JSON configs</div>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex items-center gap-2 ml-3">
            <div className="w-6"></div>
            <div className="flex-1 h-px bg-gradient-to-r from-orange-500/50 to-indigo-500/50"></div>
            <motion.div
              animate={{ x: [0, 4, 0] }}
              transition={{ repeat: Infinity, duration: 2, delay: 1.5 }}
              className="text-indigo-400"
            >
              →
            </motion.div>
          </div>

          {/* Step 5: ConfigLoader caches */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/50 flex items-center justify-center text-indigo-400 font-bold text-xs flex-shrink-0">
              5
            </div>
            <div className="flex-1">
              <div className="font-medium text-indigo-400">ConfigLoader Cache</div>
              <div className="text-slate-400">Stores in RAM (always) + encrypted disk cache (optional)</div>
              <div className="text-slate-500 text-xs mt-0.5">
                Cache valid for 5 minutes
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex items-center gap-2 ml-3">
            <div className="w-6"></div>
            <div className="flex-1 h-px bg-gradient-to-r from-indigo-500/50 to-pink-500/50"></div>
            <motion.div
              animate={{ x: [0, 4, 0] }}
              transition={{ repeat: Infinity, duration: 2, delay: 2 }}
              className="text-pink-400"
            >
              →
            </motion.div>
          </div>

          {/* Step 6: Segments use */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-pink-500/20 border border-pink-500/50 flex items-center justify-center text-pink-400 font-bold text-xs flex-shrink-0">
              6
            </div>
            <div className="flex-1">
              <div className="font-medium text-pink-400">Detection Segments</div>
              <div className="text-slate-400">All segments read configs via ConfigLoader.get()</div>
              <div className="text-slate-500 text-xs mt-0.5">
                (Automation, Behaviour, Network, Screen, VM, etc.)
              </div>
            </div>
          </div>
        </div>

        {/* Key Points */}
        <div className="mt-4 pt-3 border-t border-slate-700 space-y-1">
          <div className="text-xs font-semibold text-slate-300 mb-1">Key Points:</div>
          <div className="flex items-start gap-2 text-slate-400">
            <span className="text-indigo-400 mt-0.5">•</span>
            <span>Changes take effect within 5 minutes (scanner check interval)</span>
          </div>
          <div className="flex items-start gap-2 text-slate-400">
            <span className="text-indigo-400 mt-0.5">•</span>
            <span>ConfigLoader prioritizes: Dashboard → Cache → Local JSON files</span>
          </div>
          <div className="flex items-start gap-2 text-slate-400">
            <span className="text-indigo-400 mt-0.5">•</span>
            <span>All segments use the same unified configuration source</span>
          </div>
        </div>
      </div>
    </div>
  );
}

