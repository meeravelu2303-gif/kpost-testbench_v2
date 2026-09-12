import { randomUUID } from 'node:crypto';

/** Correlation IDs are sent as a request header and echoed into logs, DB lookups and reports. */
export function newCorrelationId(prefix = 'tb'): string {
  return `${prefix}-${randomUUID()}`;
}
