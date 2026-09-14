/* eslint-disable playwright/no-conditional-in-test */
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Deep UI sweep across EVERY authenticated screen — the front-end analogue of the API engine's
 * "a case per validation, on every endpoint". For each screen, in the reused authenticated session:
 *
 *   1. navigate and confirm the screen MOUNTED (its ready selector),
 *   2. assert every key CONTROL it should render is present (not an empty shell),
 *   3. run the whole UI check catalogue (`src/ui/ui-checks.ts`) — health (no JS crash / broken
 *      asset), performance (render budget), responsive (no phone-width overflow), accessibility —
 *      and file the MEDIUM+ findings; LOW findings (e.g. missing alt text) and failed backend calls
 *      are logged as context, not filed.
 *
 * A failure files to the KPost UI product → Ayyappan, on the screen's component. Read-only.
 */
const RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

test.describe('KPost deep UI sweep — every screen', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  for (const screen of AUTHENTICATED_SCREENS) {
    test(`${screen.name} screen — controls, health, performance, responsive, a11y @ui`, async ({
      page,
    }) => {
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
});
