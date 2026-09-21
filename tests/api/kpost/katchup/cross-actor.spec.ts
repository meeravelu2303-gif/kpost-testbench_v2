import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { KATCHUP_MESSAGE_TYPE } from '@api/schemas/kpost-types';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import type { ActorRoleId } from '../../../../src/actors/index';
import { describeViews, observeAs, rowsOf, type ActorView } from '../../support/cross-actor';
import { slotPrincipals, type CleanupCoordinator } from '../../../../src/test-data/index';

/**
 * Katchup confidential copies, observed through EACH actor's own session (master plan §10,
 * requirements 1 and 2).
 *
 * ## What the existing security test cannot say
 *
 * `feature.spec.ts` sends a copies message and asserts that the other recipients' views do not
 * contain the confidential recipient's address. That is half a security test. Absence of a leak is
 * trivially satisfied by a message that was never delivered to anyone — so without also proving
 * DELIVERY, "the confidential recipient is hidden" and "the confidential recipient got nothing" are
 * indistinguishable, and the weaker one passes.
 *
 * This asserts both halves, from each actor's own session:
 *
 *     sender                       A   sent it
 *     recipient (TO)               B   RECEIVES it, and cannot see that C was copied
 *     confidential-copy recipient  C   RECEIVES it
 *
 * Delivery is asserted on the documented `msgID`, never on a shared subject: several accounts
 * holding "the same subject" proves nothing about which message each of them actually has.
 *
 * ## What is checked, and against what
 *
 * `sharedMessageDetails` is the field the client uses to carry the copy lists —
 * `revealContactList` for visible copies, `hiddenContactList` for confidential ones
 * (`KatchupMessage.js`). It is the documented place a copy recipient could be named, so it is
 * checked directly, and then EVERY field of that actor's own row is checked too, because a leak
 * through another field would be just as real. Both checks are scoped to the row for this
 * `sharedMessageId`: a conversation response carries the whole thread, so a body-wide check reports
 * earlier messages as leaks — which it did, on the first run. No field name is invented: every one
 * appears in the live send response.
 *
 * ## The visible-Copy increment, and why it is not here
 *
 * Distinguishing a VISIBLE copy from a confidential one needs a fourth session account, and only
 * four of the six configured accounts authenticate — `personal-4` and `personal-6` answer
 * `Invalid Credential`, because the bench uses one `QA_PASSWORD` and those two do not share it.
 * Slot 0's fourth position is `personal-4`, so a four-actor flow cannot run today. That is an
 * account configuration gap, recorded in the progress file with its remediation — and not a reason
 * to leave the three-actor rule unproven.
 *
 * Gated behind `KATCHUP_LIFECYCLE`; the message is registered with the resource ledger the moment it
 * exists.
 */

const [A, B, C] = slotPrincipals(3) as [Principal, Principal, Principal];

/** The conversation between an actor and the sender, as that actor sees it. */
async function conversationWithSender(
  endpoints: EndpointExecutor,
  role: ActorRoleId,
  as: Principal,
  label: string,
): Promise<ActorView> {
  return observeAs(endpoints, {
    role,
    as,
    endpointId: 'katchup-conversation',
    body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: A.username },
    label,
    observationId: 'katchup.message.lifecycle-via-conversation',
  });
}

/**
 * The row an actor holds for a shared message.
 *
 * A copies message creates ONE ROW PER RECIPIENT, each with its own `msgID` — measured on live:
 * the sender's response carried 811492 while the confidential recipient's own view carried 811491.
 * The identity that links them is `sharedMessageId`, which was byte-identical across the sender's
 * row, the TO recipient's row and the confidential recipient's row.
 *
 * So delivery is correlated on `sharedMessageId`, never on `msgID` (which differs per recipient and
 * would report a false absence) and never on the subject (which proves only that some message with
 * that text exists, not that it is THIS one).
 */
function rowFor(view: ActorView, sharedMessageId: unknown): Record<string, unknown> | undefined {
  return rowsOf(view.body).find((row) => row.sharedMessageId === sharedMessageId);
}

/** The `hiddenContactList` an actor's own row carries — the documented confidential-copy list. */
function hiddenContactList(row: Record<string, unknown> | undefined): unknown[] {
  const details = row?.sharedMessageDetails;
  if (typeof details !== 'string') return [];
  try {
    const parsed = JSON.parse(details) as { hiddenContactList?: unknown };
    return Array.isArray(parsed.hiddenContactList) ? parsed.hiddenContactList : [];
  } catch {
    // An unparseable value is not evidence of anything; the raw-text check below still applies.
    return [];
  }
}

test.describe('KPost Katchup · cross-actor confidential copy', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    !env.KATCHUP_LIFECYCLE,
    'sends a real copies message between three QA accounts; set KATCHUP_LIFECYCLE=true',
  );

  test('a Confidential Copy is DELIVERED to its recipient and HIDDEN from the others (FR-K05 / NFR-SEC02) @api @katchup @security', async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    const marker = `QA confidential ${Date.now()}`;

    /*
     * The copies shape as the client builds it: `hiddenContactList` is the Confidential Copy and
     * `forwardReceiverList` carries everyone. Built from the endpoint definition's own `sendShape`
     * factory, so no payload is invented and no contract duplicated.
     */
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      {
        body: sendShape({
          receiver: B.username,
          messageType: KATCHUP_MESSAGE_TYPE.copiesMessage,
          sharedType: KATCHUP_MESSAGE_TYPE.normalMessage,
          subject: marker,
          actualMessage: `QA bench cross-actor probe ${marker} — safe to ignore.`,
          forwardReceiverList: [C.username, B.username],
          sharedMessageDetails: JSON.stringify({
            revealContactList: [],
            hiddenContactList: [C.username],
            receiver: B.username,
            receiverName: 'QA Bench',
            shareType: KATCHUP_MESSAGE_TYPE.normalMessage,
          }),
        }),
      },
      { label: 'cross-actor:send-confidential', auth: { principal: A }, allowLiveWrite: true },
    );

    const parsed = sent.json();
    const created = rowsOf((parsed.ok ? parsed.value : {}) as Record<string, unknown>)[0];
    const msgID = created?.msgID;
    const sharedMessageId = created?.sharedMessageId;
    expect(
      typeof msgID,
      `the copies message must be accepted and issue a msgID (status ${String(sent.status)})`,
    ).toBe('number');
    expect(
      typeof sharedMessageId,
      'a copies message must carry a sharedMessageId — it is the only identity that links the ' +
        'per-recipient rows, and without it delivery cannot be correlated at all',
    ).toBe('number');

    resources.track({
      kind: 'katchup-message',
      id: String(msgID),
      describe: `cross-actor confidential-copy probe "${marker}"`,
      cleanup: async () => {
        const deleted = await endpoints.sendTo(
          'katchup-delete-message',
          { body: { messageIds: [msgID], groupFlag: false } },
          {
            label: 'cross-actor:cleanup',
            auth: { principal: A },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        return `deleted (${String(deleted.status)})`;
      },
    });

    // ---- each actor observes, in their OWN session --------------------------------------------
    const recipient = await conversationWithSender(endpoints, 'recipient', B, 'cross-actor:to');
    const confidential = await conversationWithSender(
      endpoints,
      'confidential-copy-recipient',
      C,
      'cross-actor:confidential',
    );
    await testInfo.attach('actor-views', {
      body: describeViews([recipient, confidential]).join('\n'),
      contentType: 'text/plain',
    });

    // ---- DELIVERY: the half no existing test asserts -------------------------------------------
    const recipientRow = rowFor(recipient, sharedMessageId);
    const confidentialRow = rowFor(confidential, sharedMessageId);

    expect(
      recipientRow,
      `the TO recipient must hold a row for sharedMessageId ${String(sharedMessageId)}`,
    ).toBeTruthy();
    expect(
      confidentialRow,
      `the Confidential Copy recipient must hold a row for sharedMessageId ${String(sharedMessageId)} ` +
        '— concealment is meaningless if the message never reached them, and "hidden" and "never ' +
        'delivered" are indistinguishable without this assertion',
    ).toBeTruthy();

    // ---- CONCEALMENT: the TO recipient may not learn who was confidentially copied --------------
    expect(
      hiddenContactList(recipientRow),
      'the TO recipient’s own row must carry an EMPTY hiddenContactList — the confidential ' +
        'recipient is stripped from their copy of the metadata (NFR-SEC02)',
    ).toEqual([]);
    /*
     * The same check across every field of THIS message's row, so a leak through some other field
     * is caught too. Scoped to the row rather than the whole response on purpose: a conversation
     * carries the entire thread, so a body-wide check also sees earlier messages — and it failed on
     * exactly that, matching a previous probe's row rather than anything this send leaked.
     */
    expect(
      JSON.stringify(recipientRow),
      'no field of the TO recipient’s own row may name the confidential recipient (NFR-SEC02)',
    ).not.toContain(C.username);

    /*
     * And the concealment is SELECTIVE, not blanket: the confidential recipient's own row does name
     * them. Without this, a product that simply dropped the list for everyone would pass the check
     * above while telling the confidential recipient nothing about their own status.
     */
    expect(
      hiddenContactList(confidentialRow).map(String),
      'the confidential recipient’s own row names them — the list is filtered per actor, not emptied',
    ).toContain(C.username);
  });
});
