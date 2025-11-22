import { useRouter } from 'next/navigation';
import { useCallback, useRef } from 'react';

/**
 * Custom hook for debounced navigation to prevent double updates when switching pages
 */
export function useDebouncedNavigation() {
  const router = useRouter();
  const navigationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isNavigatingRef = useRef(false);

  const navigateTo = useCallback((path: string, delay: number = 100) => {
    // Prevent multiple rapid navigations
    if (isNavigatingRef.current) return;

    // Clear any pending navigation
    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
    }

    isNavigatingRef.current = true;

    // Small delay to allow current operations to complete
    navigationTimeoutRef.current = setTimeout(() => {
      router.push(path);

      // Reset navigation flag after a grace period
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 500);
    }, delay);
  }, [router]);

  // Cleanup function for component unmount
  const cleanup = useCallback(() => {
    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
      navigationTimeoutRef.current = null;
    }
    isNavigatingRef.current = false;
  }, []);

  return { navigateTo, cleanup };
}
