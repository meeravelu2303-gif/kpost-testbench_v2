import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from '../support/session';

/**
 * The Header shell that wraps every signed-in screen: the user chip and each `icon-KP_*` nav entry are
 * present. Read-only; it does not click through.
 */
test.describe('KPost app shell', { tag: ['@ui', '@platform', '@regression'] }, () => {
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

    // The rail is always in the DOM, so assert each nav icon is attached (a removed entry fails here).
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
