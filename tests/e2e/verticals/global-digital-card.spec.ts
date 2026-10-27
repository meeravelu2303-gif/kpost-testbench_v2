import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * /digital-card/:id, the public shareable card. A bad id renders a near-blank card rather than
 * /not-found; that is only recorded, and the test asserts no crash.
 */
test.describe(
  'KPost — /digital-card/:id public digital card',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('an invalid/unknown id does not crash the page @ui', async ({ page }) => {
      const stop = watchUiHealth(page);
      await page.goto('/digital-card/definitely-not-a-real-id', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await page.waitForLoadState('load');
      await settleFrames(page);

      const health = stop();
      expect(health.pageErrors, 'no uncaught JS error on an invalid id').toEqual([]);

      const degradedToBlankCard = await page
        .getByText('-', { exact: true })
        .first()
        .isVisible({
          timeout: 3_000,
        })
        .catch(() => false);
      const redirectedToNotFound = /not-found/.test(page.url());

      test.info().annotations.push({
        type: 'observed',
        description:
          `degraded to a near-blank card: ${degradedToBlankCard}; redirected to /not-found: ` +
          `${redirectedToNotFound} — unlike ProfileWebView, GloabalDigitalCard.js has no confirmed ` +
          'not-found handling for a bad id; whether the blank-card degrade is intentional for a ' +
          '"card" format is a product-owner question, not assumed here',
      });
    });
  },
);
