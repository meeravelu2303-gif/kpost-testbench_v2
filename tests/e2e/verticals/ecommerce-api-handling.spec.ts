import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * K-ECommerce (/e-commerce) API failure handling. Confirmed from source (ECommerceList.js): a
 * failed/non-SUCCESS merchant-list response only console.logs and leaves the grid empty — there is NO
 * loading state and NO error state, so a backend failure is visually indistinguishable from a
 * legitimate "no merchants" result. Correct behaviour: a failed load must surface a visible error (or
 * at least a state distinguishable from a real empty result), not a silent-empty grid.
 */
test.describe(
  'KPost K-ECommerce · merchant-list API failure handling',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    // #1342 [KP-ECOMSILENTFAIL] (a failed load rendered a silent-empty grid) was verified FIXED live on
    // 2026-10-21 ("Unable to load merchants. Please try again." with a Retry link), so this runs again.
    test('a failing merchant-list load shows an error, not a silent-empty grid @ui', async ({
      page,
    }) => {
      // Force the merchant fetch to return a FAILURE envelope (HTTP 200 carrying a failure, KPost's
      // anti-pattern) so the screen must distinguish "load failed" from "no merchants".
      await page.route('**/ecommerce/getEcommerceDetails/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 500, message: 'boom', data: null }),
        }),
      );

      await page.goto('/e-commerce', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('load').catch(() => undefined);
      await page.waitForTimeout(3_000);

      const cards = await page.locator('.ECommerce_Card').count();
      const errorShown = await page
        .getByText(
          /unable to|something went wrong|failed to load|please try again|couldn.t load|error/i,
        )
        .first()
        .isVisible()
        .catch(() => false);

      // Correct behaviour: on a failed load, show a visible error (not a blank/empty grid with no cards).
      expect(
        errorShown || cards > 0,
        'a failed merchant-list load must surface a visible error state, not a silent-empty grid ' +
          `(cards=${cards}, errorShown=${errorShown}) — otherwise an outage looks identical to "no merchants"`,
      ).toBe(true);
    });
  },
);
