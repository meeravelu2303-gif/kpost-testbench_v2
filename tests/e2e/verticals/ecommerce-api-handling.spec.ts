import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * K-ECommerce (/e-commerce): a failed merchant-list load must show a visible error, distinguishable
 * from a genuinely empty result.
 */
test.describe(
  'KPost K-ECommerce · merchant-list API failure handling',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('a failing merchant-list load shows an error, not a silent-empty grid @ui', async ({
      page,
    }) => {
      // Stub a FAILURE envelope (HTTP 200 carrying a failure, KPost's usual shape).
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
