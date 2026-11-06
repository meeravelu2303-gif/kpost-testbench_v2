import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { KATCHUP_MESSAGE_TYPE, KATCHUP_STATUS } from '@api/contract/kpost-types';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { text } from '@database/kpost-assertions';
import { checkOnRealRecord } from '@engine/real-record';
import { expect, test } from '@fixtures';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expectStored } from '../../../support/db-stored';

/**
 * Katchup feature flow: message types, recall, group read receipts, Confidential Copy secrecy and
 * forwards, across our PERSONAL accounts. Gated behind `KATCHUP_LIFECYCLE=true` because every test
 * writes real messages (cleaned up after itself).
 */

const K = AUTH_PROFILES.kpost;
const principal = (key: string): Principal => {
  const found = K.principals.find((p) => p.key === key);
  if (!found) throw new Error(`principal "${key}" is not configured`);
  return found;
};

// The four roles the security test needs: sender, TO, visible Copy, hidden Confidential-Copy.
const A = principal('personal'); // sender          Qatesting@
const B = principal('victim'); // TO recipient      Qatesting2@
const C = principal('personal-3'); // visible Copy   Qatesting3@
const D = principal('personal-4'); // confidential   Qatesting4@

/** A KPOST ID column holding `id`, compared without case (the token's copy is the DB's spelling). */
const isId =
  (id: string) =>
  (value: unknown): boolean =>
    text(value)?.toLowerCase() === id.toLowerCase();

/** A flag column left off (0, false or never set). */
const notSet = (value: unknown): boolean =>
  value === null || value === undefined || value === false || text(value) === '0';

const MESSAGES = 'TBL_KPOST_KATCHUP_MESSAGES';

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
  groupFlag = false,
): Promise<{ status: number; text: string }> {
  const exchange = await endpoints.sendTo(
    'katchup-conversation',
    { body: { groupFlag, firstMsgID: null, lastMsgID: null, receiver: withKpostId } },
    { label: `feature:conversation:${as.key}`, auth: { principal: as } },
  );
  return { status: exchange.status, text: exchange.bodyText };
}

/**
 * How an Edit points at the message it edits (`temporaryMsgID` is ignored). The id list is used
 * because the QA-identifier guard can vouch for it, but not for ids inside a `referenceMessage` string.
 */
function editOf(original: number): Record<string, unknown> {
  return { referenceMessageIDList: [original] };
}

/** The original msgID an edit row points at, from either reference field. */
function editTarget(row: {
  referenceMessage?: string | null;
  referenceMessageIDList?: number[] | null;
}) {
  const listed = row.referenceMessageIDList?.[0];
  if (typeof listed === 'number') return listed;
  try {
    return (JSON.parse(row.referenceMessage ?? '{}') as { msgID?: number }).msgID;
  } catch {
    return undefined;
  }
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

/** The web app's forward body (ForwardFooter.js) for a source row, and the reference it carries. */
function forwardBody(
  source: Record<string, unknown>,
  type: number,
  to: string[],
): { body: Record<string, unknown>; reference: string } {
  const hidden = type === 16 || type === 21;
  const reference = JSON.stringify({
    receiver: hidden ? '' : source.receiver,
    sender: hidden ? '' : source.sender,
    senderName: hidden ? '' : source.senderName,
    receiverName: hidden ? '' : source.receiverName,
    msgID: source.msgID,
    actualMessage: source.actualMessage,
    attachmentCaption: source.attachmentCaption ?? source.attachmentCaptionDetails,
    messageTime: source.messageTime,
    readTime: source.readTime,
    referenceMessage: source.referenceMessage,
    serverTime: source.serverTime,
    selectedMembers: source.selectedMembers,
    messageType: source.sharedType ? source.sharedType : source.messageType,
    sharedMessageDetails: source.sharedMessageDetails,
    isVoiceMessage: source.isVoiceMessage,
  });
  return {
    reference,
    body: {
      receiver: '',
      messageType: type,
      subject: source.subject,
      actualMessage: JSON.stringify([{ insert: 'QA bench forward\n' }]),
      attachmentCaption: '[]',
      status: '0',
      sessionID: 'Web-Reactjs',
      referenceMessage: reference,
      groupFlag: false,
      forwardReceiverList: to,
      groupForwardList: [],
      groupmemberList: [],
      sharedMessageDetails: null,
      sharedType: type,
      temporaryMsgID: 8989,
      uuid: [],
      referenceMessageIDList: null,
    },
  };
}

/**
 * Forward `source` (the row a send returned) to `to` with the web app's body (ForwardFooter.js):
 * the source travels as a JSON string in `referenceMessage`, its sender and receiver blanked when
 * the forward hides them (16, 21). Returns the forward's status, its new msgIDs and the row.
 */
async function forward(
  endpoints: EndpointExecutor,
  as: Principal,
  source: Record<string, unknown>,
  type: number,
  to: string[],
): Promise<{ status: number; msgIDs: number[]; row?: Record<string, unknown> }> {
  const { body, reference } = forwardBody(source, type, to);
  const exchange = await endpoints.sendTo(
    'katchup-forward-message-new',
    { body },
    {
      label: `feature:forward:${type}`,
      auth: { principal: as },
      allowLiveWrite: true,
      // The source row we just sent, as a string: the guard cannot read ids inside it.
      ownedIdentifiers: [reference],
    },
  );
  const parsed = exchange.json();
  const data = ((parsed.ok ? parsed.value : {}) as { data?: unknown }).data;
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  return {
    status: exchange.status,
    msgIDs: rows.map((r) => r.msgID).filter((id): id is number => typeof id === 'number'),
    row: rows[0],
  };
}

test.describe('KPost Katchup · feature flow', { tag: ['@api', '@katchup', '@regression'] }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    process.env.KATCHUP_LIFECYCLE !== 'true',
    'writes real messages; set KATCHUP_LIFECYCLE=true (owner sign-off, docs/modules/katchup-flow.md §6)',
  );

  test(
    'a message carries its Subject and issues a msgID (BR-K01) @api @katchup',
    { tag: '@sanity', annotation: [{ type: 'requirement', description: 'BR-KU-SUBJECT' }] },
    async ({ endpoints }) => {
      const subject = `QA Feature ${Date.now()}`;
      const sent = await send(endpoints, A, { receiver: B.username, subject });
      expect(sent.status, 'send succeeds').toBeLessThan(300);
      expect(firstRow(sent.body)?.subject, 'subject is carried (BR-K01)').toBe(subject);
      expect(sent.msgID, 'a msgID is issued').toBeTruthy();
      await cleanup(endpoints, A, sent.msgID);
    },
  );

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
      ...editOf(seed.msgID!),
    });
    expect.soft(edited.status, 'edit is accepted').toBeLessThan(300);

    // B's view should show the edited content (the "Edited:" marker is a UI label over messageType 6).
    const view = await conversation(endpoints, B, A.username);
    expect.soft(view.text, 'the recipient sees the edited body').toContain('QA edited body');

    await cleanup(endpoints, A, seed.msgID);
    await cleanup(endpoints, A, edited.msgID);
  });

  test(
    'an edit cannot change the Subject, only the body (BR-KU-EDIT-SUBJ) @api @katchup',
    { annotation: [{ type: 'requirement', description: 'BR-KU-EDIT-SUBJ' }] },
    async ({ endpoints }) => {
      const originalSubject = `QA subj-lock ${Date.now()}`;
      const seed = await send(endpoints, A, { receiver: B.username, subject: originalSubject });
      expect(seed.msgID, 'seed created').toBeTruthy();

      const attemptedSubject = `${originalSubject} CHANGED`;
      const edited = await send(endpoints, A, {
        receiver: B.username,
        messageType: KATCHUP_MESSAGE_TYPE.editMessage,
        sharedType: KATCHUP_MESSAGE_TYPE.editMessage,
        subject: attemptedSubject,
        actualMessage: 'QA subj-lock edited body',
        ...editOf(seed.msgID!),
      });
      expect.soft(edited.status, 'edit is accepted').toBeLessThan(300);

      const view = await conversation(endpoints, B, A.username);
      expect.soft(view.text, 'the body itself still changes').toContain('QA subj-lock edited body');

      // The UI locks the Subject during edit; this checks the server enforces it too (defense in depth).
      expect
        .soft(view.text, 'the edited message keeps its original Subject')
        .not.toContain(attemptedSubject);
      // The edit is stored as an Edit row pointing at the original (the client's "Edited" marker).
      const editRow = (
        JSON.parse(view.text || '{}') as {
          data?: Array<{
            msgID?: number;
            messageType?: number;
            referenceMessage?: string | null;
            referenceMessageIDList?: number[] | null;
          }>;
        }
      ).data?.find((m) => m.msgID === edited.msgID);
      expect
        .soft(editRow?.messageType, 'the edit is stored as an Edit')
        .toBe(KATCHUP_MESSAGE_TYPE.editMessage);
      expect
        .soft(editRow ? editTarget(editRow) : undefined, 'pointing at the original message')
        .toBe(seed.msgID);
      if (view.text.includes(attemptedSubject)) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-send-message',
          ruleId: 'BR-KU-EDIT-SUBJ',
          rule: 'editMessage must not change the Subject — the body is the only editable field.',
          expected: `the Subject stays "${originalSubject}"`,
          actual:
            `the Subject changed to "${attemptedSubject}" (server accepted it; the real UI client ` +
            'disables the Subject field during edit, so this is unreachable from the product today)',
        });
      }

      await cleanup(endpoints, A, seed.msgID);
      await cleanup(endpoints, A, edited.msgID);
    },
  );

  test(
    'a recalled message is removed from the recipient view (FR-K10 / BR-K03) @api @katchup @security',
    {
      tag: '@sanity',
      annotation: [
        { type: 'requirement', description: 'BR-KU-RECALL' },
        { type: 'requirement', description: 'FR-KU-028' },
      ],
    },
    async ({ endpoints, validationEngine }) => {
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

      // The full engine on a fresh real message of A's (the sweep's msgID names none, so its probes
      // stop before any field rule); that message is recalled by the engine's own normal request.
      const fresh = await send(endpoints, A, {
        receiver: B.username,
        actualMessage: `QA recall engine ${Date.now()}`,
      });
      if (fresh.msgID)
        await checkOnRealRecord(
          validationEngine,
          'katchup-recall-message',
          { body: { msgID: fresh.msgID, groupFlag: false } },
          [fresh.msgID],
        );
      await cleanup(endpoints, A, fresh.msgID);
    },
  );

  test(
    'group message: send reaches members and read receipts are tracked (FR-K06 / FR-K07) @api @katchup',
    { annotation: [{ type: 'requirement', description: 'BR-KU-RECEIPTS' }] },
    async ({ endpoints, validationEngine }) => {
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
          // groupFlag is a STRING (see send.api.ts); a real boolean 400s.
          groupFlag: 'true',
          groupmemberList: [B.username, C.username, D.username],
          actualMessage: 'QA group hello',
        });
        expect.soft(sent.status, 'group send is accepted').toBeLessThan(300);
        msgID = sent.msgID;

        // FR-K07: per-recipient read receipts.
        if (msgID) {
          const receiptsBefore = await endpoints.sendTo(
            'katchup-read-status-group',
            { body: { msgID } },
            { label: 'feature:read-receipts-before', auth: { principal: A }, allowLiveRead: true },
          );
          expect.soft(receiptsBefore.status, 'read-receipt status reads back').toBe(200);
          const beforeParsed = receiptsBefore.json();
          const beforeList = (
            beforeParsed.ok
              ? ((beforeParsed.value as Record<string, unknown>).data as unknown[])
              : []
          ) as Array<{ receiver?: string; readStatus?: string }>;
          const bBefore = beforeList.find(
            (r) => r.receiver?.toLowerCase() === B.username.toLowerCase(),
          );
          expect
            .soft(
              bBefore?.readStatus,
              'BR-KU-RECEIPTS: B has not read it yet, before opening the thread',
            )
            .not.toBe('Y');

          // B opening the group conversation marks the message read for B only.
          await conversation(endpoints, B, groupKpostID!, true);

          const receiptsAfter = await endpoints.sendTo(
            'katchup-read-status-group',
            { body: { msgID } },
            { label: 'feature:read-receipts-after', auth: { principal: A }, allowLiveRead: true },
          );
          await checkOnRealRecord(
            validationEngine,
            'katchup-read-status-group',
            { body: { msgID } },
            [],
          );
          const afterParsed = receiptsAfter.json();
          const afterList = (
            afterParsed.ok ? ((afterParsed.value as Record<string, unknown>).data as unknown[]) : []
          ) as Array<{ receiver?: string; readStatus?: string }>;
          const bAfter = afterList.find(
            (r) => r.receiver?.toLowerCase() === B.username.toLowerCase(),
          );
          const cAfter = afterList.find(
            (r) => r.receiver?.toLowerCase() === C.username.toLowerCase(),
          );
          const dAfter = afterList.find(
            (r) => r.receiver?.toLowerCase() === D.username.toLowerCase(),
          );
          expect
            .soft(
              bAfter?.readStatus,
              'BR-KU-RECEIPTS: B shows read AFTER opening the thread, independently',
            )
            .toBe('Y');
          expect
            .soft(cAfter?.readStatus, 'BR-KU-RECEIPTS: C (never opened it) must NOT show read')
            .not.toBe('Y');
          expect
            .soft(dAfter?.readStatus, 'BR-KU-RECEIPTS: D (never opened it) must NOT show read')
            .not.toBe('Y');
        }
      } finally {
        // Cleanup: remove members, then delete the group (deleteGroup refuses while members remain).
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
    },
  );

  test(
    'a Confidential Copy is hidden from the other recipients (FR-K05 / NFR-SEC02) @api @katchup @security',
    { annotation: [{ type: 'requirement', description: 'NFR-SEC02' }] },
    async ({ endpoints }) => {
      // A sends to B (TO), Copies C, Confidential-Copies D: B and C must not see that D was copied.
      const marker = `QA confidential ${Date.now()}`;
      // Shaped as the client builds a copies message (type 14): reveal list = C, hidden list = D.
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

      // B's and C's copy of THIS message must not reveal D (the confidential recipient). Only the
      // marker row is checked: older rows in the same conversation (scheduled-call notices) name D
      // legitimately.
      const rowsOf = async (who: Principal) => {
        const view = await conversation(endpoints, who, A.username);
        const parsed = JSON.parse(view.text || '{}') as { data?: Record<string, unknown>[] };
        return (parsed.data ?? []).filter((row) => row.actualMessage === marker);
      };
      const [bRows, cRows, dRows] = [await rowsOf(B), await rowsOf(C), await rowsOf(D)];
      expect.soft(bRows.length, 'the TO recipient receives the message').toBeGreaterThan(0);
      expect.soft(cRows.length, 'the Copy recipient receives the message').toBeGreaterThan(0);
      expect
        .soft(
          JSON.stringify(bRows),
          "the TO recipient must not see the confidential copy's address (NFR-SEC02)",
        )
        .not.toContain(D.username);
      expect
        .soft(
          JSON.stringify(cRows),
          'the Copy recipient must not see the confidential copy (NFR-SEC02)',
        )
        .not.toContain(D.username);

      // The send answers with B's row only, but stores one row per recipient: delete them all.
      const ids = new Set([sent.msgID, ...[...bRows, ...cRows, ...dRows].map((row) => row.msgID)]);
      for (const msgID of ids)
        await cleanup(endpoints, A, typeof msgID === 'number' ? msgID : undefined);
    },
  );

  test(
    'a reminder message is accepted (FR-K13) @api @katchup',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KU-033' }] },
    async ({ endpoints }) => {
      const sent = await send(endpoints, A, {
        receiver: B.username,
        messageType: KATCHUP_MESSAGE_TYPE.reminderMessage,
        sharedType: KATCHUP_MESSAGE_TYPE.reminderMessage,
        actualMessage: 'QA reminder',
      });
      expect.soft(sent.status, 'reminder accepted').toBeLessThan(300);
      await cleanup(endpoints, A, sent.msgID);
    },
  );

  test('forward carries a message to another recipient (FR-K15) @api @katchup', async ({
    endpoints,
    databases,
    validationEngine,
  }) => {
    const seed = await send(endpoints, A, { receiver: B.username, actualMessage: 'QA to forward' });
    expect(seed.msgID, 'seed created').toBeTruthy();
    const created: number[] = [];
    try {
      const fwd = await forward(
        endpoints,
        A,
        firstRow(seed.body)!,
        KATCHUP_MESSAGE_TYPE.forwardMessageReveal!,
        [C.username],
      );
      created.push(...fwd.msgIDs);
      expect.soft(fwd.status, 'the web app’s forward is accepted').toBe(200);
      expect.soft(fwd.row?.receiver, 'the forward goes to the person picked').toBe(C.username);
      if (fwd.status === 200 && fwd.msgIDs[0]) {
        // The same body forward() sent (it is built from the source row, so it is identical).
        const sentForward = forwardBody(
          firstRow(seed.body)!,
          KATCHUP_MESSAGE_TYPE.forwardMessageReveal!,
          [C.username],
        );
        // KatchupServiceImpl.java:1839 copies the body (convertKatchupObj), :1983 sets each receiver,
        // :2000 saves one row per forwardReceiverList entry.
        const db = databases.for('kpost-api');
        await expectStored(
          db,
          'katchup-forward-message-new',
          {
            table: MESSAGES,
            where: { msg_id: fwd.msgIDs[0] },
            columns: {
              sender: isId(A.username),
              receiver: isId(C.username),
              message_type: KATCHUP_MESSAGE_TYPE.forwardMessageReveal,
              subject: sentForward.body.subject,
              actual_message: sentForward.body.actualMessage,
              reference_message: sentForward.reference,
            },
            rule: 'forwardKatchupMessageNew stores a row from the caller to each picked recipient, with the forward type, Subject, body and source reference it was sent',
          },
          endpoints,
        );
      }
      const seen = await conversation(endpoints, C, A.username);
      expect
        .soft(seen.text, 'the recipient finds the forward in their conversation with the sender')
        .toContain(String(fwd.msgIDs[0]));

      // An incomplete forward (no source object, the case #611 was about) is refused, never a 5xx.
      const incomplete = await endpoints.sendTo(
        'katchup-forward-message-new',
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
        { label: 'feature:forward-incomplete', auth: { principal: A }, allowLiveWrite: true },
      );
      const accepted = incomplete.json();
      const extra = firstRow((accepted.ok ? accepted.value : {}) as Record<string, unknown>);
      if (typeof extra?.msgID === 'number') created.push(extra.msgID);
      expect
        .soft(incomplete.status, 'an incomplete forward is refused without crashing (no 5xx)')
        .toBeLessThan(500);

      // The full engine on the web app's forward of this real message (the sweep has no source).
      const real = forwardBody(firstRow(seed.body)!, KATCHUP_MESSAGE_TYPE.forwardMessageReveal!, [
        C.username,
      ]);
      await checkOnRealRecord(
        validationEngine,
        'katchup-forward-message-new',
        { body: real.body },
        [real.reference, seed.msgID!],
      );
    } finally {
      for (const msgID of created) await cleanup(endpoints, A, msgID);
      await cleanup(endpoints, A, seed.msgID);
    }
  });

  test(
    'forward variants — hidden/revealed × with/without thread each validate (FR-KU-035..038) @api @katchup',
    {
      annotation: [
        { type: 'requirement', description: 'FR-KU-035' },
        { type: 'requirement', description: 'FR-KU-036' },
        { type: 'requirement', description: 'FR-KU-037' },
        { type: 'requirement', description: 'FR-KU-038' },
      ],
    },
    async ({ endpoints }) => {
      // Hidden/Revealed × single/with-thread, each with the web app's forward body.
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
      const created: number[] = [];
      try {
        for (const [label, type] of variants) {
          const fwd = await forward(endpoints, A, firstRow(seed.body)!, type, [C.username]);
          created.push(...fwd.msgIDs);
          expect.soft(fwd.status, `${label} is accepted`).toBe(200);
          expect.soft(fwd.row?.messageType, `${label} is stored as type ${type}`).toBe(type);
          if (type === T.forwardMessageHidden || type === T.forwardMultipleThreadHidden) {
            // The recipient must not learn who wrote the original.
            const raw = fwd.row?.referenceMessage;
            let source: { sender?: string } = {};
            try {
              source = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as typeof source;
            } catch {
              source = {};
            }
            expect.soft(source.sender ?? '', `${label} hides the original sender`).toBe('');
          }
        }
      } finally {
        for (const msgID of created) await cleanup(endpoints, A, msgID);
        await cleanup(endpoints, A, seed.msgID);
      }
    },
  );

  test(
    'save keeps the selected message and removes the rest of the conversation from the saver’s view (FR-K18) @api @katchup @database',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KU-040' }] },
    async ({ endpoints, databases }) => {
      /*
       * Save hides every OTHER message of the conversation from the saver ("Only the selected
       * message will be saved, the rest will be deleted"), so the saver is personal-5, whose view
       * of its conversation with personal-4 nothing else reads.
       */
      const saver = principal('personal-5');
      const peer = D;
      const keep = await send(endpoints, saver, {
        receiver: peer.username,
        actualMessage: 'QA keep',
      });
      const drop = await send(endpoints, saver, {
        receiver: peer.username,
        actualMessage: 'QA drop',
      });
      expect(keep.msgID && drop.msgID, 'two messages created').toBeTruthy();
      try {
        // The web app's body (KatchupMessage.js): msgIDs, a boolean groupFlag and the receiver.
        const saved = await endpoints.sendTo(
          'katchup-save-messages',
          { body: { msgIDs: [keep.msgID], groupFlag: false, receiver: peer.username } },
          { label: 'feature:save', auth: { principal: saver }, allowLiveWrite: true },
        );
        expect
          .soft(saved.status, `save accepted (body: ${saved.bodyText?.slice(0, 200)})`)
          .toBe(200);

        const db = databases.for('kpost-api');
        if (saved.status === 200 && keep.msgID && drop.msgID) {
          // KatchupDaoImpl.java:490-492 sets deleted_by_sender on the saver's messages to the peer
          // whose msg_id is NOT in msgIDs; the selected one is left as it was.
          await expectStored(
            db,
            'katchup-save-messages',
            {
              table: MESSAGES,
              where: { msg_id: drop.msgID },
              columns: { deleted_by_sender: true },
              rule: 'saveKatchupMessages hides every other message of the conversation from the saver (deleted_by_sender set)',
            },
            endpoints,
          );
          await expectStored(
            db,
            'katchup-save-messages',
            {
              table: MESSAGES,
              where: { msg_id: keep.msgID },
              columns: { deleted_by_sender: notSet },
              rule: 'saveKatchupMessages keeps the selected message in the saver’s view (deleted_by_sender stays off)',
            },
            endpoints,
          );
        }
      } finally {
        await cleanup(endpoints, saver, keep.msgID);
        await cleanup(endpoints, saver, drop.msgID);
      }
    },
  );

  test(
    'mark-important flags a message (FR-K18) @api @katchup @database',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KU-040' }] },
    async ({ endpoints, databases, validationEngine }) => {
      const seed = await send(endpoints, A, { receiver: B.username, actualMessage: 'QA to star' });
      expect(seed.msgID, 'seed created').toBeTruthy();

      // The web app sends only the msgID (KatchupMessage.js handleStarMsg).
      const marked = await endpoints.sendTo(
        'katchup-mark-important',
        { body: { msgID: seed.msgID } },
        { label: 'feature:mark', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(marked.status, 'mark-important accepted').toBe(200);

      // A success is judged by the row: the caller is the sender of this fresh (unstarred) message.
      const db = databases.for('kpost-api');
      if (marked.status === 200 && seed.msgID)
        // KatchupDaoImpl.java:228-230 picks the sender branch; :244 flips marked_by_sender.
        await expectStored(
          db,
          'katchup-mark-important',
          {
            table: MESSAGES,
            where: { msg_id: seed.msgID },
            columns: { marked_by_sender: true },
            rule: "markOrUnmarkImportant sets marked_by_sender on the caller's own unstarred message",
          },
          endpoints,
        );

      // The full engine on this real message (the sweep's msgID names none).
      if (seed.msgID)
        await checkOnRealRecord(
          validationEngine,
          'katchup-mark-important',
          { body: { msgID: seed.msgID } },
          [seed.msgID],
        );
      await cleanup(endpoints, A, seed.msgID);
    },
  );

  test(
    'a recipient can report a received message (FR-K24) @api @katchup',
    { annotation: [{ type: 'requirement-partial', description: 'FR-KU-047' }] },
    async ({ endpoints, databases }) => {
      const seed = await send(endpoints, A, {
        receiver: B.username,
        actualMessage: 'QA to report',
      });
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

      if (report.status < 300 && seed.msgID) {
        const db = databases.for('kpost-api');
        // KatchupDaoImpl.java:858-864 persists one TBL_KPOST_REPORT_DETAILS row: kpost_id from the
        // token, the msgID, reason and reportingKpostID as sent, the reasons picked as a JSON list.
        await expectStored(
          db,
          'katchup-report-abuse',
          {
            table: 'TBL_KPOST_REPORT_DETAILS',
            where: { msg_id: seed.msgID, kpost_id: B.username },
            columns: {
              reporting_kpost_id: isId(B.username),
              reason: 'QA bench test report',
              report_id: (value: unknown) => {
                try {
                  const picked = JSON.parse(text(value) ?? '[]') as unknown[];
                  return Array.isArray(picked) && picked.some((id) => String(id) === '1');
                } catch {
                  return false;
                }
              },
            },
            rule: "reportAbuse records the reporter's report of that message with the reason and the reasons picked",
          },
          endpoints,
        );
      }

      await cleanup(endpoints, A, seed.msgID);
    },
  );

  test(
    'a disappearing / secret message is accepted in both modes (FR-KU-017..024) @api @katchup @security',
    {
      annotation: [
        { type: 'requirement', description: 'FR-KU-017' },
        { type: 'requirement', description: 'FR-KU-018' },
        { type: 'requirement', description: 'FR-KU-019' },
        { type: 'requirement', description: 'FR-KU-020' },
        { type: 'requirement', description: 'FR-KU-021' },
        { type: 'requirement', description: 'FR-KU-022' },
        { type: 'requirement', description: 'FR-KU-023' },
        { type: 'requirement', description: 'FR-KU-024' },
      ],
    },
    async ({ endpoints }) => {
      // Two modes: isVanished (gone once read) and secretMessageExpireTime (gone at a set time).

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
        expect
          .soft(row1.isVanished, 'the message is flagged as vanishing (isVanished)')
          .toBeTruthy();
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
      // The expiry comes back as an ISO string; the numeric epoch is `...AsLong`.
      if (row2 && row2.secretMessageExpireTimeAsLong != null) {
        expect
          .soft(Number(row2.secretMessageExpireTimeAsLong), 'the scheduled expiry is carried back')
          .toBeGreaterThan(Date.now());
      }

      await cleanup(endpoints, A, afterRead.msgID);
      await cleanup(endpoints, A, scheduled.msgID);
    },
  );

  test('send variants (multipart, bulk) and forward variants, all self-cleaning @api @katchup', async ({
    endpoints,
    databases,
    validationEngine,
  }) => {
    const created: number[] = [];
    const drive = async (
      id: string,
      bodyOrEmpty: Record<string, unknown>,
      label: string,
    ): Promise<{ status: number; msgID?: number }> => {
      const ex = await endpoints.sendTo(
        id,
        Object.keys(bodyOrEmpty).length ? { body: bodyOrEmpty } : {},
        { label: `feature:${label}`, auth: { principal: A }, allowLiveWrite: true },
      );
      const parsed = ex.json();
      const row = firstRow((parsed.ok ? parsed.value : {}) as Record<string, unknown>);
      const msgID = typeof row?.msgID === 'number' ? row.msgID : undefined;
      if (msgID) created.push(msgID);
      return { status: ex.status, msgID };
    };

    try {
      // A source message the forwards reference.
      const seed = await send(endpoints, A, { receiver: B.username, subject: 'QA variants' });
      if (seed.msgID) created.push(seed.msgID);

      // Send variants — each uses the endpoint's own request factory (multipart / bulk shapes).
      const variant: Record<string, { status: number; msgID?: number }> = {};
      for (const [id, label] of [
        ['katchup-send-multipart', 'send-multipart'],
        ['katchup-send-bulk', 'send-bulk'],
        ['katchup-send-bulk-multipart', 'send-bulk-multipart'],
      ] as Array<[string, string]>) {
        const result = await drive(id, {}, label);
        variant[id] = result;
        expect.soft(result.status, `${label} returns a status`).toBeLessThan(600);
      }

      // What each variant stored, against what its definition's request sent (send.api.ts). Their
      // multipart file goes in a part named `file`, not the `files` the controller reads, so no
      // attachment is expected: the text part alone is sent.
      const db = databases.for('kpost-api');
      const plain = sendShape();
      const multipart = variant['katchup-send-multipart'];
      if (multipart && multipart.status < 300 && multipart.msgID)
        // KatchupControllerV2.java:964-965 sends the text part through sendMessage, whose 1:1 branch
        // saves it at KatchupServiceImpl.java:798.
        await expectStored(
          db,
          'katchup-send-multipart',
          {
            table: MESSAGES,
            where: { msg_id: multipart.msgID },
            columns: {
              sender: isId(A.username),
              receiver: isId(B.username),
              message_type: plain.messageType,
              subject: plain.subject,
              actual_message: plain.actualMessage,
            },
            rule: 'sendKatchupMsgMultiPart stores the message in its text part, from the caller to the receiver named',
          },
          endpoints,
        );
      const bulkSent = {
        sender: isId(A.username),
        receiver: isId(B.username),
        message_type: KATCHUP_MESSAGE_TYPE.bulkMessage,
        subject: 'QA Bench',
        actual_message: 'QA bench bulk message.',
      };
      const bulk = variant['katchup-send-bulk'];
      if (bulk && bulk.status < 300 && bulk.msgID)
        // KatchupServiceImpl.java:1630 copies the body, :1706 sets each receiver, :1715 saves one row each.
        await expectStored(
          db,
          'katchup-send-bulk',
          {
            table: MESSAGES,
            where: { msg_id: bulk.msgID },
            columns: bulkSent,
            rule: 'sendBulkKatchupMsg stores one row per receiver with the type, Subject and body sent',
          },
          endpoints,
        );
      const bulkMultipart = variant['katchup-send-bulk-multipart'];
      if (bulkMultipart && bulkMultipart.status < 300 && bulkMultipart.msgID)
        // KatchupControllerV2.java:1248-1249 sends the text part through sendBulkMessage
        // (KatchupServiceImpl.java:1715 saves it).
        await expectStored(
          db,
          'katchup-send-bulk-multipart',
          {
            table: MESSAGES,
            where: { msg_id: bulkMultipart.msgID },
            columns: bulkSent,
            rule: 'sendBulkKatchupMsgMultiPart stores the bulk message in its text part, one row per receiver',
          },
          endpoints,
        );

      // Forward variants — reference the seed message / our own second account.
      const forwarded = seed.msgID
        ? await forward(
            endpoints,
            A,
            firstRow(seed.body)!,
            KATCHUP_MESSAGE_TYPE.forwardMessageReveal!,
            [B.username],
          )
        : undefined;
      created.push(...(forwarded?.msgIDs ?? []));
      const forwardedMsgID = forwarded?.msgIDs[0];
      for (const [id, bodyObj, label] of [
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
        const result = await drive(id, bodyObj, label);
        expect.soft(result.status, `${label} returns a status`).toBeLessThan(600);
      }

      // The full engine on the web app's multi-forward of this real message (ForwardFooter.js:
      // 1426-1436; the sweep's body names no source message, so it is refused before any limit).
      if (seed.msgID)
        await checkOnRealRecord(
          validationEngine,
          'katchup-forward-multiple',
          {
            body: {
              forwardReceiverList: [B.username],
              groupForwardList: [],
              forwardMessageIDList: [seed.msgID],
              attachmentCaption: '[]',
              uuid: [],
              messageType: KATCHUP_MESSAGE_TYPE.forwardMessageReveal,
              sessionID: 'Web-Reactjs',
              actualMessage: 'QA bench forward multiple',
            },
          },
          [seed.msgID],
        );

      // Backtrack is fed the forwarded message's own msgID (not the seed); a read, so allowLiveRead.
      if (forwardedMsgID) {
        const backtrack = await endpoints.sendTo(
          'katchup-forward-backtrack',
          { body: { msgID: forwardedMsgID } },
          { label: 'feature:forward-backtrack', auth: { principal: A }, allowLiveRead: true },
        );
        expect
          .soft(backtrack.status, 'forwardMessageBacktrackByMsgID traces a real forwarded message')
          .toBeLessThan(500);
      } else {
        expect
          .soft(forwardedMsgID, 'forward-message-new returned a real msgID to backtrack from')
          .toBeTruthy();
      }
    } finally {
      for (const msgID of created) await cleanup(endpoints, A, msgID);
    }
  });

  test(
    "deleting a received message removes it only from the deleter's view (BR-KU-DELETE-OWN) @api @katchup",
    {
      annotation: [
        { type: 'requirement', description: 'FR-KU-042' },
        { type: 'requirement', description: 'BR-KU-DELETE-OWN' },
      ],
    },
    async ({ endpoints }) => {
      const marker = `QA delete-own ${Date.now()}`;
      const sent = await send(endpoints, A, { receiver: B.username, actualMessage: marker });
      expect(sent.msgID, 'message created').toBeTruthy();
      if (!sent.msgID) return;

      try {
        // B (the receiver) deletes their own copy of the message.
        const del = await endpoints.sendTo(
          'katchup-delete-message',
          { body: { messageIds: [sent.msgID], groupFlag: false } },
          { label: 'feature:delete-own:receiver', auth: { principal: B }, allowLiveWrite: true },
        );
        expect.soft(del.status, 'deleteKatchUpMessage is accepted').toBeLessThan(300);

        // BR-KU-DELETE-OWN: gone from B's own view...
        const viewB = await conversation(endpoints, B, A.username);
        expect
          .soft(viewB.text, "the deleter's own view must no longer show the message")
          .not.toContain(marker);

        // ...but UNCHANGED in A's (the sender's) view — a delete is per-viewer, not a recall.
        const viewA = await conversation(endpoints, A, B.username);
        expect
          .soft(
            viewA.text,
            'BR-KU-DELETE-OWN: deleting a received message must not remove it from the ' +
              "sender's own view — only recall does that",
          )
          .toContain(marker);
      } finally {
        // The sender's own copy still needs cleaning up.
        await cleanup(endpoints, A, sent.msgID);
      }
    },
  );

  test(
    'recall is blocked once the recipient has already read the message (BR-KU-RECALL-UNREAD) @api @katchup @security',
    { annotation: [{ type: 'requirement', description: 'BR-KU-RECALL-UNREAD' }] },
    async ({ endpoints }) => {
      // Recall is allowed ONLY before the recipient has read the message.
      const marker = `QA recall-unread ${Date.now()}`;
      const sent = await send(endpoints, A, { receiver: B.username, actualMessage: marker });
      expect(sent.msgID, 'message created').toBeTruthy();
      if (!sent.msgID) return;

      try {
        // B opens the conversation — the live client's own read action.
        await conversation(endpoints, B, A.username);

        const recall = await endpoints.sendTo(
          'katchup-recall-message',
          { body: { msgID: sent.msgID, groupFlag: false } },
          { label: 'feature:recall-after-read', auth: { principal: A }, allowLiveWrite: true },
        );

        // Judged on B's view, not the status: an already-read message must stay visible to B.
        const viewAfter = await conversation(endpoints, B, A.username);
        if (!viewAfter.text.includes(marker)) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-recall-message',
            ruleId: 'BR-KU-RECALL-UNREAD',
            rule: 'recallMessage must refuse to recall a message the recipient has already read.',
            expected: 'the message remains visible to B after an already-read recall attempt',
            actual: `the message was removed from B's view (recall replied ${recall.status}) despite B having already opened the conversation`,
            request: { body: { msgID: sent.msgID, groupFlag: false } },
          });
        }
        expect
          .soft(
            viewAfter.text,
            `BR-KU-RECALL-UNREAD: an already-read message must survive a recall attempt (recall replied ${recall.status})`,
          )
          .toContain(marker);
      } finally {
        await cleanup(endpoints, A, sent.msgID);
      }
    },
  );

  test(
    'recall is unavailable for a group message (BR-KU-RECALL-SCOPE) @api @katchup @security',
    { annotation: [{ type: 'requirement', description: 'BR-KU-RECALL-SCOPE' }] },
    async ({ endpoints }) => {
      // Recall is unavailable for copies and group messages.
      const members = [B, C].map((p) => ({
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
            groupKpostName: `QA Recall-Scope Group ${Date.now()}`,
            isPrivateGroup: 'N',
            memberDetails: members,
          },
        },
        {
          label: 'feature:recall-scope-group-create',
          auth: { principal: A },
          allowLiveWrite: true,
        },
      );
      const gBody = created.json();
      const gData = (gBody.ok ? (gBody.value as Record<string, unknown>).data : undefined) as
        Record<string, unknown> | undefined;
      const groupKpostID = gData?.groupKpostID as string | undefined;
      const groupID = gData?.groupID as number | undefined;
      expect(created.status, 'group is created').toBeLessThan(300);
      if (!groupKpostID) return;

      let msgID: number | undefined;
      try {
        const marker = `QA recall-scope ${Date.now()}`;
        const sent = await send(endpoints, A, {
          receiver: groupKpostID,
          status: KATCHUP_STATUS.group,
          groupFlag: 'true',
          groupmemberList: [B.username, C.username],
          actualMessage: marker,
        });
        expect.soft(sent.status, 'group send is accepted').toBeLessThan(300);
        msgID = sent.msgID;
        if (!msgID) return;

        const recall = await endpoints.sendTo(
          'katchup-recall-message',
          { body: { msgID, groupFlag: true } },
          { label: 'feature:recall-group', auth: { principal: A }, allowLiveWrite: true },
        );

        // Asserted against a member's view: a group message must survive a recall attempt.
        const viewAfter = await conversation(endpoints, B, groupKpostID, true);
        if (!viewAfter.text.includes(marker)) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-recall-message',
            ruleId: 'BR-KU-RECALL-SCOPE',
            rule: 'recallMessage must refuse to recall a group message (recall is 1-to-1 only).',
            expected: 'the group message remains visible to members after a recall attempt',
            actual: `the message was removed from a member's view (recall replied ${recall.status})`,
            request: { body: { msgID, groupFlag: true } },
          });
        }
        expect
          .soft(
            viewAfter.text,
            `BR-KU-RECALL-SCOPE: a group message must survive a recall attempt (recall replied ${recall.status})`,
          )
          .toContain(marker);
      } finally {
        if (groupID && groupKpostID) {
          await endpoints
            .sendTo(
              'group-remove-member',
              { body: { memberKpostIdList: [B.username, C.username], groupID, groupKpostID } },
              {
                label: 'feature:recall-scope-group-remove',
                auth: { principal: A },
                allowLiveWrite: true,
              },
            )
            .catch(() => undefined);
          await endpoints
            .sendTo(
              'group-delete',
              { body: { groupID } },
              {
                label: 'feature:recall-scope-group-delete',
                auth: { principal: A },
                allowLiveWrite: true,
              },
            )
            .catch(() => undefined);
        }
      }
    },
  );
});
