'use client';

import { useEffect, useRef } from 'react';

interface ThreatData {
  category: string;
  value: number;
  color: string;
}

interface ThreatVisualizationProps {
  data: ThreatData[];
  centerValue?: number;
  centerLabel?: string;
}

function ThreatVisualization({
  data,
  centerValue = 0,
  centerLabel = 'Threat Level'
}: ThreatVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const previousDataRef = useRef<string>('');
  const previousCenterValueRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const animationProgressRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const size = 240;
    canvas.width = size * window.devicePixelRatio;
    canvas.height = size * window.devicePixelRatio;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Check if data or centerValue changed - if so, restart animation
    const currentDataKey = JSON.stringify(data) + centerValue;

    if (currentDataKey !== previousDataRef.current) {
      // If this is not the first render, save the current animated value as the starting point
      // This ensures smooth transitions even if data changes mid-animation
      if (previousDataRef.current !== '') {
        // Keep previousCenterValueRef as is - it already has the value we're animating from
        // The animate function will update it when animation completes
      } else {
        // First render, initialize previous value to current
        previousCenterValueRef.current = centerValue;
      }
      previousDataRef.current = currentDataKey;
      startTimeRef.current = Date.now();
      animationProgressRef.current = 0;
    }

    let isRunning = true;

    const animate = () => {
      if (!isRunning) return;

      const now = Date.now();
      const elapsed = now - startTimeRef.current;
      const animationDuration = 1500; // 1.5 seconds

      // Animate from previous value to current value
      if (elapsed < animationDuration) {
        animationProgressRef.current = Math.min(elapsed / animationDuration, 1);
      } else {
        animationProgressRef.current = 1; // Fully animated, keep updating
        // Update previous value when animation completes
        if (previousCenterValueRef.current !== centerValue) {
          previousCenterValueRef.current = centerValue;
        }
      }

      const animationProgress = animationProgressRef.current;

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Draw background circle
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 20, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
      ctx.lineWidth = 25;
      ctx.stroke();

      // Calculate total - always reads latest data
      const total = data.reduce((sum, item) => sum + item.value, 0);

      // Draw segments
      let currentAngle = -Math.PI / 2; // Start from top
      data.forEach((item, _index) => {
        const segmentAngle = (item.value / total) * 2 * Math.PI * animationProgress;

        // Draw segment
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 20, currentAngle, currentAngle + segmentAngle);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 25;
        ctx.stroke();

        // Draw glow effect
        ctx.shadowBlur = 10;
        ctx.shadowColor = item.color;
        ctx.stroke();
        ctx.shadowBlur = 0;

        currentAngle += segmentAngle;
      });

      // Draw center circle
      const centerRadius = size / 2 - 50;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, centerRadius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw center text - animate from previous to current value
      const previousValue = previousCenterValueRef.current;
      const animatedValue = previousValue + (centerValue - previousValue) * animationProgress;

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 32px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(animatedValue)}%`, size / 2, size / 2 - 8);

      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(centerLabel, size / 2, size / 2 + 18);

      // Draw animated particles
      const particleCount = 20;
      for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * 2 * Math.PI + (elapsed / 5000);
        const radius = size / 2 - 20 + Math.sin(angle * 3 + elapsed / 1000) * 10;
        const x = size / 2 + Math.cos(angle) * radius;
        const y = size / 2 + Math.sin(angle) * radius;
        const opacity = 0.3 + Math.sin(angle * 5 + elapsed / 500) * 0.2;

        ctx.beginPath();
        ctx.arc(x, y, 2, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(139, 92, 246, ${opacity})`;
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
  }, [data, centerValue, centerLabel]); // Re-animate when data changes

  return (
    <div className="relative inline-flex items-center justify-center p-2" style={{ width: '240px', height: '240px' }}>
      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100%', maxHeight: '100%', aspectRatio: '1/1' }}
      />
    </div>
  );
}

// Export component without memo to allow animations on data changes
export default ThreatVisualization;
