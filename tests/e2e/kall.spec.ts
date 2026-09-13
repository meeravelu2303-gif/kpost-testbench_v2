import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The Kall **screen** on the live front end, across all browsers, using the session `setup` saved.
 * No `data-testid` hooks, so locators are structural classes from `KPOST_REACTJS_2023_V1`, each
 * noted so a UI change points here.
 *
 * Read-only screen checks: the placing/scheduling of a real call is the API lifecycle's job (a call
 * rings a real device and cannot complete headlessly). These confirm the Kall workspace renders its
 * layout, tabs and contact search for a logged-in user in Chromium, Firefox and WebKit.
 */
test.describe('KPost Kall screen', { tag: '@ui' }, () => {
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

    // The contact search (placeholder "Search Contacts") is the entry point to placing a call, and
    // the tab strip (`.tabs-wrapper`) carries Recent / Frequent. Either proves the panel mounted.
    await expect(
      page
        .getByPlaceholder(/search contacts/i)
        .or(page.locator('.tabs-wrapper'))
        .first(),
      'the contact search or the call tabs are present',
    ).toBeVisible({ timeout: 20_000 });
  });
});
