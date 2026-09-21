import { apiRegistry } from '@api/definitions/index';
import type { ApiRequest } from '@api/client/request-builder';
import { ApiResponseWrapper } from '@api/client/response-wrapper';
import { flowFindingReports } from '@engine/flow-finding';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';
import {
  assessConfidence,
  captureExchange,
  confidenceFactors,
  decisionsFromReport,
  expectedStatuses,
  observationKeyOf,
  withOrigin,
  CONFIDENCE_DECISIONS,
  DECISION_BY_REASON,
  GATE_REASON_CODES,
  GATE_VERSION,
  type ConfidenceInput,
  type ExchangeEvidence,
  type GateObservation,
} from '../../src/failure-analysis/index';
import {
  buildDivergenceReport,
  divergenceRow,
  renderDivergenceConsole,
} from '../../src/reporting/confidence-divergence';
import type { ValidationReport, ValidationResult } from '@engine/validation-result';

/**
 * Guards for Phase 3.4 — the shadow defect-confidence gate.
 *
 * ## What these prove, and what they cannot
 *
 * They prove the gate is DETERMINISTIC, that each rule fires only on the structured evidence it
 * claims to read, and that a decision record can never carry a secret. They do not prove a decision
 * is *right* about the world — that is what the shadow run and the divergence report measure, and
 * why nothing here is connected to Bugzilla filing.
 *
 * The separation under test throughout:
 *
 *     Phase 3.3   what classification describes the failure
 *     Phase 3.4   whether the evidence is strong enough to treat it as a defect CANDIDATE
 *
 * and the safety rule that governs both:
 *
 *     insufficient evidence stays VISIBLE as INDETERMINATE — never quietly NOT_ELIGIBLE
 */

let counter = 0;

/**
 * Reason codes that describe an evidence GAP rather than a positive finding.
 *
 * Derived here rather than inside a test so the "never collapse INDETERMINATE" guard is a plain
 * loop: a new `…_MISSING` / `…_INCOMPLETE` code is picked up automatically and must be
 * INDETERMINATE. `CAPABILITY_DECLARED_UNSUPPORTED` is excluded because it is a DECLARATION the
 * configuration makes, not evidence the gate was unable to find.
 */
const EVIDENCE_GAP_CODES = GATE_REASON_CODES.filter(
  (code) =>
    /(MISSING|INCOMPLETE|UNKNOWN|NO_DECIDING|REQUIRES|UNSUPPORTED$)/.test(code) &&
    code !== 'CAPABILITY_DECLARED_UNSUPPORTED',
);

/** Narrows an optional to a value, so a test body never needs a conditional for its own setup. */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`test setup: ${what} was undefined`);
  return value;
}

function exchangeEvidence(options: {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  phase?: 'precondition' | 'action' | 'cleanup';
  label?: string;
  correlationId?: string;
  durationMs?: number;
  authorization?: string;
  requestBody?: unknown;
  endpointId?: string;
  endpoint?: string;
}): ExchangeEvidence {
  const correlationId = options.correlationId ?? `gate-${(counter += 1)}`;
  const request: ApiRequest = {
    method: 'POST',
    pathTemplate: '/v2/dashboard/homeDashboardMsgs/',
    url: 'https://testingapi.kpostindia.com/v2/dashboard/homeDashboardMsgs/',
    headers: {
      'content-type': 'application/json',
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    ...(options.requestBody === undefined ? {} : { body: options.requestBody }),
    correlationId,
    timeoutMs: 10_000,
  };
  const wrapper = new ApiResponseWrapper(
    request,
    options.status ?? 200,
    options.headers ?? { 'content-type': 'application/json' },
    options.body ?? '{"status":"SUCCESS","urlPath":"homeDashboardMsgs","statusCode":200}',
    options.durationMs ?? 12,
    undefined,
    options.label ?? 'primary',
  );
  return withOrigin(
    captureExchange(wrapper, {
      runId: 'run-gate-1',
      phase: options.phase ?? 'action',
      endpointId: options.endpointId ?? 'dashboard-home-msgs',
      endpoint: options.endpoint ?? 'POST /v2/dashboard/homeDashboardMsgs/',
      suite: 'kpost-api',
      testCaseId: 'TC-API-kpost-api-dashboard-home-msgs-response.status-code',
    }),
  );
}

/** An APPLICATION-attributed exchange (the KPost envelope carries `urlPath` + `status`). */
const applicationExchange = (
  options: Parameters<typeof exchangeEvidence>[0] = {},
): ExchangeEvidence => exchangeEvidence(options);

/** An EDGE-attributed exchange: RFC 9110 `Via` is set by an intermediary, by definition. */
const edgeExchange = (): ExchangeEvidence =>
  exchangeEvidence({
    status: 502,
    headers: { 'content-type': 'text/html', via: '1.1 vegur' },
    body: '<html>Bad Gateway</html>',
  });

/** An UNKNOWN-origin exchange: no application marker and no intermediary marker. */
const unknownExchange = (): ExchangeEvidence =>
  exchangeEvidence({
    status: 500,
    headers: { 'content-type': 'text/plain' },
    body: 'Internal Server Error',
  });

function observation(overrides: Partial<GateObservation> = {}): GateObservation {
  return {
    runId: 'run-gate-1',
    testCaseId: 'TC-API-kpost-api-dashboard-home-msgs-response.status-code',
    decidingCorrelationIds: [],
    endpoint: 'POST /v2/dashboard/homeDashboardMsgs/',
    endpointId: 'dashboard-home-msgs',
    suite: 'kpost-api',
    validatorName: 'response.status-code',
    category: 'RESPONSE',
    severity: 'CRITICAL',
    classification: 'APP_DEFECT',
    violationType: 'STATUS_CODE',
    reasonCode: 'APPLICATION_CONTRACT_VIOLATION',
    cleanupRelated: false,
    reachability: 'PRESENT',
    ...overrides,
  };
}

/** The default input is a clean, application-attributed STATUS_CODE defect — the ELIGIBLE case. */
function gateInput(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  const deciding = overrides.deciding ?? applicationExchange({ status: 500 });
  return {
    observation: observation({
      ...(deciding ? { correlationId: deciding.correlationId, origin: deciding.origin } : {}),
    }),
    deciding,
    exchanges: overrides.exchanges ?? (deciding ? [deciding] : []),
    contract: { expectedStatus: [200] },
    checkExpectedStatuses: [200],
    ...overrides,
  };
}

// ============================================================================================
// A. Core eligibility
// ============================================================================================

test.describe('confidence gate — core eligibility', () => {
  test('an application-attributed STATUS_CODE violation with a declared contract is ELIGIBLE', () => {
    const assessment = assessConfidence(gateInput());

    expect(assessment.decision).toBe('ELIGIBLE');
    expect(assessment.reasonCode).toBe('APPLICATION_EVIDENCE_CONFIRMED');
    expect(assessment.factors.applicationAttributed).toBe(true);
    expect(assessment.factors.reachabilityPresent).toBe(true);
    expect(assessment.factors.decidingExchangePresent).toBe(true);
    expect(assessment.factors.contractPresent).toBe(true);
    expect(assessment.factors.actionPhase).toBe(true);
    expect(assessment.factors.testIntegrityClean).toBe(true);
    expect(assessment.factors.environmentClean).toBe(true);
    expect(assessment.missingEvidence).toEqual([]);
    // The observed status is recorded as a structured scalar, never re-derived from a message.
    expect(assessment.supportingEvidence).toContainEqual({ field: 'observedStatus', value: 500 });
  });

  test('an UNKNOWN origin is INDETERMINATE, never NOT_ELIGIBLE', () => {
    const deciding = unknownExchange();
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({
          correlationId: deciding.correlationId,
          origin: 'UNKNOWN',
          // Reachability stays PRESENT so the origin rule is what decides, not the witness.
          reachability: 'PRESENT',
        }),
      }),
    );

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('ORIGIN_UNKNOWN');
    expect(assessment.factors.applicationAttributed).toBe(false);
    expect(assessment.missingEvidence.join(' ')).toContain('application marker');
  });

  test('an EDGE origin is NOT_ELIGIBLE — deterministic evidence, not an evidence gap', () => {
    const deciding = edgeExchange();
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({
          correlationId: deciding.correlationId,
          origin: 'EDGE',
          classification: 'INFRASTRUCTURE',
          reasonCode: 'INTERMEDIARY_RESPONSE',
        }),
      }),
    );

    expect(assessment.decision).toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('INFRASTRUCTURE_EVIDENCE');
  });

  test('an EDGE origin is NOT_ELIGIBLE even when the classification is APP_DEFECT', () => {
    // The independent re-verification: the gate does not rely on the classifier having caught it.
    const deciding = edgeExchange();
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({ correlationId: deciding.correlationId, origin: 'EDGE' }),
      }),
    );

    expect(assessment.decision).toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('ORIGIN_NOT_APPLICATION');
  });

  test('reachability ABSENT is NOT_ELIGIBLE — a positive claim that nothing reached the app', () => {
    const deciding = applicationExchange({ status: 500 });
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({ correlationId: deciding.correlationId, reachability: 'ABSENT' }),
      }),
    );

    expect(assessment.decision).toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('REACHABILITY_ABSENT');
    expect(assessment.factors.reachabilityPresent).toBe(false);
  });

  test('reachability UNKNOWN is INDETERMINATE, and names the witness it wanted', () => {
    const deciding = applicationExchange({ status: 500 });
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({
          correlationId: deciding.correlationId,
          reachability: 'UNKNOWN',
        }),
      }),
    );

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('REACHABILITY_NOT_PRESENT');
    expect(assessment.missingEvidence.join(' ')).toContain('application-attributed exchange');
  });

  test('no deciding exchange is INDETERMINATE — a synthetic observation is never ELIGIBLE', () => {
    const assessment = assessConfidence({
      observation: observation(),
      exchanges: [],
      contract: { expectedStatus: [200] },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('NO_DECIDING_EXCHANGE');
    expect(assessment.factors.decidingExchangePresent).toBe(false);
  });

  test('a cleanup-phase failure is NOT_ELIGIBLE, whatever else the evidence says', () => {
    const deciding = applicationExchange({ status: 500, phase: 'cleanup' });
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({
          correlationId: deciding.correlationId,
          cleanupRelated: true,
          classification: 'ENVIRONMENT',
          reasonCode: 'CLEANUP_APPLICATION_REFUSED',
        }),
      }),
    );

    expect(assessment.decision).toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('CLEANUP_PHASE');
    expect(assessment.factors.environmentClean).toBe(false);
  });

  test('cleanup wins over every later rule — an APP_DEFECT in teardown still cannot be a candidate', () => {
    const deciding = applicationExchange({ status: 500, phase: 'cleanup' });
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        // Deliberately the strongest possible downstream evidence.
        observation: observation({
          correlationId: deciding.correlationId,
          classification: 'APP_DEFECT',
          cleanupRelated: false,
          reachability: 'PRESENT',
        }),
      }),
    );

    expect(assessment.decision).toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('CLEANUP_PHASE');
  });

  test('a failed precondition is NOT_ELIGIBLE and names the setup exchange', () => {
    const setup = applicationExchange({ status: 500, phase: 'precondition', label: 'setup:login' });
    const deciding = applicationExchange({ status: 403 });
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [setup, deciding],
        observation: observation({ correlationId: deciding.correlationId }),
      }),
    );

    expect(assessment.decision).toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('PRECONDITION_FAILED');
    expect(assessment.supportingEvidence).toContainEqual({
      field: 'preconditionCorrelationId',
      value: setup.correlationId,
    });
    expect(assessment.factors.testIntegrityClean).toBe(false);
  });

  test('a SUCCESSFUL precondition does not block eligibility', () => {
    const setup = applicationExchange({ status: 200, phase: 'precondition', label: 'setup:login' });
    const deciding = applicationExchange({ status: 500 });
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [setup, deciding],
        observation: observation({ correlationId: deciding.correlationId }),
      }),
    );

    expect(assessment.decision).toBe('ELIGIBLE');
    expect(assessment.factors.testIntegrityClean).toBe(true);
  });

  test('a FAILING precondition exchange is caught by the failed-precondition rule', () => {
    // The deciding exchange is itself the setup call that failed — the earlier, more specific rule.
    const deciding = applicationExchange({ status: 500, phase: 'precondition' });
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({ correlationId: deciding.correlationId }),
      }),
    );

    expect(assessment.decision).toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('PRECONDITION_FAILED');
    expect(assessment.factors.actionPhase).toBe(false);
  });

  test('a SUCCEEDING precondition exchange judged by a check is NOT_ELIGIBLE on its phase', () => {
    /*
     * The setup call answered 200, so nothing failed in setup — but the check judged setup traffic
     * rather than the action. Distinct from the rule above, and distinctly reasoned: setup traffic
     * is not the behaviour under test, whether or not it succeeded.
     */
    const deciding = applicationExchange({ status: 200, phase: 'precondition' });
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({
          correlationId: deciding.correlationId,
          validatorName: 'response.schema',
          violationType: 'RESPONSE_SCHEMA',
        }),
        contract: { expectedStatus: [200], responseSchemaDeclared: true },
      }),
    );

    expect(assessment.decision).toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('PRECONDITION_PHASE');
    expect(assessment.factors.actionPhase).toBe(false);
  });
});

// ============================================================================================
// B. Test integrity
// ============================================================================================

test.describe('confidence gate — test integrity', () => {
  test('a TEST_ISSUE classification is NOT_ELIGIBLE (TypeError, wrong expectation)', () => {
    for (const reasonCode of [
      'VALIDATOR_IMPLEMENTATION_ERROR',
      'EXPECTATION_CONFLICTS_WITH_CONTRACT',
    ]) {
      const deciding = applicationExchange({ status: 500 });
      const assessment = assessConfidence(
        gateInput({
          deciding,
          exchanges: [deciding],
          observation: observation({
            correlationId: deciding.correlationId,
            classification: 'TEST_ISSUE',
            reasonCode,
          }),
        }),
      );

      expect(assessment.decision, reasonCode).toBe('NOT_ELIGIBLE');
      expect(assessment.reasonCode, reasonCode).toBe('TEST_INTEGRITY_FAILURE');
      expect(assessment.factors.testIntegrityClean, reasonCode).toBe(false);
    }
  });

  test('an unattributed exception (account pool, ledger, fixture) is never ELIGIBLE', () => {
    /*
     * Phase 3.3 deliberately does NOT attribute an `AccountPoolError` or a ledger error to the test:
     * an exception alone names no owner. So the gate has no deterministic proof either way, and the
     * honest answer is INDETERMINATE — which still satisfies the requirement that these must not be
     * eligible as application defects. The classifier's own reason code rides along, so the record
     * says WHICH exception was unattributed.
     */
    for (const errorName of ['AccountPoolError', 'ResourceLedgerError', 'DuplicateResourceError']) {
      const deciding = applicationExchange({ status: 500 });
      const assessment = assessConfidence(
        gateInput({
          deciding,
          exchanges: [deciding],
          observation: observation({
            correlationId: deciding.correlationId,
            classification: 'INSUFFICIENT_EVIDENCE',
            reasonCode: 'VALIDATOR_EXCEPTION_UNATTRIBUTED',
          }),
        }),
      );

      expect(assessment.decision, errorName).toBe('INDETERMINATE');
      expect(assessment.decision, errorName).not.toBe('ELIGIBLE');
      expect(assessment.reasonCode, errorName).toBe('CLASSIFICATION_INSUFFICIENT_EVIDENCE');
      expect(assessment.supportingEvidence).toContainEqual({
        field: 'classifierReasonCode',
        value: 'VALIDATOR_EXCEPTION_UNATTRIBUTED',
      });
    }
  });

  test('a BLOCKED classification is NOT_ELIGIBLE even with no failed precondition recorded', () => {
    const deciding = applicationExchange({ status: 500 });
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({
          correlationId: deciding.correlationId,
          classification: 'BLOCKED',
          reasonCode: 'PRECONDITION_FAILED',
        }),
      }),
    );

    expect(assessment.decision).toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('PRECONDITION_FAILED');
  });

  test('ENVIRONMENT and NOT_IMPLEMENTED classifications are NOT_ELIGIBLE with their own codes', () => {
    const cases = [
      { classification: 'ENVIRONMENT' as const, expected: 'ENVIRONMENT_EVIDENCE' },
      { classification: 'NOT_IMPLEMENTED' as const, expected: 'CAPABILITY_DECLARED_UNSUPPORTED' },
    ];
    for (const { classification, expected } of cases) {
      const deciding = applicationExchange({ status: 429 });
      const assessment = assessConfidence(
        gateInput({
          deciding,
          exchanges: [deciding],
          observation: observation({ correlationId: deciding.correlationId, classification }),
        }),
      );

      expect(assessment.decision, classification).toBe('NOT_ELIGIBLE');
      expect(assessment.reasonCode, classification).toBe(expected);
    }
  });

  test('a contract declaring the capability unsupported is NOT_ELIGIBLE', () => {
    const deciding = applicationExchange({ status: 501 });
    const assessment = assessConfidence(
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({ correlationId: deciding.correlationId }),
        contract: { expectedStatus: [200], declaredUnsupported: true },
      }),
    );

    expect(assessment.decision).toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('CAPABILITY_DECLARED_UNSUPPORTED');
  });
});

// ============================================================================================
// C. Contract
// ============================================================================================

test.describe('confidence gate — contract expectations', () => {
  test('a STATUS_CODE claim with no structured expectation is INDETERMINATE', () => {
    const deciding = applicationExchange({ status: 500 });
    const assessment = assessConfidence({
      observation: observation({ correlationId: deciding.correlationId }),
      deciding,
      exchanges: [deciding],
      // No endpoint contract, and the check declared nothing numeric.
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('CONTRACT_EXPECTATION_MISSING');
    expect(assessment.factors.contractPresent).toBe(false);
  });

  test('a validator assertion is NOT a registered contract — the check’s number alone is INDETERMINATE', () => {
    /*
     *     VALIDATOR ASSERTION != REGISTERED APPLICATION CONTRACT
     *
     * A bare `number[]` carries no provenance by the time it reaches the gate, so it cannot be told
     * apart from a value a validator hard-coded. Only the registry may establish status authority.
     */
    const deciding = applicationExchange({ status: 500 });
    const assessment = assessConfidence({
      observation: observation({ correlationId: deciding.correlationId }),
      deciding,
      exchanges: [deciding],
      checkExpectedStatuses: [200, 204],
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('CONTRACT_EXPECTATION_MISSING');
    expect(assessment.supportingEvidence).toContainEqual({
      field: 'checkExpectedStatusPresent',
      value: true,
    });
    expect(assessment.missingEvidence.join(' ')).toContain('not a registered application contract');
  });

  test('the registered contract alone establishes status authority, and is recorded as such', () => {
    const deciding = applicationExchange({ status: 500 });
    const assessment = assessConfidence({
      observation: observation({ correlationId: deciding.correlationId }),
      deciding,
      exchanges: [deciding],
      contract: { expectedStatus: [200] },
      // No check expectation at all: the contract is sufficient on its own.
    });

    expect(assessment.decision).toBe('ELIGIBLE');
    expect(assessment.supportingEvidence).toContainEqual({
      field: 'statusAuthority',
      value: 'registered-contract',
    });
    expect(assessment.supportingEvidence).toContainEqual({
      field: 'contractExpectedStatus',
      value: '200',
    });
  });

  test('a RESPONSE_SCHEMA claim needs a DECLARED schema, not merely a status contract', () => {
    const deciding = applicationExchange({ status: 200 });
    const base = {
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'response.schema',
        violationType: 'RESPONSE_SCHEMA' as const,
      }),
      deciding,
      exchanges: [deciding],
    };

    const withoutSchema = assessConfidence({ ...base, contract: { expectedStatus: [200] } });
    expect(withoutSchema.decision).toBe('INDETERMINATE');
    expect(withoutSchema.reasonCode).toBe('SCHEMA_EVIDENCE_MISSING');
    expect(withoutSchema.factors.contractPresent).toBe(false);
    expect(withoutSchema.missingEvidence.join(' ')).toContain('response schema declared');

    const withSchema = assessConfidence({
      ...base,
      contract: { expectedStatus: [200], responseSchemaDeclared: true },
    });
    expect(withSchema.decision).toBe('ELIGIBLE');
    expect(withSchema.factors.contractPresent).toBe(true);
  });

  test('a RESPONSE_SCHEMA claim is INDETERMINATE when the captured body cannot re-witness it', () => {
    // Binary body → no snippet was taken, so the schema failure cannot be re-derived from the record.
    const deciding = exchangeEvidence({
      status: 200,
      headers: { 'content-type': 'image/png', 'x-request-id': 'req-1' },
      body: 'PNG binary',
    });
    const assessment = assessConfidence({
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'response.schema',
        violationType: 'RESPONSE_SCHEMA',
        reachability: 'PRESENT',
      }),
      deciding: { ...deciding, origin: 'APPLICATION' },
      exchanges: [deciding],
      contract: { expectedStatus: [200], responseSchemaDeclared: true },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('SCHEMA_EVIDENCE_MISSING');
    expect(assessment.missingEvidence.join(' ')).toContain('structured (JSON) response body');
  });

  test('a HEADER claim is ELIGIBLE only for headers the evidence can witness', () => {
    const deciding = applicationExchange({ status: 200 });
    const base = {
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'response.headers',
        violationType: 'HEADER' as const,
      }),
      deciding,
      exchanges: [deciding],
    };

    // `content-type` is inside the Phase 3.2 allowlist, so presence/absence is directly observable.
    const witnessed = assessConfidence({
      ...base,
      contract: { expectedStatus: [200], requiredHeaders: ['content-type'] },
    });
    expect(witnessed.decision).toBe('ELIGIBLE');

    // A security header is NOT in the allowlist, so its absence from the record proves nothing.
    const unwitnessed = assessConfidence({
      ...base,
      contract: {
        expectedStatus: [200],
        requiredHeaders: ['content-security-policy', 'referrer-policy'],
      },
    });
    expect(unwitnessed.decision).toBe('INDETERMINATE');
    expect(unwitnessed.reasonCode).toBe('HEADER_EVIDENCE_MISSING');
    expect(unwitnessed.missingEvidence.join(' ')).toContain('content-security-policy');

    // No declared header contract at all.
    const noContract = assessConfidence({ ...base, contract: { expectedStatus: [200] } });
    expect(noContract.decision).toBe('INDETERMINATE');
    expect(noContract.reasonCode).toBe('HEADER_EVIDENCE_MISSING');
  });

  test('a CONTENT_TYPE claim needs both a declared and an observed content type', () => {
    const deciding = applicationExchange({ status: 200 });
    const base = {
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'response.content-type',
        violationType: 'CONTENT_TYPE' as const,
      }),
      deciding,
      exchanges: [deciding],
    };

    const complete = assessConfidence({
      ...base,
      contract: { expectedStatus: [200], contentType: 'application/json' },
    });
    expect(complete.decision).toBe('ELIGIBLE');
    expect(complete.supportingEvidence).toContainEqual({
      field: 'contractContentType',
      value: 'application/json',
    });

    const undeclared = assessConfidence({ ...base, contract: { expectedStatus: [200] } });
    expect(undeclared.decision).toBe('INDETERMINATE');
    expect(undeclared.reasonCode).toBe('CONTENT_TYPE_EVIDENCE_MISSING');
  });

  test('a contract for ONE dimension never licenses a claim about another', () => {
    // A declared expectedStatus must not make a schema, header or content-type claim credible.
    const deciding = applicationExchange({ status: 200 });
    for (const violationType of ['RESPONSE_SCHEMA', 'HEADER', 'CONTENT_TYPE'] as const) {
      const assessment = assessConfidence({
        observation: observation({ correlationId: deciding.correlationId, violationType }),
        deciding,
        exchanges: [deciding],
        contract: { expectedStatus: [200] },
      });
      expect(assessment.decision, violationType).toBe('INDETERMINATE');
      expect(assessment.factors.contractPresent, violationType).toBe(false);
    }
  });
});

// ============================================================================================
// D. Security
// ============================================================================================

test.describe('confidence gate — security', () => {
  test('a failing security validator is never ELIGIBLE on the validator name alone', () => {
    for (const validatorName of [
      'security.injection',
      'security.xss',
      'authentication.missing-token',
      'authorization.cross-tenant',
      'security.sensitive-data',
    ]) {
      const deciding = applicationExchange({ status: 200, authorization: 'Bearer abc.def.ghi' });
      const assessment = assessConfidence({
        observation: observation({
          correlationId: deciding.correlationId,
          validatorName,
          violationType: 'SECURITY',
          category: 'SECURITY',
        }),
        deciding,
        exchanges: [deciding],
        contract: { expectedStatus: [200] },
      });

      expect(assessment.decision, validatorName).toBe('INDETERMINATE');
      expect(assessment.reasonCode, validatorName).toBe('SECURITY_EVIDENCE_INCOMPLETE');
    }
  });

  test('a cross-account claim names the actor identity it lacks (and records the scheme only)', () => {
    const deciding = applicationExchange({ status: 200, authorization: 'Bearer secret.jwt.value' });
    const assessment = assessConfidence({
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'authorization.cross-tenant',
        violationType: 'SECURITY',
      }),
      deciding,
      exchanges: [deciding],
      contract: { expectedStatus: [200] },
    });

    expect(assessment.factors.securityEvidenceAvailable).toBe(false);
    expect(assessment.missingEvidence.join(' ')).toContain('actor identity');
    expect(assessment.missingEvidence.join(' ')).toContain('different principal');
    // The SCHEME is evidence; the credential never is.
    expect(assessment.supportingEvidence).toContainEqual({
      field: 'requestAuthScheme',
      value: 'Bearer',
    });
    expect(JSON.stringify(assessment)).not.toContain('secret.jwt.value');
  });

  test('an injection claim names the input condition the record cannot carry', () => {
    const deciding = applicationExchange({
      status: 200,
      requestBody: { search: "'; DROP TABLE users; --" },
    });
    const assessment = assessConfidence({
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'security.injection',
        violationType: 'SECURITY',
      }),
      deciding,
      exchanges: [deciding],
      contract: { expectedStatus: [200] },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.missingEvidence.join(' ')).toContain('input condition');
    // The injected VALUE is never in evidence, so it can never reach a decision record.
    expect(JSON.stringify(assessment)).not.toContain('DROP TABLE');
  });

  test('security-header findings route to the HEADER rule, and stay undecided without capture', () => {
    // `violationTypeOf('security.security-headers')` is HEADER, not SECURITY — asserted here so a
    // change to that mapping cannot silently move the finding to a different evidence requirement.
    const deciding = applicationExchange({ status: 200 });
    const assessment = assessConfidence({
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'security.security-headers',
        violationType: 'HEADER',
      }),
      deciding,
      exchanges: [deciding],
      contract: { expectedStatus: [200], requiredHeaders: ['strict-transport-security'] },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('HEADER_EVIDENCE_MISSING');
  });
});

// ============================================================================================
// E. Business rule and state
// ============================================================================================

test.describe('confidence gate — business rule and state', () => {
  test('a BUSINESS_RULE claim is INDETERMINATE and names the record it needs', () => {
    const deciding = applicationExchange({ status: 200 });
    const assessment = assessConfidence({
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'business-rule.BR-C01',
        violationType: 'BUSINESS_RULE',
        category: 'BUSINESS_RULE',
      }),
      deciding,
      exchanges: [deciding],
      contract: { expectedStatus: [200] },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('BUSINESS_RULE_EVIDENCE_INCOMPLETE');
    expect(assessment.missingEvidence.join(' ')).toContain('precondition');
    expect(assessment.missingEvidence.join(' ')).toContain('expected outcome');
  });

  test('a generic status mismatch is NOT promoted to a business-rule violation', () => {
    // The same exchange, judged by a status validator, IS eligible; judged by a business rule it is
    // not — the dimension decides what evidence is required, never the status.
    const deciding = applicationExchange({ status: 500 });
    const shared = { deciding, exchanges: [deciding], contract: { expectedStatus: [200] } };

    const status = assessConfidence({
      ...shared,
      observation: observation({ correlationId: deciding.correlationId }),
    });
    const rule = assessConfidence({
      ...shared,
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'business-rule.BR-K03',
        violationType: 'BUSINESS_RULE',
      }),
    });

    expect(status.decision).toBe('ELIGIBLE');
    expect(rule.decision).toBe('INDETERMINATE');
  });

  test('a STATE claim is INDETERMINATE — one response cannot prove a transition', () => {
    const deciding = applicationExchange({ status: 200 });
    const assessment = assessConfidence({
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'database.katchup-message-persisted',
        violationType: 'STATE',
        category: 'DATABASE',
      }),
      deciding,
      exchanges: [deciding],
      contract: { expectedStatus: [200] },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('STATE_EVIDENCE_INCOMPLETE');
    expect(assessment.factors.stateEvidenceAvailable).toBe(false);
    expect(assessment.missingEvidence.join(' ')).toContain('before and after');
  });

  test('an INPUT_VALIDATION claim is INDETERMINATE because the mutation is not recorded', () => {
    const deciding = applicationExchange({ status: 200, requestBody: { countryID: null } });
    const assessment = assessConfidence({
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'request.null-value',
        violationType: 'INPUT_VALIDATION',
        category: 'REQUEST',
      }),
      deciding,
      exchanges: [deciding],
      contract: { expectedStatus: [200] },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('INPUT_VALIDATION_EVIDENCE_INCOMPLETE');
    expect(assessment.missingEvidence.join(' ')).toContain('mutation under test');
  });

  test('an unrecognised dimension is INDETERMINATE, never a default in either direction', () => {
    const deciding = applicationExchange({ status: 500 });
    const assessment = assessConfidence({
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'something.unmapped',
        violationType: 'OTHER',
      }),
      deciding,
      exchanges: [deciding],
      contract: { expectedStatus: [200] },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('VIOLATION_TYPE_UNSUPPORTED');
  });
});

// ============================================================================================
// F. Performance
// ============================================================================================

test.describe('confidence gate — performance', () => {
  const perfObservation = (correlationId: string): GateObservation =>
    observation({
      correlationId,
      validatorName: 'performance.response-time',
      violationType: 'PERFORMANCE',
      category: 'PERFORMANCE',
      severity: 'MEDIUM',
    });

  test('a single latency sample is INDETERMINATE, not a confirmed environment problem', () => {
    const deciding = applicationExchange({ status: 200, durationMs: 9_000 });
    const assessment = assessConfidence({
      observation: perfObservation(deciding.correlationId),
      deciding,
      exchanges: [deciding],
      contract: { expectedStatus: [200], maxResponseTimeMs: 800 },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.decision).not.toBe('NOT_ELIGIBLE');
    expect(assessment.reasonCode).toBe('PERFORMANCE_REQUIRES_REPEATABILITY');
    expect(assessment.supportingEvidence).toContainEqual({ field: 'samples', value: 1 });
    expect(assessment.factors.repeatabilityAvailable).toBe(false);
  });

  test('no configured threshold is INDETERMINATE and names the missing budget', () => {
    const deciding = applicationExchange({ status: 200, durationMs: 9_000 });
    const assessment = assessConfidence({
      observation: perfObservation(deciding.correlationId),
      deciding,
      exchanges: [deciding],
      contract: { expectedStatus: [200] },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.reasonCode).toBe('PERFORMANCE_REQUIRES_REPEATABILITY');
    expect(assessment.supportingEvidence).toContainEqual({
      field: 'thresholdDefined',
      value: false,
    });
    expect(assessment.missingEvidence.join(' ')).toContain('configured latency budget');
  });

  test('repeated samples plus a threshold make the future path ELIGIBLE', () => {
    /*
     * The architecture CAN represent this — the sample count is derived from the evidence, not
     * stubbed — so the path becomes live on its own the day a measurement is repeated. Nothing in
     * this phase makes the engine repeat one.
     */
    const first = applicationExchange({ status: 200, durationMs: 9_000, label: 'primary' });
    const second = applicationExchange({ status: 200, durationMs: 9_400, label: 'primary' });
    const assessment = assessConfidence({
      observation: perfObservation(second.correlationId),
      deciding: second,
      exchanges: [first, second],
      contract: { expectedStatus: [200], maxResponseTimeMs: 800 },
    });

    expect(assessment.decision).toBe('ELIGIBLE');
    expect(assessment.factors.repeatabilityAvailable).toBe(true);
    expect(assessment.supportingEvidence).toContainEqual({ field: 'samples', value: 2 });
  });

  test('repeated samples without a threshold are still INDETERMINATE', () => {
    const first = applicationExchange({ status: 200, durationMs: 9_000, label: 'primary' });
    const second = applicationExchange({ status: 200, durationMs: 9_400, label: 'primary' });
    const assessment = assessConfidence({
      observation: perfObservation(second.correlationId),
      deciding: second,
      exchanges: [first, second],
      contract: { expectedStatus: [200] },
    });

    expect(assessment.decision).toBe('INDETERMINATE');
    expect(assessment.factors.repeatabilityAvailable).toBe(false);
  });
});

// ============================================================================================
// G. Determinism and vocabulary
// ============================================================================================

test.describe('confidence gate — determinism and vocabulary', () => {
  test('the same input yields a byte-identical decision structure', () => {
    const deciding = applicationExchange({ status: 500 });
    const build = (): ConfidenceInput =>
      gateInput({
        deciding,
        exchanges: [deciding],
        observation: observation({ correlationId: deciding.correlationId }),
      });

    const first = JSON.stringify(assessConfidence(build()));
    const second = JSON.stringify(assessConfidence(build()));
    const third = JSON.stringify(assessConfidence(build()));

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  test('the gate output carries no timestamp, so it cannot depend on the clock', () => {
    const assessment = assessConfidence(gateInput());
    const serialised = JSON.stringify(assessment);

    expect(serialised).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(Object.keys(assessment).sort()).toEqual([
      'decision',
      'factors',
      'missingEvidence',
      'reasonCode',
      'summary',
      'supportingEvidence',
    ]);
  });

  test('every reason code maps to exactly one decision, and every decision is reachable', () => {
    for (const code of GATE_REASON_CODES) {
      expect(DECISION_BY_REASON[code], code).toBeDefined();
      expect(CONFIDENCE_DECISIONS, code).toContain(DECISION_BY_REASON[code]);
    }
    const mapped = new Set(Object.values(DECISION_BY_REASON));
    for (const decision of CONFIDENCE_DECISIONS) expect(mapped).toContain(decision);

    // No stale entries in the table.
    expect(Object.keys(DECISION_BY_REASON).sort()).toEqual([...GATE_REASON_CODES].sort());
  });

  test('exactly one reason code yields ELIGIBLE, so the route to a candidate is auditable', () => {
    const eligible = Object.entries(DECISION_BY_REASON)
      .filter(([, decision]) => decision === 'ELIGIBLE')
      .map(([code]) => code);

    expect(eligible).toEqual(['APPLICATION_EVIDENCE_CONFIRMED']);
  });

  test('INDETERMINATE is never collapsed into NOT_ELIGIBLE for an evidence gap', () => {
    // Every "…_MISSING" / "…_INCOMPLETE" / "…_UNKNOWN" code must be INDETERMINATE by construction.
    expect(EVIDENCE_GAP_CODES.length).toBeGreaterThan(8);
    for (const code of EVIDENCE_GAP_CODES) {
      expect(DECISION_BY_REASON[code], code).toBe('INDETERMINATE');
    }
  });

  test('the observation key is deterministic and carries only identifiers', () => {
    const key = observationKeyOf(observation({ correlationId: 'corr-1' }));

    expect(key).toBe('dashboard-home-msgs|response.status-code|corr-1');
    expect(observationKeyOf(observation({ correlationId: 'corr-1' }))).toBe(key);
    expect(observationKeyOf(observation())).toContain('|none');
  });

  test('factors are computed independently of which rule fires', () => {
    const deciding = edgeExchange();
    const input = gateInput({
      deciding,
      exchanges: [deciding],
      observation: observation({ correlationId: deciding.correlationId, reachability: 'ABSENT' }),
    });

    // The rule stops at origin, but the factors still describe the whole evidence picture.
    expect(assessConfidence(input).factors).toEqual(confidenceFactors(input));
    expect(confidenceFactors(input).reachabilityPresent).toBe(false);
    expect(confidenceFactors(input).applicationAttributed).toBe(false);
  });
});

// ============================================================================================
// H. Secret safety
// ============================================================================================

test.describe('confidence gate — secret safety', () => {
  /*
   * Every credential-shaped value below is SYNTHETIC and exists only to be fed in and then proven
   * absent from the output. No real QA password, token or account identifier appears here — adding a
   * second copy of a live credential to the repository to test redaction would be its own leak.
   * Nothing is printed either: the assertions check for absence, so a failure names the pattern
   * rather than dumping the value.
   */
  const FORBIDDEN = [
    /Bearer\s+[A-Za-z0-9._-]{6,}/,
    /eyJ[A-Za-z0-9_-]{6,}\./,
    /set-cookie/i,
    /"?password"?\s*[:=]/i,
    /api[-_]?key\s*[:=]/i,
    /SYNTH-PW-DO-NOT-USE/,
  ];

  test('a serialised decision carries no credential, cookie, body value or response snippet', () => {
    const deciding = applicationExchange({
      status: 500,
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-payload.signature',
      requestBody: {
        password: 'SYNTH-PW-DO-NOT-USE',
        apiKey: 'ak_synthetic_9f2a',
        kpostID: 'synthetic-user@',
      },
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'session=abc123; HttpOnly',
      },
      body: '{"status":"FAILURE","password":"SYNTH-PW-DO-NOT-USE","traceId":"tr-9"}',
    });

    const report = decisionsFromReport(
      validationReport({
        evidence: [deciding],
        results: [failedResult({ correlationId: deciding.correlationId })],
      }),
      { now: new Date('2026-09-20T12:00:00.000Z') },
    );

    expect(report).toHaveLength(1);
    const serialised = JSON.stringify(report[0]);

    for (const pattern of FORBIDDEN) {
      expect(pattern.test(serialised), `${pattern} must not appear`).toBe(false);
    }
    // Nor the response snippet, nor any request body VALUE.
    expect(serialised).not.toContain('super-secret-payload');
    expect(serialised).not.toContain('ak_synthetic_9f2a');
    expect(serialised).not.toContain('abc123');
    expect(serialised).not.toContain('FAILURE');
  });

  test('a decision record has no rendered expected/actual fields at all', () => {
    const deciding = applicationExchange({ status: 500 });
    const [record] = decisionsFromReport(
      validationReport({
        evidence: [deciding],
        results: [failedResult({ correlationId: deciding.correlationId })],
      }),
    );

    expect(record).toBeDefined();
    expect(record && 'expected' in record).toBe(false);
    expect(record && 'actual' in record).toBe(false);
    expect(record && 'snippet' in record).toBe(false);
  });
});

// ============================================================================================
// Report integration and the divergence report
// ============================================================================================

function failedResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    validationId: 'v-1',
    testCaseId: 'TC-API-kpost-api-dashboard-home-msgs-response.status-code',
    validatorName: 'response.status-code',
    category: 'RESPONSE',
    endpointId: 'dashboard-home-msgs',
    endpoint: 'POST /v2/dashboard/homeDashboardMsgs/',
    method: 'POST',
    expected: [200],
    actual: 500,
    status: 'FAILED',
    message: 'expected 200, got 500',
    durationMs: 12,
    timestamp: '2026-09-20T12:00:00.000Z',
    severity: 'CRITICAL',
    correlationId: 'gate-corr',
    ...overrides,
  };
}

function validationReport(
  overrides: Partial<ValidationReport> & { results: ValidationResult[] },
): ValidationReport {
  return {
    endpointId: 'dashboard-home-msgs',
    endpoint: 'POST /v2/dashboard/homeDashboardMsgs/',
    method: 'POST',
    tags: ['kpost-api', 'dashboard'],
    suite: 'kpost-api',
    profile: 'FULL',
    environment: 'production',
    build: 'local',
    testRunId: 'run-gate-1',
    correlationId: 'gate-corr',
    startedAt: '2026-09-20T12:00:00.000Z',
    durationMs: 30,
    summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0 },
    gate: { passed: false, blocking: ['response.status-code'] },
    contract: { expectedStatus: [200] },
    ...overrides,
  };
}

test.describe('confidence gate — report integration', () => {
  test('a report produces one decision per FAILED result, with versions attached', () => {
    const deciding = applicationExchange({ status: 500 });
    const records = decisionsFromReport(
      validationReport({
        evidence: [deciding],
        results: [
          failedResult({ correlationId: deciding.correlationId }),
          { ...failedResult(), validatorName: 'response.schema', status: 'PASSED' },
        ],
      }),
      { now: new Date('2026-09-20T12:00:00.000Z') },
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.gateVersion).toBe(GATE_VERSION);
    expect(records[0]?.createdAt).toBe('2026-09-20T12:00:00.000Z');
    expect(records[0]?.decision).toBe('ELIGIBLE');
    expect(records[0]?.classification).toBe('APP_DEFECT');
    expect(records[0]?.violationType).toBe('STATUS_CODE');
  });

  test('evidence from a sibling endpoint never witnesses this report', () => {
    const foreign = withOrigin(
      captureExchange(
        new ApiResponseWrapper(
          {
            method: 'POST',
            pathTemplate: '/v2/other/',
            url: 'https://testingapi.kpostindia.com/v2/other/',
            headers: {},
            correlationId: 'foreign-1',
            timeoutMs: 1_000,
          },
          200,
          { 'content-type': 'application/json' },
          '{"status":"SUCCESS","urlPath":"other"}',
          5,
          undefined,
          'primary',
        ),
        {
          runId: 'run-gate-1',
          phase: 'action',
          endpointId: 'some-other-endpoint',
          endpoint: 'POST /v2/other/',
          suite: 'kpost-api',
        },
      ),
    );

    const [record] = decisionsFromReport(validationReport({ results: [failedResult()] }), {
      evidence: [foreign],
    });

    expect(record?.decision).toBe('INDETERMINATE');
    expect(record?.reasonCode).toBe('NO_DECIDING_EXCHANGE');
  });

  test('the divergence report counts each bucket without judging either pipeline', () => {
    const deciding = applicationExchange({ status: 500 });
    const [eligible] = decisionsFromReport(
      validationReport({
        evidence: [deciding],
        results: [failedResult({ correlationId: deciding.correlationId })],
      }),
    );
    const unknown = unknownExchange();
    const [indeterminate] = decisionsFromReport(
      validationReport({
        endpointId: 'dashboard-home-msgs',
        evidence: [unknown],
        results: [
          failedResult({ validatorName: 'response.schema', correlationId: unknown.correlationId }),
        ],
      }),
    );

    const eligibleRecord = required(eligible, 'the ELIGIBLE decision');
    const indeterminateRecord = required(indeterminate, 'the INDETERMINATE decision');
    expect(eligibleRecord.decision).toBe('ELIGIBLE');
    expect(indeterminateRecord.decision).toBe('INDETERMINATE');

    const rows = [
      divergenceRow(eligibleRecord, { candidate: true }),
      divergenceRow(indeterminateRecord, { candidate: true, rejection: undefined }),
      divergenceRow(
        { ...eligibleRecord, observationKey: 'other|response.status-code|x' },
        { candidate: false, rejection: 'severity LOW is below the filing floor' },
      ),
    ];

    const report = buildDivergenceReport(rows, {
      gateVersion: GATE_VERSION,
      classifierVersion: '3.3.1',
      generatedAt: '2026-09-20T12:00:00.000Z',
    });

    expect(report.totalObservations).toBe(3);
    expect(report.existingCandidates).toBe(2);
    expect(report.existingRejected).toBe(1);
    expect(report.shadowEligible).toBe(2);
    expect(report.overlap).toBe(1);
    expect(report.shadowEligibleNotExistingCandidate).toBe(1);
    expect(report.existingCandidateShadowIndeterminate).toBe(1);
    expect(report.byGateReason.APPLICATION_EVIDENCE_CONFIRMED).toBe(2);
    expect(report.comparisonUnit).toContain('BEFORE merge and cascade consolidation');
    // Neutral vocabulary only — no bucket is labelled a real or false defect.
    expect(JSON.stringify(report)).not.toMatch(/false positive|real bug/i);
  });
});

// ============================================================================================
// The flow.server-error evidence chain (Phase 3.4 correction pass, item 1)
// ============================================================================================

/**
 * A gated lifecycle write that received a 5xx becomes a `ValidationReport` through
 * `flowFindingReports`. These guards pin the STRUCTURED EVIDENCE CHAIN end to end:
 *
 *     flow finding → registered endpoint contract → structured expected behaviour → confidence gate
 *
 * and, just as importantly, pin that the finding's PROSE expectation
 * (`'a client error (4xx) or success — never a 5xx'`) never participates in it.
 */
const flowEndpoint = resolveEndpoint(apiRegistry.get('katchup-recall-message'));

function flowReport(): ValidationReport {
  const [report] = flowFindingReports([
    {
      endpoint: flowEndpoint,
      method: flowEndpoint.method,
      status: 500,
      body: '{"statusCode":500,"message":"NullPointerException"}',
      request: { body: { msgID: 1, groupFlag: false } },
      correlationId: 'tb-flow-chain',
    },
  ]);
  return required(report, 'the flow finding report');
}

/** An APPLICATION-attributed 5xx on the flow endpoint, so origin and reachability are satisfied. */
function flowExchange(): ExchangeEvidence {
  return applicationExchange({
    status: 500,
    endpointId: flowEndpoint.id,
    endpoint: flowEndpoint.label,
    correlationId: 'tb-flow-chain',
    body: '{"status":"FAILURE","urlPath":"recallMessage","statusCode":500}',
  });
}

test.describe('confidence gate — the flow.server-error evidence chain', () => {
  test('A. a flow finding carries the endpoint’s REGISTERED contract, not a derived one', () => {
    const report = flowReport();

    // Copied from the ResolvedEndpoint the flow already held — identical, never re-derived.
    expect(report.contract?.expectedStatus).toEqual(flowEndpoint.expectedStatus);
    expect(report.contract?.contentType).toBe(flowEndpoint.contentType);
    expect(report.contract?.requiredHeaders).toEqual(flowEndpoint.requiredHeaders);
    expect(report.contract?.responseSchemaDeclared).toBe(flowEndpoint.responseSchema !== undefined);
    // The prose expectation is untouched — it is a human sentence, never contract evidence.
    expect(report.results[0]?.expected).toBe('a client error (4xx) or success — never a 5xx');
  });

  test('A. with the contract + an application-attributed 5xx it reaches normal evaluation', () => {
    const exchange = flowExchange();
    const [record] = decisionsFromReport(flowReport(), { evidence: [exchange] });
    const decision = required(record, 'the flow decision');

    expect(decision.validatorName).toBe('flow.server-error');
    expect(decision.violationType).toBe('STATUS_CODE');
    expect(decision.origin).toBe('APPLICATION');
    expect(decision.reachability).toBe('PRESENT');
    // It now reaches the normal path instead of stopping at CONTRACT_EXPECTATION_MISSING.
    expect(decision.reasonCode).not.toBe('CONTRACT_EXPECTATION_MISSING');
    expect(decision.factors.contractPresent).toBe(true);
    expect(decision.supportingEvidence).toContainEqual({
      field: 'statusAuthority',
      value: 'registered-contract',
    });
  });

  test('B. the SAME finding without a structured contract stays INDETERMINATE', () => {
    const exchange = flowExchange();
    const withoutContract: ValidationReport = { ...flowReport() };
    delete withoutContract.contract;

    const [record] = decisionsFromReport(withoutContract, { evidence: [exchange] });
    const decision = required(record, 'the flow decision');

    expect(decision.decision).toBe('INDETERMINATE');
    expect(decision.reasonCode).toBe('CONTRACT_EXPECTATION_MISSING');
    expect(decision.factors.contractPresent).toBe(false);
  });

  test('C. prose alone can never make a finding ELIGIBLE', () => {
    // The sentence is not numeric, so the structured reader refuses it outright...
    expect(expectedStatuses('a client error (4xx) or success — never a 5xx')).toBeUndefined();
    expect(expectedStatuses('expected 200, got 500')).toBeUndefined();

    // ...and a report carrying ONLY that sentence cannot reach ELIGIBLE, however strong the rest of
    // the evidence is (application origin, PRESENT reachability, action phase, a real 5xx).
    const exchange = flowExchange();
    const proseOnly: ValidationReport = { ...flowReport() };
    delete proseOnly.contract;

    const [record] = decisionsFromReport(proseOnly, { evidence: [exchange] });
    expect(required(record, 'the decision').decision).not.toBe('ELIGIBLE');
  });

  test('D. the flow contract authorizes STATUS_CODE only, never another dimension', () => {
    const exchange = flowExchange();
    const report = flowReport();
    // Same report, same contract — but a check testing the response SHAPE rather than the status.
    const schemaReport: ValidationReport = {
      ...report,
      results: [
        {
          ...required(report.results[0], 'the flow result'),
          validatorName: 'response.schema',
          category: 'RESPONSE',
        },
      ],
      contract: { ...required(report.contract, 'the contract'), responseSchemaDeclared: false },
    };

    const [record] = decisionsFromReport(schemaReport, { evidence: [exchange] });
    const decision = required(record, 'the schema decision');

    expect(decision.violationType).toBe('RESPONSE_SCHEMA');
    expect(decision.decision).toBe('INDETERMINATE');
    expect(decision.reasonCode).toBe('SCHEMA_EVIDENCE_MISSING');
    // A declared expectedStatus must not lend credibility to a schema claim.
    expect(decision.factors.contractPresent).toBe(false);
  });
});

// ============================================================================================
// Divergence semantics (Phase 3.4 correction pass, item 4)
// ============================================================================================

test.describe('confidence gate — divergence pipeline stages', () => {
  const built = (): ReturnType<typeof buildDivergenceReport> => {
    const deciding = applicationExchange({ status: 500 });
    const [eligible] = decisionsFromReport(
      validationReport({
        evidence: [deciding],
        results: [failedResult({ correlationId: deciding.correlationId })],
      }),
    );
    const decision = required(eligible, 'the eligible decision');
    return buildDivergenceReport(
      [
        divergenceRow(decision, { candidate: true }),
        divergenceRow(
          { ...decision, observationKey: 'a|b|c' },
          { candidate: false, rejection: 'severity LOW is below the filing floor' },
        ),
      ],
      { gateVersion: GATE_VERSION, classifierVersion: '3.3.1', generatedAt: 'now' },
    );
  };

  test('every count is attributed to an explicit pipeline stage', () => {
    const stages = built().pipelineStages;

    expect(stages.rawFailedValidations).toBe(2);
    expect(stages.existingValidityGateCandidates).toBe(1);
    expect(stages.existingValidityGateRejected).toBe(1);
  });

  test('the unmeasured stages are strings, so they can never be read as counts', () => {
    const stages = built().pipelineStages;

    // Typed as literal strings rather than numbers: an absent measurement must not look like zero,
    // and nothing downstream can total it.
    expect(typeof stages.mergeAndCascadeConsolidation).toBe('string');
    expect(typeof stages.finalBugzillaFilings).toBe('string');
    expect(stages.finalBugzillaFilings).toBe('not-measured-by-this-artifact');
  });

  test('the artifact states that candidate counts are NOT ticket counts', () => {
    const report = built();

    expect(report.pipelineStages.note).toContain('not a ticket count');
    expect(report.pipelineStages.note).toContain('reports/REPORT.md');
    expect(report.comparisonUnit).toContain('BEFORE merge and cascade consolidation');
    // The stage-2 count and the headline candidate count are the same number, named twice, so a
    // reader cannot conclude they describe two different stages.
    expect(report.pipelineStages.existingValidityGateCandidates).toBe(report.existingCandidates);
  });

  test('the console block labels the stage and disclaims ticket counts', () => {
    const line = renderDivergenceConsole(built());

    expect(line).toContain('stage 2');
    expect(line).toContain('NOT tickets');
    expect(line).toContain('shadow only');
    expect(line).not.toMatch(/false positive|real bug|confirmed bug/i);
  });
});

// ============================================================================================
// Core safety invariants (Phase 3.4 correction pass, item 6)
// ============================================================================================

test.describe('confidence gate — core safety invariants', () => {
  test('ELIGIBLE != CONFIRMED BUG — the record claims eligibility, never a defect', () => {
    const deciding = applicationExchange({ status: 500 });
    const [record] = decisionsFromReport(
      validationReport({
        evidence: [deciding],
        results: [failedResult({ correlationId: deciding.correlationId })],
      }),
    );
    const decision = required(record, 'the decision');

    expect(decision.decision).toBe('ELIGIBLE');

    /*
     * The record must claim only that the EVIDENCE is sufficient, never that a defect exists or
     * that anything will be filed. `APPLICATION_EVIDENCE_CONFIRMED` is the reason code's own name
     * and its subject is the evidence, not the finding — so the assertion is about the record's
     * semantics rather than the substring "confirmed" appearing anywhere.
     */
    expect(decision.reasonCode).toBe('APPLICATION_EVIDENCE_CONFIRMED');
    expect(decision.summary).not.toMatch(/confirmed (bug|defect)|is a (bug|defect)|will be filed/i);
    // No filing vocabulary anywhere on the record: the gate decides nothing about Bugzilla.
    for (const field of ['filed', 'bugId', 'ticket', 'bugzilla', 'willFile', 'candidate']) {
      expect(field in decision, field).toBe(false);
    }
    // And the decision word itself is only ever one of the three sufficiency answers.
    expect(CONFIDENCE_DECISIONS).toContain(decision.decision);
  });

  test('HTTP STATUS ALONE != ROOT CAUSE — identical statuses decide differently on evidence', () => {
    const contract = { expectedStatus: [200] };
    // The same 500, three times, differing only in evidence that is not the status.
    const app = applicationExchange({ status: 500 });
    const edge = exchangeEvidence({
      status: 500,
      headers: { 'content-type': 'text/html', via: '1.1 proxy' },
      body: '<html>err</html>',
    });
    const opaque = unknownExchange();

    const decide = (e: ExchangeEvidence): string =>
      assessConfidence({
        observation: observation({ correlationId: e.correlationId, origin: e.origin }),
        deciding: e,
        exchanges: [e],
        contract,
      }).decision;

    expect(decide(app)).toBe('ELIGIBLE');
    expect(decide(edge)).toBe('NOT_ELIGIBLE');
    expect(decide(opaque)).toBe('INDETERMINATE');
  });

  test('5xx != automatically application defect, and 2xx is not automatically clean', () => {
    // A 5xx behind an intermediary is not an application defect...
    const edge = exchangeEvidence({
      status: 503,
      headers: { 'content-type': 'text/html', via: '1.1 gw' },
      body: 'unavailable',
    });
    expect(
      assessConfidence({
        observation: observation({ correlationId: edge.correlationId, origin: 'EDGE' }),
        deciding: edge,
        exchanges: [edge],
        contract: { expectedStatus: [200] },
      }).decision,
    ).toBe('NOT_ELIGIBLE');

    // ...and a 200 that breaks a declared contract still reaches the normal path.
    const ok = applicationExchange({ status: 200 });
    expect(
      assessConfidence({
        observation: observation({ correlationId: ok.correlationId }),
        deciding: ok,
        exchanges: [ok],
        contract: { expectedStatus: [204] },
      }).decision,
    ).toBe('ELIGIBLE');
  });

  test('405 != automatically unsupported, 429 != automatically environmental', () => {
    for (const status of [405, 429]) {
      const e = applicationExchange({ status });
      const assessment = assessConfidence({
        observation: observation({ correlationId: e.correlationId }),
        deciding: e,
        exchanges: [e],
        contract: { expectedStatus: [200] },
      });
      // Neither status short-circuits to a verdict of its own; both are judged on the contract.
      expect(assessment.reasonCode, String(status)).not.toBe('CAPABILITY_DECLARED_UNSUPPORTED');
      expect(assessment.reasonCode, String(status)).not.toBe('ENVIRONMENT_EVIDENCE');
    }
  });

  test('VALIDATOR NAME and ENDPOINT NAME != ROOT CAUSE', () => {
    const deciding = applicationExchange({ status: 500 });
    const base = { deciding, exchanges: [deciding], contract: { expectedStatus: [200] } };
    // Renaming the validator and the endpoint, keeping the dimension, cannot change the decision.
    const first = assessConfidence({
      ...base,
      observation: observation({ correlationId: deciding.correlationId }),
    });
    const second = assessConfidence({
      ...base,
      observation: observation({
        correlationId: deciding.correlationId,
        validatorName: 'totally.different-name',
        endpointId: 'some-other-endpoint',
        endpoint: 'POST /v2/elsewhere/',
      }),
    });

    expect(second.decision).toBe(first.decision);
    expect(second.reasonCode).toBe(first.reasonCode);
  });

  test('ASSERTION PROSE != ROOT CAUSE — the gate never sees the rendered expected/actual', () => {
    // `GateObservation` has no rendered prose fields at all, so no rule can read one.
    const keys = Object.keys(observation());
    expect(keys).not.toContain('expected');
    expect(keys).not.toContain('actual');
    expect(keys).not.toContain('summary');
  });

  test('CLASSIFICATION != FILING ELIGIBILITY — APP_DEFECT does not imply ELIGIBLE', () => {
    const undecidable = ['SECURITY', 'INPUT_VALIDATION', 'BUSINESS_RULE', 'STATE'] as const;
    const deciding = applicationExchange({ status: 500 });

    for (const violationType of undecidable) {
      const assessment = assessConfidence({
        observation: observation({
          correlationId: deciding.correlationId,
          classification: 'APP_DEFECT',
          violationType,
        }),
        deciding,
        exchanges: [deciding],
        contract: { expectedStatus: [200] },
      });
      expect(assessment.decision, violationType).toBe('INDETERMINATE');
    }
  });
});
