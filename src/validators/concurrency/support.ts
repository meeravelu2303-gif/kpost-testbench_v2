import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { thresholds } from '@config/thresholds.config';
import type { ResolvedEndpoint } from '@engine/validation-policy';
import { outcome, type ValidationOutcome } from '@engine/validation-result';
import type { BurstResult } from '@utils/concurrency';
import { getPath, isPlainObject } from '@utils/json';

/**
 * Shared machinery for the simultaneous-request validators.
 *
 * The hard part of concurrency testing is not firing requests together — it is deciding which
 * differences between two responses are a defect. Two identical reads answered a millisecond apart
 * legitimately differ in a server clock or a view counter; they must never differ in whose record
 * they contain. Everything here exists to hold that line, so the probes themselves stay short.
 */

/** How many requests this endpoint's probes dispatch together, clamped to the central cap. */
export function burstSize(endpoint: ResolvedEndpoint): number {
  const requested = endpoint.concurrency.requests ?? thresholds.concurrency.defaultRequests;
  return Math.max(2, Math.min(requested, thresholds.concurrency.maxRequests));
}

/**
 * Leaf names whose value is expected to move between two otherwise identical responses.
 *
 * Matched on the key name rather than a path, because the same field appears at many depths and an
 * endpoint should not have to enumerate every one. An endpoint adds its own through
 * `concurrency.volatilePaths`; nothing is ever removed from this list to make a test pass — a field
 * that genuinely should be stable belongs in the comparison.
 */
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

/**
 * A deterministic string for one response body, with volatile leaves masked and object keys sorted.
 *
 * Sorting matters: JSON object order is not significant, but two serializations that differ only in
 * key order would otherwise read as a divergence and file a bug about nothing.
 */
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
 * The caller-identity values an endpoint declared, as a single comparable string.
 *
 * Returns undefined when the endpoint declares no identity paths — which is the common case, and
 * the reason the identity check reports SKIPPED rather than inventing a field to compare.
 */
export function identityOf(
  body: unknown,
  paths: readonly string[] | undefined,
): string | undefined {
  if (!paths || paths.length === 0) return undefined;
  return JSON.stringify(paths.map((path) => getPath(body, path) ?? null));
}

/**
 * Refuses a burst that did not actually overlap.
 *
 * A machine under load can serialize the dispatches, and a sequential burst proves nothing about
 * locking. Reporting that as PASSED is the failure mode this guard exists to prevent: it would mark
 * the endpoint concurrency-safe on the strength of a test that never ran concurrently.
 */
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
