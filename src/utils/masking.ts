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
/**
 * A secret named by its own key, in free TEXT — `password=hunter2`, `"apiKey": "ak_live_…"`.
 *
 * `maskSensitive` already masks a sensitive KEY when it walks an object, but a body, a log line or
 * an error message is a STRING by the time it reaches here, so the key/value structure is only
 * visible to a pattern. Phase 2.4 added this rule scoped to the resource journal; evidence capture
 * (Phase 3.2) needs the same protection, so it lives here now and both use it — one masker, not two.
 *
 * It matches the key with an optional closing quote before the separator, so the JSON form
 * (`"password":"…"`) is covered as well as the `key=value` and `key: value` forms. Only the VALUE is
 * replaced; the key and its punctuation are preserved, so redacted text still reads correctly.
 *
 * An auth SCHEME is skipped, because `AUTH_SCHEME_PATTERN` has already masked the credential that
 * follows it: without the exclusion, `Authorization: Bearer <token>` became `Authorization: *** ***`
 * and lost which scheme was used — still safe, but less useful, and a change to behaviour that
 * predates this rule.
 */
const SECRET_ASSIGNMENT =
  /\b((?:pass(?:word)?|pwd|secret|token|authorization|api[-_]?key|apikey|cookie|session(?:id)?|credential|private[-_]?key|refresh[-_]?token|access[-_]?token)[a-z_-]*"?\s*[:=]\s*)("?)(?!(?:Bearer|Basic|Digest|Token)\b)([^\s"',;&}\]]+)\2/gi;
/**
 * An e-mail address, masked to its first character (`q***@kpostindia.com`).
 *
 * **No trailing `\b`, deliberately.** It used to end with one, and a live KPost response proved that
 * unsafe: `kallSession` is the account id concatenated with an epoch
 * (`someone@kpostindia.com1789895625915`), and a word boundary cannot exist between `com` and `1`, so
 * the whole address survived into a persisted artifact. The domain group is greedy and backtracks to
 * the last `.<letters>` run on its own, so dropping the boundary loses nothing: `a@b.co.uk` still
 * matches in full, and a trailing suffix is simply left outside the match.
 */
const EMAIL_PATTERN = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const MAX_DEPTH = 10;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function maskString(value: string): string {
  return value
    .replace(CONNECTION_STRING_PATTERN, `$1${MASK}:${MASK}@`)
    .replace(AUTH_SCHEME_PATTERN, `$1 ${MASK}`)
    .replace(JWT_PATTERN, `eyJ${MASK}`)
    .replace(
      SECRET_ASSIGNMENT,
      (_match, prefix: string, quote: string) => `${prefix}${quote}${MASK}${quote}`,
    )
    .replace(EMAIL_PATTERN, `$1${MASK}$2`);
}

/** Deep-copies `value`, masking sensitive keys and secret-looking strings. */
export function maskSensitive<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return maskString(value) as T;
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (Array.isArray(value))
    return value.map((item: unknown) => maskSensitive(item, depth + 1)) as T;
  if (value instanceof Error)
    return maskSensitive({ name: value.name, message: value.message }, depth) as T;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSensitiveKey(key) && item !== undefined && item !== null
        ? MASK
        : maskSensitive(item, depth + 1),
    ]),
  ) as T;
}
