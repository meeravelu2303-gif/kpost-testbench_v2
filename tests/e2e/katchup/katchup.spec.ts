import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Katchup screen basics with the saved session: it loads, has the contact search and the compose
 * entry point. Read-only; the app has no data-testid hooks, so locators are structural.
 */
test.describe('KPost Katchup screen', { tag: ['@ui', '@katchup', '@regression'] }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the Katchup screen loads for a logged-in user @ui', async ({ page }) => {
    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // A logged-out session is bounced to /login; staying on /katchup proves the saved session works.
    await expect(page, 'an authenticated user reaches Katchup').toHaveURL(/\/katchup/);
    await expect(page.getByText('Katchup', { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('the contact list / search is present @ui', async ({ page }) => {
    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // The contact search box (placeholder "Search…") — the entry point to any conversation.
    await expect(page.locator('[placeholder*="Search" i]').first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('the compose entry point is available on the Katchup workspace @ui', async ({ page }) => {
    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // The Subject field only mounts in an open conversation (and not on Firefox's landing page), so
    // the write-message icon is the cross-browser check.
    await expect(
      page.locator('.icon-KP_02-Write-Letter').first(),
      'the write-message entry point is on the Katchup workspace',
    ).toBeVisible({ timeout: 20_000 });
  });
});
