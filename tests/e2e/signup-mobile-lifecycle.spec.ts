/* eslint-disable playwright/no-conditional-in-test */
import { domainFor } from '@fixtures/test-accounts';
import { testData } from '@config/test-data.config';
import { recordCreatedAccount } from '@fixtures/created-accounts';
import { expect, test } from '@fixtures';

/**
 * The mobile-viewport counterpart to `signup-login-lifecycle.spec.ts` — that spec only ever ran at
 * desktop width. `signup-business.spec.ts`'s own mobile describe block confirmed Personal signup
 * REACHES its registration form correctly below the 992px breakpoint, but stopped there; this drives
 * the SAME real signup all the way through to a logged-in account, at 480×900, to close that gap.
 *
 * Business (Small/Medium/Large) is deliberately NOT covered here — #825 (CRITICAL, confirmed) already
 * establishes Business is completely broken below 992px (tapping any category resets to the account-
 * type picker), so there is no form to complete on that path yet.
 *
 * Uses its own THIRD reserved identity (`signupMobileViewportUiKpostIdLocal`/
 * `signupMobileViewportUiMobile`), separate from both the desktop UI lifecycle's and the API layer's,
 * for the same "never race for the same is-it-taken answer" reason those are separate from each other.
 */
const SIGNUP_PASSWORD = 'QaBench@2026';

test.describe(
  'KPost signup · Personal registration → login (mobile viewport)',
  { tag: '@ui' },
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
      test.skip(
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
