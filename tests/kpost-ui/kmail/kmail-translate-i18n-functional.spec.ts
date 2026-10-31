import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openReceivedMail } from '../support/kmail';
import { toast } from '../support/validation';

/**
 * KMail's translate icon must work whatever language the header is set to. The icon passes the
 * literal "Translate" (KmailMessageBox.js), but KmailMessage.js wriemailboxOpen compares it with
 * t("Translate"), so in any other language it falls through to "This mail action is not available."
 * Read-only: the language is set back to English afterwards.
 */
test.describe(
  'KPost KMail · the translate icon works in every header language',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.skip(
      !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
      'needs the 2nd QA account (QA_VICTIM_KPOST_ID)',
    );

    test('in the Russian UI the translate icon opens the language list, not "This mail action is not available."', async ({
      page,
    }) => {
      try {
        await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.locator('select.Header_Language').first().selectOption('russian');
        const box = await openReceivedMail(page);
        await box.locator('.icon-KP_75-translate').first().click();
        // What the user is shown instead, if anything (the message itself is translated).
        const shown = await page
          .locator('.Toastify__toast')
          .first()
          .textContent({ timeout: 5_000 })
          .catch(() => null);
        if (shown)
          test.info().annotations.push({ type: 'observed', description: `toast: ${shown}` });
        await expect(
          page.getByRole('dialog').filter({ visible: true }).last(),
          'the translate language list opens',
        ).toBeVisible({ timeout: 10_000 });
        await expect(
          toast(page, 'This mail action is not available.'),
          'the icon is not refused as an unknown action',
        ).toHaveCount(0);
      } finally {
        await page
          .goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 })
          .catch(() => undefined);
        await page
          .locator('select.Header_Language')
          .first()
          .selectOption('english')
          .catch(() => undefined);
        await page
          .evaluate(() => localStorage.setItem('i18nextLng', 'english'))
          .catch(() => undefined);
      }
    });
  },
);
