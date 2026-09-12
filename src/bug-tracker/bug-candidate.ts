import {
  API_COMPONENT_BY_TAG,
  UI_COMPONENT_BY_PATH,
  categoryFor,
  type BugCategory,
  type BugzillaConfig,
} from '@config/bugzilla.config';
import type { Severity, ValidationReport, ValidationResult } from '@engine/validation-result';
import { maskSensitive, maskString } from '@utils/masking';
import { apiFingerprint, uiFingerprint } from './bug-fingerprint';

/**
 * A defect ready to be filed — derived from evidence the run already produced, never invented.
 * One candidate is one Bugzilla ticket; repeated observations raise `occurrences`.
 */
export interface BugCandidate {
  /** Dedupe tag, e.g. `KPV2-A1B2C3`. Written into the summary as `[KPV2-A1B2C3]`. */
  id: string;
  source: 'api' | 'ui';
  title: string;
  /** Prose that explains the finding, above the Expected/Actual blocks. */
  narrative: string;
  severity: Severity;
  category: BugCategory;
  /** What kind of check found it: the validator name, or `UI Test Failure`. */
  classification: string;
  product: string;
  component: string;
  endpoint?: string;
  module?: string;
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

/** Endpoint tag → component; unknown areas fall back to the product's catch-all. */
export function apiComponentFor(tags: readonly string[], config: BugzillaConfig): string {
  for (const tag of tags) {
    const component = API_COMPONENT_BY_TAG[tag];
    if (component) return component;
  }
  return config.apiFallbackComponent;
}

/** Spec path → UI component; unknown areas fall back to the UI product's catch-all. */
export function uiComponentFor(file: string, config: BugzillaConfig): string {
  const lower = file.toLowerCase();
  for (const [fragment, component] of Object.entries(UI_COMPONENT_BY_PATH)) {
    if (lower.includes(fragment)) return component;
  }
  return config.uiFallbackComponent;
}

/**
 * Turns one endpoint's validation report into candidates — one per FAILED validation.
 * WARNING and SKIPPED never become tickets: a warning is not a defect, and a skip is the
 * framework saying it did not check.
 */
export function candidatesFromReport(
  report: ValidationReport,
  context: { tags: readonly string[]; baseURL: string },
  config: BugzillaConfig,
): BugCandidate[] {
  return report.results
    .filter((result) => result.status === 'FAILED')
    .map((result) => fromValidationResult(result, report, context, config));
}

function fromValidationResult(
  result: ValidationResult,
  report: ValidationReport,
  context: { tags: readonly string[]; baseURL: string },
  config: BugzillaConfig,
): BugCandidate {
  const id = apiFingerprint({
    prefix: config.tagPrefix,
    endpointId: result.endpointId,
    validatorName: result.validatorName,
    message: result.message,
  });
  const component = apiComponentFor(context.tags, config);
  return {
    id,
    source: 'api',
    title: `${result.endpoint}: ${maskString(result.message)}`,
    narrative:
      `The centralized validation engine ran "${result.validatorName}" against ${result.endpoint} ` +
      `under the ${report.profile} profile and the endpoint did not satisfy it. ` +
      `Category ${result.category}, severity ${result.severity}. ` +
      `Every request of this run carries a correlation ID, so the exchange can be traced in the ` +
      `application logs (see below).`,
    severity: result.severity,
    category: categoryFor(result.category),
    classification: result.validatorName,
    product: config.apiProduct,
    component,
    endpoint: result.endpoint,
    module: component,
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

/** Turns a browser test failure into a candidate for the UI product. */
export function candidateFromUiFailure(
  input: UiFailureInput,
  config: BugzillaConfig,
): BugCandidate {
  const id = uiFingerprint({
    prefix: config.tagPrefix,
    file: input.file,
    title: input.title,
    message: input.message,
  });
  const component = uiComponentFor(input.file, config);
  return {
    id,
    source: 'ui',
    title: `${input.title}: ${maskString(input.message)}`,
    narrative:
      `The browser test "${input.title}" (${input.file}) failed on ${input.browser}. ` +
      `Filed from the UI suite, so the evidence is the assertion failure below plus the ` +
      `Playwright trace and screenshot kept with the run's HTML report.`,
    severity: 'HIGH',
    category: 'Functional',
    classification: 'UI Test Failure',
    product: config.uiProduct,
    component,
    module: component,
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
      file: input.file,
      title: input.title,
      browser: input.browser,
      error: input.fullMessage,
    }),
  };
}

/**
 * Collapses candidates that share an identity: one ticket per defect, with the occurrence count
 * and (for UI defects) every browser that observed it. A defect seen on three browsers is one
 * ticket tagged `[browser:chromium,firefox,webkit]`, not three tickets.
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
