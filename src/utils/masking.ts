/**
 * Single masking implementation used by the logger and the reporting layer, so secrets and
 * personal data never reach console output, attachments or CI artifacts.
 */
export const MASK = '***';

const SENSITIVE_KEY =
  /(pass(word)?|pwd|secret|token|authorization|api[-_]?key|cookie|session|credential|connection[-_]?string|private[-_]?key)/i;
const JWT_PATTERN = /\beyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[\w\-.~+/=]+/gi;
const CONNECTION_STRING_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^:\s/@]+:[^@\s]+@/gi;
const EMAIL_PATTERN = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const MAX_DEPTH = 10;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function maskString(value: string): string {
  return maskSecretsInString(value).replace(EMAIL_PATTERN, `$1${MASK}$2`);
}

/**
 * Masks CREDENTIALS but leaves identifiers readable.
 *
 * Bug reports need the opposite trade-off from logs. In KPost a `kpostID` **is** an e-mail address,
 * so the general e-mail rule turns the one value a developer needs — who the request was made as —
 * into `***`, and the attached cURL stops being runnable. A ticket nobody can reproduce is the most
 * common reason a real defect gets closed as "cannot reproduce".
 *
 * What stays masked here is what is genuinely a credential: passwords, JWTs, `Bearer`/`Basic`
 * values and connection strings. Those are secrets whether or not the reader is a developer, and a
 * token pasted into a ticket outlives the bug it was filed for.
 */
export function maskSecretsInString(value: string): string {
  return value
    .replace(CONNECTION_STRING_PATTERN, `$1${MASK}:${MASK}@`)
    .replace(AUTH_SCHEME_PATTERN, `$1 ${MASK}`)
    .replace(JWT_PATTERN, `eyJ${MASK}`);
}

/** Deep-copies `value`, masking sensitive keys and secret-looking strings. */
export function maskSensitive<T>(value: T, depth = 0): T {
  return maskDeep(value, depth, maskString);
}

/**
 * Like `maskSensitive`, but keeps identifiers (e-mails, and therefore `kpostID`s) readable.
 *
 * For Bugzilla artifacts only — the payload and the cURL a developer is meant to run. Keys that
 * name a credential (`password`, `token`, …) are still replaced wholesale, so the exception is
 * narrow: it admits identifiers, not secrets.
 */
export function maskSecretsOnly<T>(value: T, depth = 0): T {
  return maskDeep(value, depth, maskSecretsInString);
}

function maskDeep<T>(value: T, depth: number, maskText: (text: string) => string): T {
  if (typeof value === 'string') return maskText(value) as T;
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (Array.isArray(value))
    return value.map((item: unknown) => maskDeep(item, depth + 1, maskText)) as T;
  if (value instanceof Error)
    return maskDeep({ name: value.name, message: value.message }, depth, maskText) as T;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSensitiveKey(key) && item !== undefined && item !== null
        ? MASK
        : maskDeep(item, depth + 1, maskText),
    ]),
  ) as T;
}
