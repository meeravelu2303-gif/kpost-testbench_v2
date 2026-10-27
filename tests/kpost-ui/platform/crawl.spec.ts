import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { crawlScreen } from '@ui/ui-crawler';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from '../support/session';

/**
 * Crawl: on every signed-in screen, click each safe control (`ui-crawler.ts`) and fail on a crash, a
 * freeze or a raw `undefined`/`NaN`/`[object Object]`. Destructive controls are never clicked.
 */
test.describe(
  'KPost UI systematic crawl — every control, every screen',
  {
    tag: ['@ui', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'performance' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test.beforeEach(async ({ page }) => {
      await skipIfSignedOut(page);
    });

    for (const screen of AUTHENTICATED_SCREENS) {
      test(`${screen.name} — crawl every control without crashing or freezing @ui`, async ({
        page,
      }) => {
        // Up to 24 real clicks, some of which reload the page, outgrow the default 60s timeout.
        test.setTimeout(150_000);
        const stop = watchUiHealth(page);

        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await expect(
          page.locator(screen.ready.join(', ')).first(),
          `${screen.name} mounted`,
        ).toBeVisible({ timeout: 20_000 });

        const crawlFindings = await crawlScreen(page, screen.route);
        const responsive = await isResponsive(page);
        const health = stop();

        const problems = [
          ...healthFailures(health), // crashes + broken assets triggered by any click
          ...crawlFindings.map((f) => `[${f.check}] ${f.message}`), // hangs + rendered-raw-value
          ...(responsive ? [] : [`the screen FROZE (main thread unresponsive) after the crawl`]),
        ];
        expect(
          problems,
          `${screen.name} broke while crawling its controls — ${problems.join(' | ')}`,
        ).toEqual([]);
      });
    }
  },
);
