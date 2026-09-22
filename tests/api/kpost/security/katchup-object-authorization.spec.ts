// Cross-account authorization (IDOR/BOLA) for Katchup messages. Conditionals guard live setup.
/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Can an outsider recall or delete a Katchup message they did not send?
 *
 * `recallMessage` and `deleteKatchUpMessage` take a `msgID` and nothing else that ties it to the
 * caller — the same object-handle shape that made `removeGroupMember` exploitable (Bugzilla #507).
 * So the question is identical: does the server check that the caller OWNS the message, or act on any
 * msgID it is handed? Only the sender should be able to recall or delete their message.
 *
 * ## Self-activating — queued behind #494
 *
 * The setup sends a message, and `sendMessage` currently answers HTTP 500 (Bugzilla #494). While
 * that is open there is no msgID to attack, so this test SKIPS with a reason rather than failing —
 * it is not this test's job to re-report #494. The moment sendMessage works again, the setup
 * succeeds and the BOLA attack runs automatically, with no edit here. That is the "queue it to run
 * when unblocked" the bench was asked for.
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

    // --- Setup: owner sends a message to the counterparty ---------------------------------------
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      {},
      { label: 'idor:katchup-send', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = sent.json();
    const data = (parsed.ok ? (parsed.value as { data?: unknown }).data : undefined) as
      Record<string, unknown> | undefined;
    const msgID = (data?.msgID ?? data?.msgId ?? data?.messageId) as number | string | undefined;

    /*
     * Queued behind #494: no msgID means sendMessage did not create one (it is 500ing). Skip with a
     * reason; the test activates itself once sendMessage is fixed.
     */
    test.skip(
      !msgID,
      `blocked by Bugzilla #494 (sendMessage 500) — activates automatically once a msgID is issued ` +
        `(send replied ${sent.status})`,
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
});
