'use client';

import { useEffect, useRef, useState } from 'react';

interface ThreatData {
  category: string;
  value: number;
  color: string;
}

interface ThreatVisualizationCompactProps {
  data: ThreatData[];
  centerValue?: number;
  centerLabel?: string;
  isActive?: boolean;
}

// New: Active Session Indicator - shows player is logged in without frequent updates
export function ActiveSessionIndicator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const size = 96;
    canvas.width = size * window.devicePixelRatio;
    canvas.height = size * window.devicePixelRatio;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const startTime = Date.now();
    let isRunning = true;

    const animate = () => {
      if (!isRunning) return;

      const elapsed = Date.now() - startTime;
      const progress = (elapsed % 3000) / 3000; // 3 second loop

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Draw background circle
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 10, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
      ctx.lineWidth = 12;
      ctx.stroke();

      // Draw rotating gradient ring (outer)
      const gradient = ctx.createLinearGradient(0, 0, size, size);
      gradient.addColorStop(0, 'rgba(16, 185, 129, 0)');
      gradient.addColorStop(0.5, 'rgba(16, 185, 129, 0.8)');
      gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');

      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.rotate(progress * Math.PI * 2);
      ctx.translate(-size / 2, -size / 2);

      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 10, 0, 2 * Math.PI);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.restore();

      // Draw pulsing inner circle
      const pulseSize = size / 2 - 22 + Math.sin(progress * Math.PI * 2) * 4;
      const pulseOpacity = 0.5 + Math.sin(progress * Math.PI * 2) * 0.3;

      ctx.beginPath();
      ctx.arc(size / 2, size / 2, pulseSize, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(16, 185, 129, ${pulseOpacity * 0.3})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(16, 185, 129, ${pulseOpacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw center circle
      const centerRadius = size / 2 - 22;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, centerRadius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.fill();

      // Draw dot
      ctx.beginPath();
      ctx.arc(size / 2, size / 2 - 2, 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#10b981';
      ctx.fill();

      // Draw text
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('LIVE', size / 2, size / 2 + 6);

      // Continue animating
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      isRunning = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <div className="relative inline-flex items-center justify-center p-1" style={{ width: '96px', height: '96px' }}>
      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100%', maxHeight: '100%', aspectRatio: '1/1' }}
      />
    </div>
  );
}

export default function ThreatVisualizationCompact({
  data,
  centerValue = 0,
  centerLabel = 'Threat Level'
}: ThreatVisualizationCompactProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const [isAnimating] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size - compact version
    const size = 96;
    canvas.width = size * window.devicePixelRatio;
    canvas.height = size * window.devicePixelRatio;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    let animationProgress = 0;
    const animationDuration = 2000; // 2 seconds
    const startTime = Date.now();
    let isRunning = true;

    const animate = () => {
      if (!isRunning) return;

      const now = Date.now();
      const elapsed = now - startTime;

      // Initial animation from 0 to current values
      if (elapsed < animationDuration) {
        animationProgress = Math.min(elapsed / animationDuration, 1);
      } else {
        animationProgress = 1; // Fully animated, keep updating
      }

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Draw background circle
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 10, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
      ctx.lineWidth = 12;
      ctx.stroke();

      // Calculate total - always reads latest data
      const total = data.reduce((sum, item) => sum + item.value, 0);

      // Draw segments
      let currentAngle = -Math.PI / 2; // Start from top
      data.forEach((item, _index) => {
        const segmentAngle = (item.value / total) * 2 * Math.PI * animationProgress;

        // Draw segment
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 10, currentAngle, currentAngle + segmentAngle);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 12;
        ctx.stroke();

        // Draw glow effect
        ctx.shadowBlur = 5;
        ctx.shadowColor = item.color;
        ctx.stroke();
        ctx.shadowBlur = 0;

        currentAngle += segmentAngle;
      });

      // Draw center circle
      const centerRadius = size / 2 - 22;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, centerRadius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw center text - always reads latest centerValue
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 14px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(centerValue * animationProgress)}%`, size / 2, size / 2 - 4);

      ctx.font = '8px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(centerLabel, size / 2, size / 2 + 8);

      // Draw animated particles (fewer for compact version)
      const particleCount = 8;
      for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * 2 * Math.PI + (elapsed / 5000);
        const radius = size / 2 - 10 + Math.sin(angle * 3 + elapsed / 1000) * 3;
        const x = size / 2 + Math.cos(angle) * radius;
        const y = size / 2 + Math.sin(angle) * radius;
        const opacity = 0.3 + Math.sin(angle * 5 + elapsed / 500) * 0.2;

        ctx.beginPath();
        ctx.arc(x, y, 1, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(139, 92, 246, ${opacity * animationProgress})`;
        ctx.fill();
      }

      // Always continue animating (for particles and updates)
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      isRunning = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [data, centerValue, centerLabel, isAnimating]); // Dependencies restored for updates

  return (
    <div className="relative inline-flex items-center justify-center p-1" style={{ width: '96px', height: '96px' }}>
      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100%', maxHeight: '100%', aspectRatio: '1/1' }}
      />
    </div>
  );
}

