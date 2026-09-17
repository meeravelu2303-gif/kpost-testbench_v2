import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from './support/session';

/**
 * The shared **Header shell** that wraps every authenticated screen (`containers/Header.js`), across
 * all browsers, using the session `setup` saved.
 *
 * This is the one place the app's navigation lives, so testing it once covers the entry point to
 * every module. The nav is an `icon-KP_*` rail (always in the DOM); each icon routes to a module
 * (`docs/ui-screens.md`). Read-only: it asserts the controls are present, it does not click through.
 */
test.describe('KPost app shell', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );
  test.beforeEach(async ({ page }) => {
    await skipIfSignedOut(page);
  });

  test('the signed-in header shows the user chip @ui', async ({ page }) => {
    await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // The user chip proves the shell rendered in a signed-in state.
    await expect(
      page.locator('.header-user-name, .header-user-pill, .header_font').first(),
      'the signed-in user chip is present',
    ).toBeVisible({ timeout: 20_000 });
  });

  test('the navigation rail links to every core module @ui', async ({ page }) => {
    await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // One icon per destination (docs/ui-screens.md · shell). The rail is always in the DOM; assert
    // each nav icon is attached, so a renamed/removed nav entry fails here rather than silently.
    for (const icon of [
      'icon-KP_01-Home',
      'icon-KP_03-KMail',
      'icon-KP_04-Katchup',
      'icon-KP_05-Kall',
      'icon-KP_15-Settings',
    ]) {
      await expect(page.locator(`.${icon}`).first(), `the ${icon} nav entry exists`).toBeAttached({
        timeout: 20_000,
      });
    }
  });
});
