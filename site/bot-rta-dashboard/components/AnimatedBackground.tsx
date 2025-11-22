"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

type AnimatedBackgroundProps = {
  intensity?: "low" | "medium" | "high";
  particleCount?: number;
  showFloatingDots?: boolean;
};

type GlowEffectProps = {
  color?: "indigo" | "purple" | "cyan" | "green" | "red";
  intensity?: "low" | "medium" | "high";
  className?: string;
};

export function AnimatedBackground({ 
  intensity = "medium",
  particleCount = 20,
  showFloatingDots = true 
}: AnimatedBackgroundProps = {}) {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; size: number }>>([]);

  useEffect(() => {
    const newParticles = Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 4 + 1,
    }));
    setParticles(newParticles);
  }, [particleCount]);

  // Intensity-based opacity multipliers
  const opacityMultipliers = {
    low: { orbs: 0.03, dots: 0.03, grid: 0.03 },
    medium: { orbs: 0.05, dots: 0.05, grid: 0.05 },
    high: { orbs: 0.08, dots: 0.08, grid: 0.08 },
  };

  const opacity = opacityMultipliers[intensity];

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      {/* Subtle Gradient Orbs */}
      <motion.div
        className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500 rounded-full blur-3xl"
        style={{ opacity: opacity.orbs }}
        animate={{
          x: [0, 50, 0],
          y: [0, -25, 0],
        }}
        transition={{
          duration: 30,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500 rounded-full blur-3xl"
        style={{ opacity: opacity.orbs }}
        animate={{
          x: [0, -50, 0],
          y: [0, 25, 0],
        }}
        transition={{
          duration: 35,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Subtle Floating Dots */}
      {showFloatingDots && particles.slice(0, Math.floor(particleCount / 2)).map((particle) => (
        <motion.div
          key={particle.id}
          className="absolute bg-white rounded-full"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            opacity: opacity.dots,
          }}
          animate={{
            y: [-10, 10, -10],
            opacity: [opacity.dots * 0.5, opacity.dots, opacity.dots * 0.5],
          }}
          transition={{
            duration: Math.random() * 10 + 10,
            repeat: Infinity,
            ease: "easeInOut",
            delay: Math.random() * 2,
          }}
        />
      ))}

      {/* Grid Pattern */}
      <svg className="absolute inset-0 w-full h-full" style={{ opacity: opacity.grid }} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
    </div>
  );
}

export function GlowEffect({
  color = "indigo",
  intensity = "medium",
  className = "",
}: GlowEffectProps) {
  const getIntensityClass = () => {
    switch (intensity) {
      case "low":
        return "opacity-10";
      case "high":
        return "opacity-30";
      default:
        return "opacity-20";
    }
  };

  const getColorClass = () => {
    switch (color) {
      case "purple":
        return "bg-purple-500";
      case "cyan":
        return "bg-cyan-500";
      case "green":
        return "bg-green-500";
      case "red":
        return "bg-red-500";
      default:
        return "bg-indigo-500";
    }
  };

  return (
    <motion.div
      className={`absolute inset-0 ${getColorClass()} blur-2xl ${getIntensityClass()} ${className}`}
      animate={{
        scale: [1, 1.1, 1],
        opacity: [0.3, 0.5, 0.3],
      }}
      transition={{
        duration: 3,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}
