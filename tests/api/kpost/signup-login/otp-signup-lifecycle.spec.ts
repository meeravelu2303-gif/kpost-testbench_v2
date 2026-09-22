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

test.describe('Signup & OTP lifecycle (test gateway) @database', { tag: '@api' }, () => {
  test.skip(
    process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'OTP/signup flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true',
  );

  test('mobile + mail OTP → personal registration @api', async ({ endpoints, databases }) => {
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

    /*
     * 3. Send + validate the mail OTP.
     *
     * The gateway bypass is SMS-ONLY. Measured on this database: the mobile channel stores the
     * literal `123456`, while the mail channel stores a real random code and sends it. This step
     * used to post `123456` to validateMailOTP and treat the resulting 500 as a product defect —
     * the code was simply wrong and the endpoint refused it correctly.
     *
     * So the real code is read from the row the send just created. Legitimate only because this is
     * the disposable TEST database the bench is authorised to read, and it is the one way to drive
     * the mail path without a mailbox. The mechanics are covered in full by
     * `otp-lifecycle-db.spec.ts`; here it is a step in the signup chain.
     */
    const sendMail = await endpoints.sendTo(
      'common-send-otp-to-mail',
      { body: { otherEmail: testData.otpEmail } },
      { label: 'feature:otp:send-mail' },
    );
    expect.soft(sendMail.status, 'sendOTPtoMail accepted').toBeLessThan(500);

    const database = databases.for('kpost-api');
    const mailRows = database.enabled
      ? await database.findMany<{ id: number; otp: string }>({
          table: 'TBL_KPOST_EMAIL_OTP_VALIDATION',
          where: { email: testData.otpEmail },
        })
      : [];
    const mailCode = [...mailRows].sort((a, b) => b.id - a.id)[0]?.otp;
    expect.soft(mailCode, 'the send minted a mail code to validate').toBeTruthy();

    const validateMail = await endpoints.sendTo(
      'common-validate-mail-otp',
      { body: { email: testData.otpEmail, otp: Number(mailCode ?? OTP) } },
      { label: 'feature:otp:validate-mail' },
    );
    expect.soft(validateMail.status, 'validateMailOTP accepted the real code').toBeLessThan(500);

    // 4. Register the personal account (both OTPs validated). Fresh DB → created; re-run → already-exists.
    const signup = await endpoints.sendTo(
      'signup-login-signup',
      {},
      { label: 'feature:signup:personal' },
    );
    expect
      .soft(signup.status, 'signup answered (created or already-exists, not a 5xx)')
      .toBeLessThan(500);

    /*
     * 5. VERIFY the account really exists now — signup must do more than "not 5xx". Whether this run
     * created it (fresh/reset DB) or it was already there (re-run), the identity must be REGISTERED:
     * kpostIdExist reports a registered id as "already exists". To sign up a genuinely NEW user each
     * run, set QA_SIGNUP_KPOST_ID / QA_SIGNUP_MOBILE / the signup email to fresh allowlisted values
     * (or reset the disposable test DB); the guard permits those because they come from config.
     */
    const exists = await endpoints.sendTo(
      'signup-login-kpost-id-exist',
      {
        body: {
          kpostID: testData.signupKpostId,
          firstName: 'QA',
          lastName: 'Bench',
          mobileNumber: testData.signupMobile,
        },
      },
      { label: 'feature:signup:verify-registered' },
    );
    expect
      .soft(
        exists.bodyText.toLowerCase(),
        'after signup the identity is registered (kpostIdExist reports it as taken)',
      )
      .toMatch(/already exi/);

    /*
     * 6. Cross-layer proof: the account row is really in the user master (when the DB is reachable).
     * This is the difference between "the endpoint answered" and "a user was actually created".
     */
    if (database.enabled) {
      const userRows = await database.findMany<{ kpost_id: string }>({
        table: 'TBL_KPOST_USER_MASTER',
        where: { kpost_id: testData.signupKpostId },
      });
      expect
        .soft(userRows.length, 'the signup wrote a user row to TBL_KPOST_USER_MASTER (API → DB)')
        .toBeGreaterThan(0);
    }
  });

  test('forgot-password OTP → set a new password on the spare account @api', async ({
    endpoints,
  }) => {
    /*
     * Skipped unless a spare account is explicitly configured, because this flow REWRITES a
     * password.
     *
     * `testData.forgotPasswordKpostId` defaults to an address that deliberately does not exist, so
     * that "an unconfigured run cannot change anything real" — and `.env` ships with
     * QA_FORGOT_PASSWORD_KPOST_ID commented out. The test ignored that and fired anyway, which put
     * a nonexistent id on the wire and was correctly refused by the QA-identifier guard — reported
     * as a red failure rather than as the "not configured" it actually was.
     *
     * A skip is right here where the bench normally avoids them: there is no safe default target.
     * Inventing one would mean rewriting the password of an account chosen by the test, and using
     * the login account would lock every other suite out mid-run.
     */
    test.skip(
      testData.forgotPasswordKpostId === 'no.such.user.9f2a@kpost.in',
      'set QA_FORGOT_PASSWORD_KPOST_ID to a spare account whose password may be rewritten; ' +
        'unset, this flow has no safe target',
    );
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
