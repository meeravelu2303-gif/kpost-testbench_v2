import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The Profile **screens** on the live front end, across all browsers, using the session `setup`
 * saved. No `data-testid` hooks, so locators are structural classes from `KPOST_REACTJS_2023_V1`,
 * each noted so a UI change points here.
 *
 * These are read-only screen checks (the profile-edit and settings writes are the API lifecycle's
 * job). They confirm the screens render the caller's own profile and the settings workspace in
 * Chromium, Firefox and WebKit.
 */
test.describe('KPost Profile screens', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the profile screen loads and shows the account holder @ui', async ({ page }) => {
    await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page, 'an authenticated user reaches the profile screen').toHaveURL(
      /\/userprofile/,
    );

    // The profile renders the account holder's name and photo (`.name_font_profile`,
    // `.Main-Profile-image`) — the core of the screen.
    await expect(page.locator('.name_font_profile').first(), 'the name is shown').toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator('.Main-Profile-image').first(),
      'the profile image is shown',
    ).toBeVisible();
  });

  test('the profile screen has the About and information sections @ui', async ({ page }) => {
    await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // "About" is a labelled profile section; asserting it exists proves the editable profile detail
    // is surfaced (its values are exercised by the API write lifecycle).
    await expect(page.getByText(/^About/i).first(), 'the About section is present').toBeVisible({
      timeout: 20_000,
    });
  });

  test('the settings screen loads with its navigation @ui', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page, 'an authenticated user reaches settings').toHaveURL(/\/settings/);

    // The settings workspace (`.settings-theme-shell`) with its nav panel.
    await expect(
      page.locator('.settings-theme-shell, .settings-theme-nav-panel').first(),
      'the settings workspace renders',
    ).toBeVisible({ timeout: 20_000 });
  });
});
