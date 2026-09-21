import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { checkSideEffect, summariseSideEffects } from '../../../../src/side-effects/index';
import { slotPrincipals, type CleanupCoordinator } from '../../../../src/test-data/index';

/**
 * Katchup side effects, measured as DELTAS on the recipient's own derived counts
 * (master plan §11).
 *
 * ## What this adds over the existing lifecycle
 *
 * `feature.spec.ts` proves a send is accepted and the message can be read back. Neither says the
 * consequence landed: a message can be correctly stored and correctly returned while the count the
 * recipient's client renders never moves. That is a real and common defect class, invisible to any
 * assertion about the message itself, and only a before/after comparison finds it.
 *
 * ## Why every assertion here is a delta
 *
 * These QA accounts are shared and never empty — the UI showed "21 Unopened Messages" while this was
 * being written. An absolute assertion would be false on the first run and would then be "fixed" by
 * loosening it to `toBeGreaterThan(0)`, which passes for any number and tests nothing. Measuring
 * before and after keeps the assertion EXACT and independent of whatever else is in the account.
 *
 * ## Why the recall step is here
 *
 * BR-K03: a recalled message leaves the recipient's view entirely. The lifecycle already proves the
 * message is gone. This proves the recipient's COUNT came back down with it — a stale count after a
 * recall means the recipient is told a message exists that they cannot open.
 *
 * ## Safety
 *
 * One message between two accounts the bench owns, registered with the ledger before any assertion
 * can fail. Gated behind `KATCHUP_LIFECYCLE`. Every call goes through the same `EndpointExecutor`, so
 * the production guard, the SMS/OTP kill-switch and the QA-identifier guard apply unchanged.
 */

const [A, B] = slotPrincipals(2) as [Principal, Principal];

/** The `data` rows of a response. Module scope: data-shaping, not test flow. */
function dataRows(exchange: {
  json(): { ok: boolean; value?: unknown };
}): Record<string, unknown>[] {
  const parsed = exchange.json();
  if (!parsed.ok) return [];
  const rows = (parsed.value as { data?: unknown }).data;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/**
 * The count `messageCountBetweenSenderAndReceiver` reports, or `undefined` when it could not be
 * read.
 *
 * MEASURED, not assumed. The count is a TOP-LEVEL `messageCount`, not the usual `data` payload:
 *
 *     {"messageCount":67,"urlPath":"messageCountBetweenSenderAndReceiver","status":"SUCCESS"}
 *
 * Reading `data` here returns nothing, which would have skipped this test forever while looking
 * like an environment problem.
 *
 * `undefined` rather than 0 on purpose: 0 is a measurement, and reporting an unreadable response as
 * an empty conversation is exactly the confusion `INDETERMINATE` exists to prevent.
 */
function countOf(exchange: { json(): { ok: boolean; value?: unknown } }): number | undefined {
  const parsed = exchange.json();
  if (!parsed.ok) return undefined;
  const count = (parsed.value as { messageCount?: unknown }).messageCount;
  return typeof count === 'number' && Number.isFinite(count) ? count : undefined;
}

test.describe('KPost Katchup · side effects on the recipient', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.KATCHUP_LIFECYCLE, 'writes a real message; set KATCHUP_LIFECYCLE=true');

  test("a send moves the recipient's message count by exactly one, and a recall moves it back (BR-K03) @api @katchup", async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    const subject = `QA sideeffect ${Date.now()}`;

    /** The recipient's own count of the conversation with A. Read as B, never as A. */
    const countAsRecipient = async (label: string): Promise<number | undefined> => {
      const read = await endpoints.sendTo(
        'katchup-message-count',
        { body: { receiver: A.username, groupFlag: 'false' } },
        { label, auth: { principal: B } },
      );
      return countOf(read);
    };

    const before = await countAsRecipient('side-effect:count-before');
    test.skip(
      before === undefined,
      'the recipient count could not be measured, so no delta exists to assert — inconclusive, not a failure',
    );

    // ---- the action ----------------------------------------------------------------------------
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      {
        body: sendShape({
          receiver: B.username,
          subject,
          actualMessage: 'QA bench side-effect probe — safe to ignore.',
        }),
      },
      { label: 'side-effect:send', auth: { principal: A }, allowLiveWrite: true },
    );
    const msgID = dataRows(sent)[0]?.msgID;
    expect(typeof msgID, `the send must issue a msgID (status ${String(sent.status)})`).toBe(
      'number',
    );

    resources.track({
      kind: 'katchup-message',
      id: String(msgID),
      describe: `side-effect probe "${subject}"`,
      cleanup: async () => {
        const deleted = await endpoints.sendTo(
          'katchup-delete-message',
          { body: { messageIds: [msgID], groupFlag: false } },
          {
            label: 'side-effect:cleanup',
            auth: { principal: A },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        return `deleted (${String(deleted.status)})`;
      },
    });

    const afterSend = await countAsRecipient('side-effect:count-after-send');

    // ---- the recall, and the count coming back down --------------------------------------------
    const recalled = await endpoints.sendTo(
      'katchup-recall-message',
      { body: { msgID, groupFlag: false } },
      { label: 'side-effect:recall', auth: { principal: A }, allowLiveWrite: true },
    );
    expect(
      recalled.status,
      `the recall must be accepted before its side effect can mean anything`,
    ).toBeLessThan(400);

    const afterRecall = await countAsRecipient('side-effect:count-after-recall');

    /*
     * The recipient's own LIST, read straight after the count, so the two can be compared.
     *
     * This is what makes the recall result interpretable. "The count did not move" alone is
     * ambiguous — a count that deliberately includes recalled tombstones would behave that way and
     * be correct. Asking the SAME actor for the list as well removes the ambiguity: whatever the
     * count is supposed to mean, it must agree with what that actor can actually open.
     */
    const recipientList = await endpoints.sendTo(
      'katchup-conversation',
      { body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: A.username } },
      { label: 'side-effect:list-after-recall', auth: { principal: B } },
    );
    const stillListed = dataRows(recipientList).some((row) => row.msgID === msgID);

    // ---- the comparisons -----------------------------------------------------------------------
    const arrived = checkSideEffect(
      { name: "recipient's message count, on send", before, after: afterSend },
      { delta: 1 },
    );
    const withdrawn = checkSideEffect(
      { name: "recipient's message count, on recall", before: afterSend, after: afterRecall },
      { delta: -1 },
    );
    await testInfo.attach('side-effects', {
      body: summariseSideEffects([arrived, withdrawn]).join('\n'),
      contentType: 'text/plain',
    });

    expect(
      arrived.outcome,
      `a message the API accepted must also be counted for its recipient. ${arrived.reason}`,
    ).not.toBe('NOT_OBSERVED');
    expect(
      stillListed,
      `BR-K03: a recalled message must leave the recipient's view entirely. msgID ${String(msgID)} ` +
        `is still in the recipient's own conversation read after the recall was accepted ` +
        `(status ${String(recalled.status)}).`,
    ).toBe(false);

    expect(
      withdrawn.outcome,
      `BR-K03: a recalled message leaves the recipient's view, so their count must come back down. ` +
        `The recipient's list ${stillListed ? 'still holds' : 'no longer holds'} this message, so a ` +
        `count that did not move ${stillListed ? 'agrees with the list but violates the recall rule' : 'DISAGREES with the list that same actor just read'}. ` +
        `A count that stays high tells the recipient a message exists that they cannot open. ` +
        `${withdrawn.reason}`,
    ).not.toBe('NOT_OBSERVED');
  });
});
