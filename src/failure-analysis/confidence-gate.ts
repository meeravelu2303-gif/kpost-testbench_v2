import { EVIDENCE_RESPONSE_HEADERS, type ExchangeEvidence } from './evidence';
import type { EvidenceReference, ViolationType } from './classification';
import {
  DECISION_BY_REASON,
  observationKeyOf,
  type ConfidenceAssessment,
  type ConfidenceFactors,
  type ConfidenceInput,
  type GateContract,
  type GateReasonCode,
} from './confidence';

/**
 * The defect-confidence gate: a finished observation plus structured evidence in, an explained
 * sufficiency decision out.
 *
 * Pure and total. No network, no filesystem, no clock, no randomness, no Bugzilla — the same input
 * yields the same output forever, which is what makes a run's distribution meaningful and lets every
 * rule be unit-tested in isolation. Persistence and identity live in the reporter.
 *
 * ## What it reads, and what it refuses to read
 *
 * Every rule reads a STRUCTURED field: an attributed origin, a phase, a reachability state, a status
 * compared against the endpoint's own registered contract, a declared content type, a declared
 * response schema, a declared required-header list, a sample count derived from the evidence itself.
 *
 * It never reads the observation's rendered `expected` / `actual` / `summary`, never reads a
 * validator's message, and never infers a cause from an endpoint name, a validator name or an HTTP
 * status on its own. The `GateObservation` type exists precisely so those prose fields are not even
 * reachable from here.
 *
 * ## Why it re-verifies what the classifier already established
 *
 * Rules 8–12 below repeat checks the Phase 3.3 classifier also makes (origin, reachability, deciding
 * exchange). That is deliberate: Section 5 of this phase's brief states the minimum conditions an
 * `APP_DEFECT` must satisfy BEFORE becoming a candidate, and a gate that simply trusted the
 * classification would not be a second check at all — it would be a rubber stamp that inherits any
 * future classifier mistake silently. Re-deriving them from the same evidence costs nothing, keeps
 * the two phases independently auditable, and means a change to either is caught by the other.
 *
 * ## Precedence, and why it is this order
 *
 * The first rule that matches decides. The order runs from "deterministic proof this is not an
 * application defect" through "the evidence cannot say" to "every condition is satisfied":
 *
 *  1. **Cleanup** — first, and for the same reason it is first in the classifier: a safety rule, not
 *     a diagnosis. A teardown failure must be impossible to promote to a defect candidate, and that
 *     guarantee must not depend on any rule below it.
 *  2. **Blocked by a precondition** — the action never ran, so its subject was never exercised.
 *  3. **Deciding exchange is itself a precondition** — setup traffic is not the behaviour under test.
 *  4. **Test integrity** — the evidence attributes the failure to the bench.
 *  5. **Environment** and 6. **Infrastructure** — attributed away from the application by evidence.
 *  7. **Declared unsupported** — the configuration says the capability is intentionally absent.
 *  8. **No deciding exchange** — nothing to verify against.
 *  9. **Origin not the application** / 10. **Origin unknown** — attribution fails, positively or not.
 * 11. **Reachability absent** / 12. **Reachability unknown** — the application was never witnessed.
 * 13. **Classifier could not conclude** — the gate has no stronger evidence than the classifier had.
 * 14. **Defensive guard** — any remaining non-`APP_DEFECT` class.
 * 15. **Per-dimension evidence requirements** — the only route to `ELIGIBLE`.
 *
 * ## The safety rule that governs the whole file
 *
 * This gate must never be tuned to shrink a Bugzilla queue. Where evidence is missing the answer is
 * `INDETERMINATE` — visible, counted, and carrying the name of the evidence that would settle it —
 * never a quiet `NOT_ELIGIBLE`. Nothing here skips a test, weakens a validator, excludes an endpoint
 * or drops a status code.
 */

/**
 * Samples of one measurement needed before a latency judgement can separate a transient slowdown
 * from a regression. Two is the minimum that can disagree; it is not a claim that two is sufficient
 * for a statistically sound baseline, only that one is definitively insufficient.
 */
const MIN_PERFORMANCE_SAMPLES = 2;

/**
 * Structured before/after state records do not exist anywhere in this architecture.
 *
 * `database.*` validators are the STATE family, and the database layer is mock-only — there is no
 * real adapter, so no read of committed state exists to compare across an action. Recorded as a
 * named constant rather than an inline `false` so the one place a future state capture plugs in is
 * obvious, and so the gate never silently starts claiming state evidence it does not have.
 */
const STATE_EVIDENCE_SUPPORTED = false;

/**
 * Structured actor identity does not exist on an exchange.
 *
 * `RequestEvidence.auth` records only whether an Authorization header was present and its SCHEME —
 * deliberately, because the credential must never be copied. So no exchange can witness "principal A
 * read principal B's resource", which is the evidence a cross-account or authorization claim needs.
 * A future phase would add a non-secret principal KEY (`personal-3`, the pool's own label) to
 * request evidence; nothing is inferred until it does.
 */
const SECURITY_ACTOR_EVIDENCE_SUPPORTED = false;

/** The response headers evidence can witness. Absence outside this set is not observable. */
const WITNESSED_HEADERS: ReadonlySet<string> = new Set<string>(EVIDENCE_RESPONSE_HEADERS);

function reference(
  field: string,
  value: string | number | boolean | undefined,
): EvidenceReference[] {
  return value === undefined ? [] : [{ field, value }];
}

/** A rule's answer, before identity and the decision word are attached. */
interface RuleOutcome {
  reasonCode: GateReasonCode;
  summary: string;
  supporting?: EvidenceReference[];
  missing?: string[];
}

/**
 * How many times the deciding measurement was actually taken.
 *
 * Derived from the evidence rather than assumed: exchanges for the same endpoint carrying the same
 * label are repeats of the same call. The engine sends the primary exactly once per endpoint per
 * run, so this is 1 today — and it becomes greater than 1 on its own the day the architecture
 * repeats a measurement, with no change to this rule.
 */
function sampleCount(input: ConfidenceInput): number {
  const deciding = input.deciding;
  if (!deciding) return 0;
  return input.exchanges.filter(
    (e) => e.endpointId === deciding.endpointId && e.label === deciding.label,
  ).length;
}

/** A setup exchange that did not succeed, so the action downstream of it never ran cleanly. */
function failedPrecondition(input: ConfidenceInput): ExchangeEvidence | undefined {
  return input.exchanges.find(
    (e) => e.phase === 'precondition' && (e.response.status === 0 || e.response.status >= 400),
  );
}

/**
 * Whether a structured contract exists for the DIMENSION under test.
 *
 * Not "is there any contract" — a declared `expectedStatus` says nothing about whether the endpoint
 * declares a response schema, so a schema claim must not borrow the status contract's credibility.
 */
function contractPresentFor(
  violationType: ViolationType,
  contract: GateContract | undefined,
): boolean {
  if (!contract) return false;
  switch (violationType) {
    case 'STATUS_CODE':
      return (contract.expectedStatus?.length ?? 0) > 0;
    case 'RESPONSE_SCHEMA':
      return contract.responseSchemaDeclared === true;
    case 'HEADER':
      return (contract.requiredHeaders?.length ?? 0) > 0;
    case 'CONTENT_TYPE':
      return contract.contentType !== undefined && contract.contentType.length > 0;
    case 'PERFORMANCE':
      return contract.maxResponseTimeMs !== undefined;
    case 'SECURITY':
    case 'INPUT_VALIDATION':
    case 'BUSINESS_RULE':
    case 'STATE':
    case 'OTHER':
      /*
       * No per-endpoint structured declaration exists for these dimensions. Reporting `false` is the
       * honest reading: the gate has no contract to verify the claim against, which is exactly why
       * each of their branches below answers INDETERMINATE and names what is missing.
       */
      return false;
  }
}

/** Every factor, derived from structured evidence only. Computed once, recorded on every decision. */
export function confidenceFactors(input: ConfidenceInput): ConfidenceFactors {
  const { observation, deciding, contract } = input;
  const samples = sampleCount(input);
  return {
    applicationAttributed: deciding?.origin === 'APPLICATION',
    reachabilityPresent: observation.reachability === 'PRESENT',
    decidingExchangePresent: deciding !== undefined,
    contractPresent: contractPresentFor(observation.violationType, contract),
    actionPhase: deciding?.phase === 'action',
    testIntegrityClean:
      observation.classification !== 'TEST_ISSUE' &&
      observation.classification !== 'BLOCKED' &&
      failedPrecondition(input) === undefined,
    environmentClean:
      observation.classification !== 'ENVIRONMENT' &&
      observation.classification !== 'INFRASTRUCTURE' &&
      !observation.cleanupRelated,
    repeatabilityAvailable:
      samples >= MIN_PERFORMANCE_SAMPLES && contract?.maxResponseTimeMs !== undefined,
    stateEvidenceAvailable: STATE_EVIDENCE_SUPPORTED,
    securityEvidenceAvailable: SECURITY_ACTOR_EVIDENCE_SUPPORTED,
  };
}

/**
 * Assesses one observation.
 *
 * The decision WORD is never written at a rule site: each rule returns a reason code, and
 * `DECISION_BY_REASON` maps it. A rule therefore cannot answer `ELIGIBLE` with a reason that means
 * the opposite, and the whole mapping is auditable in one table.
 */
export function assessConfidence(input: ConfidenceInput): ConfidenceAssessment {
  const factors = confidenceFactors(input);
  const outcome = applyRules(input, factors);
  return {
    decision: DECISION_BY_REASON[outcome.reasonCode],
    reasonCode: outcome.reasonCode,
    summary: outcome.summary,
    factors,
    supportingEvidence: [...baseEvidence(input), ...(outcome.supporting ?? [])],
    missingEvidence: outcome.missing ?? [],
  };
}

/** Identity and attribution, on every decision whatever the answer. Scalars only. */
function baseEvidence(input: ConfidenceInput): EvidenceReference[] {
  const { observation, deciding } = input;
  return [
    ...reference('observationKey', observationKeyOf(observation)),
    ...reference('validator', observation.validatorName),
    ...reference('violationType', observation.violationType),
    ...reference('classification', observation.classification),
    ...reference('classifierReasonCode', observation.reasonCode),
    ...reference('correlationId', deciding?.correlationId),
    ...reference('phase', deciding?.phase),
    ...reference('origin', deciding?.origin),
    ...reference('originRule', deciding?.originRule),
    ...reference('reachability', observation.reachability),
  ];
}

function applyRules(input: ConfidenceInput, factors: ConfidenceFactors): RuleOutcome {
  const { observation, deciding } = input;

  // ---- 1. Cleanup. A safety rule, so nothing below can override it. ---------------------------
  if (observation.cleanupRelated || deciding?.phase === 'cleanup') {
    return {
      reasonCode: 'CLEANUP_PHASE',
      summary:
        'The deciding exchange ran during teardown. A cleanup failure describes the environment ' +
        'after the test, never the behaviour the test was asserting, so it can never be an ' +
        'application-defect candidate.',
    };
  }

  // ---- 2. A precondition failed, so the action never exercised its subject. --------------------
  const blocked = failedPrecondition(input);
  if (observation.classification === 'BLOCKED' || blocked) {
    return {
      reasonCode: 'PRECONDITION_FAILED',
      summary:
        'A setup exchange failed before the action ran, so the assertion never exercised the ' +
        'behaviour it was written to judge.',
      supporting: [
        ...reference('preconditionCorrelationId', blocked?.correlationId),
        ...reference('preconditionStatus', blocked?.response.status),
      ],
    };
  }

  // ---- 3. The deciding exchange is setup traffic, not the action. ------------------------------
  if (deciding?.phase === 'precondition') {
    return {
      reasonCode: 'PRECONDITION_PHASE',
      summary:
        'The exchange the check judged belongs to the precondition phase. Setup traffic is not the ' +
        'behaviour under test, so it cannot establish an application defect on its own.',
    };
  }

  // ---- 4. The evidence attributes the failure to the bench. ------------------------------------
  if (observation.classification === 'TEST_ISSUE') {
    return {
      reasonCode: 'TEST_INTEGRITY_FAILURE',
      summary:
        'The evidence attributes this failure to the test itself — a programming fault in the ' +
        'check, or an expectation that contradicts the endpoint’s own registered contract.',
    };
  }

  // ---- 5 & 6. Attributed away from the application by evidence. --------------------------------
  if (observation.classification === 'ENVIRONMENT') {
    return {
      reasonCode: 'ENVIRONMENT_EVIDENCE',
      summary:
        'The evidence describes an environment condition — declared throttling or a refused ' +
        'teardown — rather than the behaviour under test.',
    };
  }
  if (observation.classification === 'INFRASTRUCTURE') {
    return {
      reasonCode: 'INFRASTRUCTURE_EVIDENCE',
      summary:
        'The evidence places the failure below or in front of the application: a transport failure, ' +
        'or a response produced by an intermediary.',
    };
  }

  // ---- 7. The configuration declares the capability intentionally unsupported. ------------------
  if (observation.classification === 'NOT_IMPLEMENTED' || input.contract?.declaredUnsupported) {
    return {
      reasonCode: 'CAPABILITY_DECLARED_UNSUPPORTED',
      summary:
        'The endpoint’s registered configuration declares this capability intentionally ' +
        'unsupported, so its absence is not a defect.',
    };
  }

  // ---- 8. Nothing to verify against. ------------------------------------------------------------
  if (!deciding) {
    return {
      reasonCode: 'NO_DECIDING_EXCHANGE',
      summary:
        'No recorded exchange could be matched to the failing check, so there is nothing to verify ' +
        'the claim against.',
      missing: ['an exchange whose correlation id matches the failing check'],
    };
  }

  // ---- 9 & 10. Attribution: a positive finding, or an unanswered question. ----------------------
  if (deciding.origin === 'EDGE' || deciding.origin === 'NO_RESPONSE') {
    return {
      reasonCode: 'ORIGIN_NOT_APPLICATION',
      summary:
        deciding.origin === 'EDGE'
          ? 'An intermediary produced the deciding response, so it does not describe application ' +
            'behaviour.'
          : 'No response was received for the deciding exchange, so there is no application ' +
            'behaviour to judge.',
    };
  }
  if (deciding.origin === 'UNKNOWN') {
    return {
      reasonCode: 'ORIGIN_UNKNOWN',
      summary:
        'The producer of the deciding response could not be established, so the failure cannot be ' +
        'attributed to the application.',
      missing: [
        'an application marker (traceId / urlPath / documented envelope) on the deciding response',
        'or a standards-defined intermediary marker (Via / cache) ruling the application out',
      ],
    };
  }

  // ---- 11 & 12. Was the application witnessed at all for this endpoint? -------------------------
  if (observation.reachability === 'ABSENT') {
    return {
      reasonCode: 'REACHABILITY_ABSENT',
      summary:
        'Every exchange for this endpoint was attributed away from the application, so nothing here ' +
        'witnessed it handling a request.',
    };
  }
  if (observation.reachability !== 'PRESENT') {
    return {
      reasonCode: 'REACHABILITY_NOT_PRESENT',
      summary:
        'No exchange for this endpoint carried an application marker, so the attribution of the ' +
        'deciding response is unsupported by any witness.',
      missing: ['an application-attributed exchange for this endpoint in this test'],
    };
  }

  // ---- 13. The classifier could not conclude; the gate has no stronger evidence. ----------------
  if (observation.classification === 'INSUFFICIENT_EVIDENCE') {
    return {
      reasonCode: 'CLASSIFICATION_INSUFFICIENT_EVIDENCE',
      summary:
        'The classifier could not establish a cause from this evidence, and the gate has no ' +
        'additional evidence available to it.',
      missing: ['the evidence named on the observation’s own missingEvidence'],
    };
  }

  /*
   * ---- 14. Defensive guard. Only APP_DEFECT may reach the dimension rules. ---------------------
   *
   * Every one of the seven Phase 3.3 classes is handled above, so TypeScript narrows
   * `classification` to `APP_DEFECT` here and this branch is UNREACHABLE by construction today —
   * deliberately. It exists so that ADDING a class to `FAILURE_CLASSES` cannot silently fall through
   * into the dimension rules and become eligible: the new class would reach this guard and be
   * refused until someone decides, explicitly, what evidence it requires.
   *
   * The value is widened before interpolation because the narrowed type is `never`; keeping the
   * guard is worth more than the dead-code warning it would otherwise raise.
   */
  const classification: string = observation.classification;
  if (classification !== 'APP_DEFECT') {
    return {
      reasonCode: 'NOT_APP_DEFECT_CLASSIFICATION',
      summary:
        `The classification ${classification} is not one the gate can promote to an ` +
        'application-defect candidate.',
    };
  }

  // ---- 15. The dimension's own evidence requirements. The only route to ELIGIBLE. ---------------
  return assessDimension(input, factors, deciding);
}

/**
 * The per-dimension rules.
 *
 * Reached only once origin is `APPLICATION`, reachability is `PRESENT`, the deciding exchange is in
 * the action phase and the classifier concluded `APP_DEFECT`. What remains is the question each
 * dimension answers differently: does the recorded evidence actually witness THIS kind of violation?
 */
function assessDimension(
  input: ConfidenceInput,
  factors: ConfidenceFactors,
  deciding: ExchangeEvidence,
): RuleOutcome {
  const contract = input.contract;

  switch (input.observation.violationType) {
    /*
     * A status claim needs a structured statement of what the APPLICATION was expected to answer,
     * and a status that came from the application's own response.
     *
     * ## Why only the registered contract may establish that
     *
     *     VALIDATOR ASSERTION  !=  REGISTERED APPLICATION CONTRACT
     *
     * A validator's numeric expectation is NOT accepted as the authority, even though today's one
     * STATUS_CODE validator happens to derive it correctly: `response.status-code` sets
     * `expected: endpoint.expectedStatus`, i.e. the registry verbatim. The problem is provenance, not
     * that particular validator — by the time the number reaches this gate it is a bare `number[]`
     * with no record of where it came from, so the gate cannot tell a value read from the registry
     * from one a future validator hard-codes. Accepting it would let a validator's own assumption
     * confer application-defect eligibility.
     *
     * So eligibility requires `contract.expectedStatus`, which is written onto the report from the
     * `ResolvedEndpoint` and can only come from the registry. The check's numeric expectation is kept
     * as CORROBORATION on the record, never as authority; where the two disagree, Phase 3.3's
     * `EXPECTATION_CONFLICTS_WITH_CONTRACT` rule has already classified the failure as a TEST_ISSUE,
     * which rule 4 above refuses before this branch is ever reached.
     *
     * No prose can reach here: `expectedStatuses` accepts a number or an all-number array and nothing
     * else, so `flow.server-error`'s sentence ("never a 5xx") yields `undefined` and contributes
     * nothing in either direction.
     */
    case 'STATUS_CODE': {
      const contractStatuses = contract?.expectedStatus ?? [];
      const checkStatuses = input.checkExpectedStatuses ?? [];
      if (contractStatuses.length === 0) {
        return {
          reasonCode: 'CONTRACT_EXPECTATION_MISSING',
          summary:
            'The failure concerns a status code, but the endpoint’s registered contract declares no ' +
            'expected status. A validator’s own numeric expectation is not accepted as the ' +
            'application’s contract.',
          supporting: [
            { field: 'contractExpectedStatusDeclared', value: false },
            { field: 'checkExpectedStatusPresent', value: checkStatuses.length > 0 },
          ],
          missing: [
            'a structured expectedStatus on the endpoint’s registered contract (a validator ' +
              'assertion is not a registered application contract)',
          ],
        };
      }
      if (!deciding.response.received) {
        return {
          reasonCode: 'CONTRACT_EXPECTATION_MISSING',
          summary:
            'The failure concerns a status code, but the deciding exchange recorded no response, ' +
            'so there is no observed status to compare against the contract.',
          missing: ['a received response on the deciding exchange'],
        };
      }
      return confirmed(
        `The application produced HTTP ${deciding.response.status} on an action-phase exchange ` +
          'whose expected status is declared by the endpoint’s registered contract.',
        [
          ...reference('observedStatus', deciding.response.status),
          // The AUTHORITY for this decision.
          ...reference('contractExpectedStatus', contractStatuses.join(',')),
          { field: 'statusAuthority', value: 'registered-contract' },
          // Corroboration only — recorded so the two can be compared, never relied upon.
          ...reference(
            'checkExpectedStatus',
            checkStatuses.length ? checkStatuses.join(',') : undefined,
          ),
        ],
      );
    }

    /*
     * A schema claim rests on the endpoint declaring a response schema AND on the captured body
     * being able to re-witness the failure. A truncated or binary excerpt cannot, and neither can a
     * body that is not JSON — the claim would then rest on nothing the record preserved.
     */
    case 'RESPONSE_SCHEMA': {
      const missing: string[] = [];
      if (contract?.responseSchemaDeclared !== true) {
        missing.push(
          'a response schema declared on the endpoint’s registered contract (the workbook ' +
            'documents no sample response for this endpoint, so there is no structured shape to ' +
            'hold it to)',
        );
      }
      if (!deciding.response.isJson) {
        missing.push('a structured (JSON) response body on the deciding exchange');
      }
      if (deciding.response.snippet === undefined || deciding.response.truncated) {
        missing.push(
          'a complete captured response body — the stored excerpt is absent or truncated, so the ' +
            'schema failure cannot be re-witnessed from the record',
        );
      }
      if (missing.length > 0) {
        return {
          reasonCode: 'SCHEMA_EVIDENCE_MISSING',
          summary:
            'The failure concerns the response shape, but the evidence cannot establish the ' +
            'violation from a declared schema and a complete captured body.',
          supporting: [
            { field: 'responseSchemaDeclared', value: contract?.responseSchemaDeclared === true },
            { field: 'responseIsJson', value: deciding.response.isJson },
            { field: 'bodyTruncated', value: deciding.response.truncated },
          ],
          missing,
        };
      }
      return confirmed(
        'The application returned a complete, structured body that violates the response schema ' +
          'its registered contract declares.',
        [
          { field: 'responseSchemaDeclared', value: true },
          ...reference('responseBytes', deciding.response.bytes),
        ],
      );
    }

    /*
     * A header claim is usually an ABSENCE claim, and absence is only observable for a header the
     * evidence would have copied had it been present. Phase 3.2 allowlists response headers by
     * design, so a header outside that list is indistinguishable from one that was simply never
     * recorded — and a defect must never rest on that ambiguity.
     */
    case 'HEADER': {
      const required = contract?.requiredHeaders ?? [];
      if (required.length === 0) {
        return {
          reasonCode: 'HEADER_EVIDENCE_MISSING',
          summary:
            'The failure concerns response headers, but the endpoint’s contract declares no ' +
            'required header, so there is no structured expectation to verify.',
          missing: ['a structured requiredHeaders list on the endpoint’s registered contract'],
        };
      }
      const unwitnessed = required.filter((name) => !WITNESSED_HEADERS.has(name.toLowerCase()));
      if (unwitnessed.length > 0) {
        return {
          reasonCode: 'HEADER_EVIDENCE_MISSING',
          summary:
            'The failure concerns headers the captured evidence cannot witness, so their absence ' +
            'from the record does not establish their absence from the response.',
          supporting: [{ field: 'unwitnessedHeaders', value: unwitnessed.join(',') }],
          missing: [
            `evidence capture for the response header(s) ${unwitnessed.join(', ')} — they are ` +
              'outside the Phase 3.2 response-header allowlist, so presence and absence are ' +
              'indistinguishable in the record',
          ],
        };
      }
      return confirmed(
        'Every header the endpoint’s contract requires is one the evidence records, so its ' +
          'presence or absence on the application’s response is directly witnessed.',
        [{ field: 'requiredHeaders', value: required.join(',') }],
      );
    }

    case 'CONTENT_TYPE': {
      const expected = contract?.contentType;
      const observed = deciding.response.contentType;
      if (!expected || !observed) {
        return {
          reasonCode: 'CONTENT_TYPE_EVIDENCE_MISSING',
          summary:
            'The failure concerns the content type, but a structured expected or observed content ' +
            'type is missing from the record.',
          supporting: [
            { field: 'expectedContentTypeDeclared', value: expected !== undefined },
            { field: 'observedContentTypePresent', value: observed !== undefined },
          ],
          missing: [
            ...(expected ? [] : ['a declared contentType on the endpoint’s registered contract']),
            ...(observed ? [] : ['a Content-Type header on the deciding response']),
          ],
        };
      }
      return confirmed(
        'Both the declared and the observed content type are structured values on the record, so ' +
          'the mismatch is directly witnessed.',
        [
          { field: 'contractContentType', value: expected },
          { field: 'observedContentType', value: observed },
        ],
      );
    }

    /*
     * A security validator failing is not evidence of a security defect. Each sub-family needs the
     * property itself witnessed, and this architecture witnesses none of them: request VALUES are
     * never recorded (so an injection condition is not in the record), and no exchange carries an
     * actor identity (so no cross-account or authorization claim can be supported).
     */
    case 'SECURITY':
      return {
        reasonCode: 'SECURITY_EVIDENCE_INCOMPLETE',
        summary:
          'A security check failed, but no structured evidence witnesses the security property ' +
          'itself, so the finding stays visible and undecided rather than being asserted as a defect.',
        supporting: [
          { field: 'actorIdentityAvailable', value: factors.securityEvidenceAvailable },
          { field: 'requestAuthPresent', value: deciding.request.auth.present },
          ...reference('requestAuthScheme', deciding.request.auth.scheme),
        ],
        missing: [
          'for a cross-account or authorization claim: a non-secret actor identity on the request ' +
            'evidence, plus evidence that the resource reached belonged to a different principal',
          'for an injection or payload claim: a structured description of the input condition — ' +
            'request values are never recorded, by design, so the condition under test is absent ' +
            'from the record',
        ],
      };

    /*
     * The expected behaviour and the observed behaviour are both structured here. The INPUT
     * CONDITION is not: evidence records request body KEY NAMES only, never values, so "the field
     * was null" or "the field was the wrong type" is nowhere in the record. All three are required.
     */
    case 'INPUT_VALIDATION':
      return {
        reasonCode: 'INPUT_VALIDATION_EVIDENCE_INCOMPLETE',
        summary:
          'An input-validation check failed, but the input CONDITION under test is not structurally ' +
          'recorded, so the observed behaviour cannot be tied to the input that produced it.',
        supporting: [
          ...reference('observedStatus', deciding.response.status),
          { field: 'requestBodyKeysRecorded', value: deciding.request.body?.keys.length ?? 0 },
        ],
        missing: [
          'a structured description of the mutation under test (field name and mutation kind — ' +
            'names only, never values), which request evidence does not carry today',
        ],
      };

    case 'BUSINESS_RULE':
      return {
        reasonCode: 'BUSINESS_RULE_EVIDENCE_INCOMPLETE',
        summary:
          'A business-rule check failed, but no structured record ties a precondition, an action and ' +
          'the rule’s expected outcome together — a status mismatch alone is not a business-rule ' +
          'violation.',
        missing: [
          'a structured business-rule record: the precondition or state the rule applies to, the ' +
            'action taken, the expected outcome the rule declares, and the observed outcome',
        ],
      };

    case 'STATE':
      return {
        reasonCode: 'STATE_EVIDENCE_INCOMPLETE',
        summary:
          'A state check failed, but no before-and-after state record exists. A single response ' +
          'cannot prove a state transition.',
        supporting: [{ field: 'stateEvidenceAvailable', value: factors.stateEvidenceAvailable }],
        missing: [
          'structured state records captured before and after the action (the database layer is ' +
            'mock-only, so no read of committed state exists to compare)',
        ],
      };

    /*
     * One measurement of a shared test environment cannot separate a transient slowdown from a
     * regression, whatever the threshold. The future path is implemented, not stubbed: the sample
     * count is derived from the evidence, so this becomes ELIGIBLE on its own once the architecture
     * repeats a measurement.
     */
    case 'PERFORMANCE': {
      const samples = sampleCount(input);
      const threshold = contract?.maxResponseTimeMs;
      if (factors.repeatabilityAvailable) {
        return confirmed(
          `The latency budget was exceeded across ${samples} samples of the same measurement, ` +
            'against a configured threshold.',
          [
            ...reference('observedDurationMs', deciding.durationMs),
            ...reference('thresholdMs', threshold),
            { field: 'samples', value: samples },
          ],
        );
      }
      return {
        reasonCode: 'PERFORMANCE_REQUIRES_REPEATABILITY',
        summary:
          'A latency budget was exceeded, but on a single measurement — a transient slowdown and a ' +
          'genuine regression are indistinguishable from this evidence. Recorded as undecided, not ' +
          'as a confirmed environment problem.',
        supporting: [
          ...reference('observedDurationMs', deciding.durationMs),
          ...reference('thresholdMs', threshold),
          { field: 'thresholdDefined', value: threshold !== undefined },
          { field: 'samples', value: samples },
          { field: 'requiredSamples', value: MIN_PERFORMANCE_SAMPLES },
        ],
        missing: [
          `at least ${MIN_PERFORMANCE_SAMPLES} samples of the same measurement; the engine sends ` +
            'the primary request once per endpoint per run, so repeatability is unavailable',
          ...(threshold === undefined
            ? ['a configured latency budget for this endpoint to judge the measurement against']
            : []),
        ],
      };
    }

    /*
     * The dimension could not be identified from the validator's own registered vocabulary. Nothing
     * can be verified without knowing what kind of claim is being made, so the honest answer is that
     * the gate has no rule for it — never a default in either direction.
     */
    case 'OTHER':
      return {
        reasonCode: 'VIOLATION_TYPE_UNSUPPORTED',
        summary:
          'The contract dimension under test could not be identified, so the gate has no rule for ' +
          'what evidence would establish this violation.',
        missing: [
          `a violation-type mapping for the validator ${input.observation.validatorName}, so the ` +
            'evidence requirements for its claim can be stated',
        ],
      };
  }
}

/** The single ELIGIBLE constructor, so the one route to a candidate is visible in one place. */
function confirmed(summary: string, supporting: EvidenceReference[]): RuleOutcome {
  return { reasonCode: 'APPLICATION_EVIDENCE_CONFIRMED', summary, supporting };
}
