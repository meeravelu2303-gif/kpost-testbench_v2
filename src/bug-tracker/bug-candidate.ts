import type { RequestSpec } from '@api/client/request-builder';
import { categoryFor, type BugCategory, type BugzillaConfig } from '@config/bugzilla.config';
import { componentFor, suiteFor, type SuiteId } from '@config/ownership.config';
import type { Severity, ValidationReport, ValidationResult } from '@engine/validation-result';
import { maskSensitive, maskString } from '@utils/masking';
import { buildCurl } from './curl';
import { apiFingerprint, systemicFingerprint, uiFingerprint } from './bug-fingerprint';

/**
 * Validators whose failure is ONE platform-wide root cause, not an endpoint's own bug: a defect in
 * the shared API gateway (security headers missing) or the shared auth filter (a bad token answered
 * 400/403 instead of 401, or with a body that is not the error envelope). These are filed as a
 * SINGLE consolidated ticket across every endpoint that shows them — see `systemicFingerprint`.
 *
 * Everything else stays per-endpoint on purpose: the same validator failing on two endpoints is
 * usually two different fixes (a 500 here, a 404 there), so those remain distinct tickets.
 */
const SYSTEMIC_VALIDATORS = new Set<string>([
  'security.security-headers',
  'authentication.missing-token',
  'authentication.invalid-token',
  'authentication.malformed-token',
  'authentication.expired-token',
  'security.jwt',
]);

function isSystemicFinding(validatorName: string, message: string): boolean {
  if (SYSTEMIC_VALIDATORS.has(validatorName)) return true;
  /*
   * `response.error-format` is mixed: when it reports the negative-probe (auth-rejection) envelopes
   * it is describing the shared auth filter — one platform-wide fault. When it reports a malformed
   * PRIMARY response it is that endpoint's own bug. The engine already separates the two into
   * distinct results, and only the endpoint-specific one names "primary (" in its message.
   */
  if (validatorName === 'response.error-format') return !message.includes('primary (');
  return false;
}

/**
 * A defect ready to be filed — derived from evidence the run already produced, never invented.
 * One candidate is one Bugzilla ticket; repeated observations raise `occurrences`.
 *
 * Where it goes (product, component, owner) comes entirely from the endpoint's module, so a
 * KMail defect reaches the KMail developer and an Admin defect the Admin developer without any
 * per-test configuration. See src/config/ownership.config.ts.
 */
export interface BugCandidate {
  /** Dedupe tag, e.g. `KPV2-A1B2C3`. Written into the summary as `[KPV2-A1B2C3]`. */
  id: string;
  source: 'api' | 'ui';
  /** Owning module. */
  suiteId: SuiteId;
  title: string;
  /** Prose that explains the finding, above the Expected/Actual blocks. */
  narrative: string;
  severity: Severity;
  category: BugCategory;
  /** What kind of check found it: the validator name, or `UI Test Failure`. */
  classification: string;
  product: string;
  component: string;
  version: string;
  /** Developer who maintains this module; set as the ticket's assignee. */
  assignee: string;
  ownerName: string;
  endpoint?: string;
  expected: string;
  actual: string;
  repro?: string;
  /** Body of the primary response, quoted in the ticket. */
  responseBody?: string;
  responseStatus?: number;
  /** A copy-pasteable command that reproduces the failure. */
  curl?: string;
  correlationId?: string;
  /** Browser projects that observed a UI failure. */
  browsers?: string[];
  occurrences: number;
  environment: string;
  baseURL: string;
  build: string;
  testRunId: string;
  observedAt: string;
  /** Full, unabridged evidence for the ticket attachment. */
  evidence: Record<string, unknown>;
  /** A platform-wide fault (gateway/auth filter) — filed once, listing every endpoint it hits. */
  systemic?: boolean;
  /** For a systemic defect: every endpoint the same fault was observed on, listed in the ticket. */
  affectedEndpoints?: string[];
}

/** The path out of an endpoint label like "POST /v2/common/validateOTP/". */
function endpointPath(label: string): string {
  const space = label.indexOf(String.fromCharCode(32));
  return space > 0 ? label.slice(space + 1) : label;
}

/** The request of the first failing sub-check, when a probe recorded one. */
function failingRequest(result: ValidationResult): RequestSpec | undefined {
  return result.details?.find((detail) => detail.status === 'FAILED' && detail.request)?.request;
}

const text = (value: unknown): string => {
  if (value === undefined || value === null) return '(none)';
  return maskString(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

/** Words from a spec path and test title, used to find the UI screen's component. */
function screenTokens(file: string, title: string): string[] {
  return `${file} ${title}`
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
}

/**
 * Turns one endpoint's validation report into candidates — one per FAILED validation.
 * WARNING and SKIPPED never become tickets: a warning is not a defect, and a skip is the
 * framework saying it did not check.
 */
export function candidatesFromReport(
  report: ValidationReport,
  context: { baseURL: string },
  config: BugzillaConfig,
): BugCandidate[] {
  return report.results
    .filter((result) => result.status === 'FAILED')
    .map((result) => fromValidationResult(result, report, context, config));
}

function fromValidationResult(
  result: ValidationResult,
  report: ValidationReport,
  context: { baseURL: string },
  config: BugzillaConfig,
): BugCandidate {
  const suite = suiteFor(report.suite);
  const systemic = isSystemicFinding(result.validatorName, result.message);
  const id = systemic
    ? systemicFingerprint({
        prefix: config.tagPrefix,
        validatorName: result.validatorName,
        message: result.message,
      })
    : apiFingerprint({
        prefix: config.tagPrefix,
        endpointId: result.endpointId,
        validatorName: result.validatorName,
        message: result.message,
      });
  return {
    id,
    source: 'api',
    suiteId: suite.id,
    title: systemic
      ? `Platform-wide — ${maskString(result.message)}`
      : `${result.endpoint}: ${maskString(result.message)}`,
    narrative: systemic
      ? `The centralized validation engine ran "${result.validatorName}" and found the same failure ` +
        `on ${result.endpoint} that it finds across the ${suite.label}: this is ONE shared root cause ` +
        `(the API gateway or the auth filter), not a defect specific to this endpoint. It affects ` +
        `every endpoint listed below, and one fix resolves all of them — filed as a single ticket so ` +
        `the queue is not flooded with near-duplicates. Category ${result.category}, severity ${result.severity}.`
      : `The centralized validation engine ran "${result.validatorName}" against ${result.endpoint} ` +
        `in the ${suite.label} under the ${report.profile} profile, and the endpoint did not satisfy it. ` +
        `Category ${result.category}, severity ${result.severity}. ` +
        `Every request of this run carries a correlation ID, so the exchange can be traced in the ` +
        `application logs (see below).`,
    severity: result.severity,
    category: categoryFor(result.category),
    classification: result.validatorName,
    product: suite.bugzilla.product,
    // A cross-cutting gateway/auth fault has no single owning component — the catch-all is its home.
    component: systemic ? suite.bugzilla.fallbackComponent : componentFor(suite, report.tags),
    version: suite.bugzilla.version,
    assignee: suite.owner.email,
    ownerName: suite.owner.name,
    endpoint: result.endpoint,
    expected: text(result.expected),
    actual: text(result.actual),
    /** What the endpoint actually replied, quoted the way the existing tickets here do. */
    responseBody: report.primary?.body?.trim() ? report.primary.body : undefined,
    responseStatus: report.primary?.status,
    repro: `VALIDATION_PROFILE=${report.profile} npx playwright test --project=api --grep "${result.endpointId}"`,
    curl: buildCurl({
      method: report.method,
      /*
       * `result.endpoint` is the label "POST /v2/common/validateOTP/", not a path. Split at the
       * first space rather than with a regex: an earlier regex here lost its escapes while being
       * edited and produced `http://host:8989POST /v2/...` — a curl that cannot run, in a ticket
       * whose whole purpose is to be runnable.
       */
      path: endpointPath(result.endpoint),
      baseUrl: context.baseURL,
      /*
       * The request of the case that actually FAILED, when a probe recorded one. A probe validator
       * sends many requests, and the happy-path call does not reproduce the defect — a developer
       * pasting it would see a 200 and close the ticket.
       */
      request: failingRequest(result) ?? report.request,
      // Shown only where the endpoint needs one, so a public endpoint's repro stays copy-and-run.
      /*
       * From the endpoint's own contract, not from a tag: a token endpoint whose curl omits the
       * header reproduces as 401 and sends the reader chasing an authentication problem that is
       * not the bug.
       */
      authenticated: report.requiresAuth ?? Boolean(report.request?.headers?.Authorization),
    }),
    correlationId: result.correlationId,
    occurrences: 1,
    environment: report.environment,
    baseURL: context.baseURL,
    build: report.build,
    testRunId: report.testRunId,
    observedAt: result.timestamp,
    systemic,
    affectedEndpoints: systemic ? [result.endpoint] : undefined,
    evidence: maskSensitive({
      module: suite.label,
      repository: suite.repository,
      validator: result.validatorName,
      category: result.category,
      severity: result.severity,
      endpoint: result.endpoint,
      endpointId: result.endpointId,
      profile: report.profile,
      expected: result.expected,
      actual: result.actual,
      details: result.details,
      correlationId: result.correlationId,
      error: result.error,
    }),
  };
}

export interface UiFailureInput {
  file: string;
  title: string;
  /** First meaningful line of the Playwright error. */
  message: string;
  /** Full error text, for the attachment. */
  fullMessage: string;
  browser: string;
  environment: string;
  baseURL: string;
  build: string;
  testRunId: string;
  observedAt: string;
}

/** Turns a browser test failure into a candidate for the UI module and its developer. */
export function candidateFromUiFailure(
  input: UiFailureInput,
  config: BugzillaConfig,
): BugCandidate {
  const suite = suiteFor('kpost-ui');
  const id = uiFingerprint({
    prefix: config.tagPrefix,
    file: input.file,
    title: input.title,
    message: input.message,
  });
  return {
    id,
    source: 'ui',
    suiteId: suite.id,
    title: `${input.title}: ${maskString(input.message)}`,
    narrative:
      `The browser test "${input.title}" (${input.file}) failed on ${input.browser} against the ` +
      `${suite.label}. The evidence is the assertion failure below, plus the Playwright trace and ` +
      `screenshot kept with the run's HTML report.`,
    severity: 'HIGH',
    category: 'Functional',
    classification: 'UI Test Failure',
    product: suite.bugzilla.product,
    component: componentFor(suite, screenTokens(input.file, input.title)),
    version: suite.bugzilla.version,
    assignee: suite.owner.email,
    ownerName: suite.owner.name,
    expected: 'The test completes its assertions successfully.',
    actual: maskString(input.message),
    repro: `npx playwright test ${input.file} --project=${input.browser} -g "${input.title}"`,
    browsers: [input.browser],
    occurrences: 1,
    environment: input.environment,
    baseURL: input.baseURL,
    build: input.build,
    testRunId: input.testRunId,
    observedAt: input.observedAt,
    evidence: maskSensitive({
      module: suite.label,
      repository: suite.repository,
      file: input.file,
      title: input.title,
      browser: input.browser,
      error: input.fullMessage,
    }),
  };
}

/**
 * Collapses candidates that share an identity: one ticket per defect, with the occurrence count
 * and (for UI defects) every browser that observed it.
 */
export function mergeCandidates(candidates: readonly BugCandidate[]): BugCandidate[] {
  const merged = new Map<string, BugCandidate>();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.id);
    if (!existing) {
      merged.set(candidate.id, {
        ...candidate,
        // Clone the list so accumulating onto the merged copy never mutates the source candidate.
        affectedEndpoints: candidate.affectedEndpoints
          ? [...candidate.affectedEndpoints]
          : undefined,
      });
      continue;
    }
    existing.occurrences += candidate.occurrences;
    const browsers = new Set([...(existing.browsers ?? []), ...(candidate.browsers ?? [])]);
    if (browsers.size) existing.browsers = [...browsers].sort();
    // A systemic defect's ticket lists every endpoint the same fault was seen on.
    if (candidate.affectedEndpoints?.length) {
      const endpoints = new Set([
        ...(existing.affectedEndpoints ?? []),
        ...candidate.affectedEndpoints,
      ]);
      existing.affectedEndpoints = [...endpoints].sort();
    }
  }
  return [...merged.values()];
}
