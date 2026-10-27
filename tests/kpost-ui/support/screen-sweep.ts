import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from './session';

/**
 * Shared body for the deep UI sweep (`screens-batch*.spec.ts`). It runs in small batches with a
 * pause between screens because a back-to-back sweep trips the server's rate limiter (429, then 401).
 */
const RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

/** Paced gap between screens, to thin the request burst. */
const SETTLE_MS = 4_000;

export function runScreenSweep(
  screens: readonly ScreenDef[],
  options: { session?: 'personal' | 'business' | 'public' } = {},
): void {
  const session = options.session ?? 'personal';
  // Public screens have no session to lose; a bounce to /login there is the finding, not a skip.
  if (session !== 'public') {
    test.beforeEach(async ({ page }) => {
      await skipIfSignedOut(page);
    });
  }

  for (const [index, screen] of screens.entries()) {
    test(`${screen.name} screen — controls, health, performance, responsive, a11y @ui`, async ({
      page,
    }) => {
      // A deliberate throttle between screens, not a wait for a page condition.
      // eslint-disable-next-line playwright/no-wait-for-timeout -- intentional request-rate pacing (rate-limiter, 2026-10-07)
      if (index > 0) await page.waitForTimeout(SETTLE_MS);

      const stop = watchUiHealth(page);
      const started = Date.now();

      await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      // 1. Reached the screen (a stale session bounces to /login) and it mounted.
      await expect(page, `${screen.name} is reachable when signed in`).toHaveURL(
        new RegExp(screen.route.replace(/[/-]/g, '\\$&')),
      );
      await expect(
        page.locator(screen.ready.join(', ')).first(),
        `${screen.name} mounted`,
      ).toBeVisible({ timeout: 20_000 });
      const loadMs = Date.now() - started;

      // 2. Every key control rendered — the screen shows its own UI.
      for (const control of screen.controls) {
        await expect(
          page.locator(control.selector).first(),
          `${screen.name}: ${control.label} is present`,
        ).toBeVisible({ timeout: 20_000 });
      }

      // 3. The full UI check catalogue.
      const health = stop();
      const findings = await runUiChecks({ page, screen, health, loadMs });

      const fileable = findings.filter((f) => RANK[f.severity]! >= RANK.MEDIUM!);
      const context = findings.filter((f) => RANK[f.severity]! < RANK.MEDIUM!);

      const notes: string[] = [
        ...context.map((f) => `[${f.check}] ${f.message}`),
        ...health.failedApiCalls.map((c) => `[api] ${c.status} ${c.method} ${c.url}`),
      ];
      if (notes.length) {
        console.log(`[ui-context] ${screen.name}: ${notes.join(' | ')}`);
      }

      const problems = fileable.map((f) => `[${f.check}] ${f.message}`);
      expect(problems, `${screen.name} UI issues — ${problems.join(' | ')}`).toEqual([]);
    });
  }
}
