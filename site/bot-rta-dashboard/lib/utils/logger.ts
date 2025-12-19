/**
 * Conditional logging utility
 * Only logs in development mode or when explicitly enabled via DEBUG env var
 */

const isDevelopment = process.env.NODE_ENV === "development";
const isDebugEnabled = process.env.DEBUG === "true" || process.env.DEBUG_REDIS === "true";

/**
 * Log only in development mode or when DEBUG is enabled
 */
export function debugLog(...args: unknown[]): void {
  if (isDevelopment || isDebugEnabled) {
    console.log(...args);
  }
}

/**
 * Log warnings (always shown, but can be filtered in production)
 */
export function debugWarn(...args: unknown[]): void {
  if (isDevelopment || isDebugEnabled) {
    console.warn(...args);
  }
}

/**
 * Log errors (always shown)
 */
export function debugError(...args: unknown[]): void {
  console.error(...args);
}

/**
 * Check if debug logging is enabled
 */
export function isDebugMode(): boolean {
  return isDevelopment || isDebugEnabled;
}

