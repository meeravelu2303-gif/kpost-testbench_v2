/**
 * Which validators may run against the live application: an allowlist of those that only observe
 * the endpoint's own request (plus the auth probes), because mutating validators would hit real
 * records. Default deny; the QA-identifier guard is the backstop.
 */

import { env } from '@config/env';

/** Validators cleared for live: no request of their own, no change to the endpoint's request. */
export const PRODUCTION_SAFE_VALIDATORS: readonly string[] = [
  // --- Observe the primary response only -----------------------------------------------------
  'response.status-code',
  'response.structure',
  'response.schema',
  'response.content-type',
  // Reads the primary response body's magic number only — no extra request, no mutation.
  'response.binary-content',
  'response.headers',
  'response.metadata',
  'response.pagination',
  'response.error-format',
  'metadata.timestamp',

  // --- Field-convention checks, all read-only over the response body -------------------------
  'common.api-error',
  'common.boolean',
  'common.date',
  'common.email',
  'common.id',
  'common.url',

  // --- Read the response for leaks; send nothing ---------------------------------------------
  'security.security-headers',
  'security.sensitive-data',
  'security.jwt',

  // --- Auth probes: the request with the token removed or corrupted; worst case a 401 -------
  'authentication.valid-token',
  'authentication.missing-token',
  'authentication.invalid-token',
  'authentication.malformed-token',
  'authentication.expired-token',

  // Times the primary call; adds no traffic.
  'performance.response-time',
];

/** Validators excluded on live, with reasons; a self-test checks each is in exactly one list. */
export const PRODUCTION_BLOCKED_VALIDATORS: Readonly<Record<string, string>> = {
  'request.boundary-value': 'mutates every field including ids, then sends it',
  'request.data-type': 'sends wrong-typed values into id fields',
  'request.null-value': 'sends null into required fields',
  'request.empty-value': 'sends empty values into required fields',
  'request.empty-body': 'sends requests the endpoint does not implement',
  'request.enum': 'sends values outside the documented set',
  'request.format': 'sends malformed emails, dates and ids',
  'request.required-fields': 'sends requests with fields removed',
  'request.unknown-fields': 'sends undocumented fields, which some handlers persist',
  'request.invalid-payload': 'sends deliberately invalid payloads',
  'request.malformed-json': 'sends broken JSON bodies',
  'request.method-not-allowed': 'sends a verb the endpoint does not implement',
  'request.unsupported-media-type': 'sends the body under the wrong content type',
  'security.injection': 'sends SQL/NoSQL payloads that a write endpoint would store',
  'security.xss': 'sends a script tag that a write endpoint would store',
  'security.information-disclosure': 'probes neighbouring identifiers belonging to other tenants',
  'security.rate-limit': 'deliberately floods the endpoint',
  'authorization.cross-resource-access': "requests another tenant's records by design",
  'authorization.privilege-escalation': 'attempts to act above the caller’s role',
  'authorization.forbidden': 'requires a principal that must not be exercised on live',
  'authorization.permission': 'requires a principal that must not be exercised on live',
  'authorization.role': 'requires a principal that must not be exercised on live',
  'performance.payload-size': 'sends oversized bodies at a live service',
  'performance.timeout': 'provokes timeouts, holding real connections',
  // Concurrency probes multiply traffic, and real users' requests make their findings unprovable.
  'concurrency.read-consistency': 'multiplies the request into a simultaneous burst',
  'concurrency.burst-resilience': 'deliberately floods the endpoint in parallel',
  'concurrency.duplicate-write': 'writes the same record twice at once, by design',
  'concurrency.session-isolation': 'drives two real accounts at one endpoint simultaneously',
};

const ALLOWED = new Set(PRODUCTION_SAFE_VALIDATORS);

/**
 * Input fuzzers safe on a live read endpoint: a read persists nothing, and the identifier guard
 * drops any mutated request naming a record we do not own. Injection, cross-tenant and load probes
 * are excluded.
 */
const READ_SAFE_FUZZERS = new Set<string>([
  'request.null-value',
  'request.data-type',
  'request.boundary-value',
  'request.enum',
  'request.empty-value',
  'request.empty-body',
  'request.format',
  'request.required-fields',
  'request.unknown-fields',
  'request.invalid-payload',
  'request.malformed-json',
  'request.method-not-allowed',
  'request.unsupported-media-type',
]);

/** Why this validator cannot run on live, or undefined. An unclassified validator is denied. */
export function productionExclusion(
  validatorName: string,
  endpoint?: { destructive?: boolean },
): string | undefined {
  if (ALLOWED.has(validatorName)) return undefined;
  // A read endpoint clears the input fuzzers.
  if (endpoint?.destructive === false && READ_SAFE_FUZZERS.has(validatorName)) return undefined;
  // TEST_DB_MODE: the full matrix on reads; the identifier guard and OTP kill-switch stay armed.
  if (env.TEST_DB_MODE && endpoint?.destructive === false) return undefined;
  // WRITE_FUZZ + TEST_DB_MODE: the full matrix on writes too (persists junk, so needs both flags).
  if (env.WRITE_FUZZ && env.TEST_DB_MODE) return undefined;

  const known = PRODUCTION_BLOCKED_VALIDATORS[validatorName];
  if (known) return `not run against the live application: ${known}`;
  return (
    `not run against the live application: unclassified validator — add it to ` +
    `PRODUCTION_SAFE_VALIDATORS or PRODUCTION_BLOCKED_VALIDATORS in production-validators.ts`
  );
}
