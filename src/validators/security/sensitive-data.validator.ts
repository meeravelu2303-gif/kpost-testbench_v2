import { defineValidator } from '@engine/validator';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';
import { walkJson } from '@utils/json';

const SENSITIVE_KEY =
  /pass(word|wd)?(hash)?$|^pwd$|secret|api[-_]?key|private[-_]?key|^ssn$|credit[-_]?card|card[-_]?number|^cvv$|^pin$|refresh[-_]?token|access[-_]?token|^token$/i;
const JWT_VALUE = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;
const PRIVATE_KEY_VALUE = /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/;
const CARD_CANDIDATE = /^\d{13,19}$/;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

function findingFor(key: string, value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (SENSITIVE_KEY.test(key)) return 'sensitive field name';
  if (typeof value !== 'string') return undefined;
  if (JWT_VALUE.test(value)) return 'JWT value';
  if (PRIVATE_KEY_VALUE.test(value)) return 'private key';
  const digits = value.replace(/[\s-]/g, '');
  return CARD_CANDIDATE.test(digits) && passesLuhn(digits) ? 'payment card number' : undefined;
}

/**
 * Scans every JSON response of the run (primary + probes) for secrets and personal data that
 * must not be exposed. Endpoints that legitimately return a secret allowlist the field name.
 */
export const sensitiveDataValidator = defineValidator({
  name: 'security.sensitive-data',
  category: 'SECURITY',
  severity: 'CRITICAL',
  description: 'No passwords, hashes, tokens, keys or card numbers are exposed in responses',
  toggle: 'security',
  stage: 'aggregate',
  check: (context) => {
    const allowlist = new Set(context.endpoint.security.sensitiveFieldAllowlist ?? []);
    const inspected = context.exchanges.filter((exchange) => exchange.json().ok);
    if (!inspected.length) return outcome.skipped('no JSON responses to inspect');

    const findings: CheckDetail[] = inspected.flatMap((exchange) => {
      const parsed = exchange.json();
      if (!parsed.ok) return [];
      return walkJson(parsed.value)
        .filter(({ key }) => !allowlist.has(key))
        .flatMap(({ path, key, value }) => {
          const finding = findingFor(key, value);
          return finding
            ? [
                {
                  name: `${exchange.label} → ${path}`,
                  status: 'FAILED' as const,
                  expected: 'not exposed',
                  actual: finding,
                  message: finding,
                  correlationId: exchange.correlationId,
                },
              ]
            : [];
        });
    });
    return findings.length
      ? fromChecks(findings, 'sensitive data findings')
      : outcome.passed(`${inspected.length} JSON responses contain no sensitive data`, {
          expected: 'not exposed',
          actual: 'none found',
        });
  },
});
