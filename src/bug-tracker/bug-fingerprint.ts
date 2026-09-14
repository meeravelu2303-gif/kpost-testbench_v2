import { createHash } from 'node:crypto';

/**
 * A defect's identity must be stable across runs, or dedupe never catches anything: the tag is
 * what a re-run searches Bugzilla for. Failure messages carry values that change every run —
 * correlation IDs, generated e-mails, UUIDs, ports, durations — so they are collapsed to
 * placeholders before hashing. The full message still becomes the ticket text; only the hashing
 * input is normalised.
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

/**
 * Identity of an API defect: the endpoint plus the validator plus the normalised message.
 * The endpoint is part of it on purpose — the same validator failing on two endpoints is two
 * tickets, because they are two components and usually two fixes.
 */
export function apiFingerprint(input: {
  prefix: string;
  endpointId: string;
  validatorName: string;
  message: string;
}): string {
  const key = `api|${input.endpointId}|${input.validatorName}|${normalizeForFingerprint(input.message)}`;
  return `${input.prefix}-${digest(key)}`;
}

/**
 * Identity of a PLATFORM-WIDE defect: one shared root cause that surfaces on every endpoint — a
 * missing gateway header, the auth filter answering the wrong status. The endpoint is deliberately
 * EXCLUDED (the opposite of `apiFingerprint`), so the same fault across sixty endpoints collapses
 * to ONE ticket that lists them, instead of sixty near-duplicates that bury the endpoint-specific
 * bugs. Two different symptoms (2/5 headers vs 5/5 headers) still hash apart, because the message
 * differs — so a real distinction is never merged away.
 */
export function systemicFingerprint(input: {
  prefix: string;
  validatorName: string;
  message: string;
}): string {
  const key = `platform|${input.validatorName}|${normalizeForFingerprint(input.message)}`;
  return `${input.prefix}-${digest(key)}`;
}

/**
 * Identity of a UI defect: spec file plus test title plus the normalised first error line.
 * The browser project is deliberately excluded, so one fault across three browsers is one
 * ticket that lists them (`[browser:…]`), not three.
 */
export function uiFingerprint(input: {
  prefix: string;
  file: string;
  title: string;
  message: string;
}): string {
  const key = `ui|${input.file}|${input.title}|${normalizeForFingerprint(input.message)}`;
  return `${input.prefix}-${digest(key)}`;
}
