import { createHash } from 'node:crypto';

/**
 * Run-specific values (correlation ids, e-mails, UUIDs, ports, durations) replaced before hashing,
 * so a defect's tag stays stable across runs. Only the hash input is normalised, not the ticket
 * text.
 */
const VOLATILE_PATTERNS: readonly [RegExp, string][] = [
  [/\btb-[0-9a-f-]{8,}\b/gi, '<correlation>'],
  [/\brun-[0-9a-f-]{8,}\b/gi, '<run>'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email>'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, '<jwt>'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>'],
  [/:\d{2,5}\b/g, ':<port>'],
  [/\b\d+(?:\.\d+)?\s?ms\b/gi, '<ms>'],
  [/\b[0-9a-f]{16,}\b/gi, '<hex>'],
  [/\b\d{4,}\b/g, '<n>'],
];

const MAX_KEY_CHARS = 200;

export function normalizeForFingerprint(message: string): string {
  return VOLATILE_PATTERNS.reduce(
    (text, [pattern, placeholder]) => text.replace(pattern, placeholder),
    message,
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_KEY_CHARS);
}

const digest = (key: string): string =>
  createHash('sha1').update(key).digest('hex').slice(0, 6).toUpperCase();

/** API defect identity: endpoint + validator + normalised message (two endpoints, two fixes). */
export function apiFingerprint(input: {
  prefix: string;
  endpointId: string;
  validatorName: string;
  message: string;
}): string {
  const key = `api|${input.endpointId}|${input.validatorName}|${normalizeForFingerprint(input.message)}`;
  return `${input.prefix}-${digest(key)}`;
}

/** Platform-wide defect identity: no endpoint, so one fault on many endpoints is one ticket. */
export function systemicFingerprint(input: {
  prefix: string;
  validatorName: string;
  message: string;
}): string {
  const key = `platform|${input.validatorName}|${normalizeForFingerprint(input.message)}`;
  return `${input.prefix}-${digest(key)}`;
}

/**
 * Identity of a platform-wide UI defect (a shared component failing on every screen): a stable
 * `causeKey` such as `rss-widget-cors`, never the screen or the raw message.
 */
export function uiSystemicFingerprint(input: { prefix: string; causeKey: string }): string {
  const key = `ui-platform|${input.causeKey}`;
  return `${input.prefix}-${digest(key)}`;
}

/**
 * The UI test folders were renamed per product on 2026-10-27; every UI bug already in Bugzilla was
 * fingerprinted with the old folder, so the old name is hashed to keep each bug's tag unchanged.
 */
const UI_FINGERPRINT_FOLDERS: readonly [string, string][] = [
  ['tests/kpost-ui/', 'tests/e2e/'],
  ['tests/admin-ui/', 'tests/e2e-admin/'],
];

/** The spec path as it is hashed into a UI fingerprint. */
export function uiFingerprintPath(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  for (const [current, hashedAs] of UI_FINGERPRINT_FOLDERS)
    if (normalized.startsWith(current)) return hashedAs + normalized.slice(current.length);
  return normalized;
}

/** UI defect identity: spec + title + first error line; no browser, so one ticket covers all. */
export function uiFingerprint(input: {
  prefix: string;
  file: string;
  title: string;
  message: string;
}): string {
  const key = `ui|${uiFingerprintPath(input.file)}|${input.title}|${normalizeForFingerprint(input.message)}`;
  return `${input.prefix}-${digest(key)}`;
}
