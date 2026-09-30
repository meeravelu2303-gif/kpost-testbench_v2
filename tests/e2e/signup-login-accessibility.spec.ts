/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { AXE_JSON_ATTACHMENT, renderAccessibilityOverlay } from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import { writeFileSync } from 'node:fs';

/**
 * Deep WCAG accessibility angle (axe-core, full ruleset) for the SIGNED-OUT screens — the same tool
 * `accessibility-axe.spec.ts` runs on every authenticated screen, applied here to Signup and Login.
 * Neither was ever scanned before: the authenticated sweep skips entirely when there is no session
 * (`skipIfSignedOut`), and Signup/Login are reached BEFORE one exists — so this was a genuine 0%
 * coverage gap, not a thin one.
 *
 * Same structured-evidence shape as the authenticated sweep (`AXE_JSON_ATTACHMENT`), so the existing
 * bug-filing pipeline picks these up automatically — no new filing logic needed, just new screens.
 */
test.describe('KPost signed-out screens — accessibility (axe-core WCAG)', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function scanCurrentPage(
    page: import('@playwright/test').Page,
    testInfo: import('@playwright/test').TestInfo,
    screenName: string,
    route: string,
  ): Promise<void> {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const by = (impact: string) => results.violations.filter((v) => v.impact === impact);
    const critical = by('critical');
    const serious = by('serious');
    const summary = results.violations
      .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.length}× — ${v.help}`)
      .join('\n');

    await testInfo.attach(`axe-${screenName}.txt`, {
      body: summary || 'no violations',
      contentType: 'text/plain',
    });

    const evidence: AxeScreenResult = {
      screen: screenName,
      route,
      violations: [...critical, ...serious].map((v) => ({
        id: v.id,
        impact: v.impact as AxeScreenResult['violations'][number]['impact'],
        help: v.help,
        helpUrl: v.helpUrl,
        tags: v.tags,
        nodeCount: v.nodes.length,
        targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      })),
    };
    const evidencePath = testInfo.outputPath('axe-violations.json');
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    await testInfo.attach(AXE_JSON_ATTACHMENT, { path: evidencePath, contentType: 'application/json' });

    if (evidence.violations.length) {
      await renderAccessibilityOverlay(page, screenName, evidence.violations);
      const overlayPath = testInfo.outputPath('a11y-evidence.png');
      await page.screenshot({ path: overlayPath }).catch(() => undefined);
      await testInfo.attach('a11y-evidence', { path: overlayPath, contentType: 'image/png' });
      await page
        .locator('#__kp_a11y_overlay')
        .waitFor({ state: 'detached', timeout: 4_000 })
        .catch(() => undefined);
    }

    console.log(
      `[a11y] ${screenName}: ${critical.length} critical, ${serious.length} serious, ${results.violations.length} total`,
    );

    expect
      .soft(critical, `${screenName}: critical WCAG violations — ${critical.map((v) => v.id).join(', ')}`)
      .toEqual([]);
    expect
      .soft(serious, `${screenName}: serious WCAG violations — ${serious.map((v) => v.id).join(', ')}`)
      .toEqual([]);
  }

  test('Signup — account-type picker — WCAG violations (axe) @ui', async ({
    page,
    signupPage,
  }, testInfo) => {
    await page.goto(signupPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await signupPage.expectLoaded();
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Signup — account type', '/signup');
  });

  test('Signup — Business category picker — WCAG violations (axe) @ui', async ({
    page,
    signupPage,
  }, testInfo) => {
    await page.goto(signupPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await signupPage.expectLoaded();
    await signupPage.chooseAccountType('Business');
    await page
      .locator('.category-contentBox-layout')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Signup — Business category', '/signup');
  });

  test('Login — id entry step — WCAG violations (axe) @ui', async ({ page, loginPage }, testInfo) => {
    await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await loginPage.expectLoaded();
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Login — id entry', '/login');
  });

  test('Login — password step — WCAG violations (axe) @ui', async ({ page, loginPage }, testInfo) => {
    await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await loginPage.expectLoaded();
    await loginPage.enterLoginId(testData.kpostId);
    await loginPage.passwordInput.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
    test.skip(
      !(await loginPage.passwordInput.isVisible()),
      'the fixed probe id did not exist on this host — step 2 never mounted',
    );
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Login — password entry', '/login');
  });

  test('Login — Forgot Password modal — WCAG violations (axe) @ui', async ({
    page,
    loginPage,
  }, testInfo) => {
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
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Login — Forgot Password modal', '/login');
  });

  /*
   * The two deeper signup screens below were unreachable before the Cloudflare Turnstile fix
   * (2026-09-30) — mobile verification never completed, so nothing past it could be scanned. Each
   * uses its own fresh, throwaway mobile number: unlike the lifecycle specs, this never completes a
   * signup (no account is created), so no reserved identity is needed — a collision just means
   * re-running with a different generated number.
   */
  function freshMobile(): string {
    return `77${Date.now().toString().slice(-8)}`;
  }

  test('Signup — Personal details step (post-OTP) — WCAG violations (axe) @ui', async ({
    page,
    signupPage,
  }, testInfo) => {
    test.skip(
      process.env.SIGNUP_UI_LIFECYCLE !== 'true',
      'drives a real mobile OTP to reach this step; set SIGNUP_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
    );

    await signupPage.goto();
    await signupPage.chooseAccountType('Personal');
    await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

    const otpOutcome = await signupPage.requestMobileOtp(freshMobile());
    test.skip(otpOutcome === 'already-exists', 'the random mobile happened to collide — re-run');
    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    test.skip(otpEntryOutcome === 'invalid', 'the OTP bypass code was rejected this run — re-run');

    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Signup — Personal details (post-OTP)', '/signup');
  });

  test('Signup — Business Company Details step (post-OTP) — WCAG violations (axe) @ui', async ({
    page,
    signupPage,
  }, testInfo) => {
    test.skip(
      process.env.SIGNUP_UI_LIFECYCLE !== 'true',
      'drives a real mobile OTP to reach this step; set SIGNUP_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
    );

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
      lastName: 'A11y',
      gender: 'Female',
      dobDay: 15,
      dobMonth: 'June',
      dobYear: 1995,
    });
    await page.getByRole('button', { name: /^Continue$/i }).click({ force: true });
    await page.waitForTimeout(1200);
    await scanCurrentPage(page, testInfo, 'Signup — Business Company Details (post-OTP)', '/signup');
  });
});
