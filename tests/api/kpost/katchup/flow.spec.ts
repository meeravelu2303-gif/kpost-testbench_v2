import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { AUTH_PROFILES } from '@config/auth-profile';
import { env } from '@config/env';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { ProductionSafetyError } from '@engine/production-guard';
import { expect, test } from '@fixtures';
import {
  FlowExecutionEngine,
  StepActionRegistry,
  produced,
  summarise,
  type StepActionContext,
} from '../../../../src/flow-execution/index';
import { KATCHUP_MESSAGE_1TO1_FLOW, MESSAGE_ID, MESSAGE_MARKER } from '../../../../src/flows/index';
import { currentSlot, type CleanupCoordinator } from '../../../../src/test-data/index';

/**
 * The Katchup 1-to-1 message flow, **executed** (master plan §8, §13).
 *
 * ## What this adds that the existing specs do not
 *
 * `lifecycle.spec.ts` and `feature.spec.ts` are untouched and still run: they verify the ENDPOINTS —
 * that a send is accepted, that a recall is accepted, that a subject comes back. This verifies the
 * APPLICATION BEHAVIOUR the endpoints are supposed to add up to, and it does so through the actor
 * relationship that makes the behaviour meaningful:
 *
 *     the SENDER sends  →  the RECIPIENT, in their own session, sees that exact message
 *
 * A send returning 200 is not that. Only the recipient's own read can say whether the message
 * arrived, and the flow model is what forces the question to be asked from their side.
 *
 * ## How it stays out of the endpoint layer's way
 *
 * The adapters below build no contract of their own. The send payload comes from `sendShape`, the
 * endpoint definition's own exported factory — the same one `lifecycle.spec.ts` uses — and every
 * request goes through the injected `EndpointExecutor`, so the production guard, the SMS/OTP
 * kill-switch, the QA-identifier guard and the evidence capture all apply unchanged. Nothing here
 * constructs a second executor, a second account pool or a second cleanup mechanism.
 *
 * ## Safety
 *
 * It sends one real message between two accounts the bench owns, so it is gated behind
 * `KATCHUP_LIFECYCLE` exactly as the existing lifecycle is, and registers the message with the
 * resource ledger the moment it exists so the cleanup fixture deletes it whatever the outcome.
 */

type Executor = EndpointExecutor;
type Resources = CleanupCoordinator;
type Context = StepActionContext<Executor, Resources>;

/** The accounts this run's two roles play. Slot 0 resolves to the pair the specs have always used. */
const [SENDER, RECIPIENT] = currentSlot().principals(2) as [Principal, Principal];

/** The principal bound to the step's actor — the whole point of resolving an actor at all. */
function principalOf(context: Context): Principal {
  const binding = context.run.actors.binding(context.actor.role, context.actor.instance);
  if (!binding) {
    throw new Error(
      `actor "${context.actor.actorId}" has no account binding. Bind it in the engine's ` +
        '`prepare` hook — the execution layer never chooses an account by itself.',
    );
  }
  return binding.account.principal;
}

function jsonOf(exchange: { json(): { ok: boolean; value?: unknown } }): Record<string, unknown> {
  const parsed = exchange.json();
  return parsed.ok ? (parsed.value as Record<string, unknown>) : {};
}

function rowsOf(body: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
}

function actions(): StepActionRegistry<Executor, Resources> {
  return new StepActionRegistry<Executor, Resources>().register(
    {
      action: 'auth.login',
      channel: 'API',
      describe: 'mints a session for the step’s actor through the existing TokenProvider',
      run: async (context) => {
        /*
         * Authentication is a real step, not a setup detail: if the recipient cannot log in, the
         * flow cannot say anything about what the recipient sees.
         *
         * It goes through the executor's OWN cached  rather than driving the login
         * endpoint directly. That matters on this product: an account allows one active session, so
         * a second login would displace the very session the later steps depend on. Asking the
         * provider mints the session the flow will actually use, or reuses one it already has. No
         * credential is handled here and none is returned — only whether a session exists.
         */
        const principal = principalOf(context);
        const token = await context.endpoints.tokens.tokenFor(principal, AUTH_PROFILES.kpost);
        return token
          ? { outcome: 'PASSED' }
          : { outcome: 'FAILED', failure: `no session could be minted for ${principal.key}` };
      },
    },
    {
      action: 'katchup.send-message',
      channel: 'API',
      describe: 'sends a 1:1 message using the endpoint definition’s own sendShape factory',
      run: async (context) => {
        const marker = `QA flow ${Date.now()}`;
        const exchange = await context.endpoints.sendTo(
          'katchup-send-message',
          {
            body: sendShape({
              receiver: RECIPIENT.username,
              subject: marker,
              actualMessage: 'QA bench flow execution — safe to ignore.',
            }),
          },
          {
            label: 'flow:send-message',
            auth: { principal: principalOf(context) },
            allowLiveWrite: true,
          },
        );
        const created = rowsOf(jsonOf(exchange))[0];
        const msgID = created?.msgID;
        if (exchange.status >= 300 || typeof msgID !== 'number') {
          return {
            outcome: 'FAILED',
            failure: `the send did not yield a msgID (status ${String(exchange.status)})`,
            correlationIds: [exchange.correlationId],
          };
        }

        /*
         * Registered the statement after it exists, which is the smallest window the ledger allows.
         * `cleanup` is the same delete the migrated lifecycle uses — plural `messageIds`, the field
         * the live client sends, permitted by the guard because the ledger owns this id.
         */
        context.resources.track({
          kind: 'katchup-message',
          id: String(msgID),
          describe: `flow-sent message "${marker}"`,
          cleanup: async () => {
            const deleted = await context.endpoints.sendTo(
              'katchup-delete-message',
              { body: { messageIds: [msgID], groupFlag: false } },
              {
                label: 'flow:cleanup-delete',
                auth: { principal: SENDER },
                allowLiveWrite: true,
                phase: 'cleanup',
              },
            );
            return `deleted (${String(deleted.status)})`;
          },
        });

        return {
          outcome: 'PASSED',
          produces: [produced(MESSAGE_ID, msgID), produced(MESSAGE_MARKER, marker)],
          correlationIds: [exchange.correlationId],
        };
      },
    },
    {
      action: 'katchup.read-conversation',
      channel: 'API',
      describe:
        'reads the conversation AS THE STEP’S ACTOR, so visibility is observed from their side',
      run: async (context) => {
        const msgID = context.run.require(MESSAGE_ID);
        const exchange = await context.endpoints.sendTo(
          'katchup-conversation',
          {
            body: {
              groupFlag: false,
              firstMsgID: null,
              lastMsgID: null,
              receiver: SENDER.username,
            },
          },
          { label: 'flow:recipient-observes', auth: { principal: principalOf(context) } },
        );
        const present = rowsOf(jsonOf(exchange)).some((row) => row.msgID === msgID);
        return present
          ? { outcome: 'PASSED', correlationIds: [exchange.correlationId] }
          : {
              outcome: 'FAILED',
              failure:
                `the recipient's own conversation does not contain msgID ${String(msgID)} ` +
                `(status ${String(exchange.status)}). The sender was told the send succeeded.`,
              correlationIds: [exchange.correlationId],
            };
      },
    },
  );
}

test.describe('KPost Katchup · flow execution', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    !env.KATCHUP_LIFECYCLE,
    'sends a real message between two QA accounts; set KATCHUP_LIFECYCLE=true',
  );

  test('the sender sends and the recipient sees it, in their own session (FR-KU-003) @api @katchup', async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    const engine = new FlowExecutionEngine<Executor, Resources>({
      actions: actions(),
      endpoints,
      resources,
      channel: 'API',
      // A refusal by a safety control means nothing was sent — never a defect. Recognising it is
      // injected so the execution layer never imports the validation engine to find out.
      isSafetyRefusal: (error) => error instanceof ProductionSafetyError,
      prepare: (run) => {
        run.actors.bindAccount('sender', currentSlot().sessions[0]!);
        run.actors.bindAccount('recipient', currentSlot().sessions[1]!);
      },
    });

    const result = await engine.execute(KATCHUP_MESSAGE_1TO1_FLOW);
    await testInfo.attach('flow', {
      body: summarise(result).join('\n'),
      contentType: 'text/plain',
    });

    const status = (stepId: string): string =>
      result.steps.find((step) => step.stepId === stepId)?.status ?? 'MISSING';
    const reason = (stepId: string): string =>
      result.steps.find((step) => step.stepId === stepId)?.reason ?? '';

    expect(status('authenticate-sender'), `sender login: ${reason('authenticate-sender')}`).toBe(
      'PASSED',
    );
    expect(
      status('authenticate-recipient'),
      `recipient login: ${reason('authenticate-recipient')}`,
    ).toBe('PASSED');
    expect(status('send-message'), `send: ${reason('send-message')}`).toBe('PASSED');

    /*
     * The business assertion, and the reason this spec exists: the RECIPIENT'S OWN read contains the
     * message. If the send step failed, this step is BLOCKED rather than falsely passing — the
     * message below says which, so a blocked result can never be mistaken for a verified one.
     */
    expect(
      status('recipient-observes-message'),
      `the recipient must see the message the sender sent: ${reason('recipient-observes-message')}`,
    ).toBe('PASSED');

    // The two steps KPOST has no call for stay SKIPPED with the definition's own reason (FR-K07).
    expect(status('recipient-reads-message')).toBe('SKIPPED');
    expect(status('sender-observes-read-receipt')).toBe('SKIPPED');
  });
});
