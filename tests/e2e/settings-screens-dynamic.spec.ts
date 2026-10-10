import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The health/performance/layout counterpart to `settings-accessibility.spec.ts`'s 2 dynamic states —
 * General Settings expanded, Profile Creation expanded. Same `runUiChecks`/`watchUiHealth` machinery
 * as every other dynamic-state file this session.
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
  'KPost Settings — dynamic-state health/performance/layout sweep',
  { tag: '@ui' },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('Settings — General Settings expanded: health, performance, layout @ui', async ({
      page,
      settingsPage,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();
      await settingsPage.goto();
      await settingsPage.expandGroup('General Settings');
      const loadMs = Date.now() - started;
      const screen: ScreenDef = {
        route: '/settings',
        name: 'Settings — General Settings expanded',
        screen: 'settings',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Settings — Profile Creation expanded: health, performance, layout @ui', async ({
      page,
      settingsPage,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();
      await settingsPage.goto();
      await settingsPage.expandGroup('Profile Creation');
      const loadMs = Date.now() - started;
      const screen: ScreenDef = {
        route: '/settings',
        name: 'Settings — Profile Creation expanded',
        screen: 'settings',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });
  },
);
