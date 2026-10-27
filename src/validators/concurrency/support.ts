import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { thresholds } from '@config/thresholds.config';
import type { ResolvedEndpoint } from '@engine/validation-policy';
import { outcome, type ValidationOutcome } from '@engine/validation-result';
import type { BurstResult } from '@utils/concurrency';
import { getPath, isPlainObject } from '@utils/json';

/**
 * Shared machinery for the simultaneous-request validators: deciding which response differences are
 * defects (a clock may differ, whose record it is may not).
 */

/** How many requests this endpoint's probes dispatch together, clamped to the central cap. */
export function burstSize(endpoint: ResolvedEndpoint): number {
  const requested = endpoint.concurrency.requests ?? thresholds.concurrency.defaultRequests;
  return Math.max(2, Math.min(requested, thresholds.concurrency.maxRequests));
}

/** Key names expected to differ between identical responses, at any depth (+ `volatilePaths`). */
const VOLATILE_KEYS = new Set(
  [
    'timestamp',
    'servertime',
    'serverdate',
    'currenttime',
    'responsetime',
    'duration',
    'elapsed',
    'requestid',
    'correlationid',
    'traceid',
    'token',
    'accesstoken',
    'refreshtoken',
    'jwt',
    'expiresin',
    'expiresat',
    'iat',
    'exp',
    'nonce',
    'sessionid',
  ].map((key) => key.toLowerCase()),
);

const VOLATILE_PLACEHOLDER = '<volatile>';

/** A deterministic string for a body: volatile leaves masked, keys sorted (order is not a diff). */
export function canonicalBody(value: unknown, extraPaths: readonly string[] = []): string {
  const masked = new Set(extraPaths);

  const walk = (node: unknown, path: string): unknown => {
    if (masked.has(path)) return VOLATILE_PLACEHOLDER;
    if (Array.isArray(node)) return node.map((item, index) => walk(item, `${path}[${index}]`));
    if (isPlainObject(node)) {
      return Object.fromEntries(
        Object.keys(node)
          .sort()
          .map((key) => {
            const childPath = path ? `${path}.${key}` : key;
            if (VOLATILE_KEYS.has(key.toLowerCase())) return [key, VOLATILE_PLACEHOLDER];
            return [key, walk(node[key], childPath)];
          }),
      );
    }
    return node;
  };

  return JSON.stringify(walk(value, ''));
}

/** The parsed body of an exchange, or undefined when it was not JSON. */
export function bodyOf(exchange: ApiResponseWrapper): unknown {
  const parsed = exchange.json();
  return parsed.ok ? parsed.value : undefined;
}

/**
 * The endpoint's declared caller-identity values as one string, or undefined when it declares none.
 */
export function identityOf(
  body: unknown,
  paths: readonly string[] | undefined,
): string | undefined {
  if (!paths || paths.length === 0) return undefined;
  return JSON.stringify(paths.map((path) => getPath(body, path) ?? null));
}

/** Refuses a burst that did not overlap: a sequential burst proves nothing about locking. */
export function inconclusiveIfSerialized<T>(
  result: BurstResult<T>,
  subject: string,
): ValidationOutcome | undefined {
  const { maxDispatchSkewMs } = thresholds.concurrency;
  if (result.dispatchSkewMs <= maxDispatchSkewMs) return undefined;
  return outcome.skipped(
    `inconclusive: the ${subject} did not overlap — requests left ${result.dispatchSkewMs}ms apart ` +
      `(limit ${maxDispatchSkewMs}ms), so no race could occur`,
    { expected: `dispatch skew <= ${maxDispatchSkewMs}ms`, actual: `${result.dispatchSkewMs}ms` },
  );
}

/** A compact per-response line for the report: what each simultaneous caller actually got. */
export function describeResponses(exchanges: readonly ApiResponseWrapper[]): string[] {
  return exchanges.map(
    (exchange, index) =>
      `#${index + 1} → ${exchange.status} in ${Math.round(exchange.durationMs)}ms ` +
      `(${exchange.sizeBytes} bytes, ${exchange.correlationId})`,
  );
}
