"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

// Professional Card Component - to be used across all pages
export function ProCard({ 
  children, 
  className = "",
  hover = true 
}: { 
  children: ReactNode; 
  className?: string;
  hover?: boolean;
}) {
  return (
    <motion.div
      className={`
        bg-slate-800/50 
        backdrop-blur-sm 
        border 
        border-slate-700/50 
        rounded-lg 
        shadow-lg
        ${className}
      `}
      whileHover={hover ? { y: -2, boxShadow: "0 10px 30px -5px rgba(0, 0, 0, 0.3)" } : {}}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.div>
  );
}

// Professional Button - consistent across all pages
export function ProButton({
  children,
  onClick,
  variant = "primary",
  size = "md",
  className = "",
  disabled = false,
  ...props
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
}) {
  const getVariantStyles = () => {
    switch (variant) {
      case "primary":
        return "bg-indigo-600 hover:bg-indigo-500 text-white";
      case "secondary":
        return "bg-slate-700 hover:bg-slate-600 text-white";
      case "danger":
        return "bg-red-600/80 hover:bg-red-500/80 text-white";
      case "success":
        return "bg-green-600/80 hover:bg-green-500/80 text-white";
      default:
        return "";
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case "sm":
        return "px-3 py-1.5 text-sm";
      case "lg":
        return "px-6 py-3 text-lg";
      default:
        return "px-4 py-2";
    }
  };

  return (
    <motion.button
      className={`
        ${getSizeStyles()}
        ${getVariantStyles()}
        rounded-lg
        font-medium
        transition-colors
        disabled:opacity-50
        disabled:cursor-not-allowed
        ${className}
      `}
      whileHover={!disabled ? { scale: 1.02 } : {}}
      whileTap={!disabled ? { scale: 0.98 } : {}}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </motion.button>
  );
}

// Status Badge - for consistent status indicators
export function StatusBadge({
  status,
  children,
}: {
  status: "active" | "inactive" | "warning" | "error";
  children: ReactNode;
}) {
  const getStatusStyles = () => {
    switch (status) {
      case "active":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "inactive":
        return "bg-slate-500/20 text-slate-400 border-slate-500/30";
      case "warning":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "error":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      default:
        return "";
    }
  };

  return (
    <div
      className={`
        px-3 py-1 
        rounded-lg 
        text-sm 
        font-medium
        border
        ${getStatusStyles()}
      `}
    >
      {children}
    </div>
  );
}

// Section Header - for consistent section headers
export function SectionHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mb-6">
      {icon && (
        <div className="p-3 bg-indigo-600/20 rounded-lg border border-indigo-600/30">
          {icon}
        </div>
      )}
      <div>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {subtitle && <p className="text-slate-400 text-sm mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

// Data Table - for consistent table styling
export function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-700">
            {headers.map((header, i) => (
              <th
                key={i}
                className="text-left px-4 py-3 text-slate-300 font-medium text-sm"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <motion.tr
              key={i}
              className="border-b border-slate-700/50 hover:bg-slate-800/30"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-slate-300">
                  {cell}
                </td>
              ))}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Professional Page Layout
export function ProPageLayout({
  children,
  showBackground = true,
}: {
  children: ReactNode;
  showBackground?: boolean;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {showBackground && (
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          {/* Subtle grid pattern */}
          <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.02]" />
          {/* Very subtle gradient orbs */}
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
        </div>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// Loading Spinner - simple and professional
export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const getSizeClass = () => {
    switch (size) {
      case "sm":
        return "w-6 h-6";
      case "lg":
        return "w-12 h-12";
      default:
        return "w-8 h-8";
    }
  };

  return (
    <motion.div
      className={`${getSizeClass()} border-3 border-slate-700 border-t-indigo-500 rounded-full`}
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    />
  );
}
