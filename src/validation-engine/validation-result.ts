import type { HttpMethod, RequestSpec } from '@api/client/request-builder';
import type { ValidationProfile } from '@config/constants';
import type { SuiteId } from '@config/ownership.config';

export const ValidationStatus = {
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  WARNING: 'WARNING',
} as const;
export type ValidationStatus = (typeof ValidationStatus)[keyof typeof ValidationStatus];

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VALIDATION_CATEGORIES = [
  'AUTHENTICATION',
  'AUTHORIZATION',
  'REQUEST',
  'RESPONSE',
  'SECURITY',
  'PERFORMANCE',
  'COMMON_DATA',
  'BUSINESS_RULE',
  'DATABASE',
] as const;
export type ValidationCategory = (typeof VALIDATION_CATEGORIES)[number];

/** One sub-check inside a validator (e.g. one negative payload, one role). */
export interface CheckDetail {
  name: string;
  status: ValidationStatus;
  expected?: unknown;
  actual?: unknown;
  message?: string;
  correlationId?: string;
  /**
   * The request this individual case sent, recorded on FAILURES only.
   *
   * A probe-based validator sends many requests; without this, a filed bug could only show the
   * endpoint's happy-path call, leaving the developer to reconstruct the payload that actually
   * broke it. Kept off passing cases so a green report stays small.
   */
  request?: RequestSpec;
}

/** What a validator's check returns. The engine turns it into a full ValidationResult. */
export interface ValidationOutcome {
  status: ValidationStatus;
  message: string;
  expected?: unknown;
  actual?: unknown;
  details?: CheckDetail[];
  correlationId?: string;
  error?: { name: string; message: string };
}

/** The single result format produced by every validator, business rule and DB validation. */
export interface ValidationResult {
  /** Identity of THIS execution — a fresh UUID per result. Never an identity across runs. */
  validationId: string;
  /**
   * Identity of the CHECK itself (`TC-API-…`), stable across runs, workers, machines, browsers and
   * profiles — see `src/reporting/test-case-id.ts`. Optional so a historical report that predates
   * Phase 2.2 still parses; every result the engine produces now carries one.
   */
  testCaseId?: string;
  validatorName: string;
  category: ValidationCategory;
  endpointId: string;
  /** e.g. `POST /users` */
  endpoint: string;
  method: HttpMethod;
  expected: unknown;
  actual: unknown;
  status: ValidationStatus;
  message: string;
  durationMs: number;
  timestamp: string;
  severity: Severity;
  error?: { name: string; message: string };
  correlationId: string;
  details?: CheckDetail[];
}

export interface ValidationSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
}

export interface ValidationReport {
  endpointId: string;
  endpoint: string;
  method: HttpMethod;
  /**
   * The exact request the primary exchange sent, masked. Carried so a filed bug can show a
   * copy-pasteable `curl` — a developer should never have to reconstruct the call from prose.
   */
  request?: RequestSpec;
  /** Whether the endpoint needs a token, so a filed bug's curl shows the header. */
  requiresAuth?: boolean;
  /**
   * Status and body of the primary response, truncated and masked.
   *
   * A ticket saying "Actual: 409" makes the reader go and re-run the call to find out what the API
   * actually said. The existing tickets in this Bugzilla quote the body, and they are right to.
   */
  primary?: { status: number; body?: string };
  /** Endpoint tags — used to route a filed bug to its Bugzilla component. */
  tags: readonly string[];
  /** Owning module — decides the Bugzilla product and which developer gets the ticket. */
  suite: SuiteId;
  profile: ValidationProfile;
  environment: string;
  build: string;
  testRunId: string;
  correlationId: string;
  startedAt: string;
  durationMs: number;
  results: ValidationResult[];
  summary: ValidationSummary;
  /** Quality gate: FAILED results whose severity is configured as blocking. */
  gate: { passed: boolean; blocking: string[] };
}

type OutcomeExtras = Omit<ValidationOutcome, 'status' | 'message'>;

export const outcome = {
  passed: (message: string, extras: OutcomeExtras = {}): ValidationOutcome => ({
    status: 'PASSED',
    message,
    ...extras,
  }),
  failed: (message: string, extras: OutcomeExtras = {}): ValidationOutcome => ({
    status: 'FAILED',
    message,
    ...extras,
  }),
  warning: (message: string, extras: OutcomeExtras = {}): ValidationOutcome => ({
    status: 'WARNING',
    message,
    ...extras,
  }),
  skipped: (reason: string, extras: OutcomeExtras = {}): ValidationOutcome => ({
    status: 'SKIPPED',
    message: reason,
    ...extras,
  }),
};

function format(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function describeCheck(check: CheckDetail): string {
  return check.message
    ? `${check.name} (${check.message})`
    : `${check.name} (expected ${format(check.expected)}, got ${format(check.actual)})`;
}

const MAX_LISTED_FAILURES = 5;

/** Aggregates sub-checks into one outcome: any FAILED → FAILED, any WARNING → WARNING. */
export function fromChecks(
  checks: readonly CheckDetail[],
  subject: string,
  emptyReason = `no applicable ${subject}`,
): ValidationOutcome {
  const executed = checks.filter((c) => c.status !== 'SKIPPED');
  if (!executed.length) {
    const reasons = [...new Set(checks.map((c) => c.message).filter(Boolean))].join('; ');
    return outcome.skipped(reasons || emptyReason, { details: [...checks] });
  }
  const extras: OutcomeExtras = {
    expected: Object.fromEntries(checks.map((c) => [c.name, c.expected])),
    actual: Object.fromEntries(checks.map((c) => [c.name, c.actual])),
    details: [...checks],
  };
  const failed = executed.filter((c) => c.status === 'FAILED');
  if (failed.length) {
    const listed = failed.slice(0, MAX_LISTED_FAILURES).map(describeCheck).join('; ');
    return outcome.failed(
      `${failed.length}/${executed.length} ${subject} failed: ${listed}`,
      extras,
    );
  }
  const warned = executed.filter((c) => c.status === 'WARNING');
  if (warned.length) {
    return outcome.warning(
      `${warned.length}/${executed.length} ${subject} with warnings: ${warned.map(describeCheck).join('; ')}`,
      extras,
    );
  }
  return outcome.passed(`${executed.length} ${subject} passed`, extras);
}

export function summarize(results: readonly ValidationResult[]): ValidationSummary {
  const count = (status: ValidationStatus): number =>
    results.filter((r) => r.status === status).length;
  return {
    total: results.length,
    passed: count('PASSED'),
    failed: count('FAILED'),
    warnings: count('WARNING'),
    skipped: count('SKIPPED'),
  };
}
