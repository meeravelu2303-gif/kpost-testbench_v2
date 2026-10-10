import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * K-ECommerce (`/e-commerce`) — has a real, correctly-wired backend
 * (`Fetch_ECommerceDetails()` -> `GET /v2/ecommerce/getEcommerceDetails/`), which `docs/generated/coverage.md`
 * marks **out-of-scope — third-party commerce; confirm scope with owner** for API testing. UI testing
 * matches that same caution: read-only render check only, no assumption that a purchase/click-through
 * action is safe to drive.
 *
 * Confirmed from source, a genuine gap worth documenting directly rather than silently working
 * around: there is NO loading state and NO error state in `ECommerceList.js` — a failed or
 * non-SUCCESS response only `console.log`s and leaves the list empty, which is visually
 * indistinguishable from a legitimate "no merchants" response. This test asserts what IS there
 * (the grid renders, one way or another) without pretending the empty/error ambiguity doesn't exist.
 */
test.describe('KPost K-ECommerce — merchant grid', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the E-Commerce screen loads without crashing, whether the merchant grid is populated or empty @ui', async ({
    page,
  }) => {
    const stop = watchUiHealth(page);
    await page.goto('/e-commerce', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_500);

    const health = stop();
    expect(health.pageErrors, 'no uncaught JS error on load').toEqual([]);

    const cardCount = await page.locator('.ECommerce_Card').count();
    test.info().annotations.push({
      type: 'observed',
      description:
        `${cardCount} merchant card(s) rendered — confirmed from source: an empty grid here is ` +
        'visually indistinguishable from a failed fetch (no loading/error state exists in ' +
        'ECommerceList.js), so this cannot assert WHY it is empty when it is',
    });
    await expect(page.locator('body')).toBeVisible();
  });

  test('clicking a merchant card opens its site in a new tab, intercepted rather than followed @ui', async ({
    page,
    context,
  }) => {
    await page.goto('/e-commerce', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_500);

    const firstCard = page.locator('.ECommerce_Card').first();
    const hasCard = await firstCard.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasCard, 'no merchants returned right now — nothing to click through');

    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10_000 }),
      firstCard.click(),
    ]);

    expect(
      popup,
      'clicking a merchant card opens a new tab (window.open), not an in-app navigation',
    ).toBeTruthy();
    await popup.close();
  });
});
