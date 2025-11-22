import { useEffect, useState } from 'react';

/**
 * Custom hook for debouncing values
 * Useful for search inputs, form fields, etc.
 */
export function useDebounce<T>(value: T, delay: number = 500): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Custom hook for throttling function calls
 * Useful for resize handlers, scroll handlers, etc.
 */
export function useThrottle<T extends (...args: unknown[]) => unknown>(
  func: T,
  delay: number = 300
): T {
  const [lastCall, setLastCall] = useState<number>(0);

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      setLastCall(now);
      return func(...args);
    }
  }) as T;
}
