import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import { ADMIN_SHELL, type AdminControl, type AdminScreenDef } from '@ui/admin-screens';
import { healthFailures, watchUiHealth } from '@ui/ui-health';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@fixtures';

/** Shared Admin UI steps (sanity and smoke): how an Admin screen proves it loaded. */

/** Skip unless the Admin UI session can be seeded (the setup project does it when this is on). */
export function requireAdminUiSession(): void {
  test.skip(
    process.env.ADMIN_UI_LIFECYCLE !== 'true' ||
      !env.ADMIN_UI_BASE_URL ||
      testData.businessMKpostId.includes('qa.business'),
    'needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account',
  );
}

function control(page: Page, c: AdminControl): Locator {
  const base = page.locator(c.selector);
  return (c.hasText ? base.filter({ hasText: c.hasText }) : base).first();
}

/**
 * Open `screen` in the SSO'd BUSINESS_M session and prove it loaded: its title (or first control) and
 * the Admin shell are visible, with no JS crash, no broken asset and no server error.
 */
export async function expectAdminScreenLoads(page: Page, screen: AdminScreenDef): Promise<void> {
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
}
