"use client";

import { useEffect, useRef, useCallback } from "react";

type ParticleWaveBackgroundProps = {
  /** Base color scheme - blends with your aurora gradient */
  colorScheme?: "purple" | "pink" | "cyan" | "mixed";
  /** Number of particles (more = denser waves, heavier performance) */
  particleDensity?: "low" | "medium" | "high";
  /** Wave animation speed */
  speed?: "slow" | "medium" | "fast";
  /** Overall opacity of the particle layer */
  opacity?: number;
  /** Whether to show the effect */
  enabled?: boolean;
};

/**
 * Canvas-based particle wave animation inspired by Skal Ventures template.
 * Creates flowing topographic wave patterns that complement the aurora background.
 * 
 * Uses requestAnimationFrame for smooth 60fps animation with automatic
 * cleanup on unmount.
 */
export function ParticleWaveBackground({
  colorScheme = "mixed",
  particleDensity = "medium",
  speed = "medium",
  opacity = 0.6,
  enabled = true,
}: ParticleWaveBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  // Density settings (columns x rows grid)
  const getDensity = useCallback(() => {
    switch (particleDensity) {
      case "low": return { cols: 50, rows: 30 };
      case "high": return { cols: 120, rows: 70 };
      default: return { cols: 80, rows: 50 };
    }
  }, [particleDensity]);

  // Speed multiplier
  const getSpeedMultiplier = useCallback(() => {
    switch (speed) {
      case "slow": return 0.0003;
      case "fast": return 0.0012;
      default: return 0.0006;
    }
  }, [speed]);

  // Color function based on position and time
  const getColor = useCallback((x: number, y: number, time: number, canvasWidth: number, canvasHeight: number) => {
    const normalizedX = x / canvasWidth;
    const normalizedY = y / canvasHeight;
    
    // Create flowing color gradients based on position and time
    const colorPhase = (normalizedX * 0.5 + normalizedY * 0.3 + time * 0.1) % 1;
    
    switch (colorScheme) {
      case "purple":
        // Purple to indigo gradient (matches aurora)
        const purpleR = Math.floor(120 + colorPhase * 30);
        const purpleG = Math.floor(80 + Math.sin(colorPhase * Math.PI) * 40);
        const purpleB = Math.floor(200 + Math.sin(colorPhase * Math.PI * 2) * 55);
        return `rgba(${purpleR}, ${purpleG}, ${purpleB}, ${opacity})`;
      
      case "pink":
        // Pink to magenta gradient
        const pinkR = Math.floor(220 + Math.sin(colorPhase * Math.PI) * 35);
        const pinkG = Math.floor(100 + colorPhase * 50);
        const pinkB = Math.floor(180 + Math.sin(colorPhase * Math.PI * 2) * 75);
        return `rgba(${pinkR}, ${pinkG}, ${pinkB}, ${opacity})`;
      
      case "cyan":
        // Cyan to teal (for variety)
        const cyanR = Math.floor(50 + colorPhase * 30);
        const cyanG = Math.floor(180 + Math.sin(colorPhase * Math.PI) * 50);
        const cyanB = Math.floor(200 + Math.sin(colorPhase * Math.PI * 2) * 55);
        return `rgba(${cyanR}, ${cyanG}, ${cyanB}, ${opacity})`;
      
      default: // "mixed" - flowing between purple, pink, and hints of cyan
        const mixPhase = (colorPhase + time * 0.05) % 1;
        let r, g, b;
        
        if (mixPhase < 0.33) {
          // Purple zone
          const t = mixPhase / 0.33;
          r = Math.floor(99 + t * 60);  // indigo to purple
          g = Math.floor(102 + t * 20);
          b = Math.floor(241 - t * 40);
        } else if (mixPhase < 0.66) {
          // Pink zone
          const t = (mixPhase - 0.33) / 0.33;
          r = Math.floor(159 + t * 77);  // purple to pink
          g = Math.floor(122 - t * 50);
          b = Math.floor(201 - t * 48);
        } else {
          // Back to purple with cyan hints
          const t = (mixPhase - 0.66) / 0.34;
          r = Math.floor(236 - t * 137);  // pink back to indigo
          g = Math.floor(72 + t * 30);
          b = Math.floor(153 + t * 88);
        }
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
  }, [colorScheme, opacity]);

  useEffect(() => {
    if (!enabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { cols, rows } = getDensity();
    const speedMultiplier = getSpeedMultiplier();

    // Handle resize
    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Animation loop
    const animate = (timestamp: number) => {
      const deltaTime = timestamp - timeRef.current;
      timeRef.current = timestamp;

      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;

      // Clear with transparency
      ctx.clearRect(0, 0, width, height);

      const cellWidth = width / cols;
      const cellHeight = height / rows;
      const time = timestamp * speedMultiplier;

      // Draw particles in a wave pattern
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const baseX = col * cellWidth + cellWidth / 2;
          const baseY = row * cellHeight + cellHeight / 2;

          // Create wave displacement using multiple sine waves
          // This creates the flowing topographic effect
          const wave1 = Math.sin(col * 0.1 + time * 2) * 8;
          const wave2 = Math.sin(row * 0.08 + time * 1.5) * 6;
          const wave3 = Math.sin((col + row) * 0.05 + time) * 10;
          const wave4 = Math.cos(col * 0.12 - time * 0.8) * 5;
          const wave5 = Math.sin(row * 0.15 + col * 0.08 + time * 1.2) * 7;

          // Combine waves for fluid motion
          const offsetX = wave1 + wave4;
          const offsetY = wave2 + wave3 + wave5;

          const x = baseX + offsetX;
          const y = baseY + offsetY;

          // Particle size varies with wave intensity (creates depth)
          const intensityFactor = 0.5 + Math.abs(Math.sin(col * 0.1 + row * 0.08 + time)) * 0.5;
          const particleSize = (1 + intensityFactor * 1.5) * (width / 1000);

          // Get color based on position and time
          const color = getColor(x, y, time, width, height);

          // Draw particle
          ctx.beginPath();
          ctx.arc(x, y, particleSize, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [enabled, getDensity, getSpeedMultiplier, getColor]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ 
        zIndex: 1,
        mixBlendMode: "screen", // Blends nicely with dark aurora background
      }}
    />
  );
}

/**
 * Simplified version using CSS only - lighter on performance
 * Good for devices that struggle with canvas animations
 */
export function ParticleWaveBackgroundLite({
  enabled = true,
}: { enabled?: boolean }) {
  if (!enabled) return null;

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 1 }}>
      {/* Animated gradient waves using CSS */}
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% 50%, rgba(99, 102, 241, 0.4), transparent),
            radial-gradient(ellipse 60% 40% at 30% 70%, rgba(236, 72, 153, 0.3), transparent),
            radial-gradient(ellipse 70% 45% at 70% 30%, rgba(139, 92, 246, 0.35), transparent)
          `,
          animation: "waveShift 20s ease-in-out infinite",
        }}
      />
      <style jsx>{`
        @keyframes waveShift {
          0%, 100% {
            transform: translateY(0) scale(1);
            filter: blur(60px);
          }
          25% {
            transform: translateY(-20px) scale(1.05);
            filter: blur(70px);
          }
          50% {
            transform: translateY(10px) scale(0.98);
            filter: blur(50px);
          }
          75% {
            transform: translateY(-15px) scale(1.02);
            filter: blur(65px);
          }
        }
      `}</style>
    </div>
  );
}

