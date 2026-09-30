import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The health/performance/layout counterpart to `home-accessibility.spec.ts`'s two dynamic states —
 * Contacts tab active, and Advanced Search modal open. The generic per-screen sweep (`screens.ts`)
 * only ever drives `/home` in its DEFAULT state (Recents tab, no modal), so `runUiChecks`'s full
 * catalogue — health, performance, and (for this desktop-only app) the `ui.layout` check at the two
 * SUPPORTED desktop widths (1280px/1440px, confirmed from `ui-checks.ts`'s own `responsiveCheck`) —
 * never ran against either of these two states. This is Home's "responsive" coverage in the sense
 * that actually applies here: KPost has no mobile layout by design (`ui-checks.ts`), so the
 * meaningful responsive question for an authenticated screen is "does it hold together across the
 * desktop widths it DOES support," not "does it work on a phone" — the same reasoning
 * `signup-login-responsive.spec.ts` documents for why ITS mobile/tablet checks are scoped to the
 * public, pre-auth Signup/Login screens only.
 *
 * Kept in a SEPARATE file from `home-accessibility.spec.ts` and out of `UI_FILING_SPECS`, same reason
 * as `signup-screens-post-otp.spec.ts`: unproven new screens need their own clean run(s) before a
 * selector mistake on the very first run can auto-file a false bug.
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

test.describe('KPost Home — dynamic-state health/performance/layout sweep', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('Home — Contacts tab active: health, performance, layout @ui', async ({ page, homePage }) => {
    const stop = watchUiHealth(page);
    const started = Date.now();

    await homePage.goto();
    await homePage.switchToContactsTab();
    await page.waitForTimeout(1200);
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
    await page.waitForTimeout(1200);
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
});
