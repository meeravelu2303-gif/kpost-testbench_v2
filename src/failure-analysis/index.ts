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
