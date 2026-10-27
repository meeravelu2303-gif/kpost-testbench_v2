import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Personal signup client-side validation: mobile format, required fields, the 18+ age floor, the
 * password policy and the debounced KPOST ID check. No test reaches Submit, so no account is created.
 * Gated like the lifecycle spec because most checks sit past the mobile OTP step.
 */
function freshMobile(): string {
  // 77 + 8 clock digits: free right now and outside the reserved 9000000xxx identities.
  return `77${Date.now().toString().slice(-8)}`;
}

test.describe(
  'KPost signup · Personal field validation',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test.skip(
      process.env.SIGNUP_UI_LIFECYCLE !== 'true',
      'drives the real signup screen (a mobile OTP is sent for 3 of the 4 tests); set SIGNUP_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
    );

    test(
      'a mobile number shorter than 10 digits is rejected before any OTP is sent @ui',
      { tag: '@sanity' },
      async ({ signupPage, page }) => {
        await signupPage.goto();
        await signupPage.chooseAccountType('Personal');
        await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

        // sendOTP() checks the length before calling the network.
        await signupPage.attemptVerifyWithInvalidMobile('12345');

        await expect(
          page.getByText(/^Enter your OTP$/i),
          'no OTP modal opens for an invalid-length mobile number',
        ).toBeHidden();
      },
    );

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
        "the OTP box rejected the bypass code this run — see enterMobileOtp's own doc comment; re-run",
      );

      const continueButton = page.getByRole('button', { name: /^Continue$/i });

      // Nothing filled yet: Continue must be disabled (ValidData requires firstName/lastName/DOB/pincode).
      await expect(
        continueButton,
        'Continue is disabled with no personal details filled in',
      ).toBeDisabled();

      // First Name only: still missing Last Name, DOB, pincode.
      await page.getByPlaceholder('Enter the first name').fill('QA');
      await expect(
        continueButton,
        'Continue stays disabled with Last Name still empty',
      ).toBeDisabled();

      // First AND Last Name, but still missing DOB and pincode.
      await page.getByPlaceholder('Enter the last name').fill('Bench');
      await expect(
        continueButton,
        'Continue stays disabled with Date of Birth and Pincode still empty',
      ).toBeDisabled();
    });

    // The app keeps the typed markup visible but blocks Continue and shows an error; that is asserted,
    // not that the input strips the characters.
    test('the First Name field rejects a script tag — Continue stays disabled and an error shows @ui', async ({
      signupPage,
      page,
    }) => {
      await signupPage.goto();
      await signupPage.chooseAccountType('Personal');
      await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

      const otpOutcome = await signupPage.requestMobileOtp(freshMobile());
      test.skip(otpOutcome === 'already-exists', 'the random mobile happened to collide — re-run');
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      test.skip(
        otpEntryOutcome === 'invalid',
        'the OTP bypass code was rejected this run — re-run',
      );

      const field = page.getByPlaceholder('Enter the first name');
      const payload = '<script>alert(1)</script>';
      await field.fill(payload);
      await page.getByPlaceholder('Enter the last name').fill('Bench');

      const continueButton = page.getByRole('button', { name: /^Continue$/i });
      await expect(
        continueButton,
        'Continue must stay disabled while First Name holds an unfiltered <script> tag',
      ).toBeDisabled();
      await expect(
        page.getByText(
          /can contain only letters, numbers, spaces, periods, apostrophes, and hyphens/i,
        ),
        'a validation error explains why the name is rejected',
      ).toBeVisible();
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
        "the OTP box rejected the bypass code this run — see enterMobileOtp's own doc comment; re-run",
      );

      const thisYear = new Date().getFullYear();

      // The 18-year floor removes recent years from the year dropdown, so assert on its option list.
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
        "the OTP box rejected the bypass code this run — see enterMobileOtp's own doc comment; re-run",
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

      // "qaval" + 6 digits = 11 chars, inside the 5-12 char KPOST ID limit.
      const kpostIdOutcome = await signupPage.choosePreferredKpostId(`qaval${mobile.slice(-6)}`);
      test.skip(
        kpostIdOutcome === 'taken',
        'the generated local part happened to collide — re-run',
      );

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

    // The KPOST ID availability check is debounced: a taken id then a fresh one must show the second
    // result, not a stale first response.
    test('editing the Preferred KPOST ID after a check re-validates the NEW value, not a stale result @ui', async ({
      signupPage,
    }) => {
      test.skip(
        !testData.kpostId || testData.kpostId.includes('qa.bench'),
        'needs a real, already-registered live account (QA_KPOST_ID) as the known-taken value',
      );

      await signupPage.goto();
      await signupPage.chooseAccountType('Personal');
      await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

      const mobile = freshMobile();
      const otpOutcome = await signupPage.requestMobileOtp(mobile);
      test.skip(otpOutcome === 'already-exists', 'the random mobile happened to collide — re-run');
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      test.skip(
        otpEntryOutcome === 'invalid',
        'the OTP bypass code was rejected this run — re-run',
      );

      await signupPage.fillPersonalDetails({
        firstName: 'QA',
        lastName: 'EditRecheck',
        gender: 'Female',
        dobDay: 15,
        dobMonth: 'June',
        dobYear: 1995,
        pincode: testData.pinCode,
        area: 'Chennai',
      });
      await signupPage.continueToKpostId();

      // First value: a real registered id's local part — expected "taken".
      const takenLocal = testData.kpostId.slice(0, testData.kpostId.indexOf('@'));
      const firstOutcome = await signupPage.choosePreferredKpostId(takenLocal);
      test.info().annotations.push({
        type: 'observed',
        description: `first check ("${takenLocal}"): ${firstOutcome}`,
      });

      // Edit to a fresh, never-used local part BEFORE any further action — expected "available".
      const freshLocal = `qaedit${mobile.slice(-6)}`;
      const secondOutcome = await signupPage.choosePreferredKpostId(freshLocal);
      test.info().annotations.push({
        type: 'observed',
        description: `after editing to ("${freshLocal}"): ${secondOutcome}`,
      });

      expect(
        secondOutcome,
        `after editing the field to a fresh, unused id ("${freshLocal}"), the check must reflect ` +
          `THAT value ("available") — showing "taken" here would mean a stale response for the ` +
          `earlier value ("${takenLocal}") incorrectly overwrote the current one`,
      ).toBe('available');
    });
  },
);
