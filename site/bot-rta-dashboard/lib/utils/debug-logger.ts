import fs from 'fs';
import path from 'path';

/**
 * Debug logger for development mode
 * Logs to both file (debug.log) and console
 * Only active when NODE_ENV !== 'production'
 */
class DebugLogger {
  private logFile: string;
  private enabled: boolean;
  private maxFileSize = 10 * 1024 * 1024; // 10MB

  constructor() {
    this.enabled = process.env.NODE_ENV !== 'production';
    this.logFile = path.join(process.cwd(), 'debug.log');
  }

  private shouldLog(): boolean {
    return this.enabled;
  }

  private formatMessage(level: string, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const argsStr = args.length > 0 ? ` ${JSON.stringify(args)}` : '';
    return `[${timestamp}] [${level}] ${message}${argsStr}`;
  }

  private writeToFile(message: string): void {
    if (!this.shouldLog()) return;

    try {
      // Check file size and rotate if needed
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        if (stats.size > this.maxFileSize) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const rotatedFile = path.join(process.cwd(), `debug-${timestamp}.log`);
          fs.renameSync(this.logFile, rotatedFile);
        }
      }

      // Append to log file
      fs.appendFileSync(this.logFile, message + '\n', 'utf8');
    } catch (err) {
      // Silently fail if file write fails (e.g., permissions, disk full)
      console.error('[DebugLogger] Failed to write to log file:', err);
    }
  }

  log(message: string, ...args: unknown[]): void {
    if (!this.shouldLog()) return;
    const formatted = this.formatMessage('LOG', message, ...args);
    console.log(formatted);
    this.writeToFile(formatted);
  }

  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog()) return;
    const formatted = this.formatMessage('INFO', message, ...args);
    console.info(formatted);
    this.writeToFile(formatted);
  }

  warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog()) return;
    const formatted = this.formatMessage('WARN', message, ...args);
    console.warn(formatted);
    this.writeToFile(formatted);
  }

  error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog()) return;
    const formatted = this.formatMessage('ERROR', message, ...args);
    console.error(formatted);
    this.writeToFile(formatted);
  }
}

// Export singleton instance
export const debugLogger = new DebugLogger();

