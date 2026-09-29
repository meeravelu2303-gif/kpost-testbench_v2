import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Personal signup — client-side validation, every angle the happy path in
 * `signup-login-lifecycle.spec.ts` never exercises: a rejected mobile format, required fields that
 * must block progress, the 18-years-old floor, and the password policy (weak + mismatched).
 *
 * None of these tests complete a signup — each either fails before an account could be created, or
 * deliberately stops short of the final "Submit" once its own check is made. No account is created
 * and nothing needs recording in `src/fixtures/created-accounts.ts`.
 *
 * ## Gating
 *
 * Same two gates as the lifecycle spec: `SIGNUP_UI_LIFECYCLE=true` + `OTP_TEST_GATEWAY=true` +
 * `TEST_DB_MODE=true`. Three of the four tests below still need a real mobile OTP cycle to reach the
 * screen the validation lives on (empty-field gating, the age floor, and the password policy are all
 * past the OTP step) — only the invalid-mobile-format check is otsp-free.
 *
 * ## A fresh mobile number per test, not the shared identity
 *
 * `testData.signupUiMobile` is reserved for the one test that actually completes a signup
 * (`signup-login-lifecycle.spec.ts`) and gets consumed there. These tests never create an account,
 * so a locally-generated, never-reused-elsewhere number is enough — it just needs to be free right
 * now, which a timestamp-derived one reliably is.
 */
function freshMobile(): string {
  // 77 + 8 digits derived from the clock: free with overwhelming likelihood, never collides with the
  // fixed identities other specs reserve (all in the 9000000xxx range).
  return `77${Date.now().toString().slice(-8)}`;
}

test.describe('KPost signup · Personal field validation', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    process.env.SIGNUP_UI_LIFECYCLE !== 'true',
    'drives the real signup screen (a mobile OTP is sent for 3 of the 4 tests); set SIGNUP_UI_LIFECYCLE=true',
  );
  test.skip(
    process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
  );

  test('a mobile number shorter than 10 digits is rejected before any OTP is sent @ui', async ({
    signupPage,
    page,
  }) => {
    await signupPage.goto();
    await signupPage.chooseAccountType('Personal');
    await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

    // Mobile() masks input to \d{0,10} as it's typed; sendOTP() then checks the LENGTH before ever
    // calling the network — the client-side check this test is actually pinning.
    await signupPage.attemptVerifyWithInvalidMobile('12345');

    // The OTP modal must never have appeared — a short number must be rejected, not silently sent.
    await expect(
      page.getByText(/^Enter your OTP$/i),
      'no OTP modal opens for an invalid-length mobile number',
    ).toBeHidden();
  });

  test('empty First Name and Last Name keep Continue disabled after a verified mobile @ui', async ({
    signupPage,
    page,
  }) => {
    await signupPage.goto();
    await signupPage.chooseAccountType('Personal');
    await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

    const otpOutcome = await signupPage.requestMobileOtp(freshMobile());
    test.skip(
      otpOutcome === 'already-exists',
      'the randomly generated mobile number happened to already be registered — vanishingly rare; re-run',
    );
    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    test.skip(
      otpEntryOutcome === 'invalid',
      'the OTP box rejected the bypass code this run — see enterMobileOtp\'s own doc comment; re-run',
    );

    const continueButton = page.getByRole('button', { name: /^Continue$/i });

    // Nothing filled yet: Continue must be disabled (ValidData requires firstName/lastName/DOB/pincode).
    await expect(continueButton, 'Continue is disabled with no personal details filled in').toBeDisabled();

    // First Name only: still missing Last Name, DOB, pincode.
    await page.getByPlaceholder('Enter the first name').fill('QA');
    await expect(continueButton, 'Continue stays disabled with Last Name still empty').toBeDisabled();

    // First AND Last Name, but still missing DOB and pincode.
    await page.getByPlaceholder('Enter the last name').fill('Bench');
    await expect(
      continueButton,
      'Continue stays disabled with Date of Birth and Pincode still empty',
    ).toBeDisabled();
  });

  /*
   * See #817: the First Name field accepts a raw <script> tag and an HTML-attribute-breakout payload
   * verbatim, with no character-class filtering, and Continue is not blocked by it — confirmed live.
   * Kept as a standing regression check rather than a one-off finding.
   */
  test('the First Name field does not filter script/HTML-breakout characters — #817 @ui', async ({
    signupPage,
    page,
  }) => {
    await signupPage.goto();
    await signupPage.chooseAccountType('Personal');
    await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

    const otpOutcome = await signupPage.requestMobileOtp(freshMobile());
    test.skip(otpOutcome === 'already-exists', 'the random mobile happened to collide — re-run');
    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    test.skip(otpEntryOutcome === 'invalid', 'the OTP bypass code was rejected this run — re-run');

    const field = page.getByPlaceholder('Enter the first name');
    const payload = '<script>alert(1)</script>';
    await field.fill(payload);

    test.info().annotations.push({
      type: 'observed',
      description: `First Name accepted verbatim: ${JSON.stringify(await field.inputValue())}`,
    });

    // This SHOULD fail today (documenting #817) — a name field must not accept raw markup unfiltered.
    await expect(field, 'a name field must not accept an unfiltered <script> tag — see #817').not.toHaveValue(
      payload,
    );
  });

  test('the date picker blocks a birthday younger than 18 years old @ui', async ({
    signupPage,
    page,
  }) => {
    await signupPage.goto();
    await signupPage.chooseAccountType('Personal');
    await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

    const otpOutcome = await signupPage.requestMobileOtp(freshMobile());
    test.skip(
      otpOutcome === 'already-exists',
      'the randomly generated mobile number happened to already be registered — vanishingly rare; re-run',
    );
    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    test.skip(
      otpEntryOutcome === 'invalid',
      'the OTP box rejected the bypass code this run — see enterMobileOtp\'s own doc comment; re-run',
    );

    const thisYear = new Date().getFullYear();

    // The 18-year floor is enforced by excluding recent years from the YEAR dropdown entirely (not by
    // disabling individual days within a selectable year) — confirmed live: the dropdown's options run
    // 1900 up to (this year − 18), with nothing more recent offered at all. So the correct assertion is
    // on the dropdown's own option list, not on a specific day's disabled state for an unreachable year.
    await signupPage.openDateOfBirthPicker();
    const yearOptions = await page
      .locator('.react-datepicker__year-select option')
      .allTextContents();
    const years = yearOptions.map(Number);
    expect(Math.max(...years), 'the newest offered year keeps every selectable person 18+').toBe(
      thisYear - 18,
    );
    expect(
      years,
      'no year within the last 18 years is offered at all — under-18 birth years are unreachable',
    ).not.toContain(thisYear);

    // A birthday exactly 25 years ago must NOT be disabled — the floor should not over-block real adults.
    const adultYear = thisYear - 25;
    const allowed = await signupPage.isDateOfBirthDayDisabled(15, 'June', adultYear);
    expect(allowed, 'a birthday well over 18 years ago must remain selectable').toBe(false);
  });

  test('a weak password and a mismatched confirmation are both rejected before Submit @ui', async ({
    signupPage,
    page,
  }) => {
    await signupPage.goto();
    await signupPage.chooseAccountType('Personal');
    await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

    const mobile = freshMobile();
    const otpOutcome = await signupPage.requestMobileOtp(mobile);
    test.skip(
      otpOutcome === 'already-exists',
      'the randomly generated mobile number happened to already be registered — vanishingly rare; re-run',
    );
    const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
    test.skip(
      otpEntryOutcome === 'invalid',
      'the OTP box rejected the bypass code this run — see enterMobileOtp\'s own doc comment; re-run',
    );
    await signupPage.fillPersonalDetails({
      firstName: 'QA',
      lastName: 'Validate',
      gender: 'Female',
      dobDay: 15,
      dobMonth: 'June',
      dobYear: 1995,
      pincode: testData.pinCode,
      area: 'Chennai',
    });
    await signupPage.continueToKpostId();

    // A KPOST ID local part derived from the mobile number: unique enough not to collide, never
    // reused elsewhere (this test never reaches Submit, so nothing is ever actually registered).
    // "qavalid" + 6 digits is 13 chars, over the product's own 5-12 char KPOST ID limit — confirmed live
    // (the product correctly rejects it with "KPOST ID must be between 5 and 12 characters"). "qaval" (5)
    // + 6 digits keeps this at 11, safely within bounds.
    const kpostIdOutcome = await signupPage.choosePreferredKpostId(`qaval${mobile.slice(-6)}`);
    test.skip(kpostIdOutcome === 'taken', 'the generated local part happened to collide — re-run');

    // Too short and missing every required character class — validatePassword()'s regex requirement.
    await page.getByPlaceholder('Enter Password').fill('abc');
    await expect(
      page.getByText(/Password must be at least 6 characters long/i),
      'a too-short password shows the length error',
    ).toBeVisible({ timeout: 10_000 });

    // Long enough, but no uppercase/digit/special character.
    await page.getByPlaceholder('Enter Password').fill('alllowercase');
    await expect(
      page.getByText(
        /Password must contain at least one uppercase letter, one lowercase letter, one numeric digit, one special character/i,
      ),
      'a password missing a required character class is rejected',
    ).toBeVisible({ timeout: 10_000 });

    // A policy-compliant password, then a DIFFERENT (but also compliant) confirmation.
    await page.getByPlaceholder('Enter Password').fill('QaBench@2026');
    await page.getByPlaceholder(/Enter Confirm Password/).fill('QaBench@2027');
    await expect(
      page.getByText(/Password and Confirm Password do not match/i),
      'a mismatched confirmation is rejected even though both individually satisfy the policy',
    ).toBeVisible({ timeout: 10_000 });

    // Submit must not be enabled while the confirmation still disagrees with the password.
    await expect(
      page.getByRole('button', { name: /^Submit$/i }),
      'Submit stays disabled while password and confirmation disagree',
    ).toBeDisabled();
  });
});
