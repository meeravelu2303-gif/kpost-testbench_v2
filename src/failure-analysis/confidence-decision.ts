import type { ValidationReport, ValidationResult } from '@engine/validation-result';
import { CLASSIFIER_VERSION } from './classification';
import { expectedStatuses } from './classifier';
import {
  GATE_VERSION,
  observationKeyOf,
  type ConfidenceDecisionRecord,
  type ConfidenceInput,
  type GateContract,
} from './confidence';
import { assessConfidence } from './confidence-gate';
import type { ExchangeEvidence } from './evidence';
import { observationsFromReport, type Observation } from './observation';

/**
 * Turns one endpoint's validation report into shadow confidence decisions.
 *
 * This is the layer the brief's Section 10 asks for: it RESOLVES the structured evidence an
 * observation only references, so the pure gate never has to reconstruct anything. Specifically it
 *
 *  - resolves each observation's deciding exchange from its `correlationId`,
 *  - reads the endpoint's registered contract off the report, and
 *  - reads the check's own expected status as NUMBERS, through Phase 3.3's `expectedStatuses`,
 *
 * and only then calls `assessConfidence`. Nothing here parses a message, and the gate is handed no
 * prose it could parse.
 *
 * ## Why it re-derives observations rather than being given them
 *
 * Classification is a pure function, so running it again costs only CPU and yields byte-identical
 * results. Taking that cost keeps Phase 3.3 completely untouched: the observation reporter and this
 * module read the same attachments independently and neither can perturb the other. The alternative
 * — threading decisions through the approved Phase 3.3 reporter — would mean editing it.
 *
 * ## Shadow
 *
 * Nothing here reads or writes Bugzilla, and nothing in `src/bug-tracker/` is imported. A decision
 * is a parallel record; the existing candidate pipeline neither sees it nor changes because of it.
 */

export interface DecisionOptions {
  /** Supplied by the caller so the pure gate never needs a clock. */
  now?: Date;
  /**
   * Evidence recorded elsewhere in the same test, used when the report carries none of its own —
   * a lifecycle flow-finding report is hand-built and has no `evidence` field, but its exchange was
   * captured and attached separately. Scoped to the report's endpoint, exactly as Phase 3.3 scopes
   * it, so one endpoint's exchanges can never witness another's.
   */
  evidence?: readonly ExchangeEvidence[];
}

/**
 * The exchanges this report's failures may be judged against.
 *
 * Deliberately the same rule Phase 3.3's `observationsFromReport` applies, so a decision is always
 * assessed against exactly the evidence its observation was classified from.
 */
function evidencePool(
  report: ValidationReport,
  options: DecisionOptions,
): readonly ExchangeEvidence[] {
  if (report.evidence && report.evidence.length > 0) return report.evidence;
  return (options.evidence ?? []).filter((record) => record.endpointId === report.endpointId);
}

/**
 * The FAILED result each observation came from, indexed by validator name.
 *
 * A validator runs at most once per endpoint, so the name is a unique key within one report — which
 * is what makes this safe, and safer than pairing by array position.
 */
function failedResultsByValidator(report: ValidationReport): Map<string, ValidationResult> {
  const index = new Map<string, ValidationResult>();
  for (const result of report.results) {
    if (result.status === 'FAILED') index.set(result.validatorName, result);
  }
  return index;
}

/** Builds the gate's input for one observation. Structured resolution only — no parsing. */
export function confidenceInputFor(
  observation: Observation,
  exchanges: readonly ExchangeEvidence[],
  options: { contract?: GateContract; expected?: unknown } = {},
): ConfidenceInput {
  const deciding = exchanges.find((e) => e.correlationId === observation.correlationId);
  const checkExpected = expectedStatuses(options.expected);
  return {
    observation,
    ...(deciding ? { deciding } : {}),
    exchanges,
    ...(options.contract ? { contract: options.contract } : {}),
    ...(checkExpected ? { checkExpectedStatuses: checkExpected } : {}),
  };
}

/** Assesses every classified failure in a report and returns the durable shadow records. */
export function decisionsFromReport(
  report: ValidationReport,
  options: DecisionOptions = {},
): ConfidenceDecisionRecord[] {
  const now = options.now ?? new Date();
  const exchanges = evidencePool(report, options);
  const results = failedResultsByValidator(report);
  const observations = observationsFromReport(report, {
    ...(options.evidence ? { evidence: options.evidence } : {}),
    now,
  });

  return observations.map((observation) => {
    const result = results.get(observation.validatorName);
    const input = confidenceInputFor(observation, exchanges, {
      ...(report.contract ? { contract: report.contract } : {}),
      ...(result ? { expected: result.expected } : {}),
    });
    return decisionRecord(observation, assessConfidenceFor(input), now);
  });
}

/** Named so a stack trace says which layer called the gate. */
function assessConfidenceFor(input: ConfidenceInput): ReturnType<typeof assessConfidence> {
  return assessConfidence(input);
}

/**
 * Attaches identity and versions to an assessment.
 *
 * Carries no rendered `expected` / `actual`, no response snippet and no request body: everything
 * that could describe payload content stays in `reports/evidence.jsonl` and is reached through
 * `correlationId`. That is what makes the shadow artifact safe to read by anyone who can read a
 * report, without depending on a masking pattern catching everything.
 */
export function decisionRecord(
  observation: Observation,
  assessment: ReturnType<typeof assessConfidence>,
  now: Date,
): ConfidenceDecisionRecord {
  return {
    runId: observation.runId,
    ...(observation.testCaseId ? { testCaseId: observation.testCaseId } : {}),
    observationKey: observationKeyOf(observation),
    ...(observation.correlationId ? { correlationId: observation.correlationId } : {}),
    decidingCorrelationIds: observation.decidingCorrelationIds,

    endpoint: observation.endpoint,
    endpointId: observation.endpointId,
    suite: observation.suite,
    validatorName: observation.validatorName,
    category: observation.category,
    severity: observation.severity,
    ...(observation.phase ? { phase: observation.phase } : {}),
    ...(observation.origin ? { origin: observation.origin } : {}),
    reachability: observation.reachability,

    classification: observation.classification,
    violationType: observation.violationType,
    classifierReasonCode: observation.reasonCode,

    decision: assessment.decision,
    reasonCode: assessment.reasonCode,
    summary: assessment.summary,
    factors: assessment.factors,
    supportingEvidence: assessment.supportingEvidence,
    missingEvidence: assessment.missingEvidence,

    gateVersion: GATE_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    createdAt: now.toISOString(),
  };
}
