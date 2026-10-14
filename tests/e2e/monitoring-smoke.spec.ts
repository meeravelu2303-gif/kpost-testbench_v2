import type { Page } from '@playwright/test';
import { TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from './support/settle';

/**
 * MONITORING SMOKE (FRD row 5, "Production monitoring") — a shallow, **read-only** health check meant
 * to be run on a SCHEDULE to catch an outage early, run with `npm run monitor`.
 *
 * ## Why this targets the TEST deployment, not production
 *
 * The bench's standing safety rule is "test the deployment only, never live hosts" — so this monitors
 * `test.kpostindia.com` (the host comes from `.env`, same as every other spec), NOT the live
 * production site. It is production-STYLE monitoring (scheduled, read-only, outage-catching) pointed at
 * the environment we are allowed to touch. If a true production monitor is ever wanted, it needs an
 * explicit sign-off to relax the test-only rule and its own production credentials.
 *
 * ## Read-only on purpose
 *
 * Unlike `smoke.spec.ts` (the build-acceptance gate, which also sends a Katchup + a KMail), a scheduled
 * monitor must leave NO data behind on every tick, so this only navigates and reads. It checks two
 * things an outage would break first: (1) the public login page is reachable and renders for a
 * signed-OUT visitor (the front door is up), and (2) each core authenticated screen still loads for a
 * signed-in session and does not fall to the error boundary.
 *
 * ## Scheduling
 *
 * This has no scheduler wired up (creating a cron / Windows Task on the host is a persistent,
 * outward change left to the operator). To run it every 15 minutes, point Task Scheduler (Windows) or
 * cron at `npm run monitor` from the repo root. Keep the cadence modest — the server is shared and
 * low-capacity (see the perf safety protocol).
 */
// Selected by PATH (`npm run monitor`), not by the `@smoke` tag, so it deliberately does NOT carry
// `@smoke` (that tag has a per-module budget the scheduled monitor should not eat into).
test.describe(
  'KPost · monitoring smoke (scheduled health)',
  {
    tag: [TAGS.ui, TAGS.platform, TAGS.regression],
  },
  () => {
    /** The authenticated app shell (side menu) — present on every signed-in screen. */
    const shell = (page: Page) => page.locator('.menu, nav, [class*="side-menu" i]').first();
    const errorBoundary = (page: Page) =>
      page.locator('[role="alert"], body', { hasText: /something went wrong/i });

    test.describe('the public front door is up (signed out)', () => {
      // A signed-OUT visitor: no saved session, so we see what the outside world sees.
      test.use({ storageState: { cookies: [], origins: [] } });

      test('the login page is reachable and renders for a signed-out visitor @ui', async ({
        page,
      }) => {
        await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
        await settleFrames(page).catch(() => undefined);

        // The login form's id field is the single most reliable "the app booted, not a blank 5xx page"
        // signal for a signed-out visitor.
        await expect(
          page.locator('[placeholder*="KPOST ID" i]').first(),
          'the login screen rendered its id field (the front door is up)',
        ).toBeVisible({ timeout: 20_000 });
        expect(
          await errorBoundary(page)
            .first()
            .isVisible()
            .catch(() => false),
          'the login page did not fall to the error boundary',
        ).toBe(false);
      });
    });

    test.describe('the core authenticated screens load', () => {
      test.skip(
        !testData.kpostId || testData.kpostId.includes('qa.bench'),
        'the authenticated checks need a live, logged-in QA account',
      );

      async function screenLoads(page: Page, route: string, urlRe: RegExp): Promise<void> {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
        await settleFrames(page).catch(() => undefined);
        await expect(page, 'the route resolved').toHaveURL(urlRe);
        await expect(shell(page), 'the authenticated app shell rendered').toBeVisible({
          timeout: 15_000,
        });
        expect(
          await errorBoundary(page)
            .first()
            .isVisible()
            .catch(() => false),
          `the ${route} screen did not fall to the error boundary`,
        ).toBe(false);
      }

      const SCREENS: ReadonlyArray<{ route: string; urlRe: RegExp; tag: string }> = [
        { route: '/home', urlRe: /\/home/, tag: TAGS.home },
        { route: '/katchup', urlRe: /\/katchup/, tag: TAGS.katchup },
        { route: '/kall', urlRe: /\/kall/, tag: TAGS.kall },
        { route: '/kmail', urlRe: /\/kmail/, tag: TAGS.kmail },
      ];

      for (const s of SCREENS) {
        test(`${s.route} loads for a signed-in session @ui`, { tag: [s.tag] }, async ({ page }) => {
          await screenLoads(page, s.route, s.urlRe);
        });
      }
    });
  },
);
