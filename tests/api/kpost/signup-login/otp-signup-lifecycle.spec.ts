import { env } from '@config/env';
// The OTP + signup flows, driven end to end on the disposable test DB whose OTP subsystem is a TEST
// GATEWAY (no real SMS/e-mail; 123456 validates). Not simple assertions: orchestrated flows with
// best-effort steps, so the conditionals are intentional.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * KPost **Signup & OTP** feature flow — the registration and password-recovery chains a user runs
 * before they have a token. These are `otpDependent` (external/global) and are opened ONLY on the OTP
 * test gateway: `OTP_TEST_GATEWAY=true` + `TEST_DB_MODE=true` (see `production-guard.ts`). On a real
 * gateway they stay hard-blocked by the SMS kill-switch. Identities are the allowlisted signup fixtures,
 * so the QA-identifier guard passes; the disposable DB should be reset between full runs (a signup
 * cannot be deleted, so a re-run is "already exists").
 *
 * `123456` (`QA_BYPASS_OTP`) validates. Every step is `expect.soft` so one run reports every finding,
 * and a 500 from any of these public, unauthenticated endpoints is a real, fileable defect.
 */
const OTP = testData.bypassOtp;

test.describe('Signup & OTP lifecycle (test gateway)', { tag: ['@api', '@kpost-api'] }, () => {
  test.skip(
    !env.OTP_TEST_GATEWAY || !env.TEST_DB_MODE,
    'OTP/signup flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true',
  );

  test('mobile + mail OTP → personal registration @api', async ({ endpoints }) => {
    // 1. Send the mobile OTP (test gateway — creates the record, no real SMS).
    const sendMobile = await endpoints.sendTo(
      'common-send-otp',
      {
        body: {
          countryID: testData.countryId,
          mobileNumber: testData.signupMobile,
          requestType: 'signup',
        },
      },
      { label: 'feature:otp:send-mobile' },
    );
    expect.soft(sendMobile.status, 'sendOTP accepted').toBeLessThan(500);

    // 2. Validate it with the bypass code.
    const validateMobile = await endpoints.sendTo(
      'common-validate-otp',
      {
        body: {
          otp: OTP,
          countryID: testData.countryId,
          mobileNumber: testData.signupMobile,
        },
      },
      { label: 'feature:otp:validate-mobile' },
    );
    expect.soft(validateMobile.status, 'validateOTP accepted the bypass code').toBeLessThan(500);

    // 3. Send + validate the mail OTP.
    const sendMail = await endpoints.sendTo(
      'common-send-otp-to-mail',
      { body: { otherEmail: testData.otpEmail } },
      { label: 'feature:otp:send-mail' },
    );
    expect.soft(sendMail.status, 'sendOTPtoMail accepted').toBeLessThan(500);
    const validateMail = await endpoints.sendTo(
      'common-validate-mail-otp',
      { body: { email: testData.otpEmail, otp: Number(OTP) } },
      { label: 'feature:otp:validate-mail' },
    );
    expect.soft(validateMail.status, 'validateMailOTP accepted the bypass code').toBeLessThan(500);

    // 4. Register the personal account (both OTPs validated). Fresh DB → success; re-run → already-exists.
    const signup = await endpoints.sendTo(
      'signup-login-signup',
      {},
      { label: 'feature:signup:personal' },
    );
    expect
      .soft(signup.status, 'signup answered (created or already-exists, not a 5xx)')
      .toBeLessThan(500);
  });

  test('forgot-password OTP → set a new password on the spare account @api', async ({
    endpoints,
  }) => {
    const sendReset = await endpoints.sendTo(
      'common-forgot-password-otp',
      { body: { kpostID: testData.forgotPasswordKpostId, requestType: 'password' } },
      { label: 'feature:otp:forgot-send' },
    );
    expect.soft(sendReset.status, 'forgot-password OTP send accepted').toBeLessThan(500);

    const validate = await endpoints.sendTo(
      'common-validate-otp',
      {
        body: {
          otp: OTP,
          countryID: testData.countryId,
          mobileNumber: testData.mobileExists,
        },
      },
      { label: 'feature:otp:forgot-validate' },
    );
    expect.soft(validate.status, 'forgot-password OTP validated').toBeLessThan(500);

    // Idempotent: resets the spare to QA_PASSWORD, so it never locks the account out.
    const update = await endpoints.sendTo(
      'common-forgot-password-update',
      { body: { kpostID: testData.forgotPasswordKpostId, forgotPassword: testData.password } },
      { label: 'feature:otp:forgot-update' },
    );
    expect.soft(update.status, 'forgotPasswordUpdate answered (not a 5xx)').toBeLessThan(500);
  });
});
