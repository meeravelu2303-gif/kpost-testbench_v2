import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Health/performance/layout checks for the two post-OTP signup screens. Kept apart from
 * signup-login-screens.spec.ts, which is in UI_FILING_SPECS, until these prove stable.
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

test.describe(
  'KPost signup post-OTP screens — deep UI sweep',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
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
      retryOrSkip(
        otpOutcome === 'already-exists',
        'the random mobile happened to collide — re-run',
      );
      // Start the clock right before OTP entry, so the budget judges only the post-OTP render.
      const started = Date.now();
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      retryOrSkip(
        otpEntryOutcome === 'invalid',
        'the OTP bypass code was rejected this run — re-run',
      );
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
      retryOrSkip(
        otpOutcome === 'already-exists',
        'the random mobile happened to collide — re-run',
      );
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      retryOrSkip(
        otpEntryOutcome === 'invalid',
        'the OTP bypass code was rejected this run — re-run',
      );

      await signupPage.fillBusinessPersonalDetails({
        firstName: 'QA',
        lastName: 'Sweep',
        gender: 'Female',
        dobDay: 15,
        dobMonth: 'June',
        dobYear: 1995,
      });
      // Time only this screen's transition (Continue -> Company Details), not the whole flow.
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
  },
);
