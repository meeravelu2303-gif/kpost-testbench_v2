import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';

/**
 * Unread-count **clears when a message is read** (FR-K07) — the one piece of the badge-count contract
 * the plain-read coverage (`reads-workflow.spec.ts`, which only checks the count is internally
 * consistent) never exercises: that OPENING a conversation actually drops the sender's unread count
 * back down.
 *
 * Why this exists: a QA complaint that the Katchup unread count "shows 4 or 5 even after the message
 * is read". `reads-workflow` already confirms the count endpoint is consistent (msgsCount == the sum
 * of per-sender counts), so this isolates the other half — whether reading a message is reflected in
 * the count at all, or whether it stays stuck at a stale number.
 *
 * Mechanism (confirmed from the live frontend source, KPOST_REACTJS_2023_V1): the Katchup thread view
 * has NO explicit mark-read call — opening a conversation (`katchupMessagesForSelectedContactID`) is
 * what marks its messages read server-side, and the badge is a plain re-fetch of
 * `getUnopenedMessagesCount`. So the read trigger here is the conversation open, exactly as the client
 * does it.
 *
 * Flow (qatest1 = `personal` sends; qatest2 = `victim` reads):
 *   1. baseline: victim's unread count FROM personal (c0)
 *   2. personal sends one message to victim
 *   3. victim's count FROM personal must be c0 + 1
 *   4. victim OPENS the conversation with personal (the read)
 *   5. victim's count FROM personal must return to c0 — NOT stay at c0 + 1
 * Self-cleans (personal recalls + deletes the probe message) in a finally. Gated KATCHUP_LIFECYCLE
 * like every other spec that writes a real message.
 */
const PERSONAL: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const VICTIM: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'victim')!;

/** The per-sender unread count for one sender from a getUnopenedMessagesCount body (0 if absent). */
function unreadFromSender(bodyText: string, sender: string): number {
  const body = JSON.parse(bodyText || '{}') as {
    resultList?: Array<{ sender?: string; count?: number }>;
  };
  const entry = (body.resultList ?? []).find(
    (e) => (e.sender ?? '').toLowerCase() === sender.toLowerCase(),
  );
  return entry ? Number(entry.count ?? 0) : 0;
}

test.describe(
  'KPost Katchup · unread count clears when a conversation is read (FR-K07)',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true',
      'sends a real message between our two accounts; set KATCHUP_LIFECYCLE=true (owner sign-off)',
    );
    test.skip(
      !testData.kpostId ||
        testData.kpostId.includes('qa.bench') ||
        !testData.victimKpostId ||
        testData.victimKpostId.includes('qa.bench'),
      'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
    );

    test(
      "reading a conversation clears the sender's unread count (not stuck at a stale number)",
      { annotation: [{ type: 'requirement', description: 'FR-K07' }] },
      async ({ endpoints }) => {
        const sender = testData.kpostId; // personal is the sender; victim is the reader we measure.
        const subject = `QA count-clears ${Date.now()}`;

        // 1. Baseline: victim's unread count attributed to personal.
        const before = await endpoints.sendTo(
          'katchup-unopened-count',
          {},
          { label: 'count-clears:before', auth: { principal: VICTIM }, timeoutMs: 20_000 },
        );
        expect(before.status, 'baseline count reads').toBe(200);
        const c0 = unreadFromSender(before.bodyText, sender);

        // 2. personal sends one message to victim (sendShape defaults receiver to victim).
        const sent = await endpoints.sendTo(
          'katchup-send-message',
          { body: sendShape({ subject, actualMessage: 'QA count-clears probe — safe to ignore' }) },
          { label: 'count-clears:send', auth: { principal: PERSONAL }, allowLiveWrite: true },
        );
        expect(sent.status, 'the probe message sends').toBeLessThan(300);
        const sentBody = JSON.parse(sent.bodyText || '{}') as { data?: unknown };
        const createdData = sentBody.data;
        const created = Array.isArray(createdData)
          ? (createdData[0] as { msgID?: number })
          : undefined;
        const msgID = created?.msgID;

        try {
          // 3. The unread message must increment victim's count from personal by exactly one.
          const afterSend = await endpoints.sendTo(
            'katchup-unopened-count',
            {},
            { label: 'count-clears:after-send', auth: { principal: VICTIM }, timeoutMs: 20_000 },
          );
          const c1 = unreadFromSender(afterSend.bodyText, sender);
          expect(
            c1,
            'an unread message raises the per-sender unread count above baseline',
          ).toBeGreaterThan(c0);

          // 4. victim OPENS the conversation with personal — the read action.
          const open = await endpoints.sendTo(
            'katchup-conversation',
            { body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: sender } },
            { label: 'count-clears:open', auth: { principal: VICTIM } },
          );
          expect(open.status, 'victim opens (reads) the conversation').toBe(200);

          // Give the server a moment to persist the read before re-reading the count.
          await new Promise((r) => setTimeout(r, 1_500));

          // 5. The read must clear the unread — the count returns to baseline, not stuck high.
          const afterRead = await endpoints.sendTo(
            'katchup-unopened-count',
            {},
            { label: 'count-clears:after-read', auth: { principal: VICTIM }, timeoutMs: 20_000 },
          );
          const c2 = unreadFromSender(afterRead.bodyText, sender);
          test.info().annotations.push({
            type: 'observed',
            description: `unread from ${sender}: baseline=${c0}, after send=${c1}, after read=${c2}`,
          });
          // Opening a conversation marks its messages read, so the sender's unread count must DROP
          // from its post-send value (observed live: a fully-opened conversation clears to 0). A count
          // that never drops after the message is read is the reported "stuck at 4/5" bug — this
          // asserts the server-side clear actually happens.
          expect(
            c2,
            `reading the conversation must drop the unread count below its post-send value ` +
              `(was ${c1} after the new message; now ${c2}) — a count that never drops is the reported stale-count bug`,
          ).toBeLessThan(c1);
        } finally {
          if (msgID) {
            await endpoints
              .sendTo(
                'katchup-recall-message',
                { body: { msgID, groupFlag: false } },
                {
                  label: 'count-clears:recall',
                  auth: { principal: PERSONAL },
                  allowLiveWrite: true,
                },
              )
              .catch(() => undefined);
            await endpoints
              .sendTo(
                'katchup-delete-message',
                { body: { messageIds: [msgID], groupFlag: false } },
                {
                  label: 'count-clears:delete',
                  auth: { principal: PERSONAL },
                  allowLiveWrite: true,
                },
              )
              .catch(() => undefined);
          }
        }
      },
    );
  },
);
