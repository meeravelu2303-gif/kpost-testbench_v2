import { testData } from '@config/test-data.config';
import type { ScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Deep UI sweep for the SIGNED-OUT screens — the same health/performance/layout/basic-a11y
 * catalogue `screens.spec.ts` runs on every authenticated screen (`@ui/ui-checks`), applied here to
 * Signup and Login instead. Those two were never covered by that sweep because it requires a live
 * session (`skipIfSignedOut`) and Signup/Login are reached BEFORE one exists.
 *
 * Each scenario is a distinct STATE of the signed-out flow, not just a route — the account-type
 * picker and the Business category picker are both `/signup`, reached by clicking through rather
 * than a second `goto`. `watchUiHealth` starts before the first navigation so a crash triggered by
 * the click-through itself (not just the initial load) is still caught.
 *
 * `screen: 'login' | 'signup'` routes filed findings to the existing "Auth" component
 * (`UI_COMPONENT_BY_SCREEN`) — no new Bugzilla wiring needed.
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

test.describe('KPost signed-out screens — deep UI sweep', { tag: '@ui' }, () => {
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
    await loginPage.passwordInput.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
    const loadMs = Date.now() - started;

    // A genuinely unknown id never reaches step 2 — skip (not fail) rather than file a false
    // "missing control" finding for a step this run never got to.
    test.skip(
      !(await loginPage.passwordInput.isVisible()),
      'the fixed probe id did not exist on this host — step 2 never mounted',
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
    // The "Forgot Password ?" link only renders on the PASSWORD step, not the initial id-entry
    // step — a known id must advance the flow first (same precondition as the existing, working
    // `login-session.spec.ts` test for this same link).
    await loginPage.enterLoginId(testData.kpostId);
    await loginPage.passwordInput.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
    test.skip(
      !(await loginPage.passwordInput.isVisible()),
      'the fixed probe id did not exist on this host — the password step (and its Forgot Password link) never mounted',
    );
    await page.getByText(/Forgot Password/i).first().click();
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
});
