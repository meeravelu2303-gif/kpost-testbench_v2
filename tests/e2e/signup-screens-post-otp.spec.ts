import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * The health/performance/layout counterpart to `signup-login-accessibility.spec.ts`'s two new
 * post-OTP screens — unreachable before the Cloudflare Turnstile fix (2026-09-30), so never covered
 * by `signup-login-screens.spec.ts`'s otherwise-identical sweep.
 *
 * Kept in a SEPARATE file from `signup-login-screens.spec.ts` deliberately: that file is already in
 * `UI_FILING_SPECS` (proven stable across two clean live runs, so its findings auto-file to
 * Bugzilla). These two tests are brand new and unproven — adding them to the trusted file would let
 * a selector mistake on their very first run auto-file a false bug. This file earns that trust the
 * same way the other one did (two clean runs) before being added to the allow-list itself.
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

function freshMobile(): string {
  return `77${Date.now().toString().slice(-8)}`;
}

test.describe('KPost signup post-OTP screens — deep UI sweep', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    process.env.SIGNUP_UI_LIFECYCLE !== 'true',
    'drives a real mobile OTP to reach these screens; set SIGNUP_UI_LIFECYCLE=true',
  );
  test.skip(
    process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
  );

  test('Signup — Personal details step (post-OTP): controls, health, performance, layout @ui', async ({
    page,
    signupPage,
  }) => {
    const stop = watchUiHealth(page);

    await signupPage.goto();
    await signupPage.chooseAccountType('Personal');
    await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

    const otpOutcome = await signupPage.requestMobileOtp(freshMobile());
    test.skip(otpOutcome === 'already-exists', 'the random mobile happened to collide — re-run');
    /*
     * #896 (closed INVALID 2026-10-03): the timer used to start at `goto()`, which folded the entire
     * page-load + account-type + country/language/domain flow (~10s, confirmed by direct
     * instrumentation) into what the bug then called "time for the screen to appear after OTP". The
     * real post-OTP render is under a second. Starting the clock HERE — right before OTP entry, same
     * boundary the bug's own wording describes ("the screen right after entering the mobile OTP") —
     * is what the performance budget below should actually be judging.
     */
    const started = Date.now();
    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    test.skip(otpEntryOutcome === 'invalid', 'the OTP bypass code was rejected this run — re-run');
    const loadMs = Date.now() - started;

    const screen: ScreenDef = {
      route: '/signup',
      name: 'Signup — Personal details (post-OTP)',
      screen: 'signup',
      ready: [],
      controls: [],
    };
    await assertNoFileableIssues(page, screen, stop(), loadMs);
  });

  test('Signup — Business Company Details step (post-OTP): controls, health, performance, layout @ui', async ({
    page,
    signupPage,
  }) => {
    const stop = watchUiHealth(page);

    await signupPage.goto();
    await signupPage.chooseAccountType('Business');
    await signupPage.chooseBusinessCategory('Small');
    await signupPage.selectCountryLanguageDomain('India', 'English', 'kpost.in');

    const otpOutcome = await signupPage.requestMobileOtp(freshMobile());
    test.skip(otpOutcome === 'already-exists', 'the random mobile happened to collide — re-run');
    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    test.skip(otpEntryOutcome === 'invalid', 'the OTP bypass code was rejected this run — re-run');

    await signupPage.fillBusinessPersonalDetails({
      firstName: 'QA',
      lastName: 'Sweep',
      gender: 'Female',
      dobDay: 15,
      dobMonth: 'June',
      dobYear: 1995,
    });
    // Same #896 fix as the Personal test above: time THIS screen's own transition (Continue ->
    // Company Details rendering), not the whole flow since page load.
    const started = Date.now();
    await page.getByRole('button', { name: /^Continue$/i }).click({ force: true });
    const loadMs = Date.now() - started;

    const screen: ScreenDef = {
      route: '/signup',
      name: 'Signup — Business Company Details (post-OTP)',
      screen: 'signup',
      ready: [],
      controls: [],
    };
    await assertNoFileableIssues(page, screen, stop(), loadMs);
  });
});
