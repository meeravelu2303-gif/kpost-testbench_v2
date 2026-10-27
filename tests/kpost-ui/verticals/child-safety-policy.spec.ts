import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * /child-safety-standards-policy, a public route: the page must render its heading without a JS error.
 * In source the component file is fully commented out, so React may fail to mount it.
 */
test.describe(
  'KPost Child Safety Policy — public route',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    // No storage state / auth needed — this route is explicitly public.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('visiting /child-safety-standards-policy renders its policy heading without crashing @ui', async ({
      page,
    }) => {
      const stop = watchUiHealth(page);

      await page.goto('/child-safety-standards-policy', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await page.waitForLoadState('load');
      await settleFrames(page);

      const health = stop();

      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}`,
      });

      expect(health.pageErrors, 'no uncaught JS error while rendering the policy page').toEqual([]);
      await expect(
        page.getByRole('heading', { name: /Child Safety Standards Policy/i }).first(),
        'the policy page renders its heading',
      ).toBeVisible({ timeout: 10_000 });
    });
  },
);
