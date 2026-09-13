import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Smoke tests for the **auxiliary screens** outside the documented application flow — KCloud,
 * KBooking, KNews, ECommerce. These have no KPost API of their own (KNews/ECommerce render
 * third-party content), so this is a screen-level check only: the route loads for a logged-in user
 * and the authenticated shell renders, across all browsers. Read-only.
 */
const SCREENS: Array<{ route: string; name: string }> = [
  { route: '/kcloud', name: 'KCloud' },
  { route: '/kbooking', name: 'KBooking' },
  { route: '/knews', name: 'KNews' },
  { route: '/e-commerce', name: 'ECommerce' },
];

test.describe('KPost auxiliary screens', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  for (const { route, name } of SCREENS) {
    test(`the ${name} screen loads for a logged-in user @ui`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      // Stays on the route (not bounced to /login), and the authenticated shell (nav rail) renders.
      await expect(page, `${name} is reachable when signed in`).toHaveURL(
        new RegExp(route.replace(/[/-]/g, '\\$&')),
      );
      await expect(
        page.locator('.icon-KP_01-Home, .header-user-name, .header_font').first(),
        'the authenticated shell renders',
      ).toBeVisible({ timeout: 20_000 });
    });
  }
});
