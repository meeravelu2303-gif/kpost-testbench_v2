import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Personal signup: a pincode shorter than India's 6 digits must not open the area modal or enable
 * Continue. Stops at the pincode step, so no account is created; other countries are covered by the API.
 */
function freshMobile(): string {
  return `77${Date.now().toString().slice(-8)}`;
}

test.describe(
  'KPost signup · Personal postal pincode validation',
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

    test('a pincode shorter than India’s 6 digits must not be accepted or let signup advance @ui', async ({
      signupPage,
      page,
    }) => {
      await signupPage.goto();
      await signupPage.chooseAccountType('Personal');
      await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));

      const otpOutcome = await signupPage.requestMobileOtp(freshMobile());
      retryOrSkip(
        otpOutcome === 'already-exists',
        'the randomly generated mobile number happened to already be registered — re-run',
      );
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      test.skip(
        otpEntryOutcome === 'invalid',
        "the OTP box rejected the bypass code this run — see enterMobileOtp's doc comment; re-run",
      );

      await signupPage.fillPersonalIdentityNoPincode({
        firstName: 'QA',
        lastName: 'Pincode',
        gender: 'Male',
        dobDay: 15,
        dobMonth: 'January',
        dobYear: 1990,
      });

      const continueButton = page.getByRole('button', { name: /^Continue$/i });

      // Each short pincode (below India's 6 digits) must be rejected: no area modal, Continue disabled.
      for (const shortPin of ['60', '600', '6000']) {
        await signupPage.typePostalPincode(shortPin);
        expect(
          await signupPage.isPincodeDetailsModalVisible(3_000),
          `a ${shortPin.length}-digit pincode ("${shortPin}") must NOT open the area-confirm modal`,
        ).toBe(false);
        await expect(
          continueButton,
          `Continue must stay disabled with an invalid ${shortPin.length}-digit pincode ("${shortPin}")`,
        ).toBeDisabled();
      }

      // Positive control: a valid 6-digit pincode opens the area modal.
      await signupPage.typePostalPincode(testData.pinCode);
      expect(
        await signupPage.isPincodeDetailsModalVisible(10_000),
        `a valid 6-digit pincode (${testData.pinCode}) must open the area-confirm modal`,
      ).toBe(true);
    });

    test('a well-formed pincode that does not exist is refused with "Invalid postal pincode" @ui', async ({
      signupPage,
      page,
    }) => {
      await signupPage.goto();
      await signupPage.chooseAccountType('Personal');
      await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));
      const otpOutcome = await signupPage.requestMobileOtp(freshMobile());
      retryOrSkip(
        otpOutcome === 'already-exists',
        'the randomly generated mobile number happened to already be registered — re-run',
      );
      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      test.skip(
        otpEntryOutcome === 'invalid',
        'the OTP box rejected the bypass code this run; re-run',
      );
      await signupPage.fillPersonalIdentityNoPincode({
        firstName: 'QA',
        lastName: 'Pincode',
        gender: 'Male',
        dobDay: 15,
        dobMonth: 'January',
        dobYear: 1990,
      });
      // Six digits, so the lookup runs (after its 500 ms pause); no Indian post office has it.
      await signupPage.typePostalPincode('000000');
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: 'Invalid postal pincode' }).first(),
        'the user is told the pincode does not exist',
      ).toBeVisible({ timeout: 10_000 });
      expect(
        await signupPage.isPincodeDetailsModalVisible(2_000),
        'no area is offered for it',
      ).toBe(false);
      // Refused either way: Continue stays off, or Continue does not reach the KPOST ID step.
      const next = page.getByRole('button', { name: /^Continue$/i });
      if (await next.isEnabled()) {
        await next.click();
        await expect(
          page.getByPlaceholder('Enter Preferred KPOST ID').first(),
          'signup does not advance with a pincode it reported invalid',
        ).toBeHidden({ timeout: 8_000 });
      }
    });

    test('a letter typed into an OTP box is refused: numbers only @ui', async ({
      signupPage,
      page,
    }) => {
      await signupPage.goto();
      await signupPage.chooseAccountType('Personal');
      await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));
      const otpOutcome = await signupPage.requestMobileOtp(freshMobile());
      retryOrSkip(
        otpOutcome === 'already-exists',
        'the randomly generated mobile number happened to already be registered — re-run',
      );
      // PersonalSignup.js: each OTP box (#input_0..5) takes one digit; anything else is refused.
      const first = page.locator('#input_0').first();
      await expect(first, 'the OTP boxes are shown').toBeVisible({ timeout: 15_000 });
      await first.click();
      await page.keyboard.type('a');
      await expect(
        page
          .locator('.Toastify__toast')
          .filter({ hasText: 'Only numbers are allowed — no letters or special characters!' })
          .first(),
        'the user is told only numbers are allowed',
      ).toBeVisible({ timeout: 10_000 });
      await expect(first, 'the letter is not kept').not.toHaveValue('a');
    });

    test('a letter typed into Date of Birth is refused: the calendar only @ui', async ({
      signupPage,
      page,
    }) => {
      await signupPage.goto();
      await signupPage.chooseAccountType('Personal');
      await signupPage.selectCountryLanguageDomain('India', 'English', domainFor('PERSONAL'));
      // DateSelect.js: any character other than digits, "/" and "-" is removed with a message.
      const dob = page.getByPlaceholder('Select Date of Birth').first();
      await dob.click();
      await page.keyboard.type('a');
      await expect(
        page
          .locator('.Toastify__toast')
          .filter({ hasText: 'Please select the date using the calendar only' })
          .first(),
        'the user is told to use the calendar',
      ).toBeVisible({ timeout: 10_000 });
      await expect(dob, 'the letter is not kept').not.toHaveValue(/a/);
    });
  },
);
