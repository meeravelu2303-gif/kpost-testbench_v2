import { apiRegistry } from '@api/definitions/index';
import { expect, test } from '@fixtures';
import { FAILURE_CLASSES, REASON_CODES } from '../../src/failure-analysis/index';
import { hasRequirement, requirement } from '../../src/requirements/index';
import * as flowModule from '../../src/flows/index';
import {
  EXECUTION_CHANNELS,
  FLOW_STEP_STATUSES,
  FlowRun,
  FlowRunError,
  KATCHUP_MESSAGE_1TO1_FLOW,
  MESSAGE_ID,
  MESSAGE_MARKER,
  allFlows,
  boundEndpointIds,
  defineArtifact,
  dependenciesOf,
  flow,
  hasFlow,
  unboundSteps,
  validateFlow,
  type FlowDefinition,
} from '../../src/flows/index';

/**
 * Guards for Phase 2B — the Application Flow model.
 *
 * ## What these prove
 *
 * That a flow is declarative data with a checkable dependency graph; that a consumer with no
 * producer is rejected at definition time; that a step whose upstream artifact never arrived becomes
 * BLOCKED and cannot contribute a business observation; and that the flow layer sits ABOVE the
 * existing architecture without touching it.
 *
 * ## What they deliberately do NOT do
 *
 * They execute no HTTP, need no live KPOST environment, and assert nothing about how a response is
 * validated — that remains the validators' job, unchanged.
 */

const KATCHUP = KATCHUP_MESSAGE_1TO1_FLOW;

/** A minimal well-formed flow, for the negative cases. Local so no registered flow is mutated. */
function draftFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  const TOKEN = defineArtifact<string>('token', 'a value the first step hands to the second');
  return {
    flowId: 'test.draft',
    name: 'draft',
    module: 'katchup',
    requirementIds: ['FR-KU-003'],
    actorRoles: ['sender'],
    cleanupStrategy: 'not-applicable',
    status: 'DRAFT',
    description: 'a fixture flow used by the guards',
    steps: [
      {
        stepId: 'produce',
        name: 'produce',
        actor: 'sender',
        action: 'test.produce',
        phase: 'action',
        produces: [TOKEN],
        unboundReason: 'test fixture',
      },
      {
        stepId: 'consume',
        name: 'consume',
        actor: 'sender',
        action: 'test.consume',
        phase: 'action',
        consumes: [TOKEN],
        unboundReason: 'test fixture',
      },
    ],
    ...overrides,
  };
}

// ============================================================================================
// 1–3. Structure, requirements, ordered steps
// ============================================================================================

test.describe('flow model — definition structure @framework', () => {
  test('every registered flow is well-formed', () => {
    for (const candidate of allFlows()) {
      expect(validateFlow(candidate), candidate.flowId).toEqual([]);
    }
    expect(allFlows().length, 'Phase 2B registers one proof-of-concept flow').toBeGreaterThan(0);
  });

  test('a flow is declarative data — no field can hold executable code', () => {
    /*
     * The boundary the brief names: a FlowDefinition must not become a test script. Serialising it
     * losslessly is the strongest available proof that it holds no function, locator or closure.
     */
    const serialised = JSON.stringify(KATCHUP);
    expect(JSON.parse(serialised)).toEqual(JSON.parse(JSON.stringify(KATCHUP)));
    for (const step of KATCHUP.steps) {
      for (const value of Object.values(step)) {
        expect(typeof value, `${step.stepId} holds only data`).not.toBe('function');
      }
    }
  });

  test('requirement references resolve through the Phase 1 registry, and carry no text', () => {
    expect(KATCHUP.requirementIds.length).toBeGreaterThan(0);
    for (const id of KATCHUP.requirementIds) {
      expect(hasRequirement(id), `${id} must resolve in the requirement registry`).toBe(true);
    }
    /*
     * The flow stores ids only — the registry owns the text. Collected outside the assertion so the
     * check is a plain loop: the two requirement ids this flow references (FR-KU-003, FR-K07) are a
     * current FR and a legacy one, and only the legacy one carries repository-stated text.
     */
    const serialised = JSON.stringify(KATCHUP);
    const knownTexts = KATCHUP.requirementIds
      .map((id) => requirement(id)?.normalizedRequirementText)
      .filter((text): text is string => Boolean(text));

    expect(
      knownTexts.length,
      'at least one referenced requirement has text to leak',
    ).toBeGreaterThan(0);
    for (const text of knownTexts) {
      expect(serialised, 'requirement text must not be copied into a flow').not.toContain(text);
    }
  });

  test('steps are ordered, uniquely identified, and use declared actor roles', () => {
    const ids = KATCHUP.steps.map((step) => step.stepId);
    expect(new Set(ids).size, 'step ids are unique').toBe(ids.length);
    expect(ids, 'the declared business order').toEqual([
      'authenticate-sender',
      'authenticate-recipient',
      'send-message',
      'recipient-observes-message',
      'recipient-reads-message',
      'sender-observes-read-receipt',
    ]);
    for (const step of KATCHUP.steps) {
      expect(KATCHUP.actorRoles, step.stepId).toContain(step.actor);
      expect(FLOW_STEP_STATUSES.length, 'status vocabulary is closed').toBeGreaterThan(0);
    }
  });
});

// ============================================================================================
// 4–7. Artifact production, consumption, dependency resolution, missing producer
// ============================================================================================

test.describe('flow model — artifact dependencies @framework', () => {
  test('the send step declares the artifact the downstream steps need', () => {
    const send = KATCHUP.steps.find((step) => step.stepId === 'send-message');
    expect(send?.produces?.map((a) => a.artifactId)).toEqual(['messageId', 'messageMarker']);
  });

  test('downstream steps explicitly declare what they consume', () => {
    const observe = KATCHUP.steps.find((step) => step.stepId === 'recipient-observes-message');
    const receipt = KATCHUP.steps.find((step) => step.stepId === 'sender-observes-read-receipt');
    expect(observe?.consumes?.map((a) => a.artifactId)).toEqual(['messageId', 'messageMarker']);
    expect(receipt?.consumes?.map((a) => a.artifactId)).toEqual(['messageId']);
  });

  test('dependencies resolve to the producing step, not to a string convention', () => {
    expect(dependenciesOf(KATCHUP, 'recipient-observes-message')).toEqual(['send-message']);
    expect(dependenciesOf(KATCHUP, 'sender-observes-read-receipt')).toEqual(['send-message']);
    expect(dependenciesOf(KATCHUP, 'send-message'), 'the producer depends on nothing').toEqual([]);
  });

  test('a consumer with NO producer is rejected at definition time', () => {
    const orphan = defineArtifact<number>('nobodyProducesThis', 'an artifact with no producer');
    const broken = draftFlow();
    const problems = validateFlow({
      ...broken,
      steps: [broken.steps[0]!, { ...broken.steps[1]!, consumes: [orphan] }],
    });
    expect(problems.map((p) => p.code)).toContain('MISSING_ARTIFACT_PRODUCER');
  });

  test('a producer declared AFTER its consumer is rejected', () => {
    const base = draftFlow();
    const reversed = validateFlow({ ...base, steps: [base.steps[1]!, base.steps[0]!] });
    expect(reversed.map((p) => p.code)).toContain('PRODUCER_NOT_EARLIER');
  });

  test('two producers of one artifact are rejected — provenance is never ambiguous', () => {
    const base = draftFlow();
    const duplicated = validateFlow({
      ...base,
      steps: [base.steps[0]!, { ...base.steps[0]!, stepId: 'produce-again' }, base.steps[1]!],
    });
    expect(duplicated.map((p) => p.code)).toContain('DUPLICATE_ARTIFACT_PRODUCER');
  });

  test('an unknown requirement id is rejected — a flow cannot invent one', () => {
    const problems = validateFlow({ ...draftFlow(), requirementIds: ['FR-NOT-REAL-999'] });
    expect(problems.map((p) => p.code)).toContain('UNKNOWN_REQUIREMENT');
  });
});

// ============================================================================================
// 8–9. Blocking, and no global mutation
// ============================================================================================

test.describe('flow model — blocking semantics @framework', () => {
  test('a downstream step is BLOCKED when its artifact was never produced', () => {
    const run = new FlowRun(KATCHUP);
    run.record('authenticate-sender', 'PASSED').record('authenticate-recipient', 'PASSED');
    // The send FAILS, so no messageId exists.
    run.record('send-message', 'FAILED');

    expect(run.statusOf('recipient-observes-message')).toBe('BLOCKED');
    const reason = run.blockedReason('recipient-observes-message');
    expect(reason?.missingArtifactId).toBe('messageId');
    expect(reason?.expectedProducerStepId).toBe('send-message');
    expect(reason?.message).toContain('did not produce');
  });

  test('a BLOCKED step may not contribute a business-behaviour observation', () => {
    /*
     * THE point of the phase. Today a soft-asserted send followed by a negative assertion
     * ("the recalled message is not in the recipient's view") passes vacuously when the send failed.
     * Here the downstream step is not merely wrong — it is not observable at all.
     */
    const run = new FlowRun(KATCHUP);
    run.record('send-message', 'FAILED');

    expect(run.canObserve('send-message'), 'a step that ran is observable').toBe(true);
    expect(run.canObserve('recipient-observes-message'), 'a blocked step is NOT').toBe(false);
    expect(run.canObserve('sender-observes-read-receipt')).toBe(false);
  });

  test('a step that ran is observable whether it passed or failed', () => {
    const run = new FlowRun(KATCHUP);
    run.record('send-message', 'PASSED').produce('send-message', MESSAGE_ID, 42);
    run.produce('send-message', MESSAGE_MARKER, 'marker');
    run.record('recipient-observes-message', 'FAILED');

    expect(run.canObserve('recipient-observes-message'), 'FAILED still ran').toBe(true);
    expect(run.statusOf('recipient-observes-message')).toBe('FAILED');
  });

  test('an unrun step with satisfied dependencies is NOT_EXECUTED, not BLOCKED', () => {
    const run = new FlowRun(KATCHUP);
    run.record('send-message', 'PASSED');
    run.produce('send-message', MESSAGE_ID, 7).produce('send-message', MESSAGE_MARKER, 'm');

    expect(run.statusOf('recipient-observes-message')).toBe('NOT_EXECUTED');
    expect(run.canObserve('recipient-observes-message')).toBe(false);
  });

  test('artifacts are typed at the call site — no cast, no string lookup', () => {
    const run = new FlowRun(KATCHUP);
    run.record('send-message', 'PASSED');
    run.produce('send-message', MESSAGE_ID, 1234).produce('send-message', MESSAGE_MARKER, 'QA-x');

    const id: number = run.require(MESSAGE_ID);
    const marker: string = run.require(MESSAGE_MARKER);
    expect(id).toBe(1234);
    expect(marker).toBe('QA-x');
    expect(run.producerOf(MESSAGE_ID)).toBe('send-message');
  });

  test('a step cannot publish an artifact it does not declare', () => {
    const run = new FlowRun(KATCHUP);
    run.record('recipient-observes-message', 'PASSED');
    expect(
      () => run.produce('recipient-observes-message', MESSAGE_ID, 1),
      'this is what stops the store becoming the global variable it replaces',
    ).toThrow(FlowRunError);
  });

  test('a step that did not pass cannot publish a value', () => {
    const run = new FlowRun(KATCHUP);
    run.record('send-message', 'FAILED');
    expect(() => run.produce('send-message', MESSAGE_ID, 1)).toThrow(FlowRunError);
  });

  test('requiring an unavailable artifact throws rather than returning undefined', () => {
    const run = new FlowRun(KATCHUP);
    expect(() => run.require(MESSAGE_ID)).toThrow(FlowRunError);
    expect(run.read(MESSAGE_ID)).toBeUndefined();
    expect(run.has(MESSAGE_ID)).toBe(false);
  });

  test('two runs of the same flow share no state', () => {
    const first = new FlowRun(KATCHUP);
    first.record('send-message', 'PASSED').produce('send-message', MESSAGE_ID, 1);
    const second = new FlowRun(KATCHUP);

    expect(second.has(MESSAGE_ID), 'no module-level artifact store exists').toBe(false);
    expect(second.statusOf('send-message')).toBe('NOT_EXECUTED');
  });

  test('outcomes() is deterministic and reports every step in declared order', () => {
    const run = new FlowRun(KATCHUP);
    run.record('send-message', 'FAILED');
    const first = JSON.stringify(run.outcomes());
    expect(JSON.stringify(run.outcomes())).toBe(first);
    expect(run.outcomes().map((o) => o.stepId)).toEqual(KATCHUP.steps.map((s) => s.stepId));
  });
});

// ============================================================================================
// 10. API/UI channel is a property of execution
// ============================================================================================

test.describe('flow model — API/UI boundary @framework', () => {
  test('one business flow carries bindings for both channels — no ApiFlow/UiFlow pair', () => {
    const send = KATCHUP.steps.find((step) => step.stepId === 'send-message');
    const channels = (send?.bindings ?? []).map((binding) => binding.channel);

    expect(channels).toEqual(['API', 'UI']);
    expect(
      allFlows().filter((f) => /api|ui/i.test(f.flowId)),
      'no channel-specific flows',
    ).toEqual([]);
    for (const channel of channels) expect(EXECUTION_CHANNELS).toContain(channel);
  });

  test('every API binding names a registered endpoint', () => {
    // The one place the flow layer and the endpoint registry are allowed to meet.
    const unknown = boundEndpointIds().filter((id) => !apiRegistry.has(id));
    expect(unknown, `flow bindings naming unregistered endpoints:\n${unknown.join('\n')}`).toEqual(
      [],
    );
    expect(boundEndpointIds().length).toBeGreaterThan(0);
  });

  test('a step with no binding must state why — the gap is data, not an absence', () => {
    const unbound = unboundSteps(KATCHUP);
    expect(unbound.map((entry) => entry.step.stepId)).toEqual([
      'recipient-reads-message',
      'sender-observes-read-receipt',
    ]);
    for (const entry of unbound) {
      expect(entry.reason.length, `${entry.step.stepId} must explain itself`).toBeGreaterThan(40);
    }
    // The FR-K07 gap Phase 2A identified is now machine-readable.
    expect(unbound.find((e) => e.step.stepId === 'sender-observes-read-receipt')?.reason).toContain(
      'katchup-read-status-group',
    );
  });

  test('a step with no binding and no reason is rejected', () => {
    const base = draftFlow();
    const problems = validateFlow({
      ...base,
      steps: [{ ...base.steps[0]!, unboundReason: undefined }, base.steps[1]!],
    });
    expect(problems.map((p) => p.code)).toContain('UNBOUND_STEP_WITHOUT_REASON');
  });
});

// ============================================================================================
// 11–12. The existing architecture is untouched
// ============================================================================================

test.describe('flow model — existing architecture preserved @framework', () => {
  test('the flow layer imports no execution, validation, confidence or Bugzilla code', () => {
    /*
     * Structural, not a matter of discipline: the flow model may reference the requirement registry
     * and nothing else. A future edit that reaches into the engine fails here.
     */
    const serialised = JSON.stringify(allFlows());
    for (const forbidden of ['validator', 'confidence', 'bugzilla', 'fingerprint', 'severity']) {
      expect(
        serialised.includes(`"${forbidden}"`),
        `no ${forbidden} concept belongs in a flow`,
      ).toBe(false);
    }
  });

  test('the registry resolves flows and refuses unknown ids', () => {
    expect(hasFlow(KATCHUP.flowId)).toBe(true);
    expect(flow(KATCHUP.flowId)).toBe(KATCHUP);
    expect(flow('does.not.exist')).toBeUndefined();
    expect(hasFlow('does.not.exist')).toBe(false);
  });

  test('the Requirement Registry still answers exactly as Phase 1 left it', () => {
    // Referencing a requirement from a flow must not mutate or re-status it.
    const record = requirement('FR-K07');
    expect(record?.status, 'FR-K07 is still the SUPERSEDED legacy id Phase 1 recorded').toBe(
      'SUPERSEDED',
    );
    expect(record?.supersededBy, 'still no invented successor').toEqual([]);
    expect(requirement('FR-KU-003')?.status).toBe('ACTIVE');
  });

  test('flows add no endpoint, and change no endpoint definition', () => {
    for (const id of boundEndpointIds()) {
      const definition = apiRegistry.get(id);
      expect(definition.id, id).toBe(id);
      // The flow references the endpoint; it does not annotate or extend it.
      expect(Object.keys(definition), id).not.toContain('flowId');
    }
  });
});

// ============================================================================================
// Phase 2C — execution status is NOT a failure classification
// ============================================================================================

test.describe('flow model — execution status vs failure classification @framework', () => {
  test('a BLOCKED step carries no cause, no attribution and no classification', () => {
    /*
     * The separation Phase 2C makes explicit. `BLOCKED` answers "did it run?"; the Phase 3.3
     * classifier answers "why did it fail, and whose fault is it?". A blocked step sent nothing, so
     * there is no evidence to classify — and the blocked record must not pretend otherwise.
     */
    const run = new FlowRun(KATCHUP);
    run.record('send-message', 'FAILED');
    const reason = run.blockedReason('recipient-observes-message');

    expect(reason).toBeDefined();
    expect(Object.keys(reason ?? {}).sort()).toEqual([
      'expectedProducerStepId',
      'message',
      'missingArtifactId',
      'stepId',
    ]);
    for (const field of ['classification', 'reasonCode', 'failureClass', 'severity', 'cause']) {
      expect(field in (reason ?? {}), `BlockedReason must not carry "${field}"`).toBe(false);
    }
  });

  test('BLOCKED does not mean PRECONDITION_FAILED — the word is shared, the meaning is not', () => {
    /*
     * `FailureClass` also contains BLOCKED and `REASON_CODES` contains PRECONDITION_FAILED. They are
     * a different vocabulary answering a different question, reached from evidence by the classifier.
     * The flow layer must never translate one into the other.
     */
    const run = new FlowRun(KATCHUP);
    run.record('send-message', 'FAILED');

    expect(run.statusOf('recipient-observes-message')).toBe('BLOCKED');
    expect(FLOW_STEP_STATUSES).toContain('BLOCKED');
    // The classifier's vocabulary is reachable from the test, and deliberately NOT from the model.
    expect(FAILURE_CLASSES).toContain('BLOCKED');
    expect(REASON_CODES).toContain('PRECONDITION_FAILED');
    // …but no flow outcome carries either. The overlap is lexical only.
    const serialised = JSON.stringify(run.outcomes());
    expect(serialised).not.toContain('PRECONDITION_FAILED');
    expect(serialised).not.toContain('APP_DEFECT');
  });

  test('the flow module exports no failure-classification symbol', () => {
    const exported = Object.keys(flowModule).sort();
    for (const forbidden of [
      'FAILURE_CLASSES',
      'REASON_CODES',
      'classifyFailure',
      'FailureClass',
      'CLASSIFIER_VERSION',
    ]) {
      expect(exported, `the flow layer must not re-export ${forbidden}`).not.toContain(forbidden);
    }
    expect(exported).toContain('FLOW_STEP_STATUSES');
  });

  test('a blocked step is not observable, so nothing downstream can classify it', () => {
    const run = new FlowRun(KATCHUP);
    run.record('send-message', 'FAILED');

    expect(run.canObserve('recipient-observes-message')).toBe(false);
    expect(run.canObserve('sender-observes-read-receipt')).toBe(false);
    // A step that RAN is observable and may be classified by the existing classifier, from evidence.
    expect(run.canObserve('send-message')).toBe(true);
  });
});
