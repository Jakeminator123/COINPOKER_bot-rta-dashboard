"use client";

import { motion } from "framer-motion";

export function PulseLoader({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const getSizeClass = () => {
    switch (size) {
      case "sm":
        return "w-8 h-8";
      case "lg":
        return "w-16 h-16";
      default:
        return "w-12 h-12";
    }
  };

  return (
    <div className="flex items-center justify-center gap-2">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className={`${getSizeClass()} bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full`}
          animate={{
            scale: [1, 1.5, 1],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            delay: i * 0.2,
          }}
        />
      ))}
    </div>
  );
}

export function SpinnerLoader({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const getSizeClass = () => {
    switch (size) {
      case "sm":
        return "w-8 h-8";
      case "lg":
        return "w-16 h-16";
      default:
        return "w-12 h-12";
    }
  };

  return (
    <motion.div
      className={`${getSizeClass()} border-4 border-indigo-500/30 border-t-indigo-500 rounded-full`}
      animate={{ rotate: 360 }}
      transition={{
        duration: 1,
        repeat: Infinity,
        ease: "linear",
      }}
    />
  );
}

export function DNALoader() {
  return (
    <div className="flex items-center justify-center">
      <svg width="60" height="60" viewBox="0 0 60 60">
        <motion.circle
          cx="15"
          cy="30"
          r="8"
          fill="url(#gradient1)"
          animate={{
            cy: [30, 15, 30, 45, 30],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        <motion.circle
          cx="30"
          cy="30"
          r="8"
          fill="url(#gradient2)"
          animate={{
            cy: [30, 45, 30, 15, 30],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 0.5,
          }}
        />
        <motion.circle
          cx="45"
          cy="30"
          r="8"
          fill="url(#gradient3)"
          animate={{
            cy: [30, 15, 30, 45, 30],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1,
          }}
        />
        <defs>
          <linearGradient id="gradient1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient id="gradient2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
          <linearGradient id="gradient3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export function OrbitLoader() {
  return (
    <div className="relative w-20 h-20">
      {/* Center dot */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-indigo-500 rounded-full" />
      
      {/* Orbiting dots */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute top-1/2 left-1/2 w-full h-full"
          style={{
            transformOrigin: "center",
          }}
          animate={{ rotate: 360 }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "linear",
            delay: i * 0.7,
          }}
        >
          <div
            className="absolute w-2 h-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
            style={{
              top: "0",
              left: "calc(50% - 4px)",
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}

export function LoadingOverlay({ 
  message = "Loading...", 
  variant = "spinner" 
}: { 
  message?: string; 
  variant?: "spinner" | "pulse" | "dna" | "orbit";
}) {
  const getLoader = () => {
    switch (variant) {
      case "pulse":
        return <PulseLoader size="lg" />;
      case "dna":
        return <DNALoader />;
      case "orbit":
        return <OrbitLoader />;
      default:
        return <SpinnerLoader size="lg" />;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: "spring", stiffness: 200 }}
        className="p-8 bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/10 rounded-3xl backdrop-blur-xl shadow-2xl"
      >
        <div className="flex flex-col items-center gap-6">
          {getLoader()}
          <motion.p
            className="text-white/80 font-medium text-lg"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            {message}
          </motion.p>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function SkeletonLoader({ 
  className = "", 
  variant = "text" 
}: { 
  className?: string; 
  variant?: "text" | "card" | "avatar";
}) {
  const getVariantClass = () => {
    switch (variant) {
      case "card":
        return "h-32 rounded-xl";
      case "avatar":
        return "w-12 h-12 rounded-full";
      default:
        return "h-4 rounded";
    }
  };

  return (
    <motion.div
      className={`bg-gradient-to-r from-slate-700/50 via-slate-600/50 to-slate-700/50 ${getVariantClass()} ${className}`}
      animate={{
        backgroundPosition: ["200% 0", "-200% 0"],
      }}
      transition={{
        duration: 3,
        repeat: Infinity,
        ease: "linear",
      }}
      style={{
        backgroundSize: "200% 100%",
      }}
    />
  );
}
