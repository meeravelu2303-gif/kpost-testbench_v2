import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from './session';

/**
 * Shared body for the deep UI sweep (`screens-batch*.spec.ts`), extracted so the sweep can run in
 * smaller BATCHES instead of one single file hammering every screen back to back.
 *
 * Why batches: found 2026-10-07 — one continuous run across all 13 screens in rapid succession
 * reliably tripped a server-side rate-limiter after 3 independent confirmations (chromium twice,
 * firefox once, all breaking at this exact sweep's first screen): 429s appeared, then the session's
 * own token started being rejected (401) on every endpoint, not just the one being probed — a
 * false-positive storm, not real per-screen defects. Splitting into smaller files is necessary but
 * not sufficient on its own (Playwright runs sibling spec files back to back with no gap), so this
 * also adds a deliberate settle delay between screens — the actual lever that reduces request rate.
 * See `feedback_webkit_hang_mitigation` for the same batching idea applied to a different failure
 * mode (a hung worker, not a rate limit) found earlier the same week.
 */
const RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

/** Paced gap between screens — long enough to visibly thin the request burst, short enough that a
 * 4-5 screen batch still finishes in a reasonable time. */
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
      // Pace every screen but the first in this batch, so the burst that tripped the rate-limiter
      // never recurs within a batch. This is a deliberate throttle between screens, not a wait for
      // a page condition, so there is no condition to replace it with — see the header above.
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
