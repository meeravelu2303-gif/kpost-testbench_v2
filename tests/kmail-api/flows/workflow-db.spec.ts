import { mailShape } from '@api/definitions/kmail/send.api';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { kmailDb, kmailFlag } from '@database/kmail-assertions';
import { KmailRepository } from '@database/repositories/kmail.repository';
import type { KmailTransactionRecord } from '@database/repositories/kmail.repository';
import { text } from '@database/kpost-assertions';
import { requireAll } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * KMail send → star → delete, asserted in MySQL. State lives on one transaction row per recipient,
 * not on the mail; the subject is encrypted at rest. There is no archive column, so none is asserted.
 * Sends real mail, so it needs KMAIL_LIFECYCLE=true and provisioned qatest_* accounts.
 */
test.describe(
  'KMail · lifecycle with MySQL assertions @api @kmail-api @kmail @database',
  { tag: ['@api', '@kmail', '@regression'] },
  () => {
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
      // Encryption at rest: a subject is stored, and it is not the plaintext.
      for (const check of kmailDb.subjectEncrypted(mail, subject)) {
        expect(check.status, `${check.name}: ${String(check.actual)}`).toBe('PASSED');
      }

      // One transaction row per recipient — the fan-out a single send produced.
      expect(rows, 'a single-recipient send creates exactly one transaction row').toHaveLength(1);
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
      expect(kmailFlag(row?.deleted_by_receiver), 'and not deleted for the recipient').toBe(
        'clear',
      );
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

      // The product decides which side's column it sets, so either one moving is enough.
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

      // KMail deletes per participant: the row must remain for the counterparty with one flag set.
      // A hard delete would lose their copy and look the same on the wire.
      expect(row, 'a per-side delete must leave the row for the counterparty').toBeDefined();
      const deleted =
        kmailFlag(row?.deleted_by_sender) === 'set' ||
        kmailFlag(row?.deleted_by_receiver) === 'set';
      expect(
        deleted,
        `delete reported success but neither deletion flag moved ` +
          `(deleted_by_sender=${String(row?.deleted_by_sender)}, deleted_by_receiver=${String(row?.deleted_by_receiver)})`,
      ).toBe(true);
    });
  },
);
