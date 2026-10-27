import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

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
      test.skip(
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
  },
);
