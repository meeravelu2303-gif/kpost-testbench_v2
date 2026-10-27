import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  EDITOR,
  deleteSentMessage,
  messageBySubject,
  openBellMenu,
  openComposer,
  openConversation,
  sendMessage,
} from '../support/katchup';
import { settleFrames } from '../support/settle';

/** A contact in the QA account's address book other than `victimKpostId`: Forward hides the open
 * thread's counterpart from its recipient list. */
const FORWARD_TARGET_CONTACT_ID = 'qatest3@kpostindia.com';
const FORWARD_TARGET_SEARCH_TERM = 'Qatest3';

/**
 * Katchup Forward end to end: bell menu → Forward → pick one contact → Done → send, then verify the
 * copy in the target's thread. "Done" only stores the selection; the unlabeled post button (#963) sends.
 * Writes real messages and deletes them afterwards.
 */
test.describe(
  'KPost Katchup · Forward sub-flow completion @ui',
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

    test('Forward opens the recipient picker, narrows to one real contact, and the forward actually sends @ui', async ({
      page,
    }) => {
      const sourceSubject = `QA UI Forward source ${Date.now()}`;
      await openComposer(page);
      const source = await sendMessage(page, sourceSubject, 'QA UI Forward — source message');

      await openBellMenu(page, source);
      const forwardItem = page.getByRole('menuitem', { name: /Forward\s*$/i });
      await expect(forwardItem, 'the bell menu offers Forward').toBeVisible({ timeout: 15_000 });
      await forwardItem.click();
      await expect(forwardItem, 'Forward was accepted (menu item dismissed)').toBeHidden({
        timeout: 15_000,
      });

      // The circular "Forward To" trigger appears once a message is staged for forwarding.
      const forwardToTrigger = page
        .locator('[class*="blueBack"], [style*="border-radius: 50%"]')
        .filter({ has: page.locator('svg, img') })
        .last();
      await forwardToTrigger.click({ timeout: 15_000 }).catch(async () => {
        // Fallback: the most generic circular icon near the forward footer.
        await page.locator('div[style*="border-radius"]').last().click({ timeout: 10_000 });
      });

      // Scope to the dialog so lookups never hit the Katchup page behind it.
      const recipientDialog = page.getByRole('dialog').filter({ hasText: 'Forward To' });
      await expect(recipientDialog, 'the Forward To recipient picker opens').toBeVisible({
        timeout: 15_000,
      });
      const searchBox = recipientDialog.getByRole('searchbox');
      await expect(searchBox, 'the recipient search box is available').toBeVisible({
        timeout: 10_000,
      });
      // The search matches display name, not kpostID/email.
      await searchBox.fill(FORWARD_TARGET_SEARCH_TERM);
      await settleFrames(page);

      const narrowed = await recipientDialog
        .getByText(FORWARD_TARGET_SEARCH_TERM, { exact: false })
        .first()
        .isVisible({ timeout: 10_000 })
        .catch(() => false);
      test.skip(
        !narrowed,
        `no contact matching "${FORWARD_TARGET_SEARCH_TERM}" is in this account's address book right now — nothing to forward to`,
      );

      // Narrowed to one contact there are two checkboxes: "Select All" (first) and the row (last).
      const rowCheckbox = recipientDialog.getByRole('checkbox').last();
      await expect(rowCheckbox, "the target contact's own row checkbox is available").toBeVisible({
        timeout: 10_000,
      });
      await rowCheckbox.check();

      const doneButton = recipientDialog.getByRole('button', { name: /^Done$/i });
      await expect(doneButton, 'Done is available once a contact is selected').toBeVisible({
        timeout: 5_000,
      });
      await doneButton.click();
      await settleFrames(page);

      // Back in the forward view: the final send button (post_button_size, no accessible name — #963).
      const finalSend = page.locator('.post_button_size').last();
      await expect(
        finalSend,
        'the final Forward send button is enabled once a recipient is picked',
      ).toBeEnabled({
        timeout: 10_000,
      });
      await finalSend.click();

      // Verify delivery in the sender's own thread with the target; no second session needed.
      await page
        .locator(EDITOR)
        .first()
        .waitFor({ state: 'hidden', timeout: 5_000 })
        .catch(() => undefined);
      await openConversation(page, FORWARD_TARGET_CONTACT_ID);
      await expect(
        page.getByText('QA UI Forward — source message', { exact: false }).first(),
        'the forwarded message content appears in the sender-target thread (forward actually sent)',
      ).toBeVisible({ timeout: 20_000 });

      // Clean up the sender's copies; the recipient's received copy cannot be deleted (BR-KU-RECALL).
      const forwardedCopySubject = messageBySubject(page, sourceSubject);
      if (await forwardedCopySubject.count()) {
        await deleteSentMessage(page, sourceSubject);
      }
      await openConversation(page, testData.victimKpostId);
      if (await messageBySubject(page, sourceSubject).count()) {
        await deleteSentMessage(page, sourceSubject);
      }
    });
  },
);
