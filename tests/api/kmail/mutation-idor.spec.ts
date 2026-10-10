import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { kmailFlag } from '@database/kmail-assertions';
import { KmailRepository } from '@database/repositories/kmail.repository';
import { expect, test } from '@fixtures';

/**
 * KMail mutation IDOR — can an outsider star or delete a mail they neither sent nor received?
 *
 * `setKmailAsImportant`/`kmailDelete` take a bare `kmailID`/`transactionID` and nothing else that
 * ties it to the caller — the same object-handle shape proven exploitable for KMail's attachment
 * routes (`attachment-idor.spec.ts`, bug #944) and for Group's `removeGroupMember` (#507). Before
 * this, KMail's mutation endpoints had zero IDOR coverage of any kind (see the 2026-10-03
 * ground-truth re-audit): the only real finding was the attachment-by-UUID one, on a different class
 * of endpoint (reads keyed by a file UUID, not these writes keyed by a transaction/mail id).
 *
 * ## The database is the judge
 *
 * Both endpoints answer SUCCESS regardless, so the verdict is the row: after the outsider's
 * attempt, the LEGITIMATE pair's `marked_by_*`/`deleted_by_*` flags in `TBL_KPOST_KMAIL_TRANSACTION`
 * must be unchanged — same discipline as `workflow-db.spec.ts`'s own lifecycle assertions.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // sender
const B = K.principals.find((p) => p.key === 'victim')!; // legitimate recipient
const C = K.principals.find((p) => p.key === 'personal-3')!; // attacker — no relationship to this mail

test.describe('KMail · mutation-endpoint IDOR (star/delete) @api @kmail-api @kmail @security', () => {
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  test.skip(process.env.KMAIL_LIFECYCLE !== 'true', 'sends a real mail; set KMAIL_LIFECYCLE=true');

  test('an outsider cannot star or delete a mail they did not send or receive @api @security', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kmail-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

    let kmailId: number | undefined;

    try {
      // --- Setup: A sends a real mail to B -----------------------------------------------------
      const sent = await endpoints.sendTo(
        'kmail-post-mail',
        {
          body: mailShape({
            toAddress: B.username,
            kmailSubject: `QA IDOR mutation proof ${Date.now()}`,
          }),
        },
        { label: 'idor:kmail-send', auth: { principal: A }, allowLiveWrite: true },
      );
      const parsed = sent.json();
      const data = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
      const created = Array.isArray(data) ? (data[0] as Record<string, unknown>) : data;
      kmailId = Number((created as Record<string, unknown> | undefined)?.kmailID);

      test.skip(
        !kmailId || Number.isNaN(kmailId),
        `kmail-post-mail did not return a kmailID to attack (send replied ${sent.status})`,
      );

      const repo = new KmailRepository(database);
      const before = (await repo.recipients(kmailId))[0];
      const transactionId = before?.id;

      test.skip(!transactionId, 'no transaction row was created to attack');

      // --- Attack: the outsider tries to star, then delete, the owner/receiver's mail -----------
      const attackStar = await endpoints.sendTo(
        'kmail-set-important',
        { body: { kmailID: kmailId } },
        { label: 'idor:kmail-star', auth: { principal: C }, allowLiveWrite: true },
      );
      const attackDelete = await endpoints.sendTo(
        'kmail-delete',
        { body: { groupFlag: false, transactionIDs: [transactionId] } },
        { label: 'idor:kmail-delete', auth: { principal: C }, allowLiveWrite: true },
      );

      const after = (await repo.recipients(kmailId))[0];

      expect
        .soft(
          kmailFlag(after?.marked_by_sender) === 'set' ||
            kmailFlag(after?.marked_by_receiver) === 'set',
          `BOLA: an outsider must not star a mail they did not send or receive ` +
            `(setKmailAsImportant replied ${attackStar.status})`,
        )
        .toBe(false);
      expect
        .soft(
          kmailFlag(after?.deleted_by_sender) === 'set' ||
            kmailFlag(after?.deleted_by_receiver) === 'set',
          `BOLA: an outsider must not delete a mail they did not send or receive ` +
            `(kmailDelete replied ${attackDelete.status})`,
        )
        .toBe(false);
    } finally {
      // Cleanup: the owner deletes their own mail so nothing is left dangling.
      if (kmailId) {
        const repo = new KmailRepository(database);
        const rows = await repo.recipients(kmailId).catch(() => []);
        const ownTransactionId = rows[0]?.id;
        if (ownTransactionId) {
          await endpoints
            .sendTo(
              'kmail-delete',
              { body: { groupFlag: false, transactionIDs: [ownTransactionId] } },
              { label: 'idor:kmail-cleanup', auth: { principal: A }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        }
      }
    }
  });
});
