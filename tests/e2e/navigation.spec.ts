import { testData } from '@config/test-data.config';
import { NAV_LINKS } from '@ui/screens';
import { expect, test } from '@fixtures';

/**
 * Navigation flow — the first UI **interaction** test (a real user action, not a scripted `goto`):
 * from the Home screen, click each destination in the nav rail and confirm it opens the right route.
 * This exercises the shell's routing end to end and catches a broken/mis-wired nav link, which a
 * per-screen `goto` test can never see. Read-only.
 */
test.describe('KPost navigation — the nav rail routes correctly', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  for (const link of NAV_LINKS) {
    test(`clicking ${link.name} in the nav rail opens ${link.route} @ui`, async ({ page }) => {
      await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.locator('.icon-KP_01-Home').first(), 'the nav rail is present').toBeVisible(
        {
          timeout: 20_000,
        },
      );

      await page.locator(link.icon).first().click();

      await expect(page, `${link.name} navigates to ${link.route}`).toHaveURL(
        new RegExp(link.route.replace(/[/-]/g, '\\$&')),
        { timeout: 15_000 },
      );
    });
  }
});
