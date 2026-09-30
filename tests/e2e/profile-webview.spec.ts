import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * `/profile-webview/:id` (`ProfileWebView.js`) — a PUBLIC, read-only shareable profile card, no auth
 * required. Confirmed from source: it calls the genuinely public `POST /v2/profile/shareUserDetails/`
 * (Authorization header commented out) and, on a non-SUCCESS response — the expected outcome for a
 * malformed/stranger id — cleanly `navigate("/not-found")`, no crash. This is the CORRECT behavior to
 * assert directly, matching the source's own confirmed handling.
 */
test.describe('KPost — /profile-webview/:id public profile card', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('an invalid/unknown id redirects cleanly to /not-found, without crashing @ui', async ({
    page,
  }) => {
    const stop = watchUiHealth(page);
    await page.goto('/profile-webview/definitely-not-a-real-id', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(2_000);

    const health = stop();
    expect(health.pageErrors, 'no uncaught JS error on an invalid id').toEqual([]);
    await expect(page, 'an unresolvable id redirects to the not-found route').toHaveURL(/not-found/);
  });
});
