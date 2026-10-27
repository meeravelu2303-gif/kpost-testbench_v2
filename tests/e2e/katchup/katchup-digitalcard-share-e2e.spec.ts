import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openConversation } from '../support/katchup';
import { settleFrames } from '../support/settle';

/**
 * Katchup "Share digital card" (FR-K17): header avatar → Digital Card → Share → Katchup → pick a
 * contact → post, then verify delivery in the target's thread. One session; sends a real message.
 */
// The picker excludes the card's own owner, so the target is a different contact in the address book.
const SHARE_TARGET_CONTACT_ID = 'qatest3@kpostindia.com';
const SHARE_TARGET_SEARCH_TERM = 'Qatest3';

test.describe(
  'KPost Katchup · Digital Card share @ui',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'sends a real message; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    test("sharing a contact's Digital Card via Katchup actually sends it @ui", async ({ page }) => {
      await openConversation(page, testData.victimKpostId);

      // The thread header's avatar (ContactBar) opens the Digital Card.
      const headerAvatar = page
        .locator('.background-color-katchup')
        .locator('.font-Family-Nunito')
        .first();
      await headerAvatar.click({ timeout: 15_000 });

      // "View Profile" is always present, so it marks the modal as fully rendered.
      await expect(
        page.getByText('View Profile', { exact: true }).first(),
        'the Digital Card modal opens',
      ).toBeVisible({ timeout: 15_000 });

      const shareButton = page.locator('.dc-secondary-icon').first();
      await expect(shareButton, 'the Digital Card Share icon is available').toBeVisible({
        timeout: 15_000,
      });
      await shareButton.scrollIntoViewIfNeeded().catch(() => undefined);
      await shareButton.click({ timeout: 10_000 });

      const shareDialog = page.getByRole('dialog').filter({ hasText: 'Other Applications' });
      await expect(shareDialog, 'the share-target screen opens').toBeVisible({ timeout: 15_000 });
      await shareDialog.getByText('Katchup', { exact: true }).click();

      const recipientDialog = page.getByRole('dialog').filter({ hasText: 'Forward To' });
      await expect(recipientDialog, 'the Katchup recipient picker opens').toBeVisible({
        timeout: 15_000,
      });
      const searchBox = recipientDialog.getByRole('searchbox');
      await expect(searchBox, 'the recipient search box is available').toBeVisible({
        timeout: 10_000,
      });
      await searchBox.fill(SHARE_TARGET_SEARCH_TERM);
      await settleFrames(page);

      await expect(
        recipientDialog.getByText(SHARE_TARGET_SEARCH_TERM, { exact: false }),
        `the search narrows the contact list to ${SHARE_TARGET_SEARCH_TERM}`,
      ).toBeVisible({ timeout: 10_000 });

      // hideSelectAll=true here too — the search-narrowed list renders exactly one checkbox.
      const rowCheckbox = recipientDialog.getByRole('checkbox');
      await expect(rowCheckbox, "the target contact's own row checkbox is available").toBeVisible({
        timeout: 10_000,
      });
      await rowCheckbox.check();
      // In shareNote mode there is no "Done": the unlabeled post button (#963) sends the card.
      const post = page
        .locator('.shareNote_footerBG .post_button_size')
        .filter({ has: page.locator('.icon-KP_3164') })
        .first();
      await expect(
        post,
        'the share-note post button appears once a contact is selected',
      ).toBeVisible({ timeout: 10_000 });
      await post.click();

      await expect(
        page.getByText('Contact Shared successfully', { exact: false }),
        'the app confirms the share actually sent',
      ).toBeVisible({ timeout: 15_000 });

      // Verify delivery: open the target's own thread from the sender's side.
      await openConversation(page, SHARE_TARGET_CONTACT_ID);
      await expect(
        page.getByText('Sharing Kpost Digital Card', { exact: false }).first(),
        "the shared Digital Card message appears in the target's thread",
      ).toBeVisible({ timeout: 20_000 });
    });
  },
);
