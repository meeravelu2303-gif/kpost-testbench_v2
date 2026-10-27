import { PUBLIC_SCREENS } from '@ui/screens';
import { expect, test } from '@fixtures';

/**
 * Visual baselines for the public screens (little dynamic content, so a diff means the screen changed).
 * Created with `--update-snapshots`; a later diff above 2% of pixels fails.
 */
test.describe(
  'KPost visual baselines — public screens',
  {
    tag: ['@ui', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'performance' }],
  },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const screen of PUBLIC_SCREENS) {
      test(`${screen.name} matches its baseline @ui`, async ({ page }) => {
        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);
        await expect(
          page.locator(screen.ready.join(', ')).first(),
          'the screen mounts',
        ).toBeVisible({
          timeout: 20_000,
        });
        await expect(page).toHaveScreenshot(`${screen.screen}.png`, {
          fullPage: false,
          animations: 'disabled',
          caret: 'hide',
          maxDiffPixelRatio: 0.02,
          mask: [page.locator('video, canvas, [class*="carousel"], [class*="slider"]')],
        });
      });
    }
  },
);
