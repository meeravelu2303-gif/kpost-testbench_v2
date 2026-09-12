import { env } from '@config/env';
import { maskSensitive, maskString } from './masking';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  /** Logger that adds `bindings` (e.g. correlationId) to every entry. */
  child(bindings: Record<string, unknown>): Logger;
}

/**
 * Structured logger. `LOG_FORMAT=json` emits one JSON object per line for log shipping;
 * everything (message, meta, bindings) passes through the masking utility first.
 */
export function createLogger(
  scope: string,
  level: LogLevel = env.LOG_LEVEL,
  bindings: Record<string, unknown> = {},
): Logger {
  const threshold = LEVEL_WEIGHT[level];

  const write = (lvl: LogLevel, message: string, meta?: unknown): void => {
    if (LEVEL_WEIGHT[lvl] < threshold) return;
    const timestamp = new Date().toISOString();
    const safeMessage = maskString(message);
    const safeMeta = meta === undefined ? undefined : maskSensitive(meta);
    const safeBindings = maskSensitive(bindings);

    const output =
      env.LOG_FORMAT === 'json'
        ? JSON.stringify({
            timestamp,
            level: lvl,
            scope,
            testRunId: env.TEST_RUN_ID,
            ...safeBindings,
            message: safeMessage,
            meta: safeMeta,
          })
        : [
            `${timestamp} [${lvl.toUpperCase()}] [${scope}]`,
            Object.keys(safeBindings).length ? JSON.stringify(safeBindings) : '',
            safeMessage,
            safeMeta === undefined ? '' : JSON.stringify(safeMeta),
          ]
            .filter(Boolean)
            .join(' ');

    if (lvl === 'error') console.error(output);
    else if (lvl === 'warn') console.warn(output);
    else console.log(output);
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    child: (extra) => createLogger(scope, level, { ...bindings, ...extra }),
  };
}
