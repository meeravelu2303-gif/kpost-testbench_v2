import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { A, B, call, deleteEverywhere, marker, sendMail, threadRow } from '../support/kmail-rules';

/**
 * KMail manage rules (delete, star) on ids the caller does not hold, read from the KMail backend
 * (D:\KPOST_PROJECTS\Kpost_Kmail_5.0, kmail5_qa): CommonMailController.deleteKmailWithDeletedBy /
 * setKmailAsImportant and CommonMailServiceImpl. Cross-user ownership is covered by
 * authorization/kmail-mutation-idor-authorization.spec.ts; these tests cover an empty list and ids that exist for nobody.
 * Gated by KMAIL_LIFECYCLE=true like the KMail flows.
 */

// Far above any auto-increment id, so it names no real mail or transaction.
const UNKNOWN_ID = 9_007_199_254_740_000;

test.describe('KMail manage · input rules', { tag: ['@api', '@kmail', '@regression'] }, () => {
  test.describe.configure({ mode: 'default', timeout: 120_000 });
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  test.skip(
    process.env.KMAIL_LIFECYCLE !== 'true',
    'writes real KMail data; set KMAIL_LIFECYCLE=true',
  );
  test.skip(!testData.kpostId || !testData.victimKpostId, 'needs two QA accounts');

  test(
    'delete with an empty or missing transaction list is refused with 400',
    { annotation: [{ type: 'requirement-partial', description: 'FR-M07' }] },
    async ({ endpoints }) => {
      // @NotNull + @NotEmpty transactionIDs under @Valid (DeleteKmailRequestObject.java:24-26,
      // CommonMailController.java:546-548).
      for (const [label, body] of [
        ['empty list', { groupFlag: false, transactionIDs: [] }],
        ['missing list', { groupFlag: false }],
      ] as Array<[string, Record<string, unknown>]>) {
        const r = await call(endpoints, 'kmail-delete', A, body, `manage-rules:${label}`);
        expect.soft(r.status, `${label} is refused with 400`).toBe(400);
      }
    },
  );

  test(
    'delete of a transaction id that exists for nobody is a 4xx, not a 500',
    { annotation: [{ type: 'requirement-partial', description: 'FR-M07' }] },
    async ({ endpoints }) => {
      // CommonMailController.java:553-563 answers 500 whenever no row was updated, so a client
      // error (an id the caller does not hold) is reported as a server fault.
      const body = { groupFlag: false, transactionIDs: [UNKNOWN_ID] };
      const r = await call(endpoints, 'kmail-delete', A, body, 'manage-rules:delete-unknown');
      if (r.status >= 500) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kmail-delete',
          ruleId: 'KMAIL-delete-unknown-id-4xx',
          rule: 'deleteKmailWithDeletedBy must answer a 4xx for a transaction id the caller does not hold; it answers 500 when nothing was updated (CommonMailController.java:559-563).',
          expected: '400/404, nothing changed',
          actual: `deleteKmailWithDeletedBy answered ${r.status} for transactionID ${UNKNOWN_ID}`,
          request: { body },
        });
      }
      expect.soft(r.status, 'an unknown id is refused').toBeGreaterThanOrEqual(400);
      expect.soft(r.status, 'and not as a server error').toBeLessThan(500);
    },
  );

  test(
    'starring a mail id that exists for nobody is refused with 400',
    { annotation: [{ type: 'requirement-partial', description: 'FR-M07' }] },
    async ({ endpoints }) => {
      // Neither the sender nor the receiver update matches → 400 (CommonMailServiceImpl.java:1036-1047,
      // CommonMailController.java:588-592).
      const r = await call(
        endpoints,
        'kmail-set-important',
        A,
        { kmailID: UNKNOWN_ID },
        'manage-rules:star-unknown',
      );
      expect.soft(r.status, 'an unknown kmailID is a 400').toBe(400);
    },
  );

  test(
    'delete of your own transactions together with an unknown one does not fail the whole call with a 500',
    { annotation: [{ type: 'requirement-partial', description: 'FR-M07' }] },
    async ({ endpoints }) => {
      // CommonMailServiceImpl.deleteKmailWithDeletedBy (:973) walks the ids one by one; an id the
      // caller does not hold must not turn a valid delete of their own mail into a server error.
      const sent = await sendMail(
        endpoints,
        { kmailSubject: marker('mixed-delete') },
        'manage-rules:send',
      );
      try {
        expect(sent.kmailID, 'the mail is sent').toBeDefined();
        const row = await threadRow(endpoints, A, B.username, sent.kmailID!);
        const own = (row?.kmailTransactionList ?? []).map((t) => t.transactionID);
        expect(own.length, 'the sender sees its transaction').toBeGreaterThan(0);
        const body = { groupFlag: false, transactionIDs: [...own, UNKNOWN_ID] };
        const r = await call(endpoints, 'kmail-delete', A, body, 'manage-rules:delete-mixed');
        expect.soft(r.status, 'the mixed delete is not a server error').toBeLessThan(500);
        const after = await threadRow(endpoints, A, B.username, sent.kmailID!);
        const stillShown = (after?.kmailTransactionList ?? []).filter(
          (t) => t.deleteBySender !== 'Y',
        ).length;
        expect.soft(stillShown, 'the sender’s own copy is deleted').toBe(0);
      } finally {
        await deleteEverywhere(endpoints, sent.kmailID);
      }
    },
  );
});
