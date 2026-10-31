/* eslint-disable playwright/no-wait-for-timeout */
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from '../support/session';

/**
 * Visual regression of every screen against approved baselines, gated behind `VISUAL_REGRESSION=true`
 * (`product:kpost-ui:visual:update` captures, `product:kpost-ui:visual` compares). Human review only, never filed.
 */
test.describe(
  'KPost visual regression — every screen',
  {
    tag: ['@ui', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'performance' }],
  },
  () => {
    test.skip(
      process.env.VISUAL_REGRESSION !== 'true',
      'visual regression is opt-in: run `npm run product:kpost-ui:visual:update` to baseline, then `npm run product:kpost-ui:visual`',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real account (QA_KPOST_ID)',
    );

    test.beforeEach(async ({ page }) => {
      await skipIfSignedOut(page);
    });

    for (const screen of AUTHENTICATED_SCREENS) {
      test(`${screen.name} — matches its visual baseline @ui`, async ({ page }) => {
        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(1500);
        await expect(page).toHaveScreenshot(`${screen.name}.png`, {
          fullPage: true,
          animations: 'disabled',
          // Tolerate trivial anti-aliasing / dynamic-content noise; a real layout break far exceeds this.
          maxDiffPixelRatio: 0.08,
        });
      });
    }
  },
);
