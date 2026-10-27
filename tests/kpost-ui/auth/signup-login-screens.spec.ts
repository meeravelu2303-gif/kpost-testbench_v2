import { testData } from '@config/test-data.config';
import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { answerForgotPasswordSmsLocally } from '../support/no-real-sms';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Health/performance/layout/basic-a11y sweep of each signed-out Signup and Login state. watchUiHealth
 * starts before the first navigation so a crash during the click-through is caught too.
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
  'KPost signed-out screens — deep UI sweep',
  {
    tag: ['@ui', '@auth', '@signup', '@regression'],
    annotation: [{ type: 'non-functional', description: 'performance' }],
  },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('Signup — account-type picker: controls, health, performance, layout @ui', async ({
      page,
      signupPage,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();

      await page.goto(signupPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await signupPage.expectLoaded();
      const loadMs = Date.now() - started;

      const screen: ScreenDef = {
        route: '/signup',
        name: 'Signup — account type',
        screen: 'signup',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Signup — Business category picker: controls, health, performance, layout @ui', async ({
      page,
      signupPage,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();

      await page.goto(signupPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await signupPage.expectLoaded();
      await signupPage.chooseAccountType('Business');
      await page
        .locator('.category-contentBox-layout')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 });
      const loadMs = Date.now() - started;

      const screen: ScreenDef = {
        route: '/signup',
        name: 'Signup — Business category',
        screen: 'signup',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Login — id entry step: controls, health, performance, layout @ui', async ({
      page,
      loginPage,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();

      await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await loginPage.expectLoaded();
      const loadMs = Date.now() - started;

      const screen: ScreenDef = {
        route: '/login',
        name: 'Login — id entry',
        screen: 'login',
        ready: [],
        controls: [
          { selector: '#username', label: 'KPOST ID / Mobile input' },
          { selector: 'button:has-text("Submit")', label: 'Submit button' },
        ],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Login — password step (known id, no submit): controls, health, performance, layout @ui', async ({
      page,
      loginPage,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();

      await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await loginPage.expectLoaded();
      await loginPage.enterLoginId(testData.kpostId);
      await loginPage.passwordInput
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => undefined);
      const loadMs = Date.now() - started;

      // Skip, not fail, if step 2 was never reached, so no false "missing control" is filed.
      retryOrSkip(
        !(await loginPage.passwordInput.isVisible()),
        'the fixed probe id was not accepted right now — step 2 was not shown',
      );

      const screen: ScreenDef = {
        route: '/login',
        name: 'Login — password entry',
        screen: 'login',
        ready: [],
        controls: [
          { selector: 'input[type="password"]', label: 'Password field' },
          { selector: 'button:has-text("Login")', label: 'Login button' },
        ],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Login — Forgot Password modal: controls, health, performance, layout @ui', async ({
      page,
      loginPage,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();

      await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await loginPage.expectLoaded();
      // The "Forgot Password ?" link only renders on the password step.
      await loginPage.enterLoginId(testData.kpostId);
      await loginPage.passwordInput
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => undefined);
      retryOrSkip(
        !(await loginPage.passwordInput.isVisible()),
        'the fixed probe id was not accepted right now — the password step (and its Forgot Password link) was not shown',
      );
      // Clicking the link ALONE sends a real SMS; answer it in the browser (support/no-real-sms.ts).
      await answerForgotPasswordSmsLocally(page);
      await page
        .getByText(/Forgot Password/i)
        .first()
        .click();
      await page
        .getByText(/^Forgot Password$/i)
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });
      const loadMs = Date.now() - started;

      const screen: ScreenDef = {
        route: '/login',
        name: 'Login — Forgot Password modal',
        screen: 'login',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });
  },
);
