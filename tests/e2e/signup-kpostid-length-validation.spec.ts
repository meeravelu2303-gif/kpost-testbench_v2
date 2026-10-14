import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Personal signup — Preferred KPOST ID length validation (reported manually 2026-10-13): the KPOST
 * ID must be 5–12 characters, but on a second/third attempt a SINGLE character is accepted. Correct
 * behaviour: a single character is below the 5-char minimum and must be rejected EVERY time it is
 * entered — the "between 5 and 12 characters" error must show and "KpostID is Available" must never
 * appear for it, no matter how many times it is retried.
 *
 * Reaches signup screen 3 (the KPOST ID screen) via a valid screen-2 (India, real pincode/area), then
 * stops — it never sets a password or submits, so no account is created. Same gates as
 * signup-validation.spec.ts.
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

      // Baseline: a valid-length id resolves to a real availability verdict (NOT a length error) —
      // proves we are on the KPOST ID screen and the checker works.
      const baseline = await signupPage.kpostIdValidationState(`qaid${mobile.slice(-6)}`);
      expect(
        ['available', 'taken'],
        `a valid-length KPOST ID must get an availability verdict, got "${baseline}"`,
      ).toContain(baseline);

      // The real check: a single character is below the 5-char minimum and must be rejected on
      // EVERY attempt — never accepted on a 2nd/3rd retry.
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
