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
  return value
    .replace(CONNECTION_STRING_PATTERN, `$1${MASK}:${MASK}@`)
    .replace(AUTH_SCHEME_PATTERN, `$1 ${MASK}`)
    .replace(JWT_PATTERN, `eyJ${MASK}`)
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
