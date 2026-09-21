import { expect, test } from '@fixtures';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';
import {
  FlowExecutionEngine,
  StepActionRegistry,
  StepActionRegistryError,
  observableSteps,
  produced,
  summarise,
  type StepAction,
  type StepActionResult,
} from '../../src/flow-execution/index';
import { defineArtifact, type FlowDefinition } from '../../src/flows/index';
import { KATCHUP_MESSAGE_1TO1_FLOW, MESSAGE_ID, MESSAGE_MARKER } from '../../src/flows/index';
import type { StateObservation } from '../../src/state-observation/index';

/**
 * Guards for the Flow Execution Engine (master plan §8).
 *
 * Entirely synthetic: the actions here are plain functions, so nothing authenticates, sends a
 * request or touches an account. That is deliberate — an execution architecture must be provable
 * without live destructive execution, or the only way to trust it is to run it against the product.
 *
 * The behaviour these pin is the one the whole layer exists for: **a step that did not run may not
 * contribute evidence.** A failed send must leave its downstream steps BLOCKED with the missing
 * artifact named, not quietly passing on an empty result.
 */

// --- a synthetic flow, so the engine is tested against its rules rather than one catalogue entry --

const TOKEN = defineArtifact<string>('token', 'a synthetic session token');
const RECORD_ID = defineArtifact<number>('recordId', 'the id the create step returned');

const SYNTHETIC_FLOW: FlowDefinition = {
  flowId: 'test.synthetic-lifecycle',
  name: 'synthetic lifecycle',
  module: 'katchup',
  requirementIds: [],
  actorRoles: ['sender', 'recipient'],
  cleanupStrategy: 'ledger-managed',
  status: 'ACTIVE',
  description: 'A synthetic flow used only to exercise the execution engine.',
  steps: [
    {
      stepId: 'authenticate',
      name: 'the sender authenticates',
      actor: 'sender',
      action: 'test.authenticate',
      phase: 'precondition',
      produces: [TOKEN],
      bindings: [{ channel: 'API', endpointId: 'signup-login-user-login' }],
    },
    {
      stepId: 'create',
      name: 'the sender creates a record',
      actor: 'sender',
      action: 'test.create',
      phase: 'action',
      consumes: [TOKEN],
      produces: [RECORD_ID],
      bindings: [
        { channel: 'API', endpointId: 'katchup-send-message' },
        { channel: 'UI', helper: 'tests/e2e/support/katchup.ts#sendMessage' },
      ],
    },
    {
      stepId: 'recipient-observes',
      name: 'the recipient observes the record',
      actor: 'recipient',
      action: 'test.observe',
      phase: 'action',
      consumes: [RECORD_ID],
      bindings: [{ channel: 'API', endpointId: 'katchup-conversation' }],
    },
    {
      stepId: 'independent',
      name: 'a step that declares no dependency',
      actor: 'sender',
      action: 'test.independent',
      phase: 'action',
      bindings: [{ channel: 'API', endpointId: 'katchup-message-count' }],
    },
  ],
};

interface FakeExecutor {
  readonly calls: string[];
}
interface FakeResources {
  readonly tracked: string[];
}

const action = (
  name: string,
  run: StepAction<FakeExecutor, FakeResources>['run'],
  channel: 'API' | 'UI' = 'API',
): StepAction<FakeExecutor, FakeResources> => ({
  action: name,
  channel,
  describe: `synthetic ${name}`,
  run,
});

const pass = (result: Partial<StepActionResult> = {}): StepActionResult => ({
  outcome: 'PASSED',
  ...result,
});

function engineWith(
  actions: StepActionRegistry<FakeExecutor, FakeResources>,
  extra: { channel?: 'API' | 'UI'; isSafetyRefusal?: (error: unknown) => boolean } = {},
): {
  engine: FlowExecutionEngine<FakeExecutor, FakeResources>;
  endpoints: FakeExecutor;
  resources: FakeResources;
} {
  const endpoints: FakeExecutor = { calls: [] };
  const resources: FakeResources = { tracked: [] };
  return {
    engine: new FlowExecutionEngine<FakeExecutor, FakeResources>({
      actions,
      endpoints,
      resources,
      ...extra,
    }),
    endpoints,
    resources,
  };
}

/** Every action registered and passing — the happy path, reused by several tests. */
function happyRegistry(): StepActionRegistry<FakeExecutor, FakeResources> {
  return new StepActionRegistry<FakeExecutor, FakeResources>().register(
    action('test.authenticate', (context) => {
      context.endpoints.calls.push(`auth:${context.actor.actorId}`);
      return pass({ produces: [produced(TOKEN, `token-${context.actor.actorId}`)] });
    }),
    action('test.create', (context) => {
      context.endpoints.calls.push(`create:${String(context.endpointId)}`);
      context.resources.tracked.push('record-1');
      return pass({ produces: [produced(RECORD_ID, 1)], correlationIds: ['tb-create'] });
    }),
    action('test.observe', (context) => {
      context.endpoints.calls.push(`observe:${String(context.run.require(RECORD_ID))}`);
      return pass({ correlationIds: ['tb-observe'] });
    }),
    action('test.independent', () => pass()),
  );
}

test.describe('flow execution: a successful flow @framework', () => {
  test('every step runs, in declaration order, through the injected executor', async () => {
    const { engine, endpoints } = engineWith(happyRegistry());
    const result = await engine.execute(SYNTHETIC_FLOW);

    expect(result.steps.map((step) => step.stepId)).toEqual([
      'authenticate',
      'create',
      'recipient-observes',
      'independent',
    ]);
    expect(result.steps.map((step) => step.status)).toEqual([
      'PASSED',
      'PASSED',
      'PASSED',
      'PASSED',
    ]);
    // The engine sends nothing itself: every call went through the executor the caller injected.
    expect(endpoints.calls).toEqual([
      'auth:sender#0',
      'create:katchup-send-message',
      'observe:1',
      'auth:sender#0'.replace('auth:sender#0', 'observe:1').replace('observe:1', 'observe:1'),
    ]);
  });

  test('an artifact a step publishes is readable by the step that consumes it', async () => {
    const { engine } = engineWith(happyRegistry());
    const result = await engine.execute(SYNTHETIC_FLOW);

    expect(result.run.read(RECORD_ID), 'the value crossed the step boundary').toBe(1);
    expect(result.run.producerOf(RECORD_ID), 'provenance is answerable').toBe('create');
    expect(result.steps[1]?.producedArtifactIds).toEqual(['recordId']);
  });

  test('the endpoint id from the binding reaches the action, and nothing else does', async () => {
    let seen: string | undefined = 'unset';
    const actions = happyRegistry();
    const { engine } = engineWith(
      new StepActionRegistry<FakeExecutor, FakeResources>().register(
        action('test.authenticate', () => pass({ produces: [produced(TOKEN, 't')] })),
        action('test.create', (context) => {
          seen = context.endpointId;
          return pass({ produces: [produced(RECORD_ID, 1)] });
        }),
        action('test.observe', () => pass()),
        action('test.independent', () => pass()),
      ),
    );
    await engine.execute(SYNTHETIC_FLOW);
    expect(seen, 'the binding names the endpoint; the flow carries no payload').toBe(
      'katchup-send-message',
    );
    expect(actions.describe().length, 'the registry describes itself for a report').toBe(4);
  });
});

test.describe('flow execution: a failed prerequisite blocks what depends on it @framework', () => {
  test('a failed step leaves its dependants BLOCKED, naming the artifact and its producer', async () => {
    const { engine, endpoints } = engineWith(
      new StepActionRegistry<FakeExecutor, FakeResources>().register(
        action('test.authenticate', () => pass({ produces: [produced(TOKEN, 't')] })),
        action('test.create', () => ({ outcome: 'FAILED', failure: 'the send returned 500' })),
        action('test.observe', (context) => {
          context.endpoints.calls.push('observe SHOULD NOT RUN');
          return pass();
        }),
        action('test.independent', () => pass()),
      ),
    );
    const result = await engine.execute(SYNTHETIC_FLOW);

    const byId = Object.fromEntries(result.steps.map((step) => [step.stepId, step]));
    expect(byId.create?.status).toBe('FAILED');
    expect(byId.create?.reason).toBe('the send returned 500');
    expect(byId['recipient-observes']?.status, 'not passed, and not silently skipped').toBe(
      'BLOCKED',
    );
    expect(byId['recipient-observes']?.blocked?.missingArtifactId).toBe('recordId');
    expect(byId['recipient-observes']?.blocked?.expectedProducerStepId).toBe('create');

    // The decisive point: the downstream action was never invoked, so it produced no evidence.
    expect(
      endpoints.calls,
      'a blocked step leaves no trace of having been attempted',
    ).not.toContain('observe SHOULD NOT RUN');
  });

  test('a failed step publishes nothing, even if its action returns a value', async () => {
    const { engine } = engineWith(
      new StepActionRegistry<FakeExecutor, FakeResources>().register(
        action('test.authenticate', () => pass({ produces: [produced(TOKEN, 't')] })),
        action('test.create', () => ({
          outcome: 'FAILED',
          failure: 'rejected',
          produces: [produced(RECORD_ID, 99)],
        })),
        action('test.observe', () => pass()),
        action('test.independent', () => pass()),
      ),
    );
    const result = await engine.execute(SYNTHETIC_FLOW);
    expect(result.run.has(RECORD_ID), 'a failed step must not leave a value behind').toBe(false);
  });

  test('only steps that ran may be treated as evidence', async () => {
    const { engine } = engineWith(
      new StepActionRegistry<FakeExecutor, FakeResources>().register(
        action('test.authenticate', () => pass({ produces: [produced(TOKEN, 't')] })),
        action('test.create', () => ({ outcome: 'FAILED', failure: 'rejected' })),
        action('test.observe', () => pass()),
        action('test.independent', () => pass()),
      ),
    );
    const result = await engine.execute(SYNTHETIC_FLOW);
    expect(
      observableSteps(result)
        .map((step) => step.stepId)
        .sort(),
    ).toEqual(['authenticate', 'create', 'independent']);
  });

  test('blocking follows the declared dependency, never step order', async () => {
    // `independent` declares no `consumes`, so a failure before it is not its business. Blocking it
    // would be the engine asserting a relationship the flow author never stated.
    const { engine } = engineWith(
      new StepActionRegistry<FakeExecutor, FakeResources>().register(
        action('test.authenticate', () => pass({ produces: [produced(TOKEN, 't')] })),
        action('test.create', () => ({ outcome: 'FAILED', failure: 'rejected' })),
        action('test.observe', () => pass()),
        action('test.independent', () => pass()),
      ),
    );
    const result = await engine.execute(SYNTHETIC_FLOW);
    expect(result.steps.find((step) => step.stepId === 'independent')?.status).toBe('PASSED');
  });

  test('a first step that fails blocks the whole dependent chain', async () => {
    const { engine } = engineWith(
      new StepActionRegistry<FakeExecutor, FakeResources>().register(
        action('test.authenticate', () => ({ outcome: 'FAILED', failure: 'login refused' })),
        action('test.create', () => pass({ produces: [produced(RECORD_ID, 1)] })),
        action('test.observe', () => pass()),
        action('test.independent', () => pass()),
      ),
    );
    const result = await engine.execute(SYNTHETIC_FLOW);
    expect(result.steps.map((step) => step.status)).toEqual([
      'FAILED',
      'BLOCKED',
      'BLOCKED',
      'PASSED',
    ]);
  });
});

test.describe('flow execution: actors @framework', () => {
  test('the same role resolves to the same participant across steps', async () => {
    const seen: string[] = [];
    const { engine } = engineWith(
      new StepActionRegistry<FakeExecutor, FakeResources>().register(
        action('test.authenticate', (context) => {
          seen.push(context.actor.actorId);
          return pass({ produces: [produced(TOKEN, 't')] });
        }),
        action('test.create', (context) => {
          seen.push(context.actor.actorId);
          return pass({ produces: [produced(RECORD_ID, 1)] });
        }),
        action('test.observe', (context) => {
          seen.push(context.actor.actorId);
          return pass();
        }),
        action('test.independent', (context) => {
          seen.push(context.actor.actorId);
          return pass();
        }),
      ),
    );
    await engine.execute(SYNTHETIC_FLOW);
    // sender, sender, recipient, sender — two participants, not four.
    expect(seen).toEqual(['sender#0', 'sender#0', 'recipient#0', 'sender#0']);
  });

  test('a flow whose step names an undeclared role refuses to execute', async () => {
    /*
     * A definition error, not a test outcome. Producing a result full of FAILED statuses would read
     * as an application problem; refusing to start says what is actually wrong. It reuses the
     * existing `assertValidFlow` rather than defining a second set of rules.
     */
    const broken: FlowDefinition = {
      ...SYNTHETIC_FLOW,
      flowId: 'test.broken',
      actorRoles: ['sender'],
    };
    const { engine } = engineWith(happyRegistry());
    await expect(engine.execute(broken)).rejects.toThrow(/recipient|role/i);
  });
});

test.describe('flow execution: channels and bindings @framework', () => {
  test('a step with no binding for the channel is SKIPPED with the definition’s reason', async () => {
    // The real catalogue flow: two steps are unbound because KPOST has no call that answers them.
    const actions = new StepActionRegistry<FakeExecutor, FakeResources>().register(
      action('auth.login', () => pass()),
      action('katchup.send-message', () =>
        pass({ produces: [produced(MESSAGE_ID, 1), produced(MESSAGE_MARKER, 'm')] }),
      ),
      action('katchup.read-conversation', () => pass()),
    );
    const { engine } = engineWith(actions);
    const result = await engine.execute(KATCHUP_MESSAGE_1TO1_FLOW);

    const byId = Object.fromEntries(result.steps.map((step) => [step.stepId, step]));
    expect(byId['recipient-reads-message']?.status).toBe('SKIPPED');
    expect(
      byId['recipient-reads-message']?.reason,
      'the definition’s own reason travels',
    ).toContain('No endpoint marks a 1:1 Katchup message read');
    expect(byId['sender-observes-read-receipt']?.status).toBe('SKIPPED');
    expect(byId['sender-observes-read-receipt']?.reason).toContain(
      'No 1:1 read-receipt endpoint is registered',
    );
  });

  test('the real Katchup flow drives end to end on the API channel', async () => {
    const actions = new StepActionRegistry<FakeExecutor, FakeResources>().register(
      action('auth.login', () => pass()),
      action('katchup.send-message', () =>
        pass({ produces: [produced(MESSAGE_ID, 811_500), produced(MESSAGE_MARKER, 'QA m')] }),
      ),
      action('katchup.read-conversation', (context) =>
        pass({ correlationIds: [`tb-${String(context.run.require(MESSAGE_ID))}`] }),
      ),
    );
    const { engine } = engineWith(actions);
    const result = await engine.execute(KATCHUP_MESSAGE_1TO1_FLOW);

    expect(result.steps.map((step) => step.status)).toEqual([
      'PASSED',
      'PASSED',
      'PASSED',
      'PASSED',
      'SKIPPED',
      'SKIPPED',
    ]);
    expect(result.run.read(MESSAGE_ID)).toBe(811_500);
  });

  test('a UI execution uses the UI binding, and skips steps that have only an API one', async () => {
    const actions = new StepActionRegistry<FakeExecutor, FakeResources>().register(
      action('test.create', () => pass({ produces: [produced(RECORD_ID, 7)] }), 'UI'),
    );
    const { engine } = engineWith(actions, { channel: 'UI' });
    const result = await engine.execute(SYNTHETIC_FLOW);

    const byId = Object.fromEntries(result.steps.map((step) => [step.stepId, step]));
    // `authenticate` has an API binding only — skipped on a UI run, and the reason says so.
    expect(byId.authenticate?.status).toBe('SKIPPED');
    expect(byId.authenticate?.reason).toContain('no UI binding');
    // `create` has both, so the UI adapter drives it and the artifact still crosses.
    expect(byId.create?.status).toBe('PASSED');
    expect(result.run.read(RECORD_ID)).toBe(7);
    expect(result.channel).toBe('UI');
  });

  test('an action registered for one channel is not used for another', async () => {
    const actions = new StepActionRegistry<FakeExecutor, FakeResources>().register(
      action('test.authenticate', () => pass({ produces: [produced(TOKEN, 't')] }), 'UI'),
    );
    const { engine } = engineWith(actions); // API run
    const result = await engine.execute(SYNTHETIC_FLOW);
    expect(result.steps[0]?.status).toBe('SKIPPED');
    expect(result.steps[0]?.reason).toContain('no StepAction is registered');
  });

  test('two adapters for one action on one channel is refused at registration', () => {
    const registry = new StepActionRegistry<FakeExecutor, FakeResources>().register(
      action('test.create', () => pass()),
    );
    expect(() => registry.register(action('test.create', () => pass()))).toThrow(
      StepActionRegistryError,
    );
  });
});

test.describe('flow execution: safety, evidence and determinism @framework', () => {
  test('a refusal by a bench safety control is SKIPPED, never FAILED', async () => {
    /*
     * The same principle the probe runner learned: the bench declining to act says nothing about
     * the application. Recognising the refusal is INJECTED, so this module never imports the
     * validation engine to find out what a safety error looks like.
     */
    class SafetyRefusal extends Error {}
    const { engine } = engineWith(
      new StepActionRegistry<FakeExecutor, FakeResources>().register(
        action('test.authenticate', () => pass({ produces: [produced(TOKEN, 't')] })),
        action('test.create', () => {
          throw new SafetyRefusal('refusing to send: names 1 identifier(s) we do not own');
        }),
        action('test.observe', () => pass()),
        action('test.independent', () => pass()),
      ),
      { isSafetyRefusal: (error) => error instanceof SafetyRefusal },
    );
    const result = await engine.execute(SYNTHETIC_FLOW);
    const create = result.steps.find((step) => step.stepId === 'create');
    expect(create?.status).toBe('SKIPPED');
    expect(create?.reason).toContain('refused by a bench safety control');
    // And it still blocks what depended on it — nothing was created, so nothing may be observed.
    expect(result.steps.find((step) => step.stepId === 'recipient-observes')?.status).toBe(
      'BLOCKED',
    );
  });

  test('an action that throws fails its step and the run continues', async () => {
    const { engine } = engineWith(
      new StepActionRegistry<FakeExecutor, FakeResources>().register(
        action('test.authenticate', () => pass({ produces: [produced(TOKEN, 't')] })),
        action('test.create', () => {
          throw new Error('socket hang up');
        }),
        action('test.observe', () => pass()),
        action('test.independent', () => pass()),
      ),
    );
    const result = await engine.execute(SYNTHETIC_FLOW);
    expect(result.steps[1]?.status).toBe('FAILED');
    expect(result.steps[1]?.reason).toBe('socket hang up');
    // Continuing matters: stopping would hide WHY the downstream steps did not run.
    expect(result.steps[3]?.status, 'the run did not abort').toBe('PASSED');
  });

  test('observations and correlation ids are carried, and never interpreted', async () => {
    const observation = {
      observationId: 'o1',
      stateId: 'katchup.message.read',
    } as unknown as StateObservation;
    const { engine } = engineWith(
      new StepActionRegistry<FakeExecutor, FakeResources>().register(
        action('test.authenticate', () => pass({ produces: [produced(TOKEN, 't')] })),
        action('test.create', () =>
          pass({
            produces: [produced(RECORD_ID, 1)],
            observations: [observation],
            correlationIds: ['tb-abc'],
          }),
        ),
        action('test.observe', () => pass()),
        action('test.independent', () => pass()),
      ),
    );
    const result = await engine.execute(SYNTHETIC_FLOW);
    expect(result.steps[1]?.observations).toEqual([observation]);
    expect(result.steps[1]?.correlationIds).toEqual(['tb-abc']);
    // No verdict was attached: comparing a before and an after is Phase 7's job, not this layer's.
    expect(Object.keys(result.steps[1] ?? {})).not.toContain('verdict');
  });

  test('the resource coordinator is handed to the action, and the engine never cleans up', async () => {
    const { engine, resources } = engineWith(happyRegistry());
    await engine.execute(SYNTHETIC_FLOW);
    expect(resources.tracked, 'the action registers what it created, as specs do today').toEqual([
      'record-1',
    ]);
  });

  test('two executions share nothing — no module-level state', async () => {
    const registry = happyRegistry();
    const first = await engineWith(registry).engine.execute(SYNTHETIC_FLOW);
    const second = await engineWith(registry).engine.execute(SYNTHETIC_FLOW);

    expect(first.run).not.toBe(second.run);
    expect(first.run.actorFor('authenticate')).not.toBe(second.run.actorFor('authenticate'));
    expect(first.steps.map((step) => step.status)).toEqual(second.steps.map((step) => step.status));
  });

  test('the same inputs produce the same step statuses every time', async () => {
    const statuses = async (): Promise<string[]> =>
      (await engineWith(happyRegistry()).engine.execute(SYNTHETIC_FLOW)).steps.map(
        (step) => step.status,
      );
    expect(await statuses()).toEqual(await statuses());
  });

  test('the summary is report-safe: statuses and reasons, no credential', async () => {
    const { engine } = engineWith(happyRegistry());
    const lines = summarise(await engine.execute(SYNTHETIC_FLOW)).join('\n');
    expect(lines).toContain('PASSED');
    expect(lines).not.toMatch(/password|token-|authorization|api[_-]?key/i);
  });
});

test.describe('flow execution: architectural boundary @framework', () => {
  test('the execution layer owns no request, no payload and no second executor', () => {
    /*
     * The boundary the master plan §6/§7 is most concerned with. The engine is generic over the
     * executor precisely so it CANNOT construct one, and nothing here may grow an HTTP call, a
     * payload or an authentication step of its own.
     */
    const dir = path.join(ROOT_DIR, 'src', 'flow-execution');
    const sources = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => ({
        name,
        code: readFileSync(path.join(dir, name), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1'),
      }));

    const forbidden =
      /new EndpointExecutor|apiRegistry|requestBuilder|new AccountPool|ResourceLedger|axios|fetch\(/;
    expect(
      sources.filter((file) => forbidden.test(file.code)).map((file) => file.name),
      'execution adapts; it does not re-implement',
    ).toEqual([]);
  });

  test('the declarative flow layer still knows nothing of execution', () => {
    // The dependency must run one way. `src/flows/` importing the engine would make a business
    // description depend on the machinery meant to carry it out.
    const dir = path.join(ROOT_DIR, 'src', 'flows');
    const offenders: string[] = [];
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name.endsWith('.ts') &&
          readFileSync(full, 'utf8').includes('flow-execution')
        )
          offenders.push(entry.name);
      }
    };
    walk(dir);
    expect(offenders, 'flows must not depend on flow-execution').toEqual([]);
  });
});
