import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * runUiChecks (health, performance, desktop layout at 1280/1440px) on Home's Contacts tab and the
 * Advanced Search modal, which the per-screen sweep never reaches. Out of UI_FILING_SPECS for now.
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

  const notes: string[] = [
    ...context.map((f) => `[${f.check}] ${f.message}`),
    ...health.failedApiCalls.map((c) => `[api] ${c.status} ${c.method} ${c.url}`),
  ];
  if (notes.length) {
    console.log(`[ui-context] ${screen.name}: ${notes.join(' | ')}`);
  }

  const problems = fileable.map((f) => `[${f.check}] ${f.message}`);
  expect(problems, `${screen.name} UI issues — ${problems.join(' | ')}`).toEqual([]);
}

test.describe(
  'KPost Home — dynamic-state health/performance/layout sweep',
  {
    tag: ['@ui', '@home', '@regression'],
    annotation: [{ type: 'non-functional', description: 'performance' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('Home — Contacts tab active: health, performance, layout @ui', async ({
      page,
      homePage,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();

      await homePage.goto();
      await homePage.switchToContactsTab();
      await settleFrames(page);
      const loadMs = Date.now() - started;

      const screen: ScreenDef = {
        route: '/home',
        name: 'Home — Contacts tab active',
        screen: 'home',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Home — Advanced Search modal open: health, performance, layout @ui', async ({
      page,
      homePage,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();

      await homePage.goto();
      await homePage.switchToRecentsTab();
      await homePage.openAdvancedSearch();
      await settleFrames(page);
      const loadMs = Date.now() - started;

      const screen: ScreenDef = {
        route: '/home',
        name: 'Home — Advanced Search modal open',
        screen: 'home',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });
  },
);
