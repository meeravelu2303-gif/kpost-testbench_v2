// Cross-account authorization (IDOR/BOLA) for Katchup messages. Conditionals guard live setup.

import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expect, test } from '@fixtures';

/**
 * Can an outsider recall or delete a Katchup message they did not send?
 *
 * `recallMessage` and `deleteKatchUpMessage` take a `msgID` and nothing else that ties it to the
 * caller — the same object-handle shape that made `removeGroupMember` exploitable (Bugzilla #507).
 * So the question is identical: does the server check that the caller OWNS the message, or act on any
 * msgID it is handed? Only the sender should be able to recall or delete their message.
 *
 * ## Self-activating
 *
 * The setup sends a message; if `sendMessage` ever answers without a usable msgID there is nothing
 * to attack, so this test SKIPS with a reason rather than failing. (It used to be permanently queued
 * behind Bugzilla #494's sendMessage 500 — that was superseded by #594's groupFlag string-typing fix,
 * 2026-09-26, and the skip condition below was always dynamic, not hardcoded to either ticket, so this
 * activates on its own the moment a msgID comes back.)
 *
 * ## The database is the judge
 *
 * Recall and delete report success in the envelope regardless, and an authorization bug is exactly
 * where the response cannot be trusted. The verdict is the row: after the outsider's attempt, the
 * message's `recall_status` / `delete_status` in TBL_KPOST_KATCHUP_GROUPREADSTATUS must be
 * unchanged.
 */
test.describe('KPost Security · Katchup message authorization (IDOR/BOLA) @api @kpost-api @security @katchup @database', () => {
  const K = AUTH_PROFILES.kpost;
  const owner = K.principals.find((p) => p.key === 'personal');
  const attacker = K.principals.find((p) => p.key === 'personal-3');

  test.skip(!owner || !attacker, 'needs two distinct KPost principals');
  test.skip(
    process.env.KATCHUP_LIFECYCLE !== 'true',
    'sends a real message; set KATCHUP_LIFECYCLE=true',
  );

  test('an outsider cannot recall or delete a message they did not send @api @security', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

    /*
     * `sendTo` sends a LITERAL request — it does not run the endpoint's own request factory — so the
     * body here mirrors `katchup-send-message`'s own `sendShape()` in send.api.ts exactly.
     */
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape() },
      { label: 'idor:katchup-send', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = sent.json();
    const rawData = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
    // sendMessage's `data` is an array of the sent message(s), not a bare object.
    const data = (Array.isArray(rawData) ? rawData[0] : rawData) as
      Record<string, unknown> | undefined;
    const msgID = (data?.msgID ?? data?.msgId ?? data?.messageId) as number | string | undefined;

    // No msgID means sendMessage did not create one; skip with a reason rather than failing.
    test.skip(
      !msgID,
      `sendMessage did not return a msgID to attack (send replied ${sent.status}) — activates ` +
        `automatically once one is issued`,
    );

    // --- Attack: the outsider tries to recall, then delete, the owner's message -----------------
    const before = await database.findOne<{ recall_status: string; delete_status: string }>({
      table: 'TBL_KPOST_KATCHUP_GROUPREADSTATUS',
      where: { msg_id: msgID as string },
    });

    const recall = await endpoints.sendTo(
      'katchup-recall-message',
      { body: { msgID, groupFlag: false } },
      { label: 'idor:katchup-recall', auth: { principal: attacker! }, allowLiveWrite: true },
    );
    const del = await endpoints.sendTo(
      'katchup-delete-message',
      { body: { messageIds: [msgID], groupFlag: false } },
      { label: 'idor:katchup-delete', auth: { principal: attacker! }, allowLiveWrite: true },
    );

    const after = await database.findOne<{ recall_status: string; delete_status: string }>({
      table: 'TBL_KPOST_KATCHUP_GROUPREADSTATUS',
      where: { msg_id: msgID as string },
    });

    expect
      .soft(
        after?.recall_status ?? before?.recall_status,
        `BOLA: an outsider must not recall another user's message (recall replied ${recall.status})`,
      )
      .toBe(before?.recall_status);
    expect
      .soft(
        after?.delete_status ?? before?.delete_status,
        `BOLA: an outsider must not delete another user's message (delete replied ${del.status})`,
      )
      .toBe(before?.delete_status);

    // Cleanup: the OWNER recalls their own message so the counterparty's view is left clean.
    await endpoints
      .sendTo(
        'katchup-recall-message',
        { body: { msgID, groupFlag: false } },
        { label: 'idor:katchup-cleanup', auth: { principal: owner! }, allowLiveWrite: true },
      )
      .catch(() => undefined);

    // A reference so a reader knows the counterparty fixture is what received the message.
    expect(testData.victimKpostId, 'the message went to the counterparty').toBeTruthy();
  });

  test("an outsider cannot mark-important another account's message @api @security", async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

    const sent = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape() },
      { label: 'idor:katchup-send-mark', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = sent.json();
    const rawData = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
    const data = (Array.isArray(rawData) ? rawData[0] : rawData) as
      Record<string, unknown> | undefined;
    const msgID = (data?.msgID ?? data?.msgId ?? data?.messageId) as number | string | undefined;

    test.skip(
      !msgID,
      `sendMessage did not return a msgID to attack (send replied ${sent.status}) — activates ` +
        `automatically once one is issued`,
    );

    const before = await database.findOne<{ marked_by_sender: number; marked_by_receiver: number }>(
      {
        table: 'TBL_KPOST_KATCHUP_MESSAGES',
        where: { msg_id: msgID as string },
      },
    );

    // --- Attack: the outsider tries to mark the owner's message as important ------------------
    const mark = await endpoints.sendTo(
      'katchup-mark-important',
      { body: { msgID, groupFlag: false } },
      { label: 'idor:katchup-mark', auth: { principal: attacker! }, allowLiveWrite: true },
    );

    const after = await database.findOne<{ marked_by_sender: number; marked_by_receiver: number }>({
      table: 'TBL_KPOST_KATCHUP_MESSAGES',
      where: { msg_id: msgID as string },
    });

    expect
      .soft(
        after?.marked_by_sender ?? before?.marked_by_sender,
        `BOLA: an outsider must not mark another account's message important (replied ${mark.status})`,
      )
      .toBe(before?.marked_by_sender);
    expect
      .soft(
        after?.marked_by_receiver ?? before?.marked_by_receiver,
        `BOLA: an outsider must not mark another account's message important, receiver flag (replied ${mark.status})`,
      )
      .toBe(before?.marked_by_receiver);

    await endpoints
      .sendTo(
        'katchup-recall-message',
        { body: { msgID, groupFlag: false } },
        { label: 'idor:katchup-mark-cleanup', auth: { principal: owner! }, allowLiveWrite: true },
      )
      .catch(() => undefined);
  });

  test("an outsider who is not a group member cannot read the group's read receipts @api @security", async ({
    endpoints,
  }) => {
    /*
     * Confirmed as a real, untested gap by the 2026-10-03 ground-truth re-audit: Katchup has no
     * group-membership of its own (that lives in the Group module), so the question here is
     * group-MESSAGE scoped — can someone with no relationship to this group read who has seen a
     * group message by naming its msgID? `personal-5` is used as the outsider: not a member of the
     * group created below, and not the `personal-3` attacker already used above (kept separate so a
     * failure in one test can never be explained by state the other left behind).
     */
    const outsider = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-5');
    const member = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'victim');
    test.skip(!outsider || !member, 'needs the personal-5 and victim principals');

    let groupID: number | undefined;
    let groupKpostID: string | undefined;
    try {
      const created = await endpoints.sendTo(
        'group-create',
        {
          body: {
            activeStatus: 'Y',
            createdBy: owner!.username,
            groupPicturePath: null,
            groupCreateAccess: true,
            groupKpostName: `QA IDOR Group ${Date.now()}`,
            isPrivateGroup: 'N',
            memberDetails: [
              {
                createdBy: owner!.username,
                hasAdminAccess: 'Y',
                kpostID: owner!.username,
                name: 'QA Bench',
                memberDesignation: '',
                privacyStatus: 'Y',
                remarks: 'created',
              },
              {
                createdBy: owner!.username,
                hasAdminAccess: 'N',
                kpostID: member!.username,
                name: 'QA Bench',
                memberDesignation: '',
                privacyStatus: 'Y',
                remarks: 'created',
              },
            ],
          },
        },
        { label: 'idor:group-create', auth: { principal: owner! }, allowLiveWrite: true },
      );
      const gBody = created.json();
      const gData = (gBody.ok ? (gBody.value as Record<string, unknown>).data : undefined) as
        Record<string, unknown> | undefined;
      groupKpostID = gData?.groupKpostID as string | undefined;
      groupID = gData?.groupID as number | undefined;
      test.skip(
        !groupKpostID,
        `group-create did not return a groupKpostID (replied ${created.status})`,
      );

      const sent = await endpoints.sendTo(
        'katchup-send-message',
        {
          body: sendShape({
            receiver: groupKpostID,
            groupFlag: 'true',
            groupmemberList: [member!.username],
            actualMessage: 'QA group IDOR probe',
          }),
        },
        { label: 'idor:group-send', auth: { principal: owner! }, allowLiveWrite: true },
      );
      const sentParsed = sent.json();
      const sentData = sentParsed.ok ? (sentParsed.value as { data?: unknown }).data : undefined;
      const sentRow = (Array.isArray(sentData) ? sentData[0] : sentData) as
        Record<string, unknown> | undefined;
      const msgID = sentRow?.msgID as number | string | undefined;
      test.skip(!msgID, `the group send did not return a msgID (replied ${sent.status})`);

      // --- The attack: an account with no relationship to this group asks for its read receipts ---
      const attack = await endpoints.sendTo(
        'katchup-read-status-group',
        { body: { msgID } },
        {
          label: 'idor:group-read-status-outsider',
          auth: { principal: outsider! },
          allowLiveRead: true,
        },
      );

      let leaked = false;
      if (attack.status < 300) {
        try {
          const parsed = JSON.parse(attack.bodyText || '{}') as { data?: unknown[] };
          leaked = Array.isArray(parsed.data) && parsed.data.length > 0;
        } catch {
          leaked = false;
        }
      }
      if (leaked) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-read-status-group',
          ruleId: 'IDOR-katchup-group-read-status-nonmember',
          rule:
            "getReadStatusGroupMessage must not reveal a group message's per-recipient read status " +
            'to a caller who is not a member of that group.',
          expected: 'empty data or a refusal for a non-member caller',
          actual: `replied ${attack.status} with non-empty read-receipt data for msgID ${msgID}`,
          request: { body: { msgID } },
        });
      }
      expect
        .soft(
          leaked,
          `BOLA: a non-member must not read this group message's read receipts (replied ${attack.status})`,
        )
        .toBe(false);
    } finally {
      if (groupID && groupKpostID) {
        await endpoints
          .sendTo(
            'group-remove-member',
            { body: { memberKpostIdList: [member!.username], groupID, groupKpostID } },
            {
              label: 'idor:group-cleanup-remove',
              auth: { principal: owner! },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
        await endpoints
          .sendTo(
            'group-delete',
            { body: { groupID } },
            {
              label: 'idor:group-cleanup-delete',
              auth: { principal: owner! },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
      }
    }
  });
});
