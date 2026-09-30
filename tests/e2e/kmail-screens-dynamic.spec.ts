import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The health/performance/layout counterpart to `kmail-accessibility.spec.ts`'s one dynamic state —
 * the compose form at `/writemail`, a DIFFERENT route from `/kmail` (which the generic sweep already
 * covers by default). Same `runUiChecks`/`watchUiHealth` machinery as every other dynamic-state file
 * this session.
 */
const RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

test.describe('KPost KMail — compose form dynamic-state health/performance/layout sweep', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('KMail — compose form (/writemail): health, performance, layout @ui', async ({ page }) => {
    const stop = watchUiHealth(page);
    const started = Date.now();

    await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .locator('input[name="to"], .subjectTextboxKmailTO')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    const loadMs = Date.now() - started;

    const screen: ScreenDef = {
      route: '/writemail',
      name: 'KMail — compose form',
      screen: 'kmail',
      ready: [],
      controls: [],
    };
    const findings = await runUiChecks({ page, screen, health: stop(), loadMs });
    const fileable = findings.filter((f) => RANK[f.severity]! >= RANK.MEDIUM!);
    const context = findings.filter((f) => RANK[f.severity]! < RANK.MEDIUM!);
    if (context.length) {
      console.log(
        `[ui-context] ${screen.name}: ${context.map((f) => `[${f.check}] ${f.message}`).join(' | ')}`,
      );
    }
    const problems = fileable.map((f) => `[${f.check}] ${f.message}`);
    expect(problems, `${screen.name} UI issues — ${problems.join(' | ')}`).toEqual([]);
  });
});
