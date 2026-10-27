import { TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * PERFORMANCE — single user (FRD row 25): a page-load-time sanity budget for the core screens, one
 * real navigation per screen. Run with `npm run product:kpost-ui:perf`.
 *
 * ## Deliberately low-impact
 *
 * The server is a single, shared, low-capacity box (see the perf safety protocol) — load/stress
 * testing (row 26) is DEFERRED to a separate environment for that reason. This row is different: it is
 * ONE page load per screen by ONE user, which is no more traffic than a normal smoke pass. So it is
 * safe to run on the shared box, but it is still gated behind `PERF_SINGLE_USER=true` so it never adds
 * itself to a default run.
 *
 * ## A sanity budget, not an SLO
 *
 * The budgets below are generous upper bounds meant to catch a gross regression (a screen that went
 * from ~2s to ~20s), NOT a tight opinion about the ideal load time. They are measured from the
 * browser's own `PerformanceNavigationTiming` (`domContentLoadedEventEnd` and `loadEventEnd`, relative
 * to `startTime`), the same numbers a real user's browser reports. A screen that blows the budget is
 * reported with its actual timings so the regression is visible, not just "failed".
 */
interface NavTiming {
  domContentLoaded: number;
  load: number;
}

const BUDGET = {
  domContentLoaded: 8_000,
  load: 15_000,
} as const;

test.describe(
  'KPost · performance (single user, page-load budget)',
  {
    tag: [TAGS.ui, TAGS.platform, TAGS.regression],
    annotation: [{ type: 'non-functional', description: 'performance' }],
  },
  () => {
    test.skip(
      process.env.PERF_SINGLE_USER !== 'true',
      'measures real page loads on the shared server; set PERF_SINGLE_USER=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a live, logged-in QA account',
    );

    const SCREENS: ReadonlyArray<{ route: string; tag: string }> = [
      { route: '/home', tag: TAGS.home },
      { route: '/katchup', tag: TAGS.katchup },
      { route: '/kall', tag: TAGS.kall },
      { route: '/kmail', tag: TAGS.kmail },
      { route: '/contacts', tag: TAGS.contacts },
      { route: '/profile', tag: TAGS.profile },
    ];

    for (const s of SCREENS) {
      test(
        `${s.route} loads within the page-load budget @ui`,
        { tag: [s.tag] },
        async ({ page }) => {
          await page.goto(s.route, { waitUntil: 'load', timeout: 45_000 });
          await settleFrames(page).catch(() => undefined);

          const timing = await page.evaluate<NavTiming | null>(() => {
            const nav = performance.getEntriesByType('navigation')[0] as
              PerformanceNavigationTiming | undefined;
            if (!nav) return null;
            return {
              domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
              load: Math.round(nav.loadEventEnd - nav.startTime),
            };
          });

          expect(timing, `the browser reported navigation timing for ${s.route}`).not.toBeNull();

          test.info().annotations.push({
            type: 'observed',
            description: `${s.route} — DOMContentLoaded ${timing!.domContentLoaded}ms, load ${timing!.load}ms`,
          });

          expect(
            timing!.domContentLoaded,
            `${s.route} DOMContentLoaded (${timing!.domContentLoaded}ms) exceeds the ${BUDGET.domContentLoaded}ms sanity budget`,
          ).toBeLessThan(BUDGET.domContentLoaded);
          expect(
            timing!.load,
            `${s.route} load (${timing!.load}ms) exceeds the ${BUDGET.load}ms sanity budget`,
          ).toBeLessThan(BUDGET.load);
        },
      );
    }
  },
);
