import type { ValidationReport, ValidationResult } from '@engine/validation-result';
import { CLASSIFIER_VERSION, type ClassificationResult } from './classification';
import { classifyFailure, decidingExchange, type FailureInput } from './classifier';
import type { ExchangeEvidence } from './evidence';
import { reachabilityOf, type ReachabilityWitness } from './reachability';

/**
 * A classified failure, durable and explainable.
 *
 * ## What an observation is, and what it is not
 *
 * It explains a DECISION. The evidence remains the source of truth and is referenced by
 * `correlationId` rather than copied, so there is exactly one record of what an exchange looked like
 * and no chance of the two drifting apart. An observation therefore carries identifiers, the class,
 * the rule that chose it, and the named fields that rule read — never a body, a header value or a
 * request payload.
 *
 * It is **not** a Bugzilla decision. Phase 3.3 runs in shadow: observations are written alongside
 * the existing pipeline, and nothing reads them back into filing.
 */
export interface Observation {
  runId: string;
  /** Stable Phase 2.2 identity. Legitimately absent for an exchange no single case owns. */
  testCaseId?: string;
  /** The exchange the classifier judged. The key back into `evidence.jsonl`. */
  correlationId?: string;
  /** Every correlation id the failing check judged, so a multi-exchange failure stays traceable. */
  decidingCorrelationIds: readonly string[];

  endpoint: string;
  endpointId: string;
  suite: string;
  validatorName: string;
  category: string;
  severity: string;
  /** The phase of the deciding exchange, when one was found. */
  phase?: string;

  classification: ClassificationResult['classification'];
  violationType: ClassificationResult['violationType'];
  reasonCode: ClassificationResult['reasonCode'];
  summary: string;
  supportingEvidence: ClassificationResult['supportingEvidence'];
  missingEvidence: ClassificationResult['missingEvidence'];
  eligibleForDefectReview: boolean;
  cleanupRelated: boolean;

  /** Bounded, already-masked renderings of the check's own expectation and reading. */
  expected: string;
  actual: string;

  origin?: ExchangeEvidence['origin'];
  originRule?: string;
  reachability: ReachabilityWitness['state'];

  createdAt: string;
  classifierVersion: string;
}

/** Expected/actual are `unknown`; keep a short, safe rendering rather than the whole structure. */
const MAX_VALUE_CHARS = 300;

function render(value: unknown): string {
  if (value === undefined || value === null) return '(none)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').slice(0, MAX_VALUE_CHARS);
}

/**
 * The correlation ids a failing check judged, most specific first.
 *
 * A probe validator records one id per sub-check, so the FAILED details come before the result's own
 * id: the detail names the exchange that actually broke, while the result's id is the primary. That
 * ordering is what makes `decidingExchange` pick the right one for a multi-exchange failure without
 * inventing causality.
 */
export function decidingCorrelationIds(result: ValidationResult): string[] {
  const ids = (result.details ?? [])
    .filter((detail) => detail.status === 'FAILED' && detail.correlationId)
    .map((detail) => detail.correlationId as string);
  if (result.correlationId) ids.push(result.correlationId);
  return [...new Set(ids)];
}

/**
 * Classifies every FAILED check in a report.
 *
 * Only `FAILED` is classified, matching what the existing candidate pipeline considers
 * (`candidatesFromReport`), so the shadow comparison is like-for-like. A `WARNING` is observed by
 * the report but is not a failure and is not classified here.
 *
 * Pure: it reads the report and returns records. Persistence is the journal's job.
 */
export interface ObservationOptions {
  now?: Date;
  /**
   * Evidence recorded elsewhere in the same test, used when the report carries none of its own.
   *
   * A flow-finding report is hand-built from a lifecycle 5xx and has no `evidence` field, but the
   * exchange it describes WAS captured — the fixture attaches it separately. Without this the
   * classifier would answer `NO_DECIDING_EXCHANGE` for exactly the failures a lifecycle spec exists
   * to find. Scoped to the report's own endpoint, so one endpoint's exchanges can never witness
   * another's.
   */
  evidence?: readonly ExchangeEvidence[];
}

export function observationsFromReport(
  report: ValidationReport,
  options: ObservationOptions = {},
): Observation[] {
  const now = options.now ?? new Date();
  const evidence =
    report.evidence && report.evidence.length > 0
      ? report.evidence
      : (options.evidence ?? []).filter((record) => record.endpointId === report.endpointId);
  // A report written before Phase 3.2 carries no witness; recompute rather than assume PRESENT.
  const reachability =
    report.evidence && report.evidence.length > 0
      ? (report.reachability ?? reachabilityOf(evidence))
      : reachabilityOf(evidence);

  return report.results
    .filter((result) => result.status === 'FAILED')
    .map((result) => {
      const ids = decidingCorrelationIds(result);
      const input: FailureInput = {
        runId: report.testRunId,
        ...(result.testCaseId ? { testCaseId: result.testCaseId } : {}),
        validatorName: result.validatorName,
        category: result.category,
        severity: result.severity,
        endpointId: report.endpointId,
        endpoint: report.endpoint,
        suite: report.suite,
        expected: result.expected,
        actual: result.actual,
        ...(result.error ? { validatorError: result.error } : {}),
        decidingCorrelationIds: ids,
        exchanges: evidence,
        reachability,
        ...(report.contract ? { contract: report.contract } : {}),
      };

      const decision = classifyFailure(input);
      const deciding = decidingExchange(input);

      return {
        runId: input.runId,
        ...(input.testCaseId ? { testCaseId: input.testCaseId } : {}),
        ...(deciding ? { correlationId: deciding.correlationId } : {}),
        decidingCorrelationIds: ids,
        endpoint: report.endpoint,
        endpointId: report.endpointId,
        suite: report.suite,
        validatorName: result.validatorName,
        category: result.category,
        severity: result.severity,
        ...(deciding ? { phase: deciding.phase } : {}),
        classification: decision.classification,
        violationType: decision.violationType,
        reasonCode: decision.reasonCode,
        summary: decision.summary,
        supportingEvidence: decision.supportingEvidence,
        missingEvidence: decision.missingEvidence,
        eligibleForDefectReview: decision.eligibleForDefectReview,
        cleanupRelated: decision.cleanupRelated,
        expected: render(result.expected),
        actual: render(result.actual),
        ...(deciding ? { origin: deciding.origin, originRule: deciding.originRule } : {}),
        reachability: reachability.state,
        createdAt: now.toISOString(),
        classifierVersion: CLASSIFIER_VERSION,
      } satisfies Observation;
    });
}
