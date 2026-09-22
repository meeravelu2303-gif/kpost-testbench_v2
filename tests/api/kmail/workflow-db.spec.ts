import { mailShape } from '@api/definitions/kmail/send.api';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { kmailDb, kmailFlag } from '@database/kmail-assertions';
import { KmailRepository } from '@database/repositories/kmail.repository';
import type { KmailTransactionRecord } from '@database/repositories/kmail.repository';
import { text } from '@database/kpost-assertions';
import { requireAll } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * The KMail lifecycle asserted across API and MySQL: send → star → delete.
 *
 * Schema, and the three ways it contradicts the obvious assumption: `docs/KMAIL-SCHEMA.md`. The
 * two that shape this file:
 *
 *  - **Per-recipient state is not on the mail.** `TBL_KPOST_KMAIL_MASTER` holds the mail once;
 *    read, star, delete and recall are columns on `TBL_KPOST_KMAIL_TRANSACTION`, one row per
 *    recipient. So every state assertion below is made against a *recipient row*, not a mail.
 *  - **The subject is encrypted at rest.** Asserting it equals the text that was sent would fail on
 *    a healthy API, so the spec asserts the inverse — that it is stored and is *not* the plaintext,
 *    which is a real security check rather than a way around the problem.
 *
 * ## Archive is deliberately absent
 *
 * There is no archive column anywhere in the KMail tables (searched for `archiv`, `star`, `favou`
 * and `flag`). Writing an archive assertion would mean inventing a column and producing a test that
 * passes because it checks nothing. The marked/starred pair is the real equivalent and is what this
 * asserts instead; the archive question is recorded in the schema doc for the owner.
 *
 * ## Why this is gated twice
 *
 * **The mail server is LIVE**, so a send here delivers a real mail — the database being a test
 * database does not make the mail fake. It therefore needs `KMAIL_LIFECYCLE=true` (the existing
 * opt-in for real mail) *and* provisioned `qatest_*` accounts, so that the only mailboxes it can
 * ever reach are ones the bench owns. With either missing it skips with the reason attached rather
 * than falling back to another account.
 *
 * Each write also passes `allowLiveWrite: true` — the per-call authorization the executor requires
 * for a `data` write on the live application. It unlocks nothing else: `external`/`global` side
 * effects stay blocked, and the QA-identifier guard still refuses any payload naming a record we do
 * not own. It is set here, per call, because the repo owner signed this flow off explicitly (2026-09-21).
 */
test.describe('KMail · lifecycle with MySQL assertions @api @kmail-api @kmail', () => {
  // Gated while KMail refuses every valid token — see src/fixtures/kmail-auth-gate.ts.
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');

  test.describe.configure({ mode: 'serial' });
  test.skip(
    process.env.KMAIL_LIFECYCLE !== 'true',
    'sends real mail on a LIVE mail server; set KMAIL_LIFECYCLE=true to run',
  );

  const subject = `QA Bench KMail ${Date.now()}`;
  let kmailId: number | undefined;
  let transactionId: number | undefined;

  /** Both parties, or the reason the flow cannot run. Resolved once, used by every step. */
  const parties = requireAll('primary', 'counterparty');

  test.skip(!parties.ok, parties.ok ? '' : parties.reason);

  test('send: the mail and one transaction row per recipient exist in MySQL', async ({
    endpoints,
    databases,
  }) => {
    test.skip(!parties.ok, 'needs provisioned qatest_* accounts');
    const database = databases.for('kmail-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection to assert persistence');

    const [sender, receiver] = parties.ok ? parties.accounts : [];
    if (!sender || !receiver) return;

    const exchange = await endpoints.sendTo(
      'kmail-post-mail',
      { body: mailShape({ toAddress: receiver.kpostId, kmailSubject: subject }) },
      { label: 'kmail-workflow:send', allowLiveWrite: true },
    );
    expect(exchange.status, 'the send succeeds').toBeLessThan(300);

    const parsed = exchange.json();
    const data = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
    const created = Array.isArray(data) ? (data[0] as Record<string, unknown>) : data;
    const id = (created as Record<string, unknown> | undefined)?.kmailID;
    expect(id, 'the response carries the created kmailID').toBeDefined();
    kmailId = Number(id);

    const repo = new KmailRepository(database);
    const mail = await repo.mail(kmailId);
    const rows = await repo.recipients(kmailId);

    expect(mail, 'TBL_KPOST_KMAIL_MASTER holds the mail').toBeDefined();
    /*
     * Encryption at rest, asserted as two halves: something was stored, and it is not the plaintext.
     * A stored subject equal to what was sent would be a security regression no response reveals.
     */
    for (const check of kmailDb.subjectEncrypted(mail, subject)) {
      expect(check.status, `${check.name}: ${String(check.actual)}`).toBe('PASSED');
    }

    // One transaction row per recipient — the fan-out a single send produced.
    expect(rows.length, 'a single-recipient send creates exactly one transaction row').toBe(1);
    const row: KmailTransactionRecord | undefined = rows[0];
    for (const check of kmailDb.addressedTo(row, {
      kmailId: kmailId,
      receiver: receiver.kpostId,
      sender: sender.kpostId,
    })) {
      expect(
        check.status,
        `${check.name}: expected ${String(check.expected)}, got ${String(check.actual)}`,
      ).toBe('PASSED');
    }
    transactionId = Number(row?.id);

    // A mail nobody has touched: not read, not starred, not deleted for either side.
    expect(kmailFlag(row?.read_status), 'a new mail is unread').toBe('clear');
    expect(kmailFlag(row?.marked_by_receiver), 'and unstarred').toBe('clear');
    expect(kmailFlag(row?.deleted_by_sender), 'and not deleted for the sender').toBe('clear');
    expect(kmailFlag(row?.deleted_by_receiver), 'and not deleted for the recipient').toBe('clear');
    // `receiver_name` is the one genuine BLOB in this table.
    expect(text(row?.receiver_name), 'receiver_name decodes to a readable name').toBeTruthy();
  });

  test('star: setKmailAsImportant flips a marked_by_* flag', async ({ endpoints, databases }) => {
    test.skip(!parties.ok || kmailId === undefined, 'needs the mail sent by the first step');
    const database = databases.for('kmail-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const exchange = await endpoints.sendTo(
      'kmail-set-important',
      { body: { kmailID: kmailId } },
      { label: 'kmail-workflow:star', allowLiveWrite: true },
    );
    expect(exchange.status, 'the mail is accepted as important').toBeLessThan(300);

    const rows = await new KmailRepository(database).recipients(kmailId ?? 0);
    const row = rows[0];

    /*
     * Either side may be the one recorded — the caller is the sender here, but the product decides
     * which column it owns. Asserting a specific column would encode a guess; asserting that ONE of
     * them moved is the claim the API actually made.
     */
    const marked =
      kmailFlag(row?.marked_by_sender) === 'set' || kmailFlag(row?.marked_by_receiver) === 'set';
    expect(
      marked,
      `setKmailAsImportant reported success but neither marked flag moved ` +
        `(marked_by_sender=${String(row?.marked_by_sender)}, marked_by_receiver=${String(row?.marked_by_receiver)})`,
    ).toBe(true);
  });

  test('delete: the row survives with a per-side soft-delete flag', async ({
    endpoints,
    databases,
  }) => {
    test.skip(
      !parties.ok || kmailId === undefined || transactionId === undefined,
      'needs the mail sent by the first step',
    );
    const database = databases.for('kmail-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const exchange = await endpoints.sendTo(
      'kmail-delete',
      { body: { groupFlag: false, transactionIDs: [transactionId] } },
      { label: 'kmail-workflow:delete', allowLiveWrite: true },
    );
    expect(exchange.status, 'the delete is accepted').toBeLessThan(300);

    const rows = await new KmailRepository(database).recipients(kmailId ?? 0);
    const row = rows[0];

    /*
     * The assertion that matters, and the one no response can make. KMail deletes per participant,
     * so the ROW must remain for the counterparty with one flag set. A hard delete would take the
     * other party's copy too — data loss that looks identical to a correct soft delete on the wire.
     */
    expect(row, 'a per-side delete must leave the row for the counterparty').toBeDefined();
    const deleted =
      kmailFlag(row?.deleted_by_sender) === 'set' || kmailFlag(row?.deleted_by_receiver) === 'set';
    expect(
      deleted,
      `delete reported success but neither deletion flag moved ` +
        `(deleted_by_sender=${String(row?.deleted_by_sender)}, deleted_by_receiver=${String(row?.deleted_by_receiver)})`,
    ).toBe(true);
  });
});
