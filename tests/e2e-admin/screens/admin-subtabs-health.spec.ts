import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Sub-tabs the main `admin-screens.spec.ts` sweep never actually clicks into — it only verifies
 * each tab LINK is present on the default tab, not that switching to it renders something healthy.
 * Confirmed from the 2026-10-05 ground-truth audit: Work Place Setup and HR Breakdown Setup each
 * have a distinct "Variable" tab with its own API surface the default "Tier" tab view never
 * exercises, and Employee Management's 5 live sub-tabs (Promote/Transfer/Suspend/Revoke/Terminate)
 * are each a separate component with their own health surface — only the default "Promote" tab
 * gets any coverage from the main sweep.
 */
const RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

test.describe('Admin/HR-Setup — under-tested sub-tabs, health + a11y', { tag: '@admin-ui' }, () => {
  test.skip(
    process.env.ADMIN_UI_LIFECYCLE !== 'true' ||
      !env.ADMIN_UI_BASE_URL ||
      testData.businessMKpostId.includes('qa.business'),
    'needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account',
  );

  const TAB_CASES: Array<{ route: string; name: string; tab: string }> = [
    { route: '/workplace-setup', name: 'Work Place Setup — Variable tab', tab: 'Variable' },
    { route: '/hr-breakdown-setup', name: 'HR Breakdown Setup — Variable tab', tab: 'Variable' },
    { route: '/employee-management', name: 'Employee Management — Promote tab', tab: 'Promote' },
    { route: '/employee-management', name: 'Employee Management — Transfer tab', tab: 'Transfer' },
    { route: '/employee-management', name: 'Employee Management — Suspend tab', tab: 'Suspend' },
    { route: '/employee-management', name: 'Employee Management — Revoke tab', tab: 'Revoke' },
    {
      route: '/employee-management',
      name: 'Employee Management — Terminate tab',
      tab: 'Terminate',
    },
  ];

  for (const { route, name, tab } of TAB_CASES) {
    test(`${name}: health, performance, layout, a11y @ui`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.locator('.nav-pills .nav-link', { hasText: tab }).first().click();
      await page.waitForTimeout(500);

      const stop = watchUiHealth(page);
      const started = Date.now();
      await page.waitForTimeout(500);
      const loadMs = Date.now() - started;
      const health = stop();

      const asScreen: ScreenDef = {
        route,
        name,
        screen: 'admin',
        ready: ['.title-font'],
        controls: [],
      };
      const findings = await runUiChecks({ page, screen: asScreen, health, loadMs });

      const problems = findings
        .filter((f) => RANK[f.severity]! >= RANK.MEDIUM!)
        .map((f) => `[${f.check}] ${f.message}`);
      expect(problems, `${name} UI issues — ${problems.join(' | ')}`).toEqual([]);
    });
  }
});
