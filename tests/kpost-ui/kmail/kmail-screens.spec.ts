import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The KMail screen, read-only, on every browser. Anchors on the KMail shell, not the filler columns.
 */
test.describe('KPost KMail screen', { tag: ['@ui', '@kmail', '@regression'] }, () => {
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
