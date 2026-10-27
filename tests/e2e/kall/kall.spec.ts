import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Read-only: the Kall screen renders its layout, tabs and contact search. Locators are structural
 * classes (no data-testid hooks). Placing a call is left to the API lifecycle.
 */
test.describe('KPost Kall screen', { tag: ['@ui', '@kall', '@regression'] }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the kall screen loads for a logged-in user @ui', async ({ page }) => {
    await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page, 'an authenticated user reaches the kall screen').toHaveURL(/\/kall/);

    // The Kall workspace shell (`.kall-layout-shell`) — the two-column call layout.
    await expect(
      page.locator('.kall-layout-shell, .icon-KP_05-Kall').first(),
      'the kall workspace renders',
    ).toBeVisible({ timeout: 20_000 });
  });

  test('the kall screen offers contact search and the call tabs @ui', async ({ page }) => {
    await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // The contact search (placeholder "Search") or the tab strip (`.tabs-wrapper`) proves the panel
    // mounted.
    await expect(
      page
        .getByPlaceholder(/^search$/i)
        .or(page.locator('.tabs-wrapper'))
        .first(),
      'the contact search or the call tabs are present',
    ).toBeVisible({ timeout: 20_000 });
  });
});
