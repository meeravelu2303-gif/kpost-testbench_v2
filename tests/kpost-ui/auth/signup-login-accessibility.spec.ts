/* eslint-disable playwright/no-wait-for-timeout */
import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import {
  AXE_DETAILS_ATTACHMENT,
  AXE_JSON_ATTACHMENT,
  axeDetailsText,
  renderAccessibilityOverlay,
} from '@ui/accessibility-evidence';
import type { AxeScreenResult } from '@ui/accessibility-evidence';
import { expect, test } from '@fixtures';
import { answerForgotPasswordSmsLocally } from '../support/no-real-sms';
import { writeFileSync } from 'node:fs';
import { settleFrames } from '../support/settle';
import { retryOrSkip } from '../../support/live-condition';

/**
 * axe-core WCAG scans of the signed-out Signup and Login screens, with the same evidence attachments
 * as the authenticated sweep so the filing pipeline picks them up.
 */
test.describe(
  'KPost signed-out screens — accessibility (axe-core WCAG)',
  {
    tag: ['@ui', '@auth', '@signup', '@regression'],
    annotation: [{ type: 'non-functional', description: 'accessibility' }],
  },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    async function scanCurrentPage(
      page: Page,
      testInfo: TestInfo,
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
      await testInfo.attach(AXE_JSON_ATTACHMENT, {
        path: evidencePath,
        contentType: 'application/json',
      });
      // Every failing element with selector, HTML and contrast details, uploaded to the ticket.
      if (critical.length + serious.length) {
        const detailsPath = testInfo.outputPath('a11y-details.txt');
        writeFileSync(detailsPath, axeDetailsText(screenName, [...critical, ...serious]));
        await testInfo.attach(AXE_DETAILS_ATTACHMENT, {
          path: detailsPath,
          contentType: 'text/plain',
        });
      }

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
        .soft(
          critical,
          `${screenName}: critical WCAG violations — ${critical.map((v) => v.id).join(', ')}`,
        )
        .toEqual([]);
      expect
        .soft(
          serious,
          `${screenName}: serious WCAG violations — ${serious.map((v) => v.id).join(', ')}`,
        )
        .toEqual([]);
    }

    test('Signup — account-type picker — WCAG violations (axe) @ui', async ({
      page,
      signupPage,
    }, testInfo) => {
      await page.goto(signupPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await signupPage.expectLoaded();
      await settleFrames(page, 3);
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
      await settleFrames(page, 3);
      await scanCurrentPage(page, testInfo, 'Signup — Business category', '/signup');
    });

    test('Login — id entry step — WCAG violations (axe) @ui', async ({
      page,
      loginPage,
    }, testInfo) => {
      await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await loginPage.expectLoaded();
      await settleFrames(page, 3);
      await scanCurrentPage(page, testInfo, 'Login — id entry', '/login');
    });

    test('Login — password step — WCAG violations (axe) @ui', async ({
      page,
      loginPage,
    }, testInfo) => {
      await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await loginPage.expectLoaded();
      await loginPage.enterLoginId(testData.kpostId);
      await loginPage.passwordInput
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => undefined);
      retryOrSkip(
        !(await loginPage.passwordInput.isVisible()),
        'the fixed probe id was not accepted right now — step 2 was not shown',
      );
      await settleFrames(page, 3);
      await scanCurrentPage(page, testInfo, 'Login — password entry', '/login');
    });

    test('Login — Forgot Password modal — WCAG violations (axe) @ui', async ({
      page,
      loginPage,
    }, testInfo) => {
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
      await settleFrames(page, 3);
      await scanCurrentPage(page, testInfo, 'Login — Forgot Password modal', '/login');
    });

    // The post-OTP screens use a throwaway mobile: no signup is completed, so no reserved identity.
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
      retryOrSkip(
        otpOutcome === 'already-exists',
        'the random mobile happened to collide — re-run',
      );
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      retryOrSkip(
        otpEntryOutcome === 'invalid',
        'the OTP bypass code was rejected this run — re-run',
      );

      await settleFrames(page, 3);
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
        lastName: 'A11y',
        gender: 'Female',
        dobDay: 15,
        dobMonth: 'June',
        dobYear: 1995,
      });
      await page.getByRole('button', { name: /^Continue$/i }).click();
      await settleFrames(page, 3);
      await scanCurrentPage(
        page,
        testInfo,
        'Signup — Business Company Details (post-OTP)',
        '/signup',
      );
    });
  },
);
