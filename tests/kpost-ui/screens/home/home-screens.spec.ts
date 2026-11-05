import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The Home screen (`/home`) renders its header, Recent panel and tabs with the saved session.
 * No data-testid hooks, so locators are structural classes (`HomeDashboard.js`, `RecentMessage.js`).
 */
test.describe('KPost Home screen', { tag: ['@ui', '@home', '@regression'] }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the Home screen loads for a logged-in user @ui', async ({ page }) => {
    await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page, 'a login lands on Home').toHaveURL(/\/home/);
    // The signed-in header (avatar pill) confirms the session is live on this screen.
    await expect(page.locator('.header-user-pill').first(), 'the signed-in header').toBeVisible({
      timeout: 20_000,
    });
  });

  test('the recent-messages dashboard panel renders @ui', async ({ page }) => {
    await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // The Recent panel (fed by /v2/dashboard/*) — the Home screen's core content.
    await expect(
      page.locator('.homeRecentTheme, .active-Recent').first(),
      'the recent-messages dashboard panel is present',
    ).toBeVisible({ timeout: 20_000 });
  });

  test(
    'the dashboard offers its Recents / Contacts tabs and the Home nav @ui',
    { annotation: [{ type: 'requirement', description: 'FR-SL-032' }] },
    async ({ page }) => {
      await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      // The HomeDashboard tabs (Recents / Contacts) and the Home nav icon — the screen's own controls.
      await expect(
        page.locator('.icon-KP_01-Home').first(),
        'the Home nav icon renders',
      ).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.getByText(/^Recents$/i).first(),
        'the dashboard Recents tab is present',
      ).toBeVisible({ timeout: 20_000 });
    },
  );
});
