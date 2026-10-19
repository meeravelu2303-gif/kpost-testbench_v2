import { TAGS } from '@config/constants';
import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import { ADMIN_SCREENS, ADMIN_SHELL, type AdminControl } from '@ui/admin-screens';
import { healthFailures, watchUiHealth } from '@ui/ui-health';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@fixtures';

/**
 * FULL SANITY · Admin UI — every Admin / HR-Setup screen (`src/ui/admin-screens.ts`) mounts in the
 * SSO'd BUSINESS_M session, with its shell, and loads with no JS crash, no broken asset and no
 * server error. Read-only. The light counterpart of `admin-screens.spec.ts` (the deep sweep, which
 * adds every control and the full UI check catalogue).
 *
 * Admin joins the SANITY level only (`@admin`); it runs in the runner's own Admin UI stage.
 */

function control(page: Page, c: AdminControl): Locator {
  const base = page.locator(c.selector);
  return (c.hasText ? base.filter({ hasText: c.hasText }) : base).first();
}

test.describe(
  'SANITY · Admin UI · every screen loads',
  { tag: [TAGS.ui, TAGS.admin, TAGS.sanity, TAGS.sanitySweep] },
  () => {
    test.skip(
      process.env.ADMIN_UI_LIFECYCLE !== 'true' ||
        !env.ADMIN_UI_BASE_URL ||
        testData.businessMKpostId.includes('qa.business'),
      'needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account',
    );

    for (const screen of ADMIN_SCREENS) {
      test(`${screen.name} (${screen.route}) loads cleanly`, async ({ page }) => {
        const stop = watchUiHealth(page);
        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });

        const mounted = screen.title
          ? page.locator('.title-font').filter({ hasText: screen.title }).first()
          : control(page, screen.controls[0]!);
        await expect(mounted, `${screen.name} mounted`).toBeVisible({ timeout: 20_000 });
        for (const c of ADMIN_SHELL) {
          await expect(control(page, c), `${screen.name}: ${c.label} present`).toBeVisible({
            timeout: 20_000,
          });
        }

        const report = stop();
        expect(
          [
            ...healthFailures(report),
            ...report.failedApiCalls
              .filter((call) => call.status >= 500)
              .map((call) => `server error ${call.status}: ${call.method} ${call.url}`),
          ],
          `${screen.name} loaded without a crash or server error`,
        ).toEqual([]);
      });
    }
  },
);
