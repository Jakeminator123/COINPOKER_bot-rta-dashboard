'use client';

import { useEffect, useState } from 'react';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

function AnimatedCounter({ 
  value, 
  duration = 1000,
  prefix = '',
  suffix = '',
  className = ''
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const [prevValue, setPrevValue] = useState(0);

  useEffect(() => {
    // Only animate if value actually changed
    if (value === prevValue) return;
    
    const startTime = Date.now();
    const startValue = prevValue;
    const endValue = value;
    const diff = endValue - startValue;

    const animate = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + diff * easeOut;

      setDisplayValue(currentValue);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setPrevValue(endValue);
        setDisplayValue(endValue);
      }
    };

    animate();
  }, [value, duration]); // Removed prevValue from dependencies to avoid infinite loop

  // Initialize prevValue on mount
  useEffect(() => {
    if (prevValue === 0 && value !== 0) {
      setPrevValue(value);
      setDisplayValue(value);
    }
  }, [value, prevValue]);

  return (
    <span className={className}>
      {prefix}{Math.round(displayValue)}{suffix}
    </span>
  );
}

// Export without memo to ensure updates propagate correctly
export default AnimatedCounter;
