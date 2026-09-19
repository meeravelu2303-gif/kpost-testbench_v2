import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { crawlScreen } from '@ui/ui-crawler';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from './support/session';

/**
 * Systematic crawl — the "every angle, better than a manual tester" sweep.
 *
 * On EVERY authenticated screen it discovers the controls the screen renders and clicks each safe one
 * in turn (`ui-crawler.ts`), watching the whole time for the defects a user would notice: a crash, a
 * freeze, or a value rendered as raw `undefined`/`NaN`/`[object Object]`. It needs no per-feature
 * selectors — it exercises whatever is there — so it covers the app broadly and cannot go stale, and
 * its signals are unambiguous, so it files only REAL defects. Runs on Chromium, Firefox and WebKit
 * (`npm run ui`), so a browser-specific crash/freeze is caught and the ticket names the browser.
 *
 * Safety: the crawler never clicks a destructive/committing control (send, delete, logout, confirm …)
 * and Escapes after every click — it opens/expands/views, never writes. See `ui-crawler.ts`.
 */
test.describe('KPost UI systematic crawl — every control, every screen', { tag: '@ui' }, () => {
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
});
