import type { Page } from '@playwright/test';
import { TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * Read-only monitoring smoke (`npm run product:kpost-ui:monitor`) against the TEST deployment: the
 * signed-out login page renders and each core signed-in screen loads without the error boundary.
 * Selected by path, so it deliberately carries no `@smoke` tag.
 */
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

        // The id field is the most reliable "the app booted" signal for a signed-out visitor.
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
        'the authenticated checks need a real live account (QA_KPOST_ID)',
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
