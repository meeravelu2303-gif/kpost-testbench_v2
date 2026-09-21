import type { FailureClass, ViolationType } from '../failure-analysis/classification';
import type {
  ConfidenceDecision,
  ConfidenceDecisionRecord,
  GateReasonCode,
} from '../failure-analysis/confidence';

/**
 * How the shadow confidence gate compares with the EXISTING Bugzilla candidate pipeline.
 *
 * This is the primary output of Phase 3.4. The existing pipeline is not modified, not consulted for
 * a decision and not affected by anything here — it is simply measured alongside the gate so the two
 * can be compared before anyone proposes changing either.
 *
 * ## Terminology, deliberately neutral
 *
 * The groups below are named for what they ARE, never for what someone hopes they mean. A finding in
 * `existingCandidateGateNotEligible` is not "a false positive"; it is an existing candidate the gate
 * would not call an application-defect candidate, and which of the two is right is exactly the
 * question a human reviews. Likewise `gateEligibleNotExistingCandidate` is not "a missed bug".
 *
 * ## The comparison unit, stated precisely
 *
 * One FAILED validation result. Both pipelines start from exactly that set — `candidatesFromReport`
 * and `observationsFromReport` both filter `status === 'FAILED'` — so the mapping is one-to-one and
 * needs no heuristic.
 *
 * "Existing candidate" therefore means: the per-result candidate the existing pipeline builds, which
 * passes the existing validity gate. It is measured BEFORE `mergeCandidates` and
 * `consolidateCascades`, because those collapse several failures into one ticket and would destroy
 * the one-to-one mapping. The number of TICKETS the existing pipeline would file is consequently
 * lower than `existingCandidates`, and this report does not claim otherwise.
 */

/** One failure, as both pipelines saw it. */
export interface DivergenceRow {
  observationKey: string;
  endpointId: string;
  endpoint: string;
  suite: string;
  validatorName: string;
  classification: FailureClass;
  violationType: ViolationType;
  decision: ConfidenceDecision;
  reasonCode: GateReasonCode;
  /** Whether the existing pipeline's per-result candidate passes the existing validity gate. */
  existingCandidate: boolean;
  /** The existing gate's own reason for rejecting it, when it did. Recorded verbatim. */
  existingRejection?: string;
}

/** A small, identifier-only sample so a bucket can be spot-checked without opening the journal. */
export interface DivergenceSample {
  observationKey: string;
  validatorName: string;
  classification: FailureClass;
  violationType: ViolationType;
  reasonCode: GateReasonCode;
  existingRejection?: string;
}

const MAX_SAMPLES = 10;

/**
 * The EXISTING Bugzilla pipeline's four stages, and which of them this artifact measures.
 *
 * Carried in the artifact itself so a count can never be read as belonging to a stage it does not
 * describe. The specific misreading this exists to prevent is taking `existingCandidates` — a
 * per-failure count before consolidation — for the number of tickets that would be filed. On a real
 * run those differ by an order of magnitude (368 vs 28), because merge and cascade consolidation
 * collapse many failures of one endpoint, and many endpoints of one systemic fault, into one ticket.
 *
 * The two unmeasured stages are typed as a literal STRING, not a number, so nothing downstream can
 * total them or mistake an absent measurement for zero.
 */
export interface PipelineStages {
  /** Stage 1 — every FAILED validation result. The comparison unit, and what the gate assesses. */
  rawFailedValidations: number;
  /** Stage 2 — per-failure candidates that pass the existing validity gate. NOT tickets. */
  existingValidityGateCandidates: number;
  /** Stage 2 — per-failure candidates the existing validity gate rejects. */
  existingValidityGateRejected: number;
  /** Stage 3 — `mergeCandidates` + `consolidateCascades`. Deliberately not measured here. */
  mergeAndCascadeConsolidation: 'not-measured-by-this-artifact';
  /** Stage 4 — what the Bugzilla reporter would create/comment. Deliberately not measured here. */
  finalBugzillaFilings: 'not-measured-by-this-artifact';
  /** Where the real filing numbers live. */
  note: string;
}

export interface DivergenceReport {
  gateVersion: string;
  classifierVersion: string;
  generatedAt: string;
  /** What one row represents, carried in the artifact so it cannot be misread later. */
  comparisonUnit: string;
  /** Which pipeline stage each count belongs to, and which stages are not measured at all. */
  pipelineStages: PipelineStages;

  totalObservations: number;
  /** Per-result candidates that pass the EXISTING validity gate (pre-merge, pre-cascade). */
  existingCandidates: number;
  /** Per-result candidates the EXISTING validity gate rejects. */
  existingRejected: number;

  shadowEligible: number;
  shadowIneligible: number;
  shadowIndeterminate: number;

  /** Existing candidate AND shadow-eligible — the two pipelines agree it is worth reviewing. */
  overlap: number;
  existingCandidateShadowIneligible: number;
  existingCandidateShadowIndeterminate: number;
  shadowEligibleNotExistingCandidate: number;

  byGateReason: Record<string, number>;
  byClassification: Record<string, number>;
  byViolationType: Record<string, number>;
  /** Gate decision counted per violation type, so an INDETERMINATE bucket names its dimension. */
  byViolationTypeAndDecision: Record<string, Record<string, number>>;

  samples: {
    existingCandidateShadowIneligible: DivergenceSample[];
    existingCandidateShadowIndeterminate: DivergenceSample[];
    shadowEligibleNotExistingCandidate: DivergenceSample[];
    overlap: DivergenceSample[];
  };
}

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function sample(rows: readonly DivergenceRow[]): DivergenceSample[] {
  return rows.slice(0, MAX_SAMPLES).map((row) => ({
    observationKey: row.observationKey,
    validatorName: row.validatorName,
    classification: row.classification,
    violationType: row.violationType,
    reasonCode: row.reasonCode,
    ...(row.existingRejection ? { existingRejection: row.existingRejection } : {}),
  }));
}

/** Pairs a decision with the existing pipeline's verdict for the same failure. */
export function divergenceRow(
  decision: ConfidenceDecisionRecord,
  existing: { candidate: boolean; rejection?: string },
): DivergenceRow {
  return {
    observationKey: decision.observationKey,
    endpointId: decision.endpointId,
    endpoint: decision.endpoint,
    suite: decision.suite,
    validatorName: decision.validatorName,
    classification: decision.classification,
    violationType: decision.violationType,
    decision: decision.decision,
    reasonCode: decision.reasonCode,
    existingCandidate: existing.candidate,
    ...(existing.rejection ? { existingRejection: existing.rejection } : {}),
  };
}

/** Builds the run-level comparison. Pure: the clock and the versions are supplied by the caller. */
export function buildDivergenceReport(
  rows: readonly DivergenceRow[],
  meta: { gateVersion: string; classifierVersion: string; generatedAt: string },
): DivergenceReport {
  const is = (decision: ConfidenceDecision): DivergenceRow[] =>
    rows.filter((row) => row.decision === decision);

  const eligible = is('ELIGIBLE');
  const ineligible = is('NOT_ELIGIBLE');
  const indeterminate = is('INDETERMINATE');

  const overlap = eligible.filter((row) => row.existingCandidate);
  const candidateIneligible = ineligible.filter((row) => row.existingCandidate);
  const candidateIndeterminate = indeterminate.filter((row) => row.existingCandidate);
  const eligibleNotCandidate = eligible.filter((row) => !row.existingCandidate);

  const byViolationTypeAndDecision: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const bucket = (byViolationTypeAndDecision[row.violationType] ??= {});
    bucket[row.decision] = (bucket[row.decision] ?? 0) + 1;
  }

  const existingCandidates = rows.filter((row) => row.existingCandidate).length;
  const existingRejected = rows.filter((row) => !row.existingCandidate).length;

  return {
    ...meta,
    comparisonUnit:
      'one FAILED validation result; existing candidates are counted per result after the existing ' +
      'validity gate but BEFORE merge and cascade consolidation, so they exceed the number of ' +
      'tickets the existing pipeline would file',
    pipelineStages: {
      rawFailedValidations: rows.length,
      existingValidityGateCandidates: existingCandidates,
      existingValidityGateRejected: existingRejected,
      mergeAndCascadeConsolidation: 'not-measured-by-this-artifact',
      finalBugzillaFilings: 'not-measured-by-this-artifact',
      note:
        'existingValidityGateCandidates is a PER-FAILURE count at stage 2, not a ticket count. ' +
        'Merge and cascade consolidation (stage 3) collapse many failures into one ticket, so the ' +
        'number of Bugzilla tickets (stage 4) is substantially lower. The filing numbers are in ' +
        'reports/REPORT.md and reports/REPORT.json, which this artifact does not modify.',
    },

    totalObservations: rows.length,
    existingCandidates,
    existingRejected,

    shadowEligible: eligible.length,
    shadowIneligible: ineligible.length,
    shadowIndeterminate: indeterminate.length,

    overlap: overlap.length,
    existingCandidateShadowIneligible: candidateIneligible.length,
    existingCandidateShadowIndeterminate: candidateIndeterminate.length,
    shadowEligibleNotExistingCandidate: eligibleNotCandidate.length,

    byGateReason: tally(rows.map((row) => row.reasonCode)),
    byClassification: tally(rows.map((row) => row.classification)),
    byViolationType: tally(rows.map((row) => row.violationType)),
    byViolationTypeAndDecision,

    samples: {
      existingCandidateShadowIneligible: sample(candidateIneligible),
      existingCandidateShadowIndeterminate: sample(candidateIndeterminate),
      shadowEligibleNotExistingCandidate: sample(eligibleNotCandidate),
      overlap: sample(overlap),
    },
  };
}

/** A short console block. Neutral wording: no group is described as real or false defects. */
export function renderDivergenceConsole(report: DivergenceReport): string {
  const reasons = Object.entries(report.byGateReason)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([code, count]) => `${code} ${count}`)
    .join(' · ');

  return [
    `\n[confidence] SHADOW — ${report.totalObservations} classified failure(s) assessed ` +
      `(gate ${report.gateVersion}, classifier ${report.classifierVersion})`,
    `[confidence] shadow-eligible ${report.shadowEligible} · shadow-ineligible ` +
      `${report.shadowIneligible} · shadow-indeterminate ${report.shadowIndeterminate}`,
    `[confidence] existing pipeline stage 2 — per-FAILURE candidates ${report.existingCandidates} ` +
      `(rejected ${report.existingRejected}); these are NOT tickets — merge/cascade (stage 3) run ` +
      'after this, and the filed count is in reports/REPORT.md',
    `[confidence] overlap ${report.overlap} · existing-candidate/shadow-ineligible ` +
      `${report.existingCandidateShadowIneligible} · existing-candidate/shadow-indeterminate ` +
      `${report.existingCandidateShadowIndeterminate} · shadow-eligible/not-existing-candidate ` +
      `${report.shadowEligibleNotExistingCandidate}`,
    `[confidence] top gate reasons: ${reasons || '(none)'}`,
    '[confidence] shadow only — Bugzilla filing, fingerprints and auto-resolution are unchanged.',
  ].join('\n');
}
