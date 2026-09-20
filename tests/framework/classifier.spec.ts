import type { ApiRequest } from '@api/client/request-builder';
import { ApiResponseWrapper } from '@api/client/response-wrapper';
import { expect, test } from '@fixtures';
import {
  captureExchange,
  classifyFailure,
  decidingCorrelationIds,
  decidingExchange,
  expectedStatuses,
  observationsFromReport,
  reachabilityOf,
  withOrigin,
  CLASSIFIER_VERSION,
  FAILURE_CLASSES,
  type ExchangeEvidence,
  type FailureInput,
} from '../../src/failure-analysis/index';
import type { ValidationReport, ValidationResult } from '@engine/validation-result';

/**
 * Guards for Phase 3.3 — the root-cause classifier.
 *
 * ## What these prove, and what they cannot
 *
 * They prove the rules are DETERMINISTIC and that each fires only on the structured evidence it
 * claims to read. They do not prove a classification is *correct* about the world: that is what the
 * shadow run measures, and why nothing here is connected to Bugzilla filing.
 *
 * Every rule gets a positive case, a negative case (the same evidence with the deciding field
 * changed, showing the rule does NOT fire) and, where there is one, an ambiguous case that must fall
 * to `INSUFFICIENT_EVIDENCE` rather than guess.
 *
 * The invariant under test throughout:
 *
 *     FAILED VALIDATION != APPLICATION DEFECT
 */

let counter = 0;

function exchangeEvidence(options: {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  phase?: 'precondition' | 'action' | 'cleanup';
  label?: string;
  method?: string;
  transport?: { kind: 'timeout' | 'network'; message: string };
  correlationId?: string;
}): ExchangeEvidence {
  const correlationId = options.correlationId ?? `tb-${(counter += 1)}`;
  const request: ApiRequest = {
    method: (options.method ?? 'POST') as ApiRequest['method'],
    pathTemplate: '/v2/dashboard/homeDashboardMsgs/',
    url: 'https://testingapi.kpostindia.com/v2/dashboard/homeDashboardMsgs/',
    headers: { 'content-type': 'application/json' },
    correlationId,
    timeoutMs: 10_000,
  };
  const wrapper = new ApiResponseWrapper(
    request,
    options.status ?? 200,
    options.headers ?? { 'content-type': 'application/json' },
    options.body ?? '{"status":"SUCCESS","urlPath":"homeDashboardMsgs","statusCode":200}',
    12,
    options.transport,
    options.label ?? 'primary',
  );
  return withOrigin(
    captureExchange(wrapper, {
      runId: 'run-classify-1',
      phase: options.phase ?? 'action',
      endpointId: 'dashboard-home-msgs',
      endpoint: 'POST /v2/dashboard/homeDashboardMsgs/',
      suite: 'kpost-api',
      testCaseId: 'TC-API-kpost-api-dashboard-home-msgs-response.status-code',
    }),
  );
}

/** An application-attributed exchange, so reachability is PRESENT unless a test says otherwise. */
const applicationWitness = (): ExchangeEvidence => exchangeEvidence({ status: 200 });

function failure(
  overrides: Partial<FailureInput> & { exchanges?: ExchangeEvidence[] },
): FailureInput {
  const exchanges = overrides.exchanges ?? [applicationWitness()];
  return {
    runId: 'run-classify-1',
    testCaseId: 'TC-API-kpost-api-dashboard-home-msgs-response.status-code',
    validatorName: 'response.status-code',
    category: 'RESPONSE',
    severity: 'CRITICAL',
    endpointId: 'dashboard-home-msgs',
    endpoint: 'POST /v2/dashboard/homeDashboardMsgs/',
    suite: 'kpost-api',
    expected: [200],
    actual: 500,
    decidingCorrelationIds: [exchanges[0]?.correlationId ?? ''],
    reachability: reachabilityOf(exchanges),
    contract: { expectedStatus: [200] },
    ...overrides,
    exchanges,
  };
}

test.describe('classifier · APP_DEFECT', () => {
  test.describe.configure({ mode: 'default' });

  test('an application 500 in the action phase violating the contract @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"/v2/x/"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );

    expect(decision.classification).toBe('APP_DEFECT');
    expect(decision.reasonCode).toBe('APPLICATION_CONTRACT_VIOLATION');
    expect(decision.eligibleForDefectReview).toBe(true);
    expect(decision.cleanupRelated).toBe(false);
  });

  test('an application 200 whose body violates the response schema @framework', () => {
    // A schema validator fails on a contract-valid STATUS; the violation is in the body.
    const decision = classifyFailure(
      failure({
        validatorName: 'response.schema',
        category: 'RESPONSE',
        expected: 'a body matching the documented schema',
        actual: 'missing required field "data"',
      }),
    );
    expect(decision.classification).toBe('APP_DEFECT');
  });

  test('an application 4xx where the contract requires success @framework', () => {
    const deciding = exchangeEvidence({
      status: 400,
      body: '{"status":"FAILURE","statusCode":400,"urlPath":"/v2/x/"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
        expected: [200],
        actual: 400,
      }),
    );
    expect(decision.classification).toBe('APP_DEFECT');
  });

  test('NEGATIVE — the same 500 in the cleanup phase is never APP_DEFECT @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"/v2/x/"}',
      phase: 'cleanup',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );
    expect(decision.classification).not.toBe('APP_DEFECT');
  });
});

test.describe('classifier · TEST_ISSUE', () => {
  test.describe.configure({ mode: 'default' });

  test('the check expects a status the contract does not declare @framework', () => {
    // The endpoint is configured to answer 204; the check wanted 200. The application complied.
    const deciding = exchangeEvidence({
      status: 204,
      body: '{"status":"SUCCESS","urlPath":"x","statusCode":204}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
        expected: [200],
        actual: 204,
        contract: { expectedStatus: [200, 204] },
      }),
    );

    expect(decision.classification).toBe('TEST_ISSUE');
    expect(decision.reasonCode).toBe('EXPECTATION_CONFLICTS_WITH_CONTRACT');
    expect(decision.eligibleForDefectReview).toBe(false);
  });

  test('a PROGRAMMING error in the check is the test’s fault @framework', () => {
    for (const name of ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'EvalError']) {
      const decision = classifyFailure(failure({ validatorError: { name, message: 'boom' } }));
      expect(decision.classification, name).toBe('TEST_ISSUE');
      expect(decision.reasonCode).toBe('VALIDATOR_IMPLEMENTATION_ERROR');
    }
  });

  test('the exception MESSAGE is never read — only its type @framework', () => {
    /*
     * A message that names a programming error must not promote a generic exception, and a message
     * that looks environmental must not demote a real one. The constructor name decides, alone.
     */
    const byMessage = classifyFailure(
      failure({
        validatorError: { name: 'Error', message: 'TypeError: cannot read property of undefined' },
      }),
    );
    expect(byMessage.classification).toBe('INSUFFICIENT_EVIDENCE');

    const byType = classifyFailure(
      failure({ validatorError: { name: 'TypeError', message: 'connection reset by peer' } }),
    );
    expect(byType.classification).toBe('TEST_ISSUE');
  });

  test('NEGATIVE — a generic exception names no owner @framework', () => {
    // An unexpected response shape usually surfaces as a plain Error. Responsibility is unknown.
    const decision = classifyFailure(
      failure({ validatorError: { name: 'Error', message: 'unexpected response shape' } }),
    );
    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.reasonCode).toBe('VALIDATOR_EXCEPTION_UNATTRIBUTED');
    expect(decision.missingEvidence.length).toBeGreaterThan(0);
  });

  test('NEGATIVE — a framework or setup exception is not a test issue @framework', () => {
    for (const name of [
      'ProductionSafetyError',
      'AccountPoolError',
      'ResourceLedgerError',
      'UnknownResourceError',
      'ResourceJournalError',
    ]) {
      const decision = classifyFailure(failure({ validatorError: { name, message: 'x' } }));
      expect(decision.classification, name).toBe('INSUFFICIENT_EVIDENCE');
      expect(decision.reasonCode).toBe('VALIDATOR_EXCEPTION_UNATTRIBUTED');
    }
  });

  test('NEGATIVE — a status OUTSIDE the contract is not the check’s fault @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
        expected: [200],
        actual: 500,
        contract: { expectedStatus: [200] },
      }),
    );
    expect(decision.classification).toBe('APP_DEFECT');
  });

  test('AMBIGUOUS — without a contract the rule cannot fire @framework', () => {
    const deciding = exchangeEvidence({
      status: 204,
      body: '{"status":"SUCCESS","urlPath":"x","statusCode":204}',
    });
    const input = failure({
      exchanges: [applicationWitness(), deciding],
      decidingCorrelationIds: [deciding.correlationId],
      expected: [200],
      actual: 204,
    });
    delete (input as { contract?: unknown }).contract;
    // No contract to compare against, so it falls through to the application rule rather than
    // guessing that the check is wrong.
    expect(classifyFailure(input).classification).toBe('APP_DEFECT');
  });
});

test.describe('classifier · INFRASTRUCTURE', () => {
  test.describe.configure({ mode: 'default' });

  test('no response with transport evidence @framework', () => {
    const deciding = exchangeEvidence({
      status: 0,
      headers: {},
      body: '',
      transport: { kind: 'network', message: 'connect ECONNREFUSED' },
    });
    const decision = classifyFailure(
      failure({ exchanges: [deciding], decidingCorrelationIds: [deciding.correlationId] }),
    );

    expect(decision.classification).toBe('INFRASTRUCTURE');
    expect(decision.reasonCode).toBe('TRANSPORT_FAILURE');
    expect(decision.supportingEvidence.some((e) => e.field === 'transportKind')).toBe(true);
  });

  test('a timeout is transport evidence too — but via the record, not the word @framework', () => {
    const deciding = exchangeEvidence({
      status: 0,
      headers: {},
      body: '',
      transport: { kind: 'timeout', message: 'Timeout 10000ms exceeded' },
    });
    expect(
      classifyFailure(
        failure({ exchanges: [deciding], decidingCorrelationIds: [deciding.correlationId] }),
      ).classification,
    ).toBe('INFRASTRUCTURE');
  });

  test('an intermediary-attributed response @framework', () => {
    const deciding = exchangeEvidence({
      status: 502,
      headers: { 'content-type': 'text/html', via: '1.1 proxy' },
      body: '<html>502</html>',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );
    expect(decision.classification).toBe('INFRASTRUCTURE');
    expect(decision.reasonCode).toBe('INTERMEDIARY_RESPONSE');
  });

  test('NEGATIVE — a 502 the APPLICATION produced is not infrastructure @framework', () => {
    // The status is identical; only the attribution differs, and only attribution decides.
    const deciding = exchangeEvidence({
      status: 502,
      body: '{"status":"FAILURE","statusCode":502,"urlPath":"/v2/x/"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );
    expect(decision.classification).toBe('APP_DEFECT');
  });
});

test.describe('classifier · ENVIRONMENT', () => {
  test.describe.configure({ mode: 'default' });

  test('a 429 whose Retry-After header DECLARES throttling @framework', () => {
    const deciding = exchangeEvidence({
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '30' },
      body: '{"status":"FAILURE","statusCode":429,"urlPath":"x"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );
    expect(decision.classification).toBe('ENVIRONMENT');
    expect(decision.reasonCode).toBe('THROTTLING_DECLARED');
    expect(decision.supportingEvidence.some((e) => e.field === 'retryAfter')).toBe(true);
  });

  test('NEGATIVE — an identical 429 WITHOUT Retry-After is not automatically ENVIRONMENT @framework', () => {
    /*
     * The status is the same. A 429 can come from the application's own documented rate limiting,
     * from a gateway, from account or IP throttling — different owners — so the status cannot
     * establish the class on its own.
     */
    const deciding = exchangeEvidence({
      status: 429,
      body: '{"status":"FAILURE","statusCode":429,"urlPath":"x"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );
    expect(decision.classification).not.toBe('ENVIRONMENT');
    expect(decision.reasonCode).not.toBe('THROTTLING_DECLARED');
  });

  test('a 429 of UNKNOWN origin without Retry-After is insufficient evidence @framework', () => {
    const deciding = exchangeEvidence({
      status: 429,
      headers: { 'content-type': 'text/plain' },
      body: 'too many requests',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );
    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.reasonCode).toBe('ORIGIN_UNKNOWN');
  });

  test('a 429 the CONTRACT declares is the check’s disagreement, not a defect @framework', () => {
    const deciding = exchangeEvidence({
      status: 429,
      body: '{"status":"FAILURE","statusCode":429,"urlPath":"x"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
        expected: [200],
        actual: 429,
        contract: { expectedStatus: [200, 429] },
      }),
    );
    expect(decision.classification).toBe('TEST_ISSUE');
  });
});

test.describe('classifier · INSUFFICIENT_EVIDENCE', () => {
  test.describe.configure({ mode: 'default' });

  test('an unknown origin is never an application defect @framework', () => {
    // The live 401 auth-filter shape.
    const deciding = exchangeEvidence({
      status: 401,
      headers: { 'content-type': 'application/json;charset=ISO-8859-1' },
      body: '{"status":"UNAUTHORIZED","debugMessage":"Authentication required"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );

    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.reasonCode).toBe('ORIGIN_UNKNOWN');
    expect(decision.missingEvidence.length).toBeGreaterThan(0);
  });

  test('no response and no transport record @framework', () => {
    const deciding = exchangeEvidence({ status: 0, headers: {}, body: '' });
    // status 0 with no transport record: origin cannot be NO_RESPONSE, so it is unattributable.
    const decision = classifyFailure(
      failure({ exchanges: [deciding], decidingCorrelationIds: [deciding.correlationId] }),
    );
    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
  });

  test('no exchange matches the failing check @framework', () => {
    const decision = classifyFailure(
      failure({ exchanges: [], decidingCorrelationIds: ['tb-nothing'] }),
    );
    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.reasonCode).toBe('NO_DECIDING_EXCHANGE');
  });

  test('an application-looking response with no witness is unsupported @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [deciding],
        decidingCorrelationIds: [deciding.correlationId],
        // Deliberately contradictory: the witness says the application was never reached.
        reachability: { state: 'UNKNOWN', reason: 'forced', witnesses: [], considered: 0 },
      }),
    );
    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.reasonCode).toBe('APPLICATION_REACHABILITY_UNPROVEN');
  });
});

test.describe('classifier · BLOCKED', () => {
  test.describe.configure({ mode: 'default' });

  test('a failed precondition stops the action being judged @framework', () => {
    const setup = exchangeEvidence({ status: 401, phase: 'precondition', body: '{}' });
    const deciding = exchangeEvidence({ status: 500, body: '{"status":"FAILURE","urlPath":"x"}' });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), setup, deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );

    expect(decision.classification).toBe('BLOCKED');
    expect(decision.reasonCode).toBe('PRECONDITION_FAILED');
    expect(decision.supportingEvidence.some((e) => e.field === 'preconditionStatus')).toBe(true);
  });

  test('NEGATIVE — a SUCCESSFUL precondition does not block @framework', () => {
    const setup = exchangeEvidence({ status: 200, phase: 'precondition' });
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), setup, deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );
    expect(decision.classification).toBe('APP_DEFECT');
  });
});

test.describe('classifier · NOT_IMPLEMENTED', () => {
  test.describe.configure({ mode: 'default' });

  test('the CONFIGURATION declaring the capability unsupported @framework', () => {
    const deciding = exchangeEvidence({
      status: 405,
      method: 'GET',
      headers: { 'content-type': 'application/json', allow: 'POST, OPTIONS' },
      body: '{"status":"FAILURE","statusCode":405,"urlPath":"x"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
        contract: { expectedStatus: [200], declaredUnsupported: true },
      }),
    );

    expect(decision.classification).toBe('NOT_IMPLEMENTED');
    expect(decision.reasonCode).toBe('CAPABILITY_DECLARED_UNSUPPORTED');
  });

  test('NEGATIVE — an ordinary 405 + Allow is NOT automatically NOT_IMPLEMENTED @framework', () => {
    /*
     * A 405 establishes only that the method is not allowed for the resource. It is exactly what a
     * correctly-behaving API returns to a request the bench should not have made, so it is carried
     * as context and never classifies on its own.
     */
    const deciding = exchangeEvidence({
      status: 405,
      method: 'GET',
      headers: { 'content-type': 'application/json', allow: 'POST, OPTIONS' },
      body: '{"status":"FAILURE","statusCode":405,"urlPath":"x"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );

    expect(decision.classification).not.toBe('NOT_IMPLEMENTED');
    // The Allow header survives as evidence, so a human can still see what the host declared.
    expect(decision.supportingEvidence.some((e) => e.field === 'allow')).toBe(true);
  });

  test('AMBIGUOUS — a 405 the contract declares is the check’s disagreement @framework', () => {
    const deciding = exchangeEvidence({
      status: 405,
      method: 'GET',
      body: '{"status":"FAILURE","statusCode":405,"urlPath":"x"}',
    });
    const decision = classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
        expected: [200],
        actual: 405,
        contract: { expectedStatus: [200, 405] },
      }),
    );
    expect(decision.classification).toBe('TEST_ISSUE');
  });

  test('NEGATIVE — a generic 404 never implies NOT_IMPLEMENTED @framework', () => {
    const deciding = exchangeEvidence({
      status: 404,
      body: '{"status":"FAILURE","statusCode":404,"urlPath":"x"}',
    });
    expect(
      classifyFailure(
        failure({
          exchanges: [applicationWitness(), deciding],
          decidingCorrelationIds: [deciding.correlationId],
        }),
      ).classification,
    ).not.toBe('NOT_IMPLEMENTED');
  });
});

test.describe('classifier · cleanup isolation', () => {
  test.describe.configure({ mode: 'default' });

  const cleanupCase = (status: number, body: string, transport?: ExchangeEvidence['transport']) => {
    const deciding = exchangeEvidence({
      status,
      body,
      phase: 'cleanup',
      ...(transport ? { transport, headers: {} } : {}),
    });
    return classifyFailure(
      failure({
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );
  };

  test('a cleanup 4xx is an environment problem, never a defect @framework', () => {
    const decision = cleanupCase(404, '{"status":"FAILURE","statusCode":404,"urlPath":"x"}');
    expect(decision.classification).toBe('ENVIRONMENT');
    expect(decision.reasonCode).toBe('CLEANUP_APPLICATION_REFUSED');
    expect(decision.cleanupRelated).toBe(true);
    expect(decision.eligibleForDefectReview).toBe(false);
  });

  test('a cleanup 5xx is an environment problem, never a defect @framework', () => {
    const decision = cleanupCase(500, '{"status":"FAILURE","statusCode":500,"urlPath":"x"}');
    expect(decision.classification).toBe('ENVIRONMENT');
    expect(decision.cleanupRelated).toBe(true);
  });

  test('a cleanup transport failure is infrastructure @framework', () => {
    const decision = cleanupCase(0, '', { kind: 'network', message: 'ECONNREFUSED' });
    expect(decision.classification).toBe('INFRASTRUCTURE');
    expect(decision.reasonCode).toBe('CLEANUP_NO_RESPONSE');
    expect(decision.cleanupRelated).toBe(true);
  });

  test('a cleanup response of unknown origin is insufficient evidence @framework', () => {
    const decision = cleanupCase(401, '{"status":"UNAUTHORIZED"}');
    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.cleanupRelated).toBe(true);
  });

  test('NO cleanup evidence shape can reach APP_DEFECT @framework', () => {
    for (const [status, body] of [
      [200, '{"status":"SUCCESS","urlPath":"x","statusCode":200}'],
      [400, '{"status":"FAILURE","statusCode":400,"urlPath":"x"}'],
      [500, '{"status":"FAILURE","statusCode":500,"urlPath":"x"}'],
      [502, '{"status":"FAILURE","statusCode":502,"urlPath":"x"}'],
    ] as [number, string][]) {
      const decision = cleanupCase(status, body);
      expect(decision.classification, `cleanup ${status}`).not.toBe('APP_DEFECT');
      expect(decision.cleanupRelated).toBe(true);
    }
  });
});

test.describe('classifier · probes and multi-exchange correlation', () => {
  test.describe.configure({ mode: 'default' });

  test('a probe of unknown origin beside an application primary is not a separate defect @framework', () => {
    const primary = applicationWitness();
    const probe = exchangeEvidence({
      status: 401,
      label: 'authentication.missing-token:no header',
      headers: { 'content-type': 'application/json;charset=ISO-8859-1' },
      body: '{"status":"UNAUTHORIZED","debugMessage":"Authentication required"}',
    });

    const decision = classifyFailure(
      failure({
        validatorName: 'authentication.missing-token',
        exchanges: [primary, probe],
        decidingCorrelationIds: [probe.correlationId, primary.correlationId],
      }),
    );

    // The primary witnesses the application, but the PROBE is what the check judged — and its
    // producer is unknown, so no defect is claimed.
    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.supportingEvidence.find((e) => e.field === 'reachability')?.value).toBe(
      'PRESENT',
    );
  });

  test('the deciding exchange is the failing detail, not the primary @framework', () => {
    const primary = applicationWitness();
    const probe = exchangeEvidence({ status: 500, body: '{"status":"FAILURE","urlPath":"x"}' });
    const input = failure({
      exchanges: [primary, probe],
      decidingCorrelationIds: [probe.correlationId, primary.correlationId],
    });
    expect(decidingExchange(input)?.correlationId).toBe(probe.correlationId);
  });

  test('with several probes the FIRST failing detail decides @framework', () => {
    const primary = applicationWitness();
    const first = exchangeEvidence({ status: 500, body: '{"status":"FAILURE","urlPath":"x"}' });
    const second = exchangeEvidence({ status: 503, body: '{"status":"FAILURE","urlPath":"x"}' });
    const input = failure({
      exchanges: [primary, first, second],
      decidingCorrelationIds: [first.correlationId, second.correlationId],
    });
    expect(decidingExchange(input)?.correlationId).toBe(first.correlationId);
  });

  test('an unmatched correlation id falls back to the primary, never to a guess @framework', () => {
    const primary = applicationWitness();
    const input = failure({ exchanges: [primary], decidingCorrelationIds: ['tb-not-recorded'] });
    expect(decidingExchange(input)?.correlationId).toBe(primary.correlationId);
  });

  test('decidingCorrelationIds orders failing details before the result id @framework', () => {
    const result = {
      correlationId: 'tb-result',
      details: [
        { name: 'ok', status: 'PASSED', correlationId: 'tb-passed' },
        { name: 'bad', status: 'FAILED', correlationId: 'tb-failed' },
      ],
    } as unknown as ValidationResult;
    expect(decidingCorrelationIds(result)).toEqual(['tb-failed', 'tb-result']);
  });
});

test.describe('classifier · determinism and totality', () => {
  test.describe.configure({ mode: 'default' });

  test('the same input yields an identical result every time @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const input = failure({
      exchanges: [applicationWitness(), deciding],
      decidingCorrelationIds: [deciding.correlationId],
    });

    const runs = Array.from({ length: 25 }, () => JSON.stringify(classifyFailure(input)));
    expect(new Set(runs).size, 'one input, one output').toBe(1);
  });

  test('every classification is one of the seven, with a reason and a summary @framework', () => {
    const shapes: ExchangeEvidence[] = [
      exchangeEvidence({ status: 200 }),
      exchangeEvidence({
        status: 500,
        body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
      }),
      exchangeEvidence({ status: 401, body: '{"status":"UNAUTHORIZED"}' }),
      exchangeEvidence({ status: 502, headers: { via: '1.1 p' }, body: '<html/>' }),
      exchangeEvidence({
        status: 0,
        headers: {},
        body: '',
        transport: { kind: 'timeout', message: 't' },
      }),
      exchangeEvidence({
        status: 429,
        body: '{"status":"FAILURE","statusCode":429,"urlPath":"x"}',
      }),
      exchangeEvidence({
        status: 500,
        phase: 'cleanup',
        body: '{"status":"FAILURE","urlPath":"x"}',
      }),
    ];

    for (const deciding of shapes) {
      const decision = classifyFailure(
        failure({
          exchanges: [applicationWitness(), deciding],
          decidingCorrelationIds: [deciding.correlationId],
        }),
      );
      expect(FAILURE_CLASSES).toContain(decision.classification);
      expect(decision.reasonCode.length).toBeGreaterThan(0);
      expect(decision.summary.length).toBeGreaterThan(0);
      // Only APP_DEFECT is ever eligible for a later defect review.
      expect(decision.eligibleForDefectReview).toBe(decision.classification === 'APP_DEFECT');
    }
  });

  test('APP_DEFECT names the contract dimension violated @framework', () => {
    const cases: [string, string][] = [
      ['response.status-code', 'STATUS_CODE'],
      ['response.schema', 'RESPONSE_SCHEMA'],
      ['security.security-headers', 'HEADER'],
      ['response.content-type', 'CONTENT_TYPE'],
      ['security.injection', 'SECURITY'],
      ['request.null-value', 'INPUT_VALIDATION'],
      ['business-rule.br-c01', 'BUSINESS_RULE'],
      ['database.user-row', 'STATE'],
      ['performance.response-time', 'PERFORMANCE'],
      ['something.unmapped', 'OTHER'],
    ];
    for (const [validatorName, expectedType] of cases) {
      const deciding = exchangeEvidence({
        status: 500,
        body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
      });
      const decision = classifyFailure(
        failure({
          validatorName,
          exchanges: [applicationWitness(), deciding],
          decidingCorrelationIds: [deciding.correlationId],
        }),
      );
      expect(decision.violationType, validatorName).toBe(expectedType);
    }
  });

  test('a PERFORMANCE defect records what the judgement rests on @framework', () => {
    /*
     * The classifier's answer stays APP_DEFECT — that is what the evidence indicates — but the
     * record must show a later gate that one sample is all there is. Classification and filing
     * eligibility remain separate questions.
     */
    const deciding = exchangeEvidence({
      status: 200,
      body: '{"status":"SUCCESS","urlPath":"x","statusCode":200}',
    });
    const decision = classifyFailure(
      failure({
        validatorName: 'performance.response-time',
        expected: '<= 800ms',
        actual: '1240ms',
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
        contract: { expectedStatus: [200], maxResponseTimeMs: 800 },
      }),
    );

    expect(
      decision.classification,
      'the classifier is not forced to agree with a filing gate',
    ).toBe('APP_DEFECT');
    expect(decision.violationType).toBe('PERFORMANCE');

    const field = (name: string) =>
      decision.supportingEvidence.find((e) => e.field === name)?.value;
    expect(field('observedDurationMs')).toBe(deciding.durationMs);
    expect(field('thresholdMs')).toBe(800);
    expect(field('thresholdDefined')).toBe(true);
    expect(field('repeatability'), 'never fabricated').toBe('UNKNOWN');
    expect(field('samples')).toBe(1);
    expect(decision.missingEvidence.some((m) => m.includes('repeatability'))).toBe(true);
  });

  test('a PERFORMANCE defect with NO configured budget says so @framework', () => {
    const decision = classifyFailure(
      failure({ validatorName: 'performance.response-time', contract: { expectedStatus: [200] } }),
    );
    expect(decision.supportingEvidence.find((e) => e.field === 'thresholdDefined')?.value).toBe(
      false,
    );
    expect(decision.missingEvidence.some((m) => m.includes('latency budget'))).toBe(true);
  });

  test('a FUNCTIONAL defect carries no performance evidence @framework', () => {
    // Performance evidence must not leak onto deterministic functional findings.
    const decision = classifyFailure(failure({ validatorName: 'response.status-code' }));
    expect(decision.supportingEvidence.some((e) => e.field === 'repeatability')).toBe(false);
    expect(decision.missingEvidence).toEqual([]);
  });

  test('violationType is recorded for every class, not only defects @framework', () => {
    const deciding = exchangeEvidence({ status: 401, body: '{"status":"UNAUTHORIZED"}' });
    const decision = classifyFailure(
      failure({
        validatorName: 'response.error-format',
        exchanges: [applicationWitness(), deciding],
        decidingCorrelationIds: [deciding.correlationId],
      }),
    );
    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.violationType).toBe('RESPONSE_SCHEMA');
  });

  test('no rule classifies from a status code alone @framework', () => {
    /*
     * Each status below is paired ONLY with an unattributable response. If any rule read the status
     * on its own, one of these would classify as something other than INSUFFICIENT_EVIDENCE.
     */
    for (const status of [401, 404, 405, 429, 500, 502, 503, 504]) {
      const deciding = exchangeEvidence({
        status,
        headers: { 'content-type': 'text/plain' },
        body: 'opaque',
      });
      const decision = classifyFailure(
        failure({
          exchanges: [applicationWitness(), deciding],
          decidingCorrelationIds: [deciding.correlationId],
        }),
      );
      expect(decision.classification, `status ${status}`).toBe('INSUFFICIENT_EVIDENCE');
      expect(decision.reasonCode).toBe('ORIGIN_UNKNOWN');
    }
  });

  test('expectedStatuses reads numbers only, never prose @framework', () => {
    expect(expectedStatuses(200)).toEqual([200]);
    expect(expectedStatuses([200, 204])).toEqual([200, 204]);
    expect(expectedStatuses('a 200 response')).toBeUndefined();
    expect(expectedStatuses({ status: 200 })).toBeUndefined();
    expect(expectedStatuses([])).toBeUndefined();
  });
});

test.describe('observations · the durable record', () => {
  test.describe.configure({ mode: 'default' });

  function reportWith(results: Partial<ValidationResult>[], evidence: ExchangeEvidence[]) {
    return {
      endpointId: 'dashboard-home-msgs',
      endpoint: 'POST /v2/dashboard/homeDashboardMsgs/',
      method: 'POST',
      tags: [],
      suite: 'kpost-api',
      profile: 'REGRESSION',
      environment: 'production',
      build: 'local',
      testRunId: 'run-classify-1',
      correlationId: evidence[0]?.correlationId ?? 'tb-x',
      startedAt: new Date().toISOString(),
      durationMs: 1,
      summary: {
        total: results.length,
        passed: 0,
        failed: results.length,
        warnings: 0,
        skipped: 0,
      },
      gate: { passed: false, blocking: [] },
      evidence,
      reachability: reachabilityOf(evidence),
      contract: { expectedStatus: [200] },
      results: results.map((r) => ({
        validationId: 'v-1',
        validatorName: 'response.status-code',
        category: 'RESPONSE',
        endpointId: 'dashboard-home-msgs',
        endpoint: 'POST /v2/dashboard/homeDashboardMsgs/',
        method: 'POST',
        expected: [200],
        actual: 500,
        status: 'FAILED',
        message: 'expected 200, got 500',
        durationMs: 1,
        timestamp: new Date().toISOString(),
        severity: 'CRITICAL',
        correlationId: evidence[0]?.correlationId ?? 'tb-x',
        ...r,
      })),
    } as unknown as ValidationReport;
  }

  test('only FAILED results become observations @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const report = reportWith(
      [{ status: 'FAILED' }, { status: 'PASSED' }, { status: 'SKIPPED' }, { status: 'WARNING' }],
      [deciding],
    );
    expect(observationsFromReport(report)).toHaveLength(1);
  });

  test('an observation REFERENCES evidence rather than copying it @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const [observation] = observationsFromReport(reportWith([{ status: 'FAILED' }], [deciding]));

    expect(observation?.correlationId).toBe(deciding.correlationId);
    expect(observation?.classifierVersion).toBe(CLASSIFIER_VERSION);
    // No ExchangeEvidence object is embedded — only identifiers and small scalars.
    const serialised = JSON.stringify(observation);
    expect(serialised.includes('"request"')).toBe(false);
    expect(serialised.includes('"snippet"')).toBe(false);
    expect(serialised.includes('"markers"')).toBe(false);
  });

  test('an observation carries the stable testCaseId, not an invented one @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const report = reportWith(
      [
        {
          status: 'FAILED',
          testCaseId: 'TC-API-kpost-api-dashboard-home-msgs-response.status-code',
        },
      ],
      [deciding],
    );
    const [observation] = observationsFromReport(report);
    expect(observation?.testCaseId).toBe(
      'TC-API-kpost-api-dashboard-home-msgs-response.status-code',
    );
    expect(observation?.testCaseId).not.toBe(observation?.correlationId);
  });

  test('a missing testCaseId is left absent, never fabricated @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const report = reportWith([{ status: 'FAILED', testCaseId: undefined }], [deciding]);
    expect(observationsFromReport(report)[0]?.testCaseId).toBeUndefined();
  });

  test('a report with no evidence still classifies, as insufficient @framework', () => {
    const [observation] = observationsFromReport(reportWith([{ status: 'FAILED' }], []));
    expect(observation?.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(observation?.reasonCode).toBe('NO_DECIDING_EXCHANGE');
  });

  test('a report without its own evidence uses the test’s pool, scoped by endpoint @framework', () => {
    /*
     * The flow-finding shape: a lifecycle 5xx builds a report by hand with no `evidence`, while the
     * exchange it describes was captured and attached separately. Without the pool these classify as
     * having no evidence — which is exactly the failure a lifecycle spec exists to find.
     */
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const report = reportWith([{ status: 'FAILED', correlationId: deciding.correlationId }], []);

    const [matched] = observationsFromReport(report, { evidence: [deciding] });
    expect(matched?.classification).toBe('APP_DEFECT');
    expect(matched?.correlationId).toBe(deciding.correlationId);

    // Another endpoint's exchange must never witness this one.
    const foreign = { ...deciding, endpointId: 'some-other-endpoint' };
    const [unmatched] = observationsFromReport(report, { evidence: [foreign] });
    expect(unmatched?.classification).toBe('INSUFFICIENT_EVIDENCE');
  });

  test('every observation preserves the required invariants, and no secrets @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const report = reportWith(
      [
        {
          status: 'FAILED',
          testCaseId: 'TC-API-kpost-api-dashboard-home-msgs-response.status-code',
          correlationId: deciding.correlationId,
        },
      ],
      [deciding],
    );
    const [o] = observationsFromReport(report);

    for (const field of [
      'runId',
      'testCaseId',
      'correlationId',
      'decidingCorrelationIds',
      'endpoint',
      'endpointId',
      'suite',
      'validatorName',
      'classification',
      'reasonCode',
      'violationType',
      'expected',
      'actual',
      'origin',
      'originRule',
      'reachability',
      'phase',
      'supportingEvidence',
      'missingEvidence',
      'eligibleForDefectReview',
      'cleanupRelated',
      'classifierVersion',
    ]) {
      expect(o?.[field as keyof typeof o], field).toBeDefined();
    }

    // Evidence is REFERENCED, never copied: no bodies, headers, request payloads or credentials.
    const serialised = JSON.stringify(o);
    for (const forbidden of ['"snippet"', '"markers"', '"request"', '"headers"', 'Bearer', 'eyJ']) {
      expect(serialised.includes(forbidden), forbidden).toBe(false);
    }
  });

  test('observations are deterministic for a fixed clock @framework', () => {
    const deciding = exchangeEvidence({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"urlPath":"x"}',
    });
    const report = reportWith([{ status: 'FAILED' }], [deciding]);
    const at = new Date('2026-09-20T00:00:00.000Z');
    expect(JSON.stringify(observationsFromReport(report, { now: at }))).toBe(
      JSON.stringify(observationsFromReport(report, { now: at })),
    );
  });
});
