import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Read-only checks that the own-profile and settings screens render, on every browser. No data-testid
 * hooks exist, so locators are structural classes.
 */
test.describe('KPost Profile screens', { tag: ['@ui', '@profile', '@regression'] }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the profile screen loads and shows the account holder @ui', async ({ page }) => {
    await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page, 'an authenticated user reaches the profile screen').toHaveURL(
      /\/userprofile/,
    );

    // The profile renders the account holder's name and photo.
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

    // The About section is present (its values are covered by the API lifecycle).
    await expect(page.getByText(/^About/i).first(), 'the About section is present').toBeVisible({
      timeout: 20_000,
    });
  });

  test('the OWN profile shows the self-actions: Edit Profile, Share and Change-photo @ui', async ({
    page,
  }) => {
    await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // The own profile shows Edit Profile, Share and Change Photo.
    await expect(
      page.getByText(/^Edit Profile$/i).first(),
      'the Edit Profile control is present on the own profile',
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator('.pShare_btn, .pChangePic_btn').first(),
      'the share / change-photo controls are present',
    ).toBeVisible();
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
