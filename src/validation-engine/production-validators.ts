/**
 * Which validators may run against the LIVE application.
 *
 * ## Why this is a list and not a rule
 *
 * Most of this bench's value comes from validators that **modify the request and send it again** —
 * a null where a number belongs, a string where an integer belongs, `' OR '1'='1' --` in every text
 * field, an id belonging to another tenant. On dev that is the entire point. Against the live
 * application every one of them is a request no real client would ever make, aimed at real records:
 *
 *  - `request.boundary-value` and `request.data-type` mutate **id fields**, turning
 *    `companyID: 1001605` into `0`, `-1` or `1001604` — and several KPost endpoints act on the id
 *    in the payload rather than on the caller.
 *  - `security.injection` and `security.xss` would **store** their payloads wherever an endpoint
 *    writes, which on a live `saveEnquiryDetails` means planting a script tag in a record a
 *    colleague opens.
 *  - `authorization.cross-resource-access` and `privilege-escalation` exist to try **another
 *    tenant's** identifiers, which on live means a real customer's data.
 *  - `security.rate-limit` deliberately floods an endpoint, and `performance.payload-size` /
 *    `timeout` hold real connections open.
 *
 * So the production set is an **allowlist of validators that only ever observe the one request the
 * endpoint was going to make anyway**, plus the auth probes, which send no payload at all.
 *
 * Default deny, for the same reason the endpoint allowlist is: a blocklist admits every validator
 * added after it was written, and the failure mode is a live request nobody reviewed.
 *
 * The `qa-identifier-guard` is the backstop underneath this — if a mutating validator ever does run
 * on live, the guard refuses the request rather than trusting this list to be complete.
 */

/**
 * Validators cleared for the live application.
 *
 * The test is strict: a validator belongs here only if it sends **no request of its own** and makes
 * no change to the endpoint's own request. Everything here reads the primary exchange.
 */
export const PRODUCTION_SAFE_VALIDATORS: readonly string[] = [
  // --- Observe the primary response only -----------------------------------------------------
  'response.status-code',
  'response.structure',
  'response.schema',
  'response.content-type',
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

  /*
   * --- Authentication probes -----------------------------------------------------------------
   *
   * These re-send the endpoint's own request with the token removed, corrupted, or expired. They
   * change no payload and touch no identifier, so the worst case is a 401 in a live log — and
   * "is this endpoint actually protected?" is worth more on production than anywhere else. It is
   * the question the bench got wrong once already, by reading the gateway's blanket 401 as proof.
   *
   * `authentication.valid-token` is the primary call itself, so it carries no extra risk.
   */
  'authentication.valid-token',
  'authentication.missing-token',
  'authentication.invalid-token',
  'authentication.malformed-token',
  'authentication.expired-token',

  /*
   * Observes how long the primary call took. Not load testing - it adds no traffic.
   */
  'performance.response-time',
];

/**
 * Validators deliberately excluded, each with the reason a reader can check.
 *
 * Kept as data rather than prose so the framework self-test can assert that every registered
 * validator appears in exactly one of the two lists — otherwise a newly added validator would be
 * silently denied, which is safe but invisible, and nobody would know to classify it.
 */
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
};

const ALLOWED = new Set(PRODUCTION_SAFE_VALIDATORS);

/**
 * Why this validator cannot run against the live application, or undefined when it may.
 *
 * An unclassified validator is denied with a message saying so, rather than allowed — a validator
 * nobody has reviewed is exactly the one not to run on production.
 */
export function productionExclusion(validatorName: string): string | undefined {
  if (ALLOWED.has(validatorName)) return undefined;

  const known = PRODUCTION_BLOCKED_VALIDATORS[validatorName];
  if (known) return `not run against the live application: ${known}`;
  return (
    `not run against the live application: unclassified validator — add it to ` +
    `PRODUCTION_SAFE_VALIDATORS or PRODUCTION_BLOCKED_VALIDATORS in production-validators.ts`
  );
}
