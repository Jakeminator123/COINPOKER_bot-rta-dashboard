"use client";

import { motion, HTMLMotionProps } from "framer-motion";
import { ReactNode } from "react";

interface AnimatedButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "success" | "ghost";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  glow?: boolean;
  gradient?: boolean;
  loading?: boolean;
}

export function AnimatedButton({
  children,
  variant = "primary",
  size = "md",
  icon,
  glow = false,
  gradient = false,
  loading = false,
  className = "",
  disabled,
  ...props
}: AnimatedButtonProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case "primary":
        return gradient
          ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white border-transparent"
          : "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-600";
      case "secondary":
        return "bg-white/10 hover:bg-white/20 text-white border-white/20";
      case "danger":
        return gradient
          ? "bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500 text-white border-transparent"
          : "bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/30";
      case "success":
        return gradient
          ? "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white border-transparent"
          : "bg-green-500/20 hover:bg-green-500/30 text-green-400 border-green-500/30";
      case "ghost":
        return "bg-transparent hover:bg-white/10 text-white border-transparent";
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

  const isDisabled = disabled || loading;

  return (
    <motion.button
      className={`
        relative
        ${getSizeStyles()}
        ${getVariantStyles()}
        rounded-xl
        font-medium
        border
        backdrop-blur-xl
        transition-all
        duration-300
        disabled:opacity-50
        disabled:cursor-not-allowed
        ${className}
      `}
      whileHover={!isDisabled ? { scale: 1.05 } : {}}
      whileTap={!isDisabled ? { scale: 0.95 } : {}}
      disabled={isDisabled}
      {...props}
    >
      {/* Glow Effect */}
      {glow && !isDisabled && (
        <motion.div
          className="absolute -inset-1 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl blur-lg opacity-50"
          animate={{
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      )}

      {/* Button Content */}
      <div className="relative flex items-center justify-center gap-2">
        {loading ? (
          <motion.div
            className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          />
        ) : (
          <>
            {icon && <span>{icon}</span>}
            {children}
          </>
        )}
      </div>

      {/* Hover Shine Effect */}
      <motion.div
        className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-white/10 to-transparent"
        initial={{ x: "-100%" }}
        whileHover={{ x: "100%" }}
        transition={{ duration: 0.6 }}
        style={{ pointerEvents: "none" }}
      />
    </motion.button>
  );
}

// Floating Action Button
export function FloatingActionButton({
  icon,
  onClick,
  position = "bottom-right",
}: {
  icon: ReactNode;
  onClick?: () => void;
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
}) {
  const getPositionStyles = () => {
    switch (position) {
      case "bottom-left":
        return "bottom-8 left-8";
      case "top-right":
        return "top-8 right-8";
      case "top-left":
        return "top-8 left-8";
      default:
        return "bottom-8 right-8";
    }
  };

  return (
    <motion.button
      className={`fixed ${getPositionStyles()} z-50 p-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-full shadow-2xl shadow-indigo-500/30`}
      whileHover={{ scale: 1.1, rotate: 15 }}
      whileTap={{ scale: 0.9 }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 200 }}
      onClick={onClick}
    >
      {/* Pulse Effect */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full"
        animate={{
          scale: [1, 1.5, 1.5],
          opacity: [0.5, 0, 0],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
        }}
      />
      
      {/* Icon */}
      <div className="relative">
        {icon}
      </div>
    </motion.button>
  );
}
