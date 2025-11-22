"use client";

import { motion } from "framer-motion";
import SpinningLogo3D from "./SpinningLogo3D";

// Animated Settings Gear Icon
export function SettingsGearIcon({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <motion.svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      animate={{ rotate: 360 }}
      transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.364-6.364l-1.414 1.414M7.05 16.95l-1.414 1.414m12.728 0l-1.414-1.414M7.05 7.05L5.636 5.636M12 8a4 4 0 100 8 4 4 0 000-8z"
      />
      <circle cx="12" cy="12" r="3" />
    </motion.svg>
  );
}

// Database Icon with Pulse Animation
export function DatabaseIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <motion.svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.02, 1] }}
      transition={{ duration: 4, repeat: Infinity }}
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </motion.svg>
  );
}

// Shield Icon with Glow Effect
export function ShieldIcon({ className = "w-6 h-6", isActive = false }: { className?: string; isActive?: boolean }) {
  return (
    <motion.div
      className="relative inline-block"
      animate={isActive ? { scale: [1, 1.1, 1] } : {}}
      transition={{ duration: 0.5 }}
    >
      {isActive && (
        <motion.div
          className="absolute inset-0 bg-green-500 rounded-full blur-lg"
          animate={{ opacity: [0.2, 0.3, 0.2] }}
          transition={{ duration: 3, repeat: Infinity }}
        />
      )}
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 2L4 7v6c0 4 3.5 7.5 8 8.5c4.5-1 8-4.5 8-8.5V7l-8-5z"
        />
        {isActive && (
          <motion.path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          />
        )}
      </svg>
    </motion.div>
  );
}

// Network Icon with Connection Animation
export function NetworkIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <motion.circle
        cx="12"
        cy="12"
        r="3"
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 3, repeat: Infinity }}
      />
      <motion.path
        d="M12 2v7M12 15v7M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h7M15 12h7M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24"
        initial={{ opacity: 0.3 }}
        animate={{ opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 4, repeat: Infinity, staggerChildren: 0.1 }}
      />
    </svg>
  );
}

// Detection Icon with 3D Spinning Logo
export function DetectionIcon({ className = "w-6 h-6" }: { className?: string }) {
  // Extract size from className (e.g., "w-10 h-10" -> 40px)
  // Tailwind: w-6=24px, w-8=32px, w-10=40px, w-12=48px, etc.
  const sizeMatch = className.match(/w-(\d+)/);
  const size = sizeMatch ? parseInt(sizeMatch[1]) * 4 : 24; // Convert Tailwind size to px
  
  // Remove color classes from className as they don't apply to 3D logo
  const sizeClasses = className.split(' ').filter(cls => cls.startsWith('w-') || cls.startsWith('h-')).join(' ');
  
  return (
    <div 
      className={`relative inline-block ${sizeClasses || className}`} 
      style={{ 
        width: `${size}px`, 
        height: `${size}px`,
        zIndex: 10, // Ensure it's above backdrop-blur
        position: 'relative'
      }}
    >
      <SpinningLogo3D width={size} height={size} />
    </div>
  );
}

// Configuration Icon with Floating Elements
export function ConfigIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <motion.div className="relative inline-block">
      <motion.div
        className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-500 rounded-full"
        animate={{ y: [-2, 2, -2] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <motion.div
        className="absolute -bottom-1 -left-1 w-2 h-2 bg-purple-500 rounded-full"
        animate={{ y: [2, -2, 2] }}
        transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
      />
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    </motion.div>
  );
}

// Animated Check Mark
export function CheckIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <motion.svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
    >
      <motion.path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
      />
    </motion.svg>
  );
}

// Animated Arrow
export function ArrowIcon({ direction = "right", className = "w-5 h-5" }: { direction?: string; className?: string }) {
  const getPath = () => {
    switch (direction) {
      case "up":
        return "M12 19V5M5 12l7-7 7 7";
      case "down":
        return "M12 5v14M19 12l-7 7-7-7";
      case "left":
        return "M19 12H5M12 19l-7-7 7-7";
      default:
        return "M5 12h14M12 5l7 7-7 7";
    }
  };

  return (
    <motion.svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      whileHover={{ x: direction === "right" ? 3 : direction === "left" ? -3 : 0 }}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={getPath()} />
    </motion.svg>
  );
}
