import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Personal signup: a single-character KPOST ID (below the 5-12 limit) must be rejected on every retry.
 * Stops at the KPOST ID screen, so no account is created.
 */
function freshMobile(): string {
  return `77${Date.now().toString().slice(-8)}`;
}

test.describe(
  'KPost signup · Preferred KPOST ID length validation',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
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

    test('a single-character KPOST ID is rejected on every attempt, not accepted on a retry @ui', async ({
      signupPage,
    }) => {
      await signupPage.goto();
      await signupPage.chooseAccountType('Personal');
      await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

      const mobile = freshMobile();
      const otpOutcome = await signupPage.requestMobileOtp(mobile);
      test.skip(
        otpOutcome === 'already-exists',
        'the randomly generated mobile number happened to already be registered — re-run',
      );
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      test.skip(
        otpEntryOutcome === 'invalid',
        "the OTP box rejected the bypass code this run — see enterMobileOtp's doc comment; re-run",
      );

      // A valid screen 2 → reach the KPOST ID screen.
      await signupPage.fillPersonalDetails({
        firstName: 'QA',
        lastName: 'KpostId',
        gender: 'Male',
        dobDay: 15,
        dobMonth: 'January',
        dobYear: 1990,
        pincode: testData.pinCode,
        area: 'Chennai',
      });
      await signupPage.continueToKpostId();

      // Baseline: a valid-length id gets an availability verdict, not a length error.
      const baseline = await signupPage.kpostIdValidationState(`qaid${mobile.slice(-6)}`);
      expect(
        ['available', 'taken'],
        `a valid-length KPOST ID must get an availability verdict, got "${baseline}"`,
      ).toContain(baseline);

      // A single character must be rejected on every attempt, not accepted on a retry.
      for (const [attempt, single] of ['a', 'b', 'c'].entries()) {
        const state = await signupPage.kpostIdValidationState(single);
        expect(
          state,
          `attempt ${attempt + 1}: single-character KPOST ID "${single}" must be rejected with the ` +
            `length error (must be 5–12 chars), but the screen showed "${state}"`,
        ).toBe('length-error');
      }
    });
  },
);
