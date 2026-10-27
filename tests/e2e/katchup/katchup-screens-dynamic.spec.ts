import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { gotoKatchup, openConversation } from '../support/katchup';

/**
 * Katchup health/performance/layout checks on three states: the conversation list, an open thread,
 * and the composer with Subject focused. Not in UI_FILING_SPECS until it has clean runs.
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
  'KPost Katchup — dynamic-state health/performance/layout sweep',
  {
    tag: ['@ui', '@katchup', '@regression'],
    annotation: [{ type: 'non-functional', description: 'performance' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    test('Katchup — conversation list (default): health, performance, layout @ui', async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();
      await gotoKatchup(page);
      const loadMs = Date.now() - started;
      const screen: ScreenDef = {
        route: '/katchup',
        name: 'Katchup — conversation list',
        screen: 'katchup',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Katchup — open conversation thread: health, performance, layout @ui', async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();
      await openConversation(page, testData.victimKpostId);
      const loadMs = Date.now() - started;
      const screen: ScreenDef = {
        route: '/katchup',
        name: 'Katchup — open conversation',
        screen: 'katchup',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Katchup — composer open, Subject focused: health, performance, layout @ui', async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();
      await openConversation(page, testData.victimKpostId);
      await page.locator('.msg-arrow').first().click();
      await page.getByRole('textbox', { name: 'Subject' }).click();
      const loadMs = Date.now() - started;
      const screen: ScreenDef = {
        route: '/katchup',
        name: 'Katchup — composer open',
        screen: 'katchup',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });
  },
);
