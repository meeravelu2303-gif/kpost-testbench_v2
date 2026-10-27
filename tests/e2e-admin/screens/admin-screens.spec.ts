import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import { ADMIN_SCREENS, ADMIN_SHELL, type AdminControl } from '@ui/admin-screens';
import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@fixtures';

/**
 * Read-only sweep of every Admin/HR-Setup screen: it mounts, the shell and key controls render, and
 * the UI check catalogue (crashes, assets, render time, overflow, a11y) finds nothing MEDIUM or worse.
 * Needs ADMIN_UI_LIFECYCLE=true and the BUSINESS_M admin session.
 */
const RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

function control(page: Page, c: AdminControl): Locator {
  const base = page.locator(c.selector);
  return (c.hasText ? base.filter({ hasText: c.hasText }) : base).first();
}

test.describe('Admin/HR-Setup deep UI sweep — every screen', { tag: '@admin-ui' }, () => {
  test.skip(
    process.env.ADMIN_UI_LIFECYCLE !== 'true' ||
      !env.ADMIN_UI_BASE_URL ||
      testData.businessMKpostId.includes('qa.business'),
    'needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account',
  );

  for (const screen of ADMIN_SCREENS) {
    test(`${screen.name} — mount, shell, controls, health, a11y @admin-ui`, async ({ page }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();

      await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page, `${screen.name} is reachable when signed in`).toHaveURL(
        new RegExp(screen.route.replace(/[/-]/g, '\\$&')),
      );

      // 1. The screen mounted: its title, or its first key control where the title text is a known bug.
      if (screen.title) {
        await expect(
          page.locator('.title-font').filter({ hasText: screen.title }).first(),
          `${screen.name} title "${screen.title}" rendered`,
        ).toBeVisible({ timeout: 20_000 });
      } else {
        await expect(
          control(page, screen.controls[0]!),
          `${screen.name} mounted (via ${screen.controls[0]!.label})`,
        ).toBeVisible({ timeout: 20_000 });
      }
      const loadMs = Date.now() - started;

      // 2. The global shell and every key control.
      for (const c of [...ADMIN_SHELL, ...screen.controls]) {
        await expect(control(page, c), `${screen.name}: ${c.label} present`).toBeVisible({
          timeout: 20_000,
        });
      }

      // 3. The UI check catalogue (the checks read page/health/loadMs, not the screen fields).
      const health = stop();
      const asScreen: ScreenDef = {
        route: screen.route,
        name: screen.name,
        screen: 'admin',
        ready: ['.title-font'],
        controls: [],
      };
      const findings = await runUiChecks({ page, screen: asScreen, health, loadMs });

      const problems = findings
        .filter((f) => RANK[f.severity]! >= RANK.MEDIUM!)
        .map((f) => `[${f.check}] ${f.message}`);
      const notes = [
        ...findings
          .filter((f) => RANK[f.severity]! < RANK.MEDIUM!)
          .map((f) => `[${f.check}] ${f.message}`),
        ...health.failedApiCalls.map((c) => `[api] ${c.status} ${c.method} ${c.url}`),
      ];
      if (notes.length) console.log(`[admin-ui-context] ${screen.name}: ${notes.join(' | ')}`);
      expect(problems, `${screen.name} UI issues — ${problems.join(' | ')}`).toEqual([]);
    });
  }
});
