import { categoryFor, type BugCategory, type BugzillaConfig } from '@config/bugzilla.config';
import { componentFor, suiteFor, type SuiteId } from '@config/ownership.config';
import type { Severity, ValidationReport, ValidationResult } from '@engine/validation-result';
import { maskSensitive, maskString } from '@utils/masking';
import { apiFingerprint, uiFingerprint } from './bug-fingerprint';

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
  const id = apiFingerprint({
    prefix: config.tagPrefix,
    endpointId: result.endpointId,
    validatorName: result.validatorName,
    message: result.message,
  });
  return {
    id,
    source: 'api',
    suiteId: suite.id,
    title: `${result.endpoint}: ${maskString(result.message)}`,
    narrative:
      `The centralized validation engine ran "${result.validatorName}" against ${result.endpoint} ` +
      `in the ${suite.label} under the ${report.profile} profile, and the endpoint did not satisfy it. ` +
      `Category ${result.category}, severity ${result.severity}. ` +
      `Every request of this run carries a correlation ID, so the exchange can be traced in the ` +
      `application logs (see below).`,
    severity: result.severity,
    category: categoryFor(result.category),
    classification: result.validatorName,
    product: suite.bugzilla.product,
    component: componentFor(suite, report.tags),
    version: suite.bugzilla.version,
    assignee: suite.owner.email,
    ownerName: suite.owner.name,
    endpoint: result.endpoint,
    expected: text(result.expected),
    actual: text(result.actual),
    repro: `VALIDATION_PROFILE=${report.profile} npx playwright test --project=api --grep "${result.endpointId}"`,
    correlationId: result.correlationId,
    occurrences: 1,
    environment: report.environment,
    baseURL: context.baseURL,
    build: report.build,
    testRunId: report.testRunId,
    observedAt: result.timestamp,
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
      merged.set(candidate.id, { ...candidate });
      continue;
    }
    existing.occurrences += candidate.occurrences;
    const browsers = new Set([...(existing.browsers ?? []), ...(candidate.browsers ?? [])]);
    if (browsers.size) existing.browsers = [...browsers].sort();
  }
  return [...merged.values()];
}
