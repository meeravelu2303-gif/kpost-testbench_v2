import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { recordCreatedAccount } from '@fixtures/created-accounts';
import { expect, test } from '@fixtures';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Personal signup through to login at a 480×900 mobile viewport. Uses its own reserved identity so it
 * never races the desktop or API signup for the same "is it taken?" answer.
 */
const SIGNUP_PASSWORD = 'QaBench@2026';

test.describe(
  'KPost signup · Personal registration → login (mobile viewport)',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
    test.use({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 480, height: 900 },
    });

    test.skip(
      process.env.SIGNUP_UI_LIFECYCLE !== 'true',
      'creates a real account and sends a real mail-OTP/e-mail; set SIGNUP_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'the mobile OTP bypass code only validates on the confirmed OTP test gateway',
    );

    test('a Personal account signs up (or is already registered) and then logs in, at 480×900 @ui', async ({
      signupPage,
      loginPage,
      page,
    }) => {
      const mobileNumber = testData.signupMobileViewportUiMobile;
      const kpostIdLocal = testData.signupMobileViewportUiKpostIdLocal;
      const domainSuffix = domainFor('PERSONAL');
      const fullKpostId = `${kpostIdLocal}@${domainSuffix}`;

      await signupPage.goto();
      await signupPage.chooseAccountType('Personal');
      await signupPage.selectCountryLanguageDomain('India', 'English', domainSuffix);

      const otpOutcome = await signupPage.requestMobileOtp(mobileNumber);
      test.skip(
        otpOutcome === 'already-exists',
        `${mobileNumber} is already registered — set a fresh QA_SIGNUP_MOBILE_VIEWPORT_UI_MOBILE`,
      );

      const otpEntryOutcome = await signupPage.enterMobileOtp(testData.bypassOtp);
      retryOrSkip(
        otpEntryOutcome === 'invalid',
        'the OTP bypass code was rejected this run — likely transient; re-run',
      );

      await signupPage.fillPersonalDetails({
        firstName: 'QA',
        lastName: 'Mobile',
        gender: 'Female',
        dobDay: 15,
        dobMonth: 'June',
        dobYear: 1995,
        pincode: testData.pinCode,
        area: 'Chennai',
      });
      await signupPage.continueToKpostId();

      const kpostIdOutcome = await signupPage.choosePreferredKpostId(kpostIdLocal);
      test.skip(
        kpostIdOutcome === 'taken',
        `${fullKpostId} is taken — set a fresh QA_SIGNUP_MOBILE_VIEWPORT_UI_KPOST_ID_LOCAL`,
      );

      await signupPage.setPasswordAndSubmit(SIGNUP_PASSWORD);
      await signupPage.confirmSuccessAndGoToLogin();

      await expect(page, "signup's success modal lands on /login").toHaveURL(/\/login/, {
        timeout: 20_000,
      });

      recordCreatedAccount({
        kpostId: fullKpostId,
        mobileNumber,
        source: 'signup-mobile-lifecycle.spec.ts (UI, 480×900)',
        note: 'Personal registration driven end-to-end at mobile viewport width',
      });

      await loginPage.login(fullKpostId, SIGNUP_PASSWORD);
      await expect(page, 'login reaches /home').toHaveURL(/\/home/, { timeout: 20_000 });
    });
  },
);
