"use client";

import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";

// Navigation tabs configuration
// Each tab represents a major section of the dashboard
type Tab = {
  id: string;
  label: string;
  path: string;
  icon: string;
};

const TABS: Tab[] = [
  {
    id: "overview",
    label: "Overview",
    path: "/",
    icon: "🏠",
  },
  {
    id: "devices",
    label: "Device Manager",
    path: "/devices",
    icon: "📱",
  },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    icon: "⚙️",
  },
];

export default function NavigationTabs() {
  const pathname = usePathname();
  const router = useRouter();

  // Determine if a tab is active based on current pathname
  const isActive = (path: string) => {
    if (path === "/") {
      return pathname === "/";
    }
    return pathname?.startsWith(path);
  };

  return (
    <div className="mb-6 sm:mb-8">
      <nav
        className="flex flex-wrap gap-2 border-b border-slate-700/50 pb-2"
        aria-label="Main navigation"
      >
        {TABS.map((tab, index) => {
          const active = isActive(tab.path);
          return (
            <motion.button
              key={tab.id}
              onClick={() => router.push(tab.path)}
              className={`px-5 py-3 rounded-t-xl font-semibold transition-all duration-300 flex items-center gap-2.5 relative overflow-hidden group ${
                active
                  ? "bg-gradient-to-r from-indigo-500/90 via-purple-500/90 to-purple-600/90 text-white shadow-lg shadow-purple-500/25"
                  : "bg-slate-700/30 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200 hover:shadow-md"
              }`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: index * 0.1,
                type: "spring",
                stiffness: 300,
                damping: 25,
              }}
              whileHover={{ scale: active ? 1 : 1.05, y: -2 }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Background glow effect for active tab */}
              {active && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-indigo-400/20 via-purple-400/20 to-purple-500/20"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                />
              )}

              <span className="text-lg relative z-10">{tab.icon}</span>
              <span className="text-sm sm:text-base relative z-10 font-medium">
                {tab.label}
              </span>

              {/* Active indicator bar with smooth animation */}
              {active && (
                <motion.div
                  className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-400 via-purple-400 to-purple-500"
                  layoutId="activeTab"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}

              {/* Hover effect shimmer */}
              {!active && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
                  initial={{ x: "-100%" }}
                  whileHover={{ x: "100%" }}
                  transition={{ duration: 0.6 }}
                />
              )}
            </motion.button>
          );
        })}
      </nav>
    </div>
  );
}
