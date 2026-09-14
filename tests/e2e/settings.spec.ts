import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The **Settings** screen on the live front end, across all browsers, using the session `setup`
 * saved. Read-only: it asserts the settings workspace and its section nav render (the theme/font/
 * notification changes are the API lifecycle's job). Selectors from `components/Settings/Setting.js`
 * and `Settingdetails.js` (`docs/ui-screens.md`).
 */
test.describe('KPost Settings screen', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the settings workspace loads with its nav and content panels @ui', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page, 'an authenticated user reaches settings').toHaveURL(/\/settings/);

    // The two-panel workspace: nav on the left, content on the right.
    await expect(
      page.locator('.settings-theme-shell, .settings-theme-nav-panel').first(),
      'the settings workspace renders',
    ).toBeVisible({ timeout: 20_000 });
  });

  test('the settings section nav lists the preference groups @ui', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // The nav title, plus at least one collapsible section header (docs/ui-screens.md · /settings).
    await expect(
      page
        .getByText(/^Settings$/)
        .first()
        .or(page.locator('.ecomm_font').first()),
      'the Settings nav title is present',
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(/General Settings|Profile Creation/i).first(),
      'a settings section group is listed',
    ).toBeVisible({ timeout: 20_000 });
  });

  // The Settings section-expand INTERACTION is deferred until it can be tuned against the live DOM
  // (its exact click target / revealed element), rather than shipping an unverified assumption that
  // files a false-positive UI bug. It will be rebuilt from a recorded flow.
});
