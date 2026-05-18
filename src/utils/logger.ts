/**
 * Diagnostic logger. CRITICAL: the stdio MCP transport owns stdout for the JSON-RPC
 * stream, so Kairo must never write diagnostics there. Everything goes to stderr.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const env = process.env.KAIRO_LOG_LEVEL?.toLowerCase() as Level | undefined;
  return order[env ?? 'info'] ?? order.info;
}

function emit(level: Level, message: string, meta?: unknown): void {
  if (order[level] < threshold()) return;
  const line = `[kairo] ${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  console.error(meta === undefined ? line : `${line} ${safe(meta)}`);
}

function safe(meta: unknown): string {
  try {
    return JSON.stringify(meta);
  } catch {
    return '[unserializable meta]';
  }
}

export const logger = {
  debug: (m: string, meta?: unknown) => emit('debug', m, meta),
  info: (m: string, meta?: unknown) => emit('info', m, meta),
  warn: (m: string, meta?: unknown) => emit('warn', m, meta),
  error: (m: string, meta?: unknown) => emit('error', m, meta),
};
