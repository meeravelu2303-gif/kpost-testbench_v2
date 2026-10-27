import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  deleteSentMessage,
  messageBySubject,
  openBellMenu,
  openComposer,
  sendMessage,
} from '../support/katchup';
import { settleFrames } from '../support/settle';
import { openConversation } from '../support/katchup';

/**
 * Katchup bell-menu Transfer → Katchup: pick one contact, press Done (which sends in one step), and
 * the content arrives. Gated behind KATCHUP_UI_LIFECYCLE; deletes the source message.
 */
test.describe(
  'KPost Katchup · Transfer sub-flow completion @ui',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'writes real messages; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    test('Transfer opens the Katchup recipient picker, selects one real contact, and the transfer actually sends @ui', async ({
      page,
    }) => {
      const sourceSubject = `QA UI Transfer source ${Date.now()}`;
      await openComposer(page);
      const source = await sendMessage(page, sourceSubject, 'QA UI Transfer — source message');

      await openBellMenu(page, source);
      const transferItem = page.getByRole('menuitem', { name: /Transfer/i });
      await expect(transferItem, 'the bell menu offers Transfer').toBeVisible({ timeout: 15_000 });
      await transferItem.click();

      // Scope to the dialog: the "Katchup" label also appears in the left nav and elsewhere.
      const transferDialog = page.getByRole('dialog').filter({ hasText: 'Transfer Message' });
      await expect(transferDialog, 'the Transfer Message modal opens').toBeVisible({
        timeout: 15_000,
      });

      await transferDialog.getByText('Katchup', { exact: true }).click();

      const recipientDialog = page.getByRole('dialog').filter({ hasText: 'Forward To' });
      await expect(recipientDialog, 'the Katchup recipient picker opens').toBeVisible({
        timeout: 15_000,
      });

      // The search matches by display name, not kpostID/email.
      const searchBox = recipientDialog.getByRole('searchbox');
      await expect(searchBox, 'the recipient search box is available').toBeVisible({
        timeout: 10_000,
      });
      // The picker excludes the open thread's counterpart, so the target is a third contact (Qatest3).
      await searchBox.fill('Qatest3');
      await settleFrames(page);

      // Row-level scoping is unreliable here; the search leaves exactly one checkbox to grab.
      const narrowed = await recipientDialog
        .getByText(/Qatest3/i)
        .first()
        .isVisible({ timeout: 10_000 })
        .catch(() => false);
      test.skip(
        !narrowed,
        'no contact matching "Qatest3" is in this account\'s address book right now — nothing to transfer to',
      );
      const rowCheckbox = recipientDialog.getByRole('checkbox').first();
      await expect(rowCheckbox, "the target contact's own row checkbox is available").toBeVisible({
        timeout: 10_000,
      });
      await rowCheckbox.check();

      await expect(
        recipientDialog.getByText(/1 Contacts? Selected/i),
        'the picker reflects one contact selected before Done is pressed',
      ).toBeVisible({ timeout: 10_000 });

      // Done sends the transfer itself; there is no separate send button.
      await recipientDialog.getByRole('button', { name: /^Done$/i }).click();

      // The sender's own thread with the recipient shows the transfer, so no second session is needed.
      await openConversation(page, 'qatest3@kpostindia.com');
      await expect(
        page.getByText('QA UI Transfer — source message', { exact: false }).first(),
        'the transferred message content appears in the sender-recipient thread (transfer actually sent)',
      ).toBeVisible({ timeout: 20_000 });
      // Back to the source thread for the self-clean below.
      await openConversation(page, testData.victimKpostId);

      // Delete the source; the copy in the recipient's account is left alone.
      if (await messageBySubject(page, sourceSubject).count()) {
        await deleteSentMessage(page, sourceSubject);
      }
    });
  },
);
