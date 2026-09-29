export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
  timestamp: string;
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
let debugEnabled = false;

export function setDebugMode(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebugMode(): boolean {
  return debugEnabled;
}

export function createLogger(scope: string) {
  function record(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      level,
      scope,
      message,
      data,
      timestamp: new Date().toISOString(),
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();

    if (level === 'error') {
      console.error(`[${scope}] ${message}`, data ?? '');
    } else if (debugEnabled) {
      console.log(`[${scope}] ${message}`, data ?? '');
    }
  }

  return {
    debug: (message: string, data?: unknown) => record('debug', message, data),
    info: (message: string, data?: unknown) => record('info', message, data),
    warn: (message: string, data?: unknown) => record('warn', message, data),
    error: (message: string, data?: unknown) => record('error', message, data),
  };
}

export function getLogEntries(filter?: { scope?: string; level?: LogLevel }): LogEntry[] {
  let result = entries;
  if (filter?.scope) result = result.filter((e) => e.scope === filter.scope);
  if (filter?.level) result = result.filter((e) => e.level === filter.level);
  return result;
}

export function clearLogEntries(): void {
  entries.length = 0;
}