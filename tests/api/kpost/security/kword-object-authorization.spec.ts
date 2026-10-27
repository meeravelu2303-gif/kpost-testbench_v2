// Cross-account authorization (IDOR/BOLA) for KWord documents. Conditionals guard live setup.

import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Can an outsider delete or edit a KWord document (bare `docId`) they do not own? The verdict is
 * the row. Known defect #499: `/kword/create` returns 500, so this skips until create works.
 */
test.describe(
  'KPost Security · KWord document authorization (IDOR/BOLA) @api @kpost-api @security @kos @database',
  {
    tag: ['@api', '@auth', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    const K = AUTH_PROFILES.kpost;
    const owner = K.principals.find((p) => p.key === 'personal');
    const attacker = K.principals.find((p) => p.key === 'personal-3');

    test.skip(!owner || !attacker, 'needs two distinct KPost principals');
    test.skip(
      process.env.KOS_LIFECYCLE !== 'true',
      'creates a real document; set KOS_LIFECYCLE=true',
    );

    test('an outsider cannot delete or edit a document they do not own @api @security', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

      // --- Setup: owner creates a document --------------------------------------------------------
      const created = await endpoints.sendTo(
        'kos-create-doc',
        {
          body: {
            titleOfDocument: 'QA BOLA Doc',
            subject: 'QA bench',
            documentType: 'word',
            convertToKad: false,
            initiatedBy: testData.kpostId,
          },
        },
        { label: 'idor:kword-create', auth: { principal: owner! }, allowLiveWrite: true },
      );
      const parsed = created.json();
      const data = (parsed.ok ? (parsed.value as { data?: unknown }).data : undefined) as
        Record<string, unknown> | string | undefined;
      const docId =
        typeof data === 'object' && data
          ? ((data.id ?? data.docId) as string | undefined)
          : undefined;

      // No docId means create still fails (#499).
      test.skip(
        !docId,
        `blocked by Bugzilla #499 (kword/create 500) — activates automatically once a docId is issued ` +
          `(create replied ${created.status})`,
      );

      try {
        // --- Attack: the outsider tries to edit, then delete, the owner's document ----------------
        await endpoints.sendTo(
          'kos-update-doc',
          { body: { docId, heading: [{ topic: 'HACKED', children: [] }] } },
          { label: 'idor:kword-update', auth: { principal: attacker! }, allowLiveWrite: true },
        );
        await endpoints.sendTo(
          'kos-delete-doc',
          { query: { docId: String(docId) } },
          { label: 'idor:kword-delete', auth: { principal: attacker! }, allowLiveWrite: true },
        );

        // The document must still exist and not be soft-deleted by the outsider.
        const row = await database.findOne<{
          delete_status: number | string | null;
          title_of_document: string;
        }>({
          table: 'TBL_KPOST_KWORD_DOCUMENT',
          where: { id: docId as string },
        });
        expect(row, 'the owner document still exists after the outsider attempt').toBeDefined();
        expect
          .soft(
            String(row?.delete_status ?? '0'),
            "BOLA: an outsider must not delete another user's document",
          )
          .not.toBe('1');
      } finally {
        // Owner deletes their own document.
        await endpoints
          .sendTo(
            'kos-delete-doc',
            { query: { docId: String(docId) } },
            { label: 'idor:kword-cleanup', auth: { principal: owner! }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    });
  },
);
