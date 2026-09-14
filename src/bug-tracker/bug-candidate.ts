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
  /** Dedupe tag, e.g. `KP-A1B2C3`. Written into the summary as `[KP-A1B2C3]`. */
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

/** A single expected/actual value as a short human string: `[401]` → `401`, `[400,401]` → `400 or 401`. */
const oneValue = (value: unknown): string => {
  if (value === undefined || value === null) return '(none)';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(' or ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return maskString(typeof value === 'string' ? value : JSON.stringify(value));
};

/**
 * A READABLE Expected/Actual for a multi-case validator (the auth-token probes, error-shape, …).
 *
 * Those validators report a per-case `details` array, and their top-level expected/actual are a
 * mixed object where masking turns half the entries into a meaningless `"empty token": "***"`. So
 * when there are failing sub-cases, build one aligned line PER FAILED CASE — `case → code` — so the
 * ticket's green (Expected) and red (Actual) boxes read as a clean, line-by-line diff. Falls back to
 * the raw expected/actual when a validator has no sub-cases (a single-shot check like status-code).
 */
function renderExpectedActual(result: ValidationResult): { expected: string; actual: string } {
  const failed = (result.details ?? []).filter((d) => d.status === 'FAILED');
  if (failed.length > 0) {
    const width = Math.min(Math.max(...failed.map((d) => d.name.length)), 40);
    // The case NAME is a static validator label ("Basic credentials", "missing Bearer scheme"), not
    // user data — show it in full. Only the VALUE is mask-checked (via oneValue), and status codes
    // are numbers, so nothing is masked here.
    const row = (name: string, value: unknown): string =>
      `${name.slice(0, 40).padEnd(width)}  →  ${oneValue(value)}`;
    return {
      expected: failed.map((d) => row(d.name, d.expected)).join('\n'),
      actual: failed.map((d) => row(d.name, d.actual)).join('\n'),
    };
  }
  return { expected: text(result.expected), actual: text(result.actual) };
}

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
    // A cross-cutting gateway/auth fault → the product's real platform-security component (KPost:
    // Authentication V2), never the generic catch-all. Falls back only if none is configured.
    component: systemic
      ? (suite.bugzilla.systemicComponent ?? suite.bugzilla.fallbackComponent)
      : componentFor(suite, report.tags),
    version: suite.bugzilla.version,
    assignee: suite.owner.email,
    ownerName: suite.owner.name,
    endpoint: result.endpoint,
    ...renderExpectedActual(result),
    /** What the endpoint actually replied, quoted the way the existing tickets here do. */
    responseBody: report.primary?.body?.trim() ? report.primary.body : undefined,
    responseStatus: report.primary?.status,
    // No internal test-bench command in the ticket — the developer has the app, not our repo. The
    // curl below is the runnable, application-level way to reproduce.
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
  // The component doubles as the screen name for the reproduction steps.
  const component = componentFor(suite, screenTokens(input.file, input.title));
  return {
    id,
    source: 'ui',
    suiteId: suite.id,
    title: `${input.title}: ${maskString(input.message)}`,
    // Application-level, for a developer who has the app but not our test repo: no internal file path
    // or test command — the screen, the browser, and what went wrong.
    narrative:
      `A front-end (UI) defect on the ${suite.label} at ${input.baseURL}, seen in ${input.browser}. ` +
      `To reproduce: sign in with a test account and open the ${component} screen, then exercise ` +
      `"${input.title}". Expected vs Actual are below.`,
    severity: 'HIGH',
    category: 'Functional',
    classification: 'UI Test Failure',
    product: suite.bugzilla.product,
    component,
    version: suite.bugzilla.version,
    assignee: suite.owner.email,
    ownerName: suite.owner.name,
    expected: 'The screen renders and behaves as expected.',
    actual: maskString(input.message),
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
      screen: component,
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
