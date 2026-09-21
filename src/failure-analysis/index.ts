/**
 * Failure analysis — the evidence foundation (Phase 3.2).
 *
 * This module is **observational only**. It records what an exchange looked like and attributes
 * where the response came from, with bounded, redacted, deterministic data. It decides nothing:
 * there is no severity here, no defect, no filing, and nothing in the Bugzilla pipeline reads it.
 *
 * Classification (`APP_DEFECT` / `TEST_ISSUE` / …) and the defect-confidence gate are Phase 3.3 and
 * later, and they consume this. The invariant they exist to protect starts here:
 *
 *     FAILED VALIDATION != APPLICATION DEFECT
 */
export {
  captureExchange,
  captureMarkers,
  captureResponseHeaders,
  serialiseEvidence,
  EVIDENCE_LIMITS,
  EVIDENCE_RESPONSE_HEADERS,
  type CaptureContext,
  type EvidenceHeader,
  type ExchangeEvidence,
  type RequestAuthEvidence,
  type RequestEvidence,
  type ResponseEvidence,
  type ResponseMarkers,
  type ResponseOrigin,
  type TransportEvidence,
} from './evidence';

export {
  attributeOrigin,
  withOrigin,
  ORIGIN_RULE_IDS,
  type OriginAttribution,
  type OriginRule,
} from './origin';

export {
  reachabilityByEndpoint,
  reachabilityOf,
  type ReachabilityState,
  type ReachabilityWitness,
} from './reachability';

export {
  FileEvidenceJournal,
  MemoryEvidenceJournal,
  DEFAULT_EVIDENCE_FILE,
  type EvidenceSink,
} from './evidence-journal';

/**
 * Phase 3.3 — the root-cause classifier. Still observational: it classifies, and nothing reads a
 * classification back into Bugzilla filing.
 */
export {
  CLASSIFIER_VERSION,
  FAILURE_CLASSES,
  REASON_CODES,
  VIOLATION_TYPES,
  violationTypeOf,
  type ClassificationResult,
  type EvidenceReference,
  type FailureClass,
  type MissingEvidence,
  type ReasonCode,
  type ViolationType,
} from './classification';

export {
  classifyFailure,
  decidingExchange,
  expectedStatuses,
  type ContractExpectation,
  type FailureInput,
} from './classifier';

export { decidingCorrelationIds, observationsFromReport, type Observation } from './observation';

/**
 * Phase 3.4 — the defect-confidence gate. Still observational: it answers whether an observation's
 * evidence is strong enough to be treated as a defect CANDIDATE, and nothing reads that answer back
 * into Bugzilla filing, fingerprints or auto-resolution.
 */
export {
  CONFIDENCE_DECISIONS,
  DECISION_BY_REASON,
  GATE_REASON_CODES,
  GATE_VERSION,
  observationKeyOf,
  type ConfidenceAssessment,
  type ConfidenceDecision,
  type ConfidenceDecisionRecord,
  type ConfidenceFactors,
  type ConfidenceInput,
  type GateContract,
  type GateObservation,
  type GateReasonCode,
} from './confidence';

export { assessConfidence, confidenceFactors } from './confidence-gate';

export {
  confidenceInputFor,
  decisionRecord,
  decisionsFromReport,
  type DecisionOptions,
} from './confidence-decision';
