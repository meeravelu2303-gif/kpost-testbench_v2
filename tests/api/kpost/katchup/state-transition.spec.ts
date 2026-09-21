import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { observeExchange, type StateObservation } from '../../../../src/state-observation/index';
import { transition } from '../../../../src/states/index';
import { checkTransition, summariseChecks } from '../../../../src/state-transition/index';
import { slotPrincipals, type CleanupCoordinator } from '../../../../src/test-data/index';

/**
 * The Katchup read transition, validated (master plan §9).
 *
 *     the SENDER's view BEFORE  ──►  the RECIPIENT opens the conversation  ──►  the view AFTER
 *
 * ## Why this is not what any existing spec does
 *
 * `feature.spec.ts` reads the receipts endpoint back and asserts it answered. That is an endpoint
 * check. It cannot distinguish "the receipt appeared because the recipient read the message" from
 * "the receipt was already there", because it never looks before. The business rule
 * (BR-KU-RECEIPTS / FR-K07) is precisely about the CHANGE: a read time appears **only once that
 * recipient has actually read**, which needs a before, an action and an after.
 *
 * So this observes the sender's own view of the message twice, drives exactly one action between
 * them, and asks the Phase 7 checker whether the declared transition `katchup.message.read`
 * (`sent → read`, status 0 → 2) occurred.
 *
 * ## The conflict it exercises, and does not resolve
 *
 * The state model declares this transition's mechanism as **UI**: "no endpoint marks a 1:1 Katchup
 * message read; the web client marks a thread read as a side effect of opening the conversation."
 * The Phase 4D calibration then observed the API conversation read performing it, which is
 * `CONF-KATCHUP-READ-PERSPECTIVE` — recorded as unresolved in the state catalogue, in
 * `BR-KU-RECEIPTS` and in `BR-X01`.
 *
 * This spec drives the API read and RECORDS which way the evidence falls, as an annotation. It does
 * not rewrite the model: one more observation does not settle whether the API performing the
 * transition is the intended mechanism or an accident of the implementation, and that question is
 * the owner's.
 *
 * Gated behind `KATCHUP_LIFECYCLE`; one message, between two accounts the bench owns, registered
 * with the resource ledger the moment it exists.
 */

const [SENDER, RECIPIENT] = slotPrincipals(2) as [Principal, Principal];
const READ_TRANSITION = transition('katchup.message.read');

/** The sender's own view of their conversation with the recipient — the state under observation. */
async function observeSenderView(
  endpoints: EndpointExecutor,
  label: string,
): Promise<readonly StateObservation[]> {
  const exchange = await endpoints.sendTo(
    'katchup-conversation',
    { body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: RECIPIENT.username } },
    { label, auth: { principal: SENDER } },
  );
  return observeExchange(exchange, {
    observationId: 'katchup.message.lifecycle-via-conversation',
    label,
    actorId: 'sender#0',
  });
}

/** The msgID a send response created. Module scope: data-shaping, not test flow. */
function createdMessageId(exchange: { json(): { ok: boolean; value?: unknown } }): unknown {
  const parsed = exchange.json();
  if (!parsed.ok) return undefined;
  const rows = (parsed.value as { data?: unknown }).data;
  return Array.isArray(rows) ? (rows[0] as { msgID?: unknown } | undefined)?.msgID : undefined;
}

test.describe('KPost Katchup · read state transition', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    !env.KATCHUP_LIFECYCLE,
    'sends a real message between two QA accounts; set KATCHUP_LIFECYCLE=true',
  );

  test('the read receipt appears only after the recipient opens it (FR-K07) @api @katchup', async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    expect(READ_TRANSITION, 'the state model declares the read transition').toBeTruthy();

    // ---- the resource under test -----------------------------------------------------------
    const marker = `QA transition ${Date.now()}`;
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      {
        body: sendShape({
          receiver: RECIPIENT.username,
          subject: marker,
          actualMessage: 'QA bench read-transition probe — safe to ignore.',
        }),
      },
      { label: 'transition:send', auth: { principal: SENDER }, allowLiveWrite: true },
    );
    const msgID = createdMessageId(sent);
    expect(typeof msgID, `the send must yield a msgID (status ${String(sent.status)})`).toBe(
      'number',
    );
    const resourceId = String(msgID);

    resources.track({
      kind: 'katchup-message',
      id: resourceId,
      describe: `read-transition probe "${marker}"`,
      cleanup: async () => {
        const deleted = await endpoints.sendTo(
          'katchup-delete-message',
          { body: { messageIds: [msgID], groupFlag: false } },
          {
            label: 'transition:cleanup',
            auth: { principal: SENDER },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        return `deleted (${String(deleted.status)})`;
      },
    });

    // ---- BEFORE ------------------------------------------------------------------------------
    const before = await observeSenderView(endpoints, 'transition:before');

    /*
     * The precondition, asserted rather than assumed. If the message were already `read` before the
     * recipient touched it, the rest of this test would be meaningless — and the checker would say
     * INDETERMINATE rather than let it look like a pass.
     */
    const beforeCheck = checkTransition(READ_TRANSITION!, { resourceId, before, after: before });
    expect(
      beforeCheck.outcome,
      `a freshly sent message must not already be read: ${beforeCheck.reason}`,
    ).toBe('NOT_OCCURRED');

    // ---- the ACTION: the RECIPIENT opens the conversation -------------------------------------
    const opened = await endpoints.sendTo(
      'katchup-conversation',
      { body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: SENDER.username } },
      { label: 'transition:recipient-opens', auth: { principal: RECIPIENT } },
    );
    expect(opened.status, 'the recipient can open the conversation').toBeLessThan(300);

    // ---- AFTER -------------------------------------------------------------------------------
    const after = await observeSenderView(endpoints, 'transition:after');
    const check = checkTransition(READ_TRANSITION!, { resourceId, before, after });

    await testInfo.attach('transition', {
      body: [
        ...summariseChecks([check]),
        '',
        `declared mechanism: ${READ_TRANSITION!.mechanism}`,
        `mechanism driven here: API (${'katchup-conversation'})`,
        READ_TRANSITION!.unavailableReason ?? '',
      ].join('\n'),
      contentType: 'text/plain',
    });

    /*
     * CONF-KATCHUP-READ-PERSPECTIVE, recorded rather than resolved. Whichever way the evidence
     * falls, it is a fact about the API read — not a decision about what the mechanism SHOULD be.
     */
    testInfo.annotations.push({
      type: 'conflict',
      description:
        `CONF-KATCHUP-READ-PERSPECTIVE — the model declares mechanism ${READ_TRANSITION!.mechanism}; ` +
        `driving the API conversation read produced ${check.outcome}. ` +
        (check.outcome === 'OCCURRED'
          ? 'The API read performs the transition, contradicting the declared UI-only mechanism.'
          : 'The API read did NOT perform it, which is consistent with the declared UI mechanism.'),
    });

    /*
     * The business assertion (BR-KU-RECEIPTS / FR-K07): once the recipient has opened the message,
     * the sender's view must show it read. INDETERMINATE fails here too, and deliberately — it means
     * the bench could not observe the change, which is not evidence that receipts work.
     */
    expect(
      check.outcome,
      `after the recipient opened it, the sender's view must show the message read: ${check.reason}`,
    ).toBe('OCCURRED');
  });
});
