import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The **Home** screen on the live front end, across all browsers, using the session `setup` saved.
 *
 * `/home` is where a login lands. Its recent-messages panel is fed by the Dashboard endpoints
 * (`/v2/dashboard/*`). No `data-testid` hooks, so locators are structural classes from the live app
 * (`KPOST_REACTJS_2023_V1` — `HomeDashboard.js`, `RecentMessage.js`).
 */
test.describe('KPost Home screen', { tag: '@ui' }, () => {
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
});
