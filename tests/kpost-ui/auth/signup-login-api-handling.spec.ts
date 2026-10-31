import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { retryOrSkip } from '../../support/live-condition';
import { toast } from '../support/validation';

/**
 * Signup must surface a failing KPOST ID check and registration submit (incl. HTTP 200 carrying a
 * failure). Only the call under test is stubbed; OTP calls go through the test gateway.
 */
/**
 * The final signup POST (`Services/SignUp.js UserSignup`): `/signupLogin/signup`, with no trailing
 * slash. A glob ending in `/**` misses it and the real signup goes through (it did: 9 accounts made
 * by this spec were deleted on 2026-10-31), so each test also asserts its stub was used.
 */
const SIGNUP_SUBMIT = /\/signupLogin\/signup\/?(\?.*)?$/;

function freshMobile(): string {
  return `77${Date.now().toString().slice(-8)}`;
}

test.describe(
  'KPost signup · API failure handling',
  {
    tag: ['@ui', '@auth', '@signup', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test.skip(
      process.env.SIGNUP_UI_LIFECYCLE !== 'true',
      'drives the real signup screen (a mobile OTP is sent); set SIGNUP_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
    );

    test('a failing KPOST ID availability check shows an error, not silence or a false "available" @ui', async ({
      signupPage,
      page,
    }) => {
      await signupPage.goto();
      await signupPage.chooseAccountType('Personal');
      await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

      const mobile = freshMobile();
      const otpOutcome = await signupPage.requestMobileOtp(mobile);
      retryOrSkip(
        otpOutcome === 'already-exists',
        'the random mobile happened to collide — re-run',
      );
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      retryOrSkip(
        otpEntryOutcome === 'invalid',
        'the OTP bypass code was rejected this run — re-run',
      );

      await signupPage.fillPersonalDetails({
        firstName: 'QA',
        lastName: 'ApiFail',
        gender: 'Female',
        dobDay: 15,
        dobMonth: 'June',
        dobYear: 1995,
        pincode: testData.pinCode,
        area: 'Chennai',
      });
      await signupPage.continueToKpostId();

      // KPost's envelope: HTTP 200 carrying a failure.
      await page.route('**/kpostIdExist/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 500,
            status: 'FAILURE',
            message: 'Internal Server Error',
          }),
        });
      });

      await page.getByPlaceholder('Enter Preferred KPOST ID').fill(`qafail${mobile.slice(-6)}`);

      const available = page.getByText(/KpostID is Available/i);
      const taken = page.getByText(/This KpostID is already exists/i);
      const anyErrorToast = page.locator('.Toastify__toast, [class*="toast"]', {
        hasText: /error|fail|try again|something went wrong/i,
      });

      const outcome = await Promise.race([
        available
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then((): 'available' => 'available'),
        taken.waitFor({ state: 'visible', timeout: 10_000 }).then((): 'taken' => 'taken'),
        anyErrorToast
          .first()
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then((): 'error-shown' => 'error-shown'),
      ]).catch((): 'nothing' => 'nothing');

      test.info().annotations.push({
        type: 'observed',
        description: `outcome when the check fails: ${outcome}`,
      });

      // Failure modes: falsely reporting "available", or total silence.
      expect(
        outcome,
        'a failed availability check must not be silently swallowed or misreported as "available"',
      ).not.toBe('available');
      expect(
        outcome,
        'a failed availability check must show SOME visible feedback, not nothing at all',
      ).not.toBe('nothing');
    });

    test('a failing final registration submit shows an error, not a false success @ui', async ({
      signupPage,
      page,
    }) => {
      await signupPage.goto();
      await signupPage.chooseAccountType('Personal');
      await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

      const mobile = freshMobile();
      const otpOutcome = await signupPage.requestMobileOtp(mobile);
      retryOrSkip(
        otpOutcome === 'already-exists',
        'the random mobile happened to collide — re-run',
      );
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      retryOrSkip(
        otpEntryOutcome === 'invalid',
        'the OTP bypass code was rejected this run — re-run',
      );

      await signupPage.fillPersonalDetails({
        firstName: 'QA',
        lastName: 'SubmitFail',
        gender: 'Female',
        dobDay: 15,
        dobMonth: 'June',
        dobYear: 1995,
        pincode: testData.pinCode,
        area: 'Chennai',
      });
      await signupPage.continueToKpostId();
      const kpostIdOutcome = await signupPage.choosePreferredKpostId(`qasf${mobile.slice(-6)}`);
      retryOrSkip(
        kpostIdOutcome === 'taken',
        'the generated local part happened to collide — re-run',
      );

      // Stub only the final submit; every earlier call was real. The shape the server really sends:
      // SignUpLoginControllerV2 answers with the HTTP status of its statusCode (500 here), so an
      // HTTP 200 carrying a 500 envelope is a state it no longer produces (2026-10-31).
      let stubbed = 0;
      await page.route(SIGNUP_SUBMIT, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        stubbed += 1;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 500,
            status: 'FAILURE',
            message: 'Internal Server Error',
          }),
        });
      });

      await page.getByPlaceholder('Enter Password').fill(testData.password);
      await page.getByPlaceholder(/Enter Confirm Password/).fill(testData.password);
      await page.locator('input[type="checkbox"]').check();
      await page.getByRole('button', { name: /^Submit$/i }).click();

      const success = page.getByText(/Successfully completed the Signup/i);
      const anyErrorToast = page.locator('.Toastify__toast, [class*="toast"]', {
        hasText: /error|fail|try again|something went wrong/i,
      });

      const outcome = await Promise.race([
        success
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then((): 'false-success' => 'false-success'),
        anyErrorToast
          .first()
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then((): 'error-shown' => 'error-shown'),
      ]).catch((): 'nothing' => 'nothing');

      test.info().annotations.push({
        type: 'observed',
        description: `outcome when submit fails: ${outcome}`,
      });

      expect(
        outcome,
        'a failed registration submit must never show the success modal to the user',
      ).not.toBe('false-success');
      expect(
        outcome,
        'a failed registration submit must show SOME visible feedback, not nothing at all',
      ).not.toBe('nothing');
      expect(stubbed, 'the submit was answered in the browser (no account was created)').toBe(1);
    });

    // The desktop renders the Personal signup screen, a phone width renders MainSignup: each has its
    // own catch for a submit that gets no answer.
    for (const [screen, viewport] of [
      ['desktop', { width: 1280, height: 800 }],
      ['mobile 480×900', { width: 480, height: 900 }],
    ] as const) {
      test.describe(`${screen}`, () => {
        test.use({ viewport });

        test(`a registration submit that gets no answer says "Unable to complete signup" (${screen}) @ui`, async ({
          signupPage,
          page,
        }) => {
          await signupPage.goto();
          await signupPage.chooseAccountType('Personal');
          await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

          const mobile = freshMobile();
          const otpOutcome = await signupPage.requestMobileOtp(mobile);
          retryOrSkip(
            otpOutcome === 'already-exists',
            'the random mobile happened to collide right now — re-run',
          );
          const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
          retryOrSkip(
            otpEntryOutcome === 'invalid',
            'the OTP bypass code was rejected right now — re-run',
          );
          await signupPage.fillPersonalDetails({
            firstName: 'QA',
            lastName: 'NoAnswer',
            gender: 'Female',
            dobDay: 15,
            dobMonth: 'June',
            dobYear: 1995,
            pincode: testData.pinCode,
            area: 'Chennai',
          });
          await signupPage.continueToKpostId();
          const kpostIdOutcome = await signupPage.choosePreferredKpostId(`qana${mobile.slice(-6)}`);
          retryOrSkip(
            kpostIdOutcome === 'taken',
            'the generated local part happened to collide right now — re-run',
          );

          // The submit never reaches the server, so no account is created.
          let aborted = 0;
          await page.route(SIGNUP_SUBMIT, (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            aborted += 1;
            return route.abort();
          });
          await page.getByPlaceholder('Enter Password').fill(testData.password);
          await page.getByPlaceholder(/Enter Confirm Password/).fill(testData.password);
          await page.locator('input[type="checkbox"]').check();
          await page.getByRole('button', { name: /^Submit$/i }).click();

          await expect(
            toast(page, 'Unable to complete signup. Check your connection and try again.'),
            'the user is told the signup did not go through',
          ).toBeVisible({ timeout: 15_000 });
          await expect(page.getByText(/Successfully completed the Signup/i)).toHaveCount(0);
          expect(aborted, 'the submit was stopped in the browser (no account was created)').toBe(1);
        });
      });
    }
  },
);
