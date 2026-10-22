import { PUBLIC_SCREENS } from '@ui/screens';
import { expect, test } from '@fixtures';

/**
 * **Visual regression baselines** — the cross-cutting test type the production plan listed as
 * absent. Starts with the PUBLIC screens (login, signup, child-safety policy, the signed-out Kall
 * window, the KPoster demo): they have no session and little dynamic content, so a pixel diff
 * means the screen changed, not the data.
 *
 * Baselines live next to this file (`visual-baselines.spec.ts-snapshots/`, one per browser) and
 * are created on the first run with `--update-snapshots`; a later diff above 2% of pixels fails.
 * Animations are disabled for the capture and the viewport is the project's default.
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
