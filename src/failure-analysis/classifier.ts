import type { ExchangeEvidence } from './evidence';
import type { ReachabilityWitness } from './reachability';
import {
  violationTypeOf,
  type ClassificationResult,
  type EvidenceReference,
  type FailureClass,
  type ReasonCode,
} from './classification';

/**
 * Error TYPES that identify a programming fault in the code that threw.
 *
 * The error's constructor name is structural evidence; its message is prose and is never read. A
 * plain `Error`, a `ProductionSafetyError`, an `AccountPoolError` or a ledger error is deliberately
 * absent — those are framework, safety-guard or setup conditions whose owner is not established.
 */
const PROGRAMMING_ERROR_TYPES = new Set([
  'TypeError',
  'ReferenceError',
  'RangeError',
  'SyntaxError',
  'EvalError',
]);

/**
 * The root-cause classifier: structured evidence in, an explained classification out.
 *
 * Pure and total. No network, no filesystem, no Bugzilla, no clock, no randomness — the same input
 * yields the same output forever, which is what makes a distribution over a run meaningful and what
 * lets every rule be unit-tested in isolation. Persistence lives in `observation.ts`.
 *
 * ## How it decides, and what it refuses to do
 *
 * Every rule reads a STRUCTURED field: a phase, an attributed origin, a transport record, a status
 * compared against the endpoint's own configured contract. No rule reads a message, a narrative or
 * any other prose, and no rule maps a status code to a cause on its own. The four forbidden
 * shortcuts — `500 → APP_DEFECT`, `401 → AUTH`, `502 → INFRASTRUCTURE`, `timeout → INFRASTRUCTURE`
 * — are absent by construction: a status is only ever compared with the contract that declared what
 * that endpoint should answer.
 *
 * ## Precedence, and why it is this order
 *
 * The first rule that matches decides. Each is ahead of the next because it describes a STRONGER,
 * more specific claim about who is responsible:
 *
 *  1. **Cleanup isolation** — first, because it is a safety rule, not a diagnosis. A teardown runs
 *     after the assertions and says nothing about the behaviour under test, so it must be impossible
 *     for any later rule to promote it to `APP_DEFECT`. Putting it anywhere else would make that
 *     guarantee depend on the rules below it.
 *  2. **Exception** — execution stopped. Only a programming-error TYPE attributes it to the test;
 *     anything else is unattributed, because an exception alone names no owner.
 *  3. **Blocked precondition** — the action never ran, so the assertion that failed is downstream of
 *     a setup failure and its subject was never exercised.
 *  4. **No response** — nothing answered at all. There is no response to attribute, so every rule
 *     below (which reasons about a response) is inapplicable.
 *  5. **Intermediary response** — something in front of the application answered. Attribution has
 *     already been established by evidence, so the application's behaviour is simply not in view.
 *  6. **Declared throttling** — a `Retry-After` header is the server stating it is throttling,
 *     whoever emitted it, so it sits above the origin rules. A 429 alone never reaches here.
 *  7. **Unknown origin** — we cannot say who answered, so we must not say who is at fault.
 *  8. **No deciding exchange** — a failure with no evidence at all.
 *  9. **Expectation conflicts with the contract** — the application did what its own registered
 *     contract says, so the disagreement is the test's. This must precede the defect rule, or a
 *     wrong expectation would be filed against the application.
 * 10. **Capability declared unsupported** — the endpoint's own configuration says so. A 404 or a 405
 *     is never treated as that declaration.
 * 11. **Application contract violation** — only now, with the application established as the
 *     producer and every cheaper explanation excluded, is `APP_DEFECT` available. The record names
 *     the contract DIMENSION violated, so a defect is never a black box.
 * 12. **Fallback** — `INSUFFICIENT_EVIDENCE`. The honest answer, never a guess.
 *
 * ## Rules that read a status, and what each combines it with
 *
 * No rule classifies from a status alone. `precondition` pairs a status range with the PHASE;
 * throttling pairs 429 with a `Retry-After` HEADER; the contract rules pair a status with the
 * endpoint's own declared `expectedStatus`. Origin, phase and transport carry every other decision.
 */

/** What the endpoint's own registered contract says a successful call returns. */
export interface ContractExpectation {
  /** Statuses the endpoint is configured to answer, e.g. `[200]` or `[200, 204]`. */
  expectedStatus: readonly number[];
  /**
   * The configuration declares this capability intentionally unsupported.
   *
   * The ONLY route to `NOT_IMPLEMENTED`. Nothing in the repository sets it today — there is no
   * structured "intentionally unsupported" declaration on an endpoint definition — so the class is
   * currently unreachable from live traffic. That is deliberate: a 404 or a 405 is not evidence of
   * intent, and inventing one would be worse than an unreachable class.
   */
  declaredUnsupported?: boolean;
  /**
   * The endpoint's configured latency budget (`thresholds.config.ts` via
   * `endpoint.performance.maxResponseTimeMs`), when one is defined.
   *
   * Carried so a performance observation can state the threshold it was judged against. Its ABSENCE
   * is itself evidence — a latency finding with no configured budget rests on nothing.
   */
  maxResponseTimeMs?: number;
}

/** The failure being classified, assembled from Phase 3.2 evidence and the validation result. */
export interface FailureInput {
  runId: string;
  /** Stable Phase 2.2 identity. Absent for a shared exchange that belongs to no single case. */
  testCaseId?: string;
  validatorName: string;
  category: string;
  severity: string;
  endpointId: string;
  endpoint: string;
  suite: string;

  /** What the check wanted and what it saw. Read structurally; never parsed as text. */
  expected: unknown;
  actual: unknown;
  /** Set by the engine when the validator itself threw — a bench fault, not a product one. */
  validatorError?: { name: string; message: string };

  /** Correlation ids the failing check judged, most specific first. */
  decidingCorrelationIds: readonly string[];
  /** Every exchange observed for this endpoint in this test. */
  exchanges: readonly ExchangeEvidence[];
  reachability: ReachabilityWitness;
  /** The endpoint's registered contract, when the caller could resolve it. */
  contract?: ContractExpectation;

  /*
   * ---- Phase 10 evidence ------------------------------------------------------------------
   *
   * Every field below is OPTIONAL, so a caller that predates this phase classifies exactly as it
   * did before. They exist because the master plan asks the analysis to consume flow, actor, state,
   * invariant and requirement evidence — and because without them the classifier has to answer from
   * an HTTP status, which is the one thing it is forbidden to do.
   */

  /**
   * Where this check sat in an executed flow.
   *
   * `prerequisiteFailed` is the load-bearing field: a step whose DECLARED prerequisite failed never
   * exercised its own subject, so classifying it at all would attribute someone else's failure to
   * it. The master plan forbids it in as many words, and rule 2 below enforces it.
   */
  flowStep?: {
    readonly flowId: string;
    readonly stepId: string;
    readonly prerequisiteFailed: boolean;
    /** The step that failed first, when one did. Named so the record points at the real cause. */
    readonly blockedByStepId?: string;
  };

  /** Which participant made the observation. The pool KEY, never a username or a credential. */
  actor?: { readonly role: string; readonly accountKey: string };

  /** The Phase 7 verdict, when this check was a state transition. */
  stateTransition?: 'OCCURRED' | 'NOT_OCCURRED' | 'INDETERMINATE';

  /** The Phase 9 verdict, when this check was a side effect. */
  sideEffect?: 'OBSERVED' | 'NOT_OBSERVED' | 'INDETERMINATE';

  /** The business invariant this check was asserting, when it was asserting one. */
  invariantId?: string;

  /** The requirement ids this check traces to, for provenance on the record. */
  requirementIds?: readonly string[];
}

/** HTTP 429. Compared as a number, never matched as text. */
const TOO_MANY_REQUESTS = 429;
/**
 * HTTP 405. Used ONLY to decide whether an `Allow` header is worth attaching as context — it
 * classifies nothing, because "the method is not allowed here" is not evidence that the capability
 * is intentionally unsupported.
 */
const METHOD_NOT_ALLOWED = 405;

function reference(
  field: string,
  value: string | number | boolean | undefined,
): EvidenceReference[] {
  return value === undefined ? [] : [{ field, value }];
}

/**
 * The exchange the failing check actually judged.
 *
 * Deterministic: the first deciding correlation id that matches a recorded exchange wins; failing
 * that, the primary exchange, which is the only other exchange the check could have been reading.
 * Causality is never invented — when neither resolves, the caller gets `undefined` and the failure
 * classifies as having no evidence.
 */
export function decidingExchange(input: FailureInput): ExchangeEvidence | undefined {
  for (const correlationId of input.decidingCorrelationIds) {
    const match = input.exchanges.find((e) => e.correlationId === correlationId);
    if (match) return match;
  }
  return input.exchanges.find((e) => e.primary);
}

/** Statuses the check expected, when it expressed them as numbers. Never derived from prose. */
export function expectedStatuses(expected: unknown): number[] | undefined {
  if (typeof expected === 'number') return [expected];
  if (!Array.isArray(expected) || expected.length === 0) return undefined;
  const numbers = expected.filter((value): value is number => typeof value === 'number');
  return numbers.length === expected.length ? numbers : undefined;
}

/** Methods an `Allow` header declares, upper-cased. Header parsing, not message parsing. */
function allowedMethods(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
}

function result(
  classification: FailureClass,
  reasonCode: ReasonCode,
  summary: string,
  supportingEvidence: EvidenceReference[],
  options: { missing?: string[]; cleanupRelated?: boolean } = {},
): Decision {
  return {
    classification,
    reasonCode,
    summary,
    supportingEvidence,
    missingEvidence: options.missing ?? [],
    // Only an APP_DEFECT is worth a later defect review, and even then the gate may disagree.
    eligibleForDefectReview: classification === 'APP_DEFECT',
    cleanupRelated: options.cleanupRelated ?? false,
  };
}

/** A decision before the contract dimension is attached — see `classifyFailure`. */
type Decision = Omit<ClassificationResult, 'violationType'>;

/**
 * Classifies one failure.
 *
 * The dimension under test is derived once, here, from the validator's own name, so every rule
 * below states only WHO is responsible and never has to remember to record WHAT was violated.
 */
export function classifyFailure(input: FailureInput): ClassificationResult {
  const violationType = violationTypeOf(input.validatorName);
  const decision: ClassificationResult = { ...decide(input), violationType };
  return violationType === 'PERFORMANCE' ? withPerformanceEvidence(decision, input) : decision;
}

/**
 * Records what a LATENCY judgement actually rests on.
 *
 * The classifier's answer is unchanged — an application-attributed response that missed its
 * configured budget is still an `APP_DEFECT`, because that is what the evidence indicates, and
 * forcing the classifier to agree with a filing gate would collapse two questions into one:
 *
 *     classifier:      "what does the evidence indicate?"
 *     confidence gate: "is that enough to report as a defect?"
 *
 * What this adds is the second question's INPUT. A latency measurement is one sample of a shared
 * test environment, and the bench sends the primary request exactly once — there is no repeat, no
 * percentile and no baseline anywhere in the architecture. So repeatability is recorded as UNKNOWN
 * rather than fabricated, and the requirement is named in `missingEvidence`. A later gate keys on
 * `violationType === 'PERFORMANCE'` — a structured field, not prose — and may refuse filing on
 * exactly that basis. That decision belongs to Phase 3.4 and is not taken here.
 */
function withPerformanceEvidence(
  decision: ClassificationResult,
  input: FailureInput,
): ClassificationResult {
  const deciding = decidingExchange(input);
  const threshold = input.contract?.maxResponseTimeMs;
  return {
    ...decision,
    supportingEvidence: [
      ...decision.supportingEvidence,
      ...reference('observedDurationMs', deciding?.durationMs),
      ...reference('thresholdMs', threshold),
      { field: 'thresholdDefined', value: threshold !== undefined },
      // One request, once. Never inferred, never invented.
      { field: 'repeatability', value: 'UNKNOWN' },
      { field: 'samples', value: deciding ? 1 : 0 },
    ],
    missingEvidence: [
      ...decision.missingEvidence,
      'repeatability: the budget was measured from a single request, so a transient slowdown and a ' +
        'genuine regression are indistinguishable from this evidence alone',
      ...(threshold === undefined
        ? ['a configured latency budget for this endpoint to judge the measurement against']
        : []),
    ],
  };
}

function decide(input: FailureInput): Decision {
  const deciding = decidingExchange(input);
  const base: EvidenceReference[] = [
    ...reference('testCaseId', input.testCaseId),
    ...reference('validator', input.validatorName),
    ...reference('endpointId', input.endpointId),
    ...reference('correlationId', deciding?.correlationId),
    ...reference('phase', deciding?.phase),
    ...reference('origin', deciding?.origin),
    ...reference('originRule', deciding?.originRule),
    ...reference('status', deciding?.response.status),
    ...reference('reachability', input.reachability.state),
    // Phase 10 provenance. Present only when the caller supplied it, so nothing is invented.
    ...reference('flowId', input.flowStep?.flowId),
    ...reference('stepId', input.flowStep?.stepId),
    ...reference('actorRole', input.actor?.role),
    ...reference('actorAccount', input.actor?.accountKey),
    ...reference('stateTransition', input.stateTransition),
    ...reference('sideEffect', input.sideEffect),
    ...reference('invariantId', input.invariantId),
    ...reference('requirements', input.requirementIds?.join(',')),
  ];

  // ---- 1. Cleanup isolation. A safety rule, so nothing below can override it. ----------------
  if (deciding?.phase === 'cleanup') {
    const cleanup = { cleanupRelated: true };
    if (deciding.origin === 'NO_RESPONSE') {
      return result(
        'INFRASTRUCTURE',
        'CLEANUP_NO_RESPONSE',
        'A cleanup exchange received no HTTP response; teardown could not reach the host.',
        base,
        cleanup,
      );
    }
    if (deciding.origin === 'EDGE') {
      return result(
        'INFRASTRUCTURE',
        'CLEANUP_INTERMEDIARY',
        'A cleanup exchange was answered by an intermediary, not the application.',
        base,
        cleanup,
      );
    }
    if (deciding.origin === 'APPLICATION') {
      return result(
        'ENVIRONMENT',
        'CLEANUP_APPLICATION_REFUSED',
        'The application did not complete a teardown request. This is the environment’s state ' +
          'after the test, never the behaviour the test was asserting.',
        base,
        cleanup,
      );
    }
    return result(
      'INSUFFICIENT_EVIDENCE',
      'CLEANUP_ORIGIN_UNKNOWN',
      'A cleanup exchange failed and its producer could not be established.',
      base,
      { ...cleanup, missing: ['an application or intermediary marker on the cleanup response'] },
    );
  }

  // ---- 2. Something threw. WHOSE fault that is must be established, not assumed. ---------------
  if (input.validatorError) {
    const errorEvidence = [...base, ...reference('errorName', input.validatorError.name)];
    /*
     * An exception alone proves only that execution stopped. A `TypeError` or `ReferenceError` is a
     * programming fault in the code that threw — deterministic, from the error's own TYPE. A plain
     * `Error`, a `ProductionSafetyError`, an `AccountPoolError` or a ledger error is a framework,
     * safety-guard or setup condition, and attributing those to the test implementation would be the
     * same guess this classifier exists to avoid.
     */
    if (PROGRAMMING_ERROR_TYPES.has(input.validatorError.name)) {
      return result(
        'TEST_ISSUE',
        'VALIDATOR_IMPLEMENTATION_ERROR',
        `The check faulted with a ${input.validatorError.name}, a programming error in the code ` +
          'that ran — the application was never judged.',
        errorEvidence,
      );
    }
    return result(
      'INSUFFICIENT_EVIDENCE',
      'VALIDATOR_EXCEPTION_UNATTRIBUTED',
      'Execution stopped with an exception, but nothing establishes whether the test, the ' +
        'framework or the environment was responsible.',
      errorEvidence,
      {
        missing: [
          'a structured marker attributing the exception to the validator, the framework or setup',
        ],
      },
    );
  }

  // ---- 3. A precondition failed, so the action never ran. -------------------------------------
  const failedPrecondition = input.exchanges.find(
    (e) => e.phase === 'precondition' && (e.response.status === 0 || e.response.status >= 400),
  );
  if (failedPrecondition) {
    return result(
      'BLOCKED',
      'PRECONDITION_FAILED',
      'A setup exchange failed before the action ran, so the assertion never exercised its subject.',
      [
        ...base,
        ...reference('preconditionCorrelationId', failedPrecondition.correlationId),
        ...reference('preconditionStatus', failedPrecondition.response.status),
      ],
    );
  }

  /*
   * ---- 3b. A DECLARED prerequisite step of the flow failed. -------------------------------------
   *
   * The master plan states it directly: do not classify a downstream step when its prerequisite
   * failed. A step that never ran its own action cannot have produced a defect, and attributing one
   * to it is how a single real failure becomes a page of derived ones that all name the wrong thing.
   *
   * This sits with the other BLOCKED rules rather than among the evidence rules because it is not a
   * judgement about evidence at all — whatever the exchange shows, the subject was never exercised.
   * It is deliberately narrower than "something earlier failed": it fires only on a DECLARED
   * dependency, the same artifact dependency the flow engine blocks on, so an unrelated failure
   * elsewhere in the flow does not silence a real finding here.
   */
  if (input.flowStep?.prerequisiteFailed === true) {
    return result(
      'BLOCKED',
      'FLOW_PREREQUISITE_FAILED',
      'A declared prerequisite step of this flow failed, so this step never exercised its subject. ' +
        'The failure belongs to the prerequisite, not here.',
      [
        ...base,
        ...reference('blockedByStepId', input.flowStep.blockedByStepId),
        { field: 'prerequisiteFailed', value: true },
      ],
    );
  }

  // ---- 4. Nothing answered. There is no response to attribute. --------------------------------
  if (deciding?.origin === 'NO_RESPONSE') {
    if (deciding.transport) {
      return result(
        'INFRASTRUCTURE',
        'TRANSPORT_FAILURE',
        'No HTTP response was received; the failure is below the application layer.',
        [...base, ...reference('transportKind', deciding.transport.kind)],
      );
    }
    return result(
      'INSUFFICIENT_EVIDENCE',
      'NO_RESPONSE_WITHOUT_TRANSPORT_EVIDENCE',
      'No response was received, but no transport evidence explains why.',
      base,
      { missing: ['a transport error record for the failed exchange'] },
    );
  }

  // ---- 5. An intermediary answered. The application's behaviour is not in view. ----------------
  if (deciding?.origin === 'EDGE') {
    return result(
      'INFRASTRUCTURE',
      'INTERMEDIARY_RESPONSE',
      'An intermediary answered this exchange, so the response does not describe application ' +
        'behaviour.',
      base,
    );
  }

  /*
   * ---- 6. The host DECLARED throttling. Never inferred from the status. ------------------------
   *
   * A 429 on its own establishes nothing: it can come from the application's own documented rate
   * limiting, from a gateway, from account or IP throttling, or from an environment protection — and
   * those have different owners. What IS deterministic is a `Retry-After` header: RFC 9110 defines it
   * as the server telling the caller how long to wait, which is a declaration of throttling whoever
   * emitted it. Status alone never reaches this rule.
   */
  if (
    deciding?.response.status === TOO_MANY_REQUESTS &&
    deciding.response.headers['retry-after'] !== undefined
  ) {
    return result(
      'ENVIRONMENT',
      'THROTTLING_DECLARED',
      'The host declared throttling with a Retry-After header, so the response describes a load ' +
        'condition rather than the behaviour under test.',
      [...base, ...reference('retryAfter', deciding.response.headers['retry-after'])],
    );
  }

  // ---- 7. We cannot say who answered, so we must not say who is at fault. ----------------------
  if (deciding?.origin === 'UNKNOWN') {
    return result(
      'INSUFFICIENT_EVIDENCE',
      'ORIGIN_UNKNOWN',
      'The producer of this response could not be established from the evidence available.',
      base,
      {
        missing: [
          'an application marker (traceId / urlPath / documented envelope) on the deciding response',
          'or a standards-defined intermediary marker (Via / cache)',
        ],
      },
    );
  }

  // ---- 8. A failure with no evidence at all. ---------------------------------------------------
  if (!deciding) {
    return result(
      'INSUFFICIENT_EVIDENCE',
      'NO_DECIDING_EXCHANGE',
      'No recorded exchange could be matched to the failing check.',
      base,
      { missing: ['an exchange whose correlation id matches the failing check'] },
    );
  }

  // Everything below reasons about an APPLICATION-attributed response.
  if (input.reachability.state !== 'PRESENT') {
    return result(
      'INSUFFICIENT_EVIDENCE',
      'APPLICATION_REACHABILITY_UNPROVEN',
      'The deciding response looks application-produced, but no exchange for this endpoint ' +
        'witnessed the application, so the attribution is unsupported.',
      base,
      { missing: ['an application-attributed exchange for this endpoint in this test'] },
    );
  }

  // ---- 9. The application did what its own contract declares; the expectation is the outlier. ---
  const status = deciding.response.status;
  const wanted = expectedStatuses(input.expected);
  if (
    input.contract &&
    input.contract.expectedStatus.includes(status) &&
    wanted !== undefined &&
    !wanted.includes(status)
  ) {
    return result(
      'TEST_ISSUE',
      'EXPECTATION_CONFLICTS_WITH_CONTRACT',
      'The application answered a status its registered contract declares, but the check expected ' +
        'a different one — the disagreement is between the check and the contract.',
      [
        ...base,
        ...reference('contractExpectedStatus', input.contract.expectedStatus.join(',')),
        ...reference('checkExpectedStatus', wanted.join(',')),
      ],
    );
  }

  /*
   * ---- 10. The CONFIGURATION declares the capability unsupported. ------------------------------
   *
   * A 405 with an `Allow` header establishes only that the method is not allowed for that resource
   * — which is a contract statement about routing, not evidence that the capability is
   * *intentionally unsupported*. The same response is what a correctly-behaving API returns to a
   * request the bench should not have made. So a 405 is recorded as CONTEXT below and never
   * classifies on its own.
   *
   * `NOT_IMPLEMENTED` requires the endpoint's own registered configuration to say so. Nothing in the
   * repository populates `declaredUnsupported` today, so this rule cannot fire on real traffic — an
   * honest dead end rather than an inference, and the place a real declaration would plug in.
   */
  if (input.contract?.declaredUnsupported === true) {
    return result(
      'NOT_IMPLEMENTED',
      'CAPABILITY_DECLARED_UNSUPPORTED',
      'The endpoint’s registered configuration declares this capability intentionally unsupported.',
      [...base, ...reference('declaredUnsupported', true)],
    );
  }

  /*
   * ---- 10b. A transition or a side effect that could not be MEASURED. ---------------------------
   *
   * Reached only after every infrastructure, environment and reachability rule above has declined,
   * so the host did answer and the application produced it. What is left is the Phase 7 / Phase 9
   * distinction that matters most:
   *
   *     NOT_OCCURRED / NOT_OBSERVED   the application was measured, and it did not do the thing
   *     INDETERMINATE                 one side was never measured, so there is nothing to judge
   *
   * The second is the one worth a rule of its own. An INDETERMINATE outcome reaching the contract
   * violation below would be reported as a defect on the strength of a measurement nobody took —
   * the exact "unmeasured is not unchanged" failure the side-effect layer refuses to make, undone
   * one layer later. A NOT_OCCURRED / NOT_OBSERVED outcome deliberately falls through to rule 11,
   * because it IS an application-attributed contract violation and needs no special pleading.
   */
  if (input.stateTransition === 'INDETERMINATE') {
    return result(
      'INSUFFICIENT_EVIDENCE',
      'STATE_TRANSITION_INDETERMINATE',
      'The state before or after the action was never observed, so whether the transition happened ' +
        'cannot be judged from this evidence.',
      base,
      { missing: ['an observation of the state on both sides of the action'] },
    );
  }
  if (input.sideEffect === 'INDETERMINATE') {
    return result(
      'INSUFFICIENT_EVIDENCE',
      'SIDE_EFFECT_INDETERMINATE',
      'One side of the before/after comparison was never measured, so no change can be judged. ' +
        'Unmeasured is not unchanged.',
      base,
      { missing: ['a measurement of the derived value on both sides of the action'] },
    );
  }

  // ---- 11. The application produced it, and it breaks the contract. -----------------------------
  if (deciding.origin === 'APPLICATION') {
    // A 405's `Allow` header is context worth carrying into the record, never a classification.
    const allowed =
      status === METHOD_NOT_ALLOWED ? allowedMethods(deciding.response.headers.allow) : [];
    return result(
      'APP_DEFECT',
      'APPLICATION_CONTRACT_VIOLATION',
      `An application-attributed exchange in the action phase violated the ` +
        `${violationTypeOf(input.validatorName)} dimension of its contract, and no test, ` +
        'environment or infrastructure explanation accounts for it.',
      [
        ...base,
        ...reference('violationType', violationTypeOf(input.validatorName)),
        ...(allowed.length ? reference('allow', allowed.join(',')) : []),
      ],
    );
  }

  // ---- 12. Fallback. The honest answer. ---------------------------------------------------------
  return result(
    'INSUFFICIENT_EVIDENCE',
    'UNCLASSIFIED',
    'No rule matched this combination of evidence.',
    base,
    { missing: ['a rule covering this evidence shape'] },
  );
}
