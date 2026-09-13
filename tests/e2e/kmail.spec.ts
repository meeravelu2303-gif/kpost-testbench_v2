import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The **KMail** screen on the live front end, across all browsers, using the session `setup` saved.
 *
 * Read-only screen check (KMail's own API module is a later target). Structural selectors from
 * `components/Kmail/Kmail.js` (`docs/ui-screens.md`). The `<Knews>`/`<Ecommerce>` fillers sit in the
 * right columns before a mail is opened, so the assertion anchors on the KMail shell, not those.
 */
test.describe('KPost KMail screen', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the KMail screen loads for a logged-in user @ui', async ({ page }) => {
    await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page, 'an authenticated user reaches KMail').toHaveURL(/\/kmail/);

    // The KMail workspace shell, or the KMail nav icon as a fallback anchor.
    await expect(
      page.locator('.kmail-layout-shell, .icon-KP_03-KMail').first(),
      'the KMail workspace renders',
    ).toBeVisible({ timeout: 20_000 });
  });
});
