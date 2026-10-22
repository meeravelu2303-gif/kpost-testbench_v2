import { TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { NAV_LINKS } from '@ui/screens';
import { requirePersonalAccount } from './smoke-ui';

/**
 * UI SMOKE · the signed-in user's own data reaches the screen, and the app's navigation works:
 * Home and Profile show the signed-in account (not a blank or someone else's), and every entry of the
 * side navigation opens its module. Read-only.
 */
test.describe(
  'SMOKE · UI · account and navigation',
  { tag: [TAGS.ui, TAGS.smoke, TAGS.regression] },
  () => {
    requirePersonalAccount();
    /** "qatest1@kpostindia.com" → /qatest1/i: the display name is built from the account. */
    const accountName = (): RegExp => new RegExp(testData.kpostId.split('@')[0]!, 'i');

    test(
      'Home greets the signed-in user by name',
      { tag: [TAGS.home, TAGS.sanity] },
      async ({ page }) => {
        await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await expect(
          page.locator('.header-user-name').first(),
          'the header shows the signed-in user',
        ).toContainText(accountName(), { timeout: 20_000 });
      },
    );

    test(
      "Profile shows the signed-in user's own name and photo",
      { tag: [TAGS.profile, TAGS.sanity] },
      async ({ page }) => {
        await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await expect(
          page.locator('.name_font_profile').first(),
          'the profile shows the account holder',
        ).toContainText(accountName(), { timeout: 20_000 });
        await expect(
          page.locator('.Main-Profile-image').first(),
          'the profile photo',
        ).toBeVisible();
      },
    );

    test(
      `the side navigation opens ${NAV_LINKS.map((l) => l.name).join(', ')}`,
      { tag: [TAGS.platform, TAGS.sanity] },
      async ({ page }) => {
        for (const link of NAV_LINKS) {
          await test.step(link.name, async () => {
            await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await expect(page.locator('.icon-KP_01-Home').first(), 'the nav rail').toBeVisible({
              timeout: 20_000,
            });
            await page.locator(link.icon).first().click();
            await expect(page, `${link.name} opens ${link.route}`).toHaveURL(
              new RegExp(link.route.replace(/[/-]/g, '\\$&')),
              { timeout: 15_000 },
            );
          });
        }
      },
    );
  },
);
