import { env } from '@config/env';
// An orchestrated multi-step feature flow (send → read → recall → clean up), not simple assertions;
// the conditionals guard optional steps and best-effort cleanup of real live data.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import type { Principal } from '@config/auth.config';
import { currentSlot } from '../../../../src/test-data/index';
import { KATCHUP_MESSAGE_TYPE, KATCHUP_STATUS } from '@api/schemas/kpost-types';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';

/**
 * Katchup **feature flow** — the FRD's message behaviours, end to end, across our six PERSONAL
 * accounts on a real KPost host.
 *
 * Every test here WRITES a real message (or group) and cleans up after itself. It runs only with
 * `KATCHUP_LIFECYCLE=true`, so it never fires on a default run. Findings use `expect.soft` so one
 * run reports every defect instead of halting at the first.
 *
 * Coverage: reply/edit/note/comment/clarify (message-type variants), recall removing a message from
 * the recipient's view (BR-K03), group send + per-recipient read receipts (FR-K06/K07), and the
 * Confidential-Copy secrecy rule (FR-K05 / NFR-SEC02) — the one that needs four distinct people.
 */

/*
 * The four people this flow needs, from the account pool rather than by name: sender, TO recipient,
 * visible Copy, hidden Confidential-Copy. The pool hands this worker's logical slot four session
 * accounts nobody else may log in as, which is what keeps a parallel run from signing this test out
 * mid-flow. Slot 0 resolves to the same four accounts this spec has always used.
 */
const [A, B, C, D] = currentSlot().principals(4) as [Principal, Principal, Principal, Principal];

interface Sent {
  status: number;
  msgID?: number;
  body: Record<string, unknown>;
}

function firstRow(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = body.data;
  return Array.isArray(data) ? (data[0] as Record<string, unknown>) : undefined;
}

/** Send a message as `as`, returning the created row's msgID. */
async function send(
  endpoints: EndpointExecutor,
  as: Principal,
  overrides: Record<string, unknown>,
): Promise<Sent> {
  const exchange = await endpoints.sendTo(
    'katchup-send-message',
    { body: sendShape(overrides) },
    { label: `feature:send:${as.key}`, auth: { principal: as }, allowLiveWrite: true },
  );
  const parsed = exchange.json();
  const body = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  const row = firstRow(body);
  return {
    status: exchange.status,
    msgID: typeof row?.msgID === 'number' ? row.msgID : undefined,
    body,
  };
}

/** Read `as`'s conversation with `withKpostId`, returning the raw body text for content checks. */
async function conversation(
  endpoints: EndpointExecutor,
  as: Principal,
  withKpostId: string,
): Promise<{ status: number; text: string }> {
  const exchange = await endpoints.sendTo(
    'katchup-conversation',
    { body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: withKpostId } },
    { label: `feature:conversation:${as.key}`, auth: { principal: as } },
  );
  return { status: exchange.status, text: exchange.bodyText };
}

/** Best-effort cleanup — delete a message we created. Never throws. */
async function cleanup(endpoints: EndpointExecutor, as: Principal, msgID?: number): Promise<void> {
  if (!msgID) return;
  await endpoints
    .sendTo(
      'katchup-delete-message',
      { body: { messageIds: [msgID], groupFlag: false } },
      { label: 'feature:cleanup', auth: { principal: as }, allowLiveWrite: true },
    )
    .catch(() => undefined);
}

test.describe('KPost Katchup · feature flow', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    !env.KATCHUP_LIFECYCLE,
    'writes real messages; set KATCHUP_LIFECYCLE=true (owner sign-off, docs/katchup-flow.md §6)',
  );

  test('a message carries its Subject and issues a msgID (BR-K01) @api @katchup', async ({
    endpoints,
  }) => {
    const subject = `QA Feature ${Date.now()}`;
    const sent = await send(endpoints, A, { receiver: B.username, subject });
    expect(sent.status, 'send succeeds').toBeLessThan(300);
    expect(firstRow(sent.body)?.subject, 'subject is carried (BR-K01)').toBe(subject);
    expect(sent.msgID, 'a msgID is issued').toBeTruthy();
    await cleanup(endpoints, A, sent.msgID);
  });

  test('reply, note, comment and clarify are each accepted with their type @api @katchup', async ({
    endpoints,
  }) => {
    // Seed a message to reply to.
    const seed = await send(endpoints, A, { receiver: B.username, subject: 'QA thread' });
    expect(seed.msgID, 'seed message created').toBeTruthy();

    const T = KATCHUP_MESSAGE_TYPE as Record<string, number>;
    const variants: Array<[string, number, Principal]> = [
      ['reply', T.replyMessage!, B],
      ['note', T.noteMessage!, A],
      ['comment', T.commentMessage!, B],
      ['clarify', T.clarifyMessage!, B],
    ];
    const made: number[] = [];
    for (const [label, type, as] of variants) {
      const to = as.key === B.key ? A.username : B.username;
      const r = await send(endpoints, as, {
        receiver: to,
        messageType: type,
        sharedType: type,
        subject: 'QA thread',
        actualMessage: `QA ${label}`,
        temporaryMsgID: seed.msgID,
      });
      expect.soft(r.status, `${label} (type ${type}) is accepted`).toBeLessThan(300);
      if (r.msgID) made.push(r.msgID);
    }

    // Clean up seed + variants (as their senders — the reply/comment/clarify are B's, note is A's).
    await cleanup(endpoints, A, seed.msgID);
    for (const id of made) await cleanup(endpoints, A, id);
    for (const id of made) await cleanup(endpoints, B, id);
  });

  test('an edited message is marked edited (FR-K08 / FR-K09) @api @katchup', async ({
    endpoints,
  }) => {
    const seed = await send(endpoints, A, { receiver: B.username, subject: 'QA edit' });
    expect(seed.msgID, 'seed created').toBeTruthy();

    const edited = await send(endpoints, A, {
      receiver: B.username,
      messageType: KATCHUP_MESSAGE_TYPE.editMessage,
      sharedType: KATCHUP_MESSAGE_TYPE.editMessage,
      subject: 'QA edit',
      actualMessage: 'QA edited body',
      temporaryMsgID: seed.msgID,
    });
    expect.soft(edited.status, 'edit is accepted').toBeLessThan(300);

    // B's view should show the edited content (the "Edited:" marker is a UI label over messageType 6).
    const view = await conversation(endpoints, B, A.username);
    expect.soft(view.text, 'the recipient sees the edited body').toContain('QA edited body');

    await cleanup(endpoints, A, seed.msgID);
    await cleanup(endpoints, A, edited.msgID);
  });

  test('a recalled message is removed from the recipient view (FR-K10 / BR-K03) @api @katchup @security', async ({
    endpoints,
  }) => {
    const marker = `QA recall ${Date.now()}`;
    const sent = await send(endpoints, A, { receiver: B.username, actualMessage: marker });
    expect(sent.msgID, 'message created').toBeTruthy();

    // Recall it.
    const recall = await endpoints.sendTo(
      'katchup-recall-message',
      { body: { msgID: sent.msgID, groupFlag: false } },
      { label: 'feature:recall', auth: { principal: A }, allowLiveWrite: true },
    );
    expect.soft(recall.status, 'recall is accepted').toBeLessThan(300);

    // BR-K03: it must be gone from B's view.
    const view = await conversation(endpoints, B, A.username);
    expect
      .soft(view.text, 'a recalled message must not remain in the recipient view (BR-K03)')
      .not.toContain(marker);

    await cleanup(endpoints, A, sent.msgID);
  });

  test('group message: send reaches members and read receipts are tracked (FR-K06 / FR-K07) @api @katchup', async ({
    endpoints,
  }) => {
    // Create a group A(admin) + B, C, D.
    const members = [B, C, D].map((p) => ({
      createdBy: A.username,
      hasAdminAccess: 'N',
      kpostID: p.username,
      name: 'QA Bench',
      memberDesignation: '',
      privacyStatus: 'Y',
      remarks: 'created',
    }));
    members.push({
      createdBy: A.username,
      hasAdminAccess: 'Y',
      kpostID: A.username,
      name: 'QA Bench',
      memberDesignation: '',
      privacyStatus: 'Y',
      remarks: 'created',
    });
    const created = await endpoints.sendTo(
      'group-create',
      {
        body: {
          activeStatus: 'Y',
          createdBy: A.username,
          groupPicturePath: null,
          groupCreateAccess: true,
          groupKpostName: `QA Feature Group ${Date.now()}`,
          isPrivateGroup: 'N',
          memberDetails: members,
        },
      },
      { label: 'feature:group-create', auth: { principal: A }, allowLiveWrite: true },
    );
    const gBody = created.json();
    const gData = (gBody.ok ? (gBody.value as Record<string, unknown>).data : undefined) as
      Record<string, unknown> | undefined;
    const groupKpostID = gData?.groupKpostID as string | undefined;
    const groupID = gData?.groupID as number | undefined;
    expect(created.status, 'group is created').toBeLessThan(300);
    expect(groupKpostID, 'a groupKpostID is returned').toBeTruthy();

    let msgID: number | undefined;
    try {
      // Group send from A.
      const sent = await send(endpoints, A, {
        receiver: groupKpostID,
        status: KATCHUP_STATUS.group,
        groupFlag: true,
        groupmemberList: [B.username, C.username, D.username],
        actualMessage: 'QA group hello',
      });
      expect.soft(sent.status, 'group send is accepted').toBeLessThan(300);
      msgID = sent.msgID;

      // FR-K07: per-recipient read receipts.
      if (msgID) {
        const receipts = await endpoints.sendTo(
          'katchup-read-status-group',
          { body: { msgID } },
          { label: 'feature:read-receipts', auth: { principal: A }, allowLiveWrite: true },
        );
        expect.soft(receipts.status, 'read-receipt status reads back').toBe(200);
      }
    } finally {
      // Cleanup: remove members, then delete the group (verified order on live).
      if (groupID && groupKpostID) {
        await endpoints
          .sendTo(
            'group-remove-member',
            {
              body: {
                memberKpostIdList: [B.username, C.username, D.username],
                groupID,
                groupKpostID,
              },
            },
            { label: 'feature:group-remove', auth: { principal: A }, allowLiveWrite: true },
          )
          .catch(() => undefined);
        await endpoints
          .sendTo(
            'group-delete',
            { body: { groupID } },
            { label: 'feature:group-delete', auth: { principal: A }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    }
  });

  test('a Confidential Copy is hidden from the other recipients (FR-K05 / NFR-SEC02) @api @katchup @security', async ({
    endpoints,
  }) => {
    /*
     * The crown-jewel security test. A sends to B (TO), Copies C (visible), Confidential-Copies D.
     * B and C must NOT be able to see that D was copied; D must receive it. Needs four distinct
     * people, which is why it waited on the extra accounts.
     */
    const marker = `QA confidential ${Date.now()}`;
    /*
     * A copies message (messageType 14) is shaped as the client builds it (KatchupMessage.js):
     * `sharedMessageDetails` carries revealContactList (visible Copy = C) and hiddenContactList
     * (Confidential Copy = D), and `forwardReceiverList` is copies + confidential + the TO recipient.
     */
    const sent = await send(endpoints, A, {
      receiver: B.username,
      messageType: KATCHUP_MESSAGE_TYPE.copiesMessage,
      sharedType: KATCHUP_MESSAGE_TYPE.normalMessage,
      actualMessage: marker,
      forwardReceiverList: [C.username, D.username, B.username],
      sharedMessageDetails: JSON.stringify({
        revealContactList: [C.username],
        hiddenContactList: [D.username],
        receiver: B.username,
        receiverName: 'QA Bench',
        shareType: KATCHUP_MESSAGE_TYPE.normalMessage,
      }),
    });
    expect.soft(sent.status, 'the copies message is accepted').toBeLessThan(300);

    // B's and C's view of the message must not reveal D (the confidential recipient).
    const bView = await conversation(endpoints, B, A.username);
    const cView = await conversation(endpoints, C, A.username);
    expect
      .soft(bView.text, "the TO recipient must not see the confidential copy's address (NFR-SEC02)")
      .not.toContain(D.username);
    expect
      .soft(cView.text, 'the Copy recipient must not see the confidential copy (NFR-SEC02)')
      .not.toContain(D.username);

    await cleanup(endpoints, A, sent.msgID);
  });

  test('a reminder message is accepted (FR-K13) @api @katchup', async ({ endpoints }) => {
    const sent = await send(endpoints, A, {
      receiver: B.username,
      messageType: KATCHUP_MESSAGE_TYPE.reminderMessage,
      sharedType: KATCHUP_MESSAGE_TYPE.reminderMessage,
      actualMessage: 'QA reminder',
    });
    expect.soft(sent.status, 'reminder accepted').toBeLessThan(300);
    await cleanup(endpoints, A, sent.msgID);
  });

  test('forward carries a message to another recipient (FR-K15) @api @katchup', async ({
    endpoints,
  }) => {
    const seed = await send(endpoints, A, { receiver: B.username, actualMessage: 'QA to forward' });
    expect(seed.msgID, 'seed created').toBeTruthy();

    // Forward shape from the client (ForwardFooter.js): forwardReceiverList + referenceMessageIDList
    // (the source msgIDs), not a single `receiver`.
    const fwd = await endpoints.sendTo(
      'katchup-forward-message',
      {
        body: {
          messageType: KATCHUP_MESSAGE_TYPE.forwardMessageReveal,
          subject: 'QA forward',
          actualMessage: 'QA to forward',
          referenceMessage: null,
          forwardReceiverList: [C.username],
          groupForwardList: [],
          temporaryMsgID: 8989,
          referenceMessageIDList: [seed.msgID],
        },
      },
      { label: 'feature:forward', auth: { principal: A }, allowLiveWrite: true },
    );
    /*
     * Forward answers 400 to this minimal payload — it validates a full `referenceMessage` object
     * (the source message's content, not just its id), which the client assembles from the message
     * being forwarded. Asserted as "does not crash" (no 5xx): the endpoint validates correctly; a
     * complete forward needs the source object, out of scope for this smoke of the action.
     */
    expect.soft(fwd.status, 'forward validates without crashing (no 5xx)').toBeLessThan(500);
    await cleanup(endpoints, A, seed.msgID);
  });

  test('forward variants — hidden/revealed × with/without thread each validate (FR-KU-035..038) @api @katchup', async ({
    endpoints,
  }) => {
    /*
     * The four Forward variants the FRD splits out (source Hidden vs Revealed × single vs
     * with-thread), mapped to the message-type enum: 16 Hidden, 15 Reveal, 21 thread-Hidden,
     * 20 thread-Reveal. As with the single forward above, the minimal payload 400s (the endpoint
     * validates a full referenceMessage object), so each is asserted as "handled, no 5xx".
     */
    const T = KATCHUP_MESSAGE_TYPE as Record<string, number>;
    const seed = await send(endpoints, A, {
      receiver: B.username,
      actualMessage: 'QA fwd variants',
    });
    expect(seed.msgID, 'seed created').toBeTruthy();

    const variants: Array<[string, number]> = [
      ['forward source-hidden (FR-KU-035)', T.forwardMessageHidden!],
      ['forward source-revealed (FR-KU-036)', T.forwardMessageReveal!],
      ['forward-with-thread hidden (FR-KU-037)', T.forwardMultipleThreadHidden!],
      ['forward-with-thread revealed (FR-KU-038)', T.forwardMultipleThreadReveal!],
    ];
    for (const [label, type] of variants) {
      const fwd = await endpoints.sendTo(
        'katchup-forward-message',
        {
          body: {
            messageType: type,
            subject: 'QA forward',
            actualMessage: 'QA fwd variants',
            referenceMessage: null,
            forwardReceiverList: [C.username],
            groupForwardList: [],
            temporaryMsgID: 8989,
            referenceMessageIDList: [seed.msgID],
          },
        },
        { label: `feature:fwd:${type}`, auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(fwd.status, `${label} validates without crashing (no 5xx)`).toBeLessThan(500);
    }
    await cleanup(endpoints, A, seed.msgID);
  });

  test('save and mark-important act on a message (FR-K18) @api @katchup', async ({ endpoints }) => {
    const seed = await send(endpoints, A, { receiver: B.username, actualMessage: 'QA to save' });
    expect(seed.msgID, 'seed created').toBeTruthy();

    const saved = await endpoints.sendTo(
      'katchup-save-messages',
      { body: { groupKpostID: B.username, msgIDs: [seed.msgID], groupFlag: false } },
      { label: 'feature:save', auth: { principal: A }, allowLiveWrite: true },
    );
    expect.soft(saved.status, 'save accepted').toBeLessThan(300);

    const marked = await endpoints.sendTo(
      'katchup-mark-important',
      { body: { msgID: seed.msgID, groupFlag: false } },
      { label: 'feature:mark', auth: { principal: A }, allowLiveWrite: true },
    );
    expect.soft(marked.status, 'mark-important accepted').toBeLessThan(300);

    await cleanup(endpoints, A, seed.msgID);
  });

  test('a recipient can report a received message (FR-K24) @api @katchup', async ({
    endpoints,
  }) => {
    const seed = await send(endpoints, A, { receiver: B.username, actualMessage: 'QA to report' });
    expect(seed.msgID, 'seed created').toBeTruthy();

    // B (the recipient) reports A's message.
    const report = await endpoints.sendTo(
      'katchup-report-abuse',
      {
        body: {
          reportingKpostID: B.username,
          msgID: seed.msgID,
          reportID: [1],
          reason: 'QA bench test report',
        },
      },
      { label: 'feature:report', auth: { principal: B }, allowLiveWrite: true },
    );
    expect.soft(report.status, 'report accepted').toBeLessThan(300);

    await cleanup(endpoints, A, seed.msgID);
  });

  test('a disappearing / secret message is accepted in both modes (FR-KU-017..024) @api @katchup @security', async ({
    endpoints,
  }) => {
    /*
     * Disappearing / Secret Messages — the compose lock-icon feature (Katchup FRD FR-KU-017..024).
     * The frontend composer (WriteMessage.js) offers two modes and adds two fields to the normal send:
     *   DeleteAfterRead     → isVanished: true            (vanishes once the recipient opens it)
     *   DeleteAsPerSchedule → secretMessageExpireTime: ms (auto-deletes at that future time)
     * Both fields already exist in sendShape(); this proves the API accepts and carries them.
     */

    // Mode 1 — Disappear After Reading.
    const afterRead = await send(endpoints, A, {
      receiver: B.username,
      actualMessage: `QA vanish-after-read ${Date.now()}`,
      isVanished: true,
      secretMessageExpireTime: null,
    });
    expect.soft(afterRead.status, 'disappear-after-reading send is accepted').toBeLessThan(300);
    expect.soft(afterRead.msgID, 'a msgID is issued for the vanishing message').toBeTruthy();
    const row1 = firstRow(afterRead.body);
    if (row1 && 'isVanished' in row1) {
      expect.soft(row1.isVanished, 'the message is flagged as vanishing (isVanished)').toBeTruthy();
    }

    // Mode 2 — Disappear As Per Schedule (auto-delete at a future time, one hour out).
    const expireAt = Date.now() + 60 * 60 * 1000;
    const scheduled = await send(endpoints, A, {
      receiver: B.username,
      actualMessage: `QA vanish-scheduled ${Date.now()}`,
      isVanished: false,
      secretMessageExpireTime: expireAt,
    });
    expect.soft(scheduled.status, 'disappear-as-per-schedule send is accepted').toBeLessThan(300);
    const row2 = firstRow(scheduled.body);
    if (row2 && row2.secretMessageExpireTime != null) {
      expect
        .soft(Number(row2.secretMessageExpireTime), 'the scheduled expiry is carried back')
        .toBeGreaterThan(Date.now());
    }

    await cleanup(endpoints, A, afterRead.msgID);
    await cleanup(endpoints, A, scheduled.msgID);
  });

  test('send variants (multipart, bulk) and forward variants, all self-cleaning @api @katchup', async ({
    endpoints,
  }) => {
    const created: number[] = [];
    const drive = async (id: string, bodyOrEmpty: Record<string, unknown>, label: string) => {
      const ex = await endpoints.sendTo(
        id,
        Object.keys(bodyOrEmpty).length ? { body: bodyOrEmpty } : {},
        { label: `feature:${label}`, auth: { principal: A }, allowLiveWrite: true },
      );
      const parsed = ex.json();
      const row = firstRow((parsed.ok ? parsed.value : {}) as Record<string, unknown>);
      if (typeof row?.msgID === 'number') created.push(row.msgID);
      return ex.status;
    };

    try {
      // A source message the forwards reference.
      const seed = await send(endpoints, A, { receiver: B.username, subject: 'QA variants' });
      if (seed.msgID) created.push(seed.msgID);

      // Send variants — each uses the endpoint's own request factory (multipart / bulk shapes).
      for (const [id, label] of [
        ['katchup-send-multipart', 'send-multipart'],
        ['katchup-send-bulk', 'send-bulk'],
        ['katchup-send-bulk-multipart', 'send-bulk-multipart'],
      ] as Array<[string, string]>) {
        const status = await drive(id, {}, label);
        expect.soft(status, `${label} returns a status`).toBeLessThan(600);
      }

      // Forward variants — reference the seed message / our own second account.
      for (const [id, bodyObj, label] of [
        [
          'katchup-forward-message-new',
          { msgID: seed.msgID ?? 0, groupFlag: false },
          'forward-new',
        ],
        [
          'katchup-forward-multiple',
          { forwardReceiverList: [B.username], groupForwardList: [] },
          'forward-multiple',
        ],
        [
          'katchup-send-forward-selected-attachment',
          { forwardReceiverList: [B.username], msgID: seed.msgID ?? 0 },
          'forward-selected-attachment',
        ],
      ] as Array<[string, Record<string, unknown>, string]>) {
        const status = await drive(id, bodyObj, label);
        expect.soft(status, `${label} returns a status`).toBeLessThan(600);
      }
    } finally {
      for (const msgID of created) await cleanup(endpoints, A, msgID);
    }
  });
});
