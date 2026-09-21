import type { ApiRequest } from '@api/client/request-builder';
import { ApiResponseWrapper } from '@api/client/response-wrapper';
import { expect, test } from '@fixtures';
import {
  captureExchange,
  classifyFailure,
  reachabilityOf,
  violationTypeOf,
  withOrigin,
  VIOLATION_TYPES,
  type ExchangeEvidence,
  type FailureInput,
} from '../../src/failure-analysis/index';

/**
 * Guards for Phase 10 — the failure analysis widened to the evidence the later phases produce
 * (master plan §12).
 *
 * ## The two prohibitions the master plan states outright
 *
 *     do not classify an application bug from HTTP status alone
 *     do not classify a downstream step when its prerequisite failed
 *
 * The first was already enforced by the origin and reachability rules; it is pinned here so a later
 * edit cannot quietly undo it. The second needed a rule, because the bench now runs FLOWS, and a
 * flow step whose declared prerequisite failed never exercised its own subject — attributing a
 * defect to it is how one real failure becomes a page of derived ones that all name the wrong thing.
 *
 * Pure: nothing here sends a request or touches an account.
 */

let counter = 0;

function exchange(options: {
  status?: number;
  phase?: 'precondition' | 'action' | 'cleanup';
  body?: string;
}): ExchangeEvidence {
  const correlationId = `tb-p10-${(counter += 1)}`;
  const request: ApiRequest = {
    method: 'POST',
    pathTemplate: '/v2/katchup/recallMessage/',
    url: 'https://testingapi.kpostindia.com/v2/katchup/recallMessage/',
    headers: { 'content-type': 'application/json' },
    correlationId,
    timeoutMs: 10_000,
  };
  const wrapper = new ApiResponseWrapper(
    request,
    options.status ?? 200,
    { 'content-type': 'application/json' },
    options.body ?? '{"status":"SUCCESS","statusCode":200,"urlPath":"recallMessage"}',
    12,
    undefined,
    'primary',
  );
  return withOrigin(
    captureExchange(wrapper, {
      runId: 'run-p10',
      phase: options.phase ?? 'action',
      endpointId: 'katchup-recall-message',
      endpoint: 'POST /v2/katchup/recallMessage/',
      suite: 'kpost-api',
      testCaseId: 'TC-API-kpost-api-katchup-recall-message-response.status-code',
    }),
  );
}

function failure(overrides: Partial<FailureInput> & { exchanges?: ExchangeEvidence[] }) {
  const exchanges = overrides.exchanges ?? [exchange({ status: 500 })];
  return {
    runId: 'run-p10',
    validatorName: 'response.status-code',
    category: 'RESPONSE',
    severity: 'CRITICAL',
    endpointId: 'katchup-recall-message',
    endpoint: 'POST /v2/katchup/recallMessage/',
    suite: 'kpost-api',
    expected: [200],
    actual: 500,
    decidingCorrelationIds: [exchanges[0]?.correlationId ?? ''],
    reachability: reachabilityOf(exchanges),
    contract: { expectedStatus: [200] },
    ...overrides,
    exchanges,
  } satisfies FailureInput;
}

test.describe('failure analysis · a downstream step is never blamed for its prerequisite @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('a step whose DECLARED prerequisite failed is BLOCKED, not a defect', () => {
    /*
     * The evidence here is otherwise a textbook APP_DEFECT — an application-attributed 500 in the
     * action phase against a declared contract. The prerequisite is the only thing that changes the
     * answer, and it has to, because the step never ran its own action.
     */
    const decision = classifyFailure(
      failure({
        flowStep: {
          flowId: 'katchup-recall',
          stepId: 'recall',
          prerequisiteFailed: true,
          blockedByStepId: 'send',
        },
      }),
    );
    expect(decision.classification).toBe('BLOCKED');
    expect(decision.reasonCode).toBe('FLOW_PREREQUISITE_FAILED');
    expect(decision.eligibleForDefectReview, 'a blocked step is never reviewed as a defect').toBe(
      false,
    );
  });

  test('the record points at the step that actually failed', () => {
    // Otherwise the reader has a blocked step and no way back to the cause.
    const decision = classifyFailure(
      failure({
        flowStep: {
          flowId: 'katchup-recall',
          stepId: 'recall',
          prerequisiteFailed: true,
          blockedByStepId: 'send',
        },
      }),
    );
    expect(decision.supportingEvidence).toContainEqual({ field: 'blockedByStepId', value: 'send' });
    expect(decision.supportingEvidence).toContainEqual({ field: 'stepId', value: 'recall' });
  });

  test('the SAME evidence without a failed prerequisite still classifies as a defect', () => {
    /*
     * The negative case that gives the rule meaning. If it fired whenever a flow was present it
     * would silence every finding inside a flow — which is the opposite of what the bench is for.
     */
    const decision = classifyFailure(
      failure({
        flowStep: { flowId: 'katchup-recall', stepId: 'recall', prerequisiteFailed: false },
      }),
    );
    expect(decision.classification).toBe('APP_DEFECT');
  });

  test('a flow that is absent altogether changes nothing', () => {
    expect(classifyFailure(failure({})).classification).toBe('APP_DEFECT');
  });
});

test.describe('failure analysis · unmeasured is never a defect @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('an INDETERMINATE state transition is INSUFFICIENT_EVIDENCE, not APP_DEFECT', () => {
    /*
     * Phase 7 refuses to judge a transition whose before or after was never observed. Without this
     * rule that refusal would be undone one layer later: the exchange is application-attributed, so
     * the contract-violation rule would report a defect on the strength of a measurement nobody took.
     */
    const decision = classifyFailure(
      failure({ validatorName: 'state-transition.read', stateTransition: 'INDETERMINATE' }),
    );
    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.reasonCode).toBe('STATE_TRANSITION_INDETERMINATE');
    expect(decision.missingEvidence.join(' ')).toContain('both sides');
  });

  test('an INDETERMINATE side effect is INSUFFICIENT_EVIDENCE, and says why', () => {
    const decision = classifyFailure(
      failure({ validatorName: 'side-effect.unread-count', sideEffect: 'INDETERMINATE' }),
    );
    expect(decision.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.reasonCode).toBe('SIDE_EFFECT_INDETERMINATE');
    expect(decision.summary, 'the rule the whole layer rests on').toContain(
      'Unmeasured is not unchanged',
    );
  });

  test('a MEASURED failure falls through to the ordinary application rule', () => {
    /*
     * The counterpart that keeps the rule above honest: NOT_OBSERVED means the application WAS
     * measured and did not do the thing, which needs no special pleading and must stay a defect.
     */
    const measured = classifyFailure(
      failure({ validatorName: 'side-effect.unread-count', sideEffect: 'NOT_OBSERVED' }),
    );
    expect(measured.classification).toBe('APP_DEFECT');
    expect(
      classifyFailure(
        failure({ validatorName: 'state-transition.read', stateTransition: 'NOT_OCCURRED' }),
      ).classification,
    ).toBe('APP_DEFECT');
  });
});

test.describe('failure analysis · an application bug is never read off a status alone @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('a 500 answered by an intermediary is INFRASTRUCTURE, not a defect', () => {
    // Same status, different origin, different answer — which is the whole point.
    const edge = withOrigin(
      captureExchange(
        new ApiResponseWrapper(
          {
            method: 'POST',
            pathTemplate: '/v2/katchup/recallMessage/',
            url: 'https://testingapi.kpostindia.com/v2/katchup/recallMessage/',
            headers: {},
            correlationId: 'tb-p10-edge',
            timeoutMs: 10_000,
          },
          503,
          { server: 'nginx', 'content-type': 'text/html' },
          '<html><head><title>503 Service Temporarily Unavailable</title></head></html>',
          5,
          undefined,
          'primary',
        ),
        {
          runId: 'run-p10',
          phase: 'action',
          endpointId: 'katchup-recall-message',
          endpoint: 'POST /v2/katchup/recallMessage/',
          suite: 'kpost-api',
        },
      ),
    );
    const decision = classifyFailure(
      failure({ exchanges: [edge], decidingCorrelationIds: [edge.correlationId], actual: 503 }),
    );
    expect(decision.classification).not.toBe('APP_DEFECT');
  });
});

test.describe('failure analysis · the dimensions the master plan asks to distinguish @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('authentication and authorization are no longer the same dimension', () => {
    /*
     * "The caller was not who they claimed" and "the caller was not allowed to do that" are
     * different defects, with different owners and different fixes. Both used to resolve to
     * SECURITY, so no report could tell them apart.
     */
    expect(violationTypeOf('authentication.missing-token')).toBe('AUTHENTICATION');
    expect(violationTypeOf('authorization.cross-tenant')).toBe('AUTHORIZATION');
    expect(violationTypeOf('security.injection'), 'and neither swallowed the other').toBe(
      'SECURITY',
    );
  });

  test('the evidence the later phases produce has a dimension of its own', () => {
    expect(violationTypeOf('state-transition.read')).toBe('STATE_TRANSITION');
    expect(violationTypeOf('side-effect.unread-count')).toBe('SIDE_EFFECT');
    expect(violationTypeOf('consistency.count-versus-list')).toBe('DATA_CONSISTENCY');
    expect(violationTypeOf('ui.content')).toBe('UI_BEHAVIOUR');
  });

  test('an unknown validator still resolves, to OTHER rather than to a guess', () => {
    expect(violationTypeOf('something.nobody.registered')).toBe('OTHER');
  });

  test('every dimension in the vocabulary is reachable from some validator name', () => {
    /*
     * A dimension nothing can produce is dead weight that makes the taxonomy look richer than the
     * analysis is. STATE is the one exception, and an honest one: it belongs to `database.*`, which
     * is mock-only in this repository today.
     */
    const samples = [
      'response.status-code',
      'response.schema',
      'response.headers',
      'response.content-type',
      'security.injection',
      'authentication.missing-token',
      'authorization.cross-tenant',
      'request.null-value',
      'business-rule.BR-C01',
      'database.row-present',
      'state-transition.read',
      'side-effect.unread-count',
      'consistency.count-versus-list',
      'ui.content',
      'performance.response-time',
      'something.nobody.registered',
    ];
    const reached = new Set(samples.map(violationTypeOf));
    expect([...VIOLATION_TYPES].filter((type) => !reached.has(type))).toEqual([]);
  });
});

test.describe('failure analysis · provenance travels with the decision @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('actor, flow and requirement provenance reach the record', () => {
    // So a reader can ask "who saw this, in which flow, against which requirement" off the record.
    const decision = classifyFailure(
      failure({
        actor: { role: 'recipient', accountKey: 'victim' },
        flowStep: { flowId: 'katchup-recall', stepId: 'recall', prerequisiteFailed: false },
        invariantId: 'BR-KU-RECALL',
        requirementIds: ['FR-KU-010', 'FR-KU-011'],
      }),
    );
    const fields = Object.fromEntries(
      decision.supportingEvidence.map((entry) => [entry.field, entry.value]),
    );
    expect(fields.actorRole).toBe('recipient');
    expect(fields.flowId).toBe('katchup-recall');
    expect(fields.invariantId).toBe('BR-KU-RECALL');
    expect(fields.requirements).toBe('FR-KU-010,FR-KU-011');
  });

  test('the actor is named by POOL KEY, and no credential reaches the record', () => {
    /*
     * The same rule the account pool and the cross-actor reporting keep. A classification record is
     * durable and is read by people who are not running the test.
     */
    const decision = classifyFailure(
      failure({ actor: { role: 'recipient', accountKey: 'victim' } }),
    );
    const rendered = JSON.stringify(decision);
    expect(rendered).toContain('victim');
    expect(rendered).not.toMatch(/password|bearer|authorization|@kpost|api[_-]?key/i);
  });

  test('provenance that was not supplied is absent, never invented', () => {
    const decision = classifyFailure(failure({}));
    const fields = decision.supportingEvidence.map((entry) => entry.field);
    expect(fields).not.toContain('actorRole');
    expect(fields).not.toContain('flowId');
    expect(fields).not.toContain('requirements');
  });
});
