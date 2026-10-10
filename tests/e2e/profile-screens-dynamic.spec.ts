import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The health/performance/layout counterpart to `profile-accessibility.spec.ts`'s 2 dynamic states —
 * the three-dot action menu open, and the Share modal open. Same `runUiChecks`/`watchUiHealth`
 * machinery as every other dynamic-state file this session.
 */
const RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

async function assertNoFileableIssues(
  page: Parameters<typeof runUiChecks>[0]['page'],
  screen: ScreenDef,
  health: ReturnType<ReturnType<typeof watchUiHealth>>,
  loadMs: number,
): Promise<void> {
  const findings = await runUiChecks({ page, screen, health, loadMs });
  const fileable = findings.filter((f) => RANK[f.severity]! >= RANK.MEDIUM!);
  const context = findings.filter((f) => RANK[f.severity]! < RANK.MEDIUM!);
  if (context.length) {
    console.log(
      `[ui-context] ${screen.name}: ${context.map((f) => `[${f.check}] ${f.message}`).join(' | ')}`,
    );
  }
  const problems = fileable.map((f) => `[${f.check}] ${f.message}`);
  expect(problems, `${screen.name} UI issues — ${problems.join(' | ')}`).toEqual([]);
}

test.describe(
  'KPost Profile — dynamic-state health/performance/layout sweep',
  { tag: '@ui' },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('Profile — three-dot menu open: health, performance, layout @ui', async ({ page }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();
      await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await page.locator('.icon-KP_144---More-Vertical').first().click();
      const loadMs = Date.now() - started;
      const screen: ScreenDef = {
        route: '/userprofile',
        name: 'Profile — three-dot menu open',
        screen: 'userprofile',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Profile — Share modal open: health, performance, layout @ui', async ({ page }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();
      await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await page.locator('.icon-KP_144---More-Vertical').first().click();
      await page
        .getByText(/^Share$/i)
        .first()
        .click();
      const loadMs = Date.now() - started;
      const screen: ScreenDef = {
        route: '/userprofile',
        name: 'Profile — Share modal open',
        screen: 'userprofile',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });
  },
);
