import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * **Settings** section navigation (read-only) — `components/Settings/Settingdetails.js`. The nav has
 * collapsible groups (Profile Creation · Digital Card · General Settings · KMail Settings · KNews
 * Settings · My Account, + Business for business accounts), each expanding to `t("…")` sub-items.
 * This asserts the groups and key items render and expand — the writes (theme, About, notifications)
 * are covered by their own gated specs. Selectors from `docs/ui-build-plan.md`.
 */
test.describe('KPost Settings — section navigation', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the settings nav lists its preference groups @ui', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    await expect(
      page.locator('.settings-theme-shell, .settings-theme-nav-panel').first(),
      'the settings workspace renders',
    ).toBeVisible({ timeout: 20_000 });

    // The main nav groups are present.
    for (const group of [/General Settings/i, /Profile Creation/i, /KMail Settings/i]) {
      await expect(page.getByText(group).first(), `the "${group}" group is listed`).toBeVisible({
        timeout: 20_000,
      });
    }
  });

  test('expanding General Settings reveals its items (Personalize, Notification) @ui', async ({
    page,
  }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    await page
      .getByText(/General Settings/i)
      .first()
      .click();
    await expect(
      page.getByText(/^Personalize$/i).first(),
      'General Settings reveals Personalize',
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(/^Notification$/i).first(),
      'General Settings reveals Notification',
    ).toBeVisible({ timeout: 20_000 });
  });

  test('expanding Profile Creation reveals its items (About, Basic Information) @ui', async ({
    page,
  }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    await page
      .getByText(/Profile Creation/i)
      .first()
      .click();
    await expect(
      page.getByText(/Basic Information/i).first(),
      'Profile Creation reveals Basic Information',
    ).toBeVisible({ timeout: 20_000 });
  });
});
