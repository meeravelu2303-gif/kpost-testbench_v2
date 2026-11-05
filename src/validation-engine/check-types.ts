/**
 * The test types an engine check is reported under. Every engine check (`<category>.<check>`, a
 * business rule or a database validation) belongs to exactly one type, and each type is a folder:
 * `tests/<api-product>/<type>/[<module>/]<module>-endpoints-<type>.spec.ts`. The engine still runs
 * every check of an endpoint once (`endpoint-cases.ts`); the type only decides where it is reported.
 *
 * Adding a validator: give its name a prefix below, or `checkTypeOf` throws and the framework
 * self-test (`tests/framework/engine/check-types.spec.ts`) fails.
 */

/** Folder names, and the file-name suffix of the specs in each. */
export const CHECK_TYPES = [
  'contract',
  'positive',
  'negative',
  'boundary',
  'authentication',
  'authorization',
  'security',
  'performance',
  'data-integrity',
  'business-rules',
] as const;

export type CheckType = (typeof CHECK_TYPES)[number];

/** Out of scope by owner decision (2026-10-10): never planned while CONCURRENCY_PROBES=false. */
export const EXCLUDED_CHECK_TYPE = 'concurrency';

/** One line per type: what a passing check of that type proves. */
export const CHECK_TYPE_INFO: Readonly<Record<CheckType, string>> = {
  contract:
    'Contract and schema: status code, response structure and schema, headers, content type and field formats match the documented contract.',
  positive:
    'Positive: the documented request, with a valid login, gets its documented answer (the happy path).',
  negative:
    'Negative: missing, null, empty, wrong-type, malformed and unknown input is refused cleanly (4xx, never 5xx).',
  boundary:
    "Boundary values: just outside a field's limit is refused, exactly at the limit is accepted.",
  authentication:
    'Authentication: no token, a forged, expired or malformed token is refused; sessions end when they should.',
  authorization:
    "Authorization: roles and object-level access; no IDOR, cross-user or cross-tenant reach into another account's data.",
  security:
    'Security: injection, XSS, JWT handling, CORS, security headers, sensitive-data exposure, rate limits.',
  performance: 'Performance: per-request response time, payload size and timeouts.',
  'data-integrity':
    'Data integrity: what the API says it stored is what the database holds, and bytes survive a round trip.',
  'business-rules':
    "Business rules: the product's own rules, checked by their end result in every party's view.",
};

/** Checks that are the happy path rather than their category's usual type. */
const POSITIVE = new Set(['response.status-code', 'authentication.valid-token']);
const BOUNDARY = new Set(['request.boundary-value', 'request.boundary-accept']);

const BY_PREFIX: ReadonlyArray<readonly [prefix: string, type: CheckType | 'concurrency']> = [
  ['authentication.', 'authentication'],
  ['authorization.', 'authorization'],
  ['request.', 'negative'],
  ['response.', 'contract'],
  ['common.', 'contract'],
  ['security.', 'security'],
  ['performance.', 'performance'],
  ['database.', 'data-integrity'],
  ['business-rule.', 'business-rules'],
  ['concurrency.', EXCLUDED_CHECK_TYPE],
];

/** The type an engine check is reported under. Throws for a name no rule covers. */
export function checkTypeOf(checkName: string): CheckType | typeof EXCLUDED_CHECK_TYPE {
  if (POSITIVE.has(checkName)) return 'positive';
  if (BOUNDARY.has(checkName)) return 'boundary';
  const rule = BY_PREFIX.find(([prefix]) => checkName.startsWith(prefix));
  if (!rule) {
    throw new Error(
      `engine check "${checkName}" has no test type: add its prefix to src/validation-engine/check-types.ts`,
    );
  }
  return rule[1];
}

export function isCheckType(value: string): value is CheckType {
  return (CHECK_TYPES as readonly string[]).includes(value);
}
