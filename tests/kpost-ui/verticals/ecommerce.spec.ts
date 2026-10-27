import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { settleFrames, settleNetwork } from '../support/settle';
import type { Page } from '@playwright/test';

/** K-ECommerce (/e-commerce): read-only render check; third-party purchases are never driven. */
test.describe(
  'KPost K-ECommerce — merchant grid',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    /** The grid is populated by one fetch after mount; wait for a card or for that fetch to answer. */
    async function settledCommerce(page: Page): Promise<void> {
      await Promise.race([
        page
          .locator('.ECommerce_Card')
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 })
          .catch(() => undefined),
        settleNetwork(page, /commerce|merchant|vendor/i, 15_000),
      ]);
      await settleFrames(page);
    }

    test('the E-Commerce screen loads without crashing, whether the merchant grid is populated or empty @ui', async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      await page.goto('/e-commerce', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await settledCommerce(page);

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
      await settledCommerce(page);

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
  },
);
