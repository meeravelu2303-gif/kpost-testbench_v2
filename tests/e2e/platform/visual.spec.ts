/* eslint-disable playwright/no-wait-for-timeout */
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from '../support/session';

/**
 * Visual-regression angle — pixel-compares every screen against an approved baseline, so an
 * unintended layout/style change (a broken CSS bundle, a shifted component, a blank region) is
 * caught even when the DOM checks pass.
 *
 * It is GATED behind `VISUAL_REGRESSION=true` and is NOT in the default `npm run product:kpost-ui`, because it
 * needs baselines: run `npm run product:kpost-ui:visual:update` ONCE to capture them (per browser), then
 * `npm run product:kpost-ui:visual` compares. It is NOT in `UI_FILING_SPECS` — a visual diff is a human-review
 * signal (fonts/anti-aliasing differ across environments), not an auto-filed defect. A generous
 * `maxDiffPixelRatio` + disabled animations keep it from flapping on trivial rendering noise.
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
