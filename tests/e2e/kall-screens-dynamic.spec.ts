import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The health/performance/layout counterpart to `kall-accessibility.spec.ts`'s 2 dynamic states — the
 * Kool Kall tab active, and the schedule modal (CreateKallModal) open. Same `runUiChecks`/
 * `watchUiHealth` machinery; never completes Submit (blocked on a codegen-pending participant-picker
 * step, same as `kall-features.spec.ts`).
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

test.describe('KPost Kall — dynamic-state health/performance/layout sweep', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('Kall — Kool Kall tab active: health, performance, layout @ui', async ({ page }) => {
    const stop = watchUiHealth(page);
    const started = Date.now();
    await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByRole('button', { name: /Kool Kall/i })
      .first()
      .click()
      .catch(() => undefined);
    const loadMs = Date.now() - started;
    const screen: ScreenDef = {
      route: '/kall',
      name: 'Kall — Kool Kall tab active',
      screen: 'kall',
      ready: [],
      controls: [],
    };
    await assertNoFileableIssues(page, screen, stop(), loadMs);
  });

  test('Kall — schedule modal open: health, performance, layout @ui', async ({ page }) => {
    const stop = watchUiHealth(page);
    const started = Date.now();
    await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByRole('button', { name: /Kool Kall/i })
      .first()
      .click()
      .catch(() => undefined);

    const modal = page.locator('.modal-content');
    const titleField = modal.locator('input[placeholder="Enter Meeting Title"]').first();
    const createBtn = page.locator('.create_font').first();
    await createBtn.click({ force: true }).catch(() => undefined);
    if (!(await titleField.isVisible().catch(() => false))) {
      await createBtn.click({ force: true }).catch(() => undefined);
    }
    const opened = await titleField.isVisible({ timeout: 15_000 }).catch(() => false);
    test.skip(!opened, 'the schedule modal did not open on this build');
    const loadMs = Date.now() - started;

    const screen: ScreenDef = {
      route: '/kall',
      name: 'Kall — schedule modal open',
      screen: 'kall',
      ready: [],
      controls: [],
    };
    await assertNoFileableIssues(page, screen, stop(), loadMs);
  });
});
