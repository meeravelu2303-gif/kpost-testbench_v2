// The OTP + signup flows, driven end to end on the disposable test DB whose OTP subsystem is a TEST
// GATEWAY (no real SMS/e-mail; 123456 validates). Not simple assertions: orchestrated flows with
// best-effort steps, so the conditionals are intentional.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { testData } from '@config/test-data.config';
import { recordCreatedAccount } from '@fixtures/created-accounts';
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

    /*
     * 4. Register the personal account (both OTPs validated). Fresh DB → created; re-run →
     * already-exists. `sendTo` sends a LITERAL request — it does not run the endpoint's own request
     * factory — so the body here mirrors `signupApi`'s `request` in signup.api.ts exactly.
     */
    const signup = await endpoints.sendTo(
      'signup-login-signup',
      {
        body: {
          kpostID: testData.signupKpostId,
          firstName: 'QA',
          lastName: 'Bench',
          mobileNumber: testData.signupMobile,
          createdDate: Date.now(),
          password: testData.password,
          gender: 'female',
          dateOfBirth: '1995-01-01',
          module: 0,
          countryCode: '91',
          email: testData.otpEmail,
          userProfile: {
            landLineNumber: '04400000000',
            referalId: '',
            pinCode: testData.pinCode,
            areaName: 'Pazhavanthangal',
            state: 'Tamil Nadu',
            city: 'Chennai',
          },
        },
      },
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
      const userRows = await database.findMany<{ kpost_id: string; mobile_number: string | number }>({
        table: 'TBL_KPOST_USER_MASTER',
        where: { kpost_id: testData.signupKpostId },
      });
      expect
        .soft(userRows.length, 'the signup wrote a user row to TBL_KPOST_USER_MASTER (API → DB)')
        .toBeGreaterThan(0);
      // Every account this bench creates gets logged — see src/fixtures/created-accounts.ts.
      if (userRows[0]) {
        recordCreatedAccount({
          kpostId: userRows[0].kpost_id,
          mobileNumber: String(userRows[0].mobile_number),
          source: 'signup-login-signup',
          note: 'otp-signup-lifecycle.spec.ts: personal registration',
        });
      }
    }
  });

  /*
   * BR-SL-PWD (NFR-SEC03): password must be ≥8 chars with upper/lower/digit/special, or rejected.
   * Previously marked ⛔ "OTP-gated" in docs/business-rules.md — signup is back in scope (the OTP
   * gateway fix earlier this session), so this is now testable. Confirmed live 2026-10-03: password
   * validation runs BEFORE the "already exists" check, so this works even against the already-
   * registered `signupKpostId` from the test above — every weak variant below gets a clean,
   * password-specific rejection, never "already exists".
   */
  test('a weak password is rejected at every missing requirement (BR-SL-PWD) @api', async ({
    endpoints,
  }) => {
    const sendMobile = await endpoints.sendTo(
      'common-send-otp',
      { body: { countryID: testData.countryId, mobileNumber: testData.signupMobile, requestType: 'signup' } },
      { label: 'br-sl-pwd:send-mobile' },
    );
    expect.soft(sendMobile.status, 'sendOTP accepted').toBeLessThan(500);
    const validateMobile = await endpoints.sendTo(
      'common-validate-otp',
      { body: { otp: OTP, countryID: testData.countryId, mobileNumber: testData.signupMobile } },
      { label: 'br-sl-pwd:validate-mobile' },
    );
    expect.soft(validateMobile.status, 'validateOTP accepted the bypass code').toBeLessThan(500);

    const signupBody = (password: string): Record<string, unknown> => ({
      kpostID: testData.signupKpostId,
      firstName: 'QA',
      lastName: 'Bench',
      mobileNumber: testData.signupMobile,
      createdDate: Date.now(),
      password,
      gender: 'female',
      dateOfBirth: '1995-01-01',
      module: 0,
      countryCode: '91',
      email: testData.otpEmail,
      userProfile: {
        landLineNumber: '04400000000',
        referalId: '',
        pinCode: testData.pinCode,
        areaName: 'Pazhavanthangal',
        state: 'Tamil Nadu',
        city: 'Chennai',
      },
    });

    const weakVariants: Array<[string, string]> = [
      ['too short (7 chars, all classes)', 'Qa1!abc'],
      ['no uppercase', 'qa1!abcdef'],
      ['no lowercase', 'QA1!ABCDEF'],
      ['no digit', 'Qa!abcdefg'],
      ['no special character', 'Qa1abcdefg'],
      ['all lowercase, too short', 'abc'],
    ];

    for (const [label, password] of weakVariants) {
      const attempt = await endpoints.sendTo(
        'signup-login-signup',
        { body: signupBody(password) },
        { label: `br-sl-pwd:${label}` },
      );
      expect
        .soft(
          attempt.status,
          `BR-SL-PWD: a password that is ${label} must be rejected (replied ${attempt.status}: ${attempt.bodyText.slice(0, 120)})`,
        )
        .toBe(400);
      expect
        .soft(
          attempt.bodyText.toLowerCase(),
          `BR-SL-PWD: the rejection for "${label}" must be about the password, not an unrelated error`,
        )
        .toMatch(/password/);
    }
  });

  test('mobile + mail OTP → business (admin) registration @api', async ({
    endpoints,
    databases,
  }) => {
    /*
     * `adminRegistrationApi` creates a whole company/tenant, not just an account (see the `global`
     * note on `adminRegistrationApi` in signup.api.ts) — a bigger, permanent footprint than the
     * personal-signup test above, so this stays behind its own explicit opt-in on top of the OTP
     * gateway gate, same spirit as the forgot-password test's spare-account gate below.
     */
    test.skip(
      process.env.BUSINESS_SIGNUP_LIVE !== 'true',
      'mints a permanent company/tenant on the test DB; set BUSINESS_SIGNUP_LIVE=true to run it. ' +
        'Confirmed live 2026-10-02: registers QA Bench API Business Co end to end.',
    );

    const sendMobile = await endpoints.sendTo(
      'common-send-otp',
      {
        body: {
          countryID: testData.countryId,
          mobileNumber: testData.businessSignupMobile,
          requestType: 'signup',
        },
      },
      { label: 'feature:otp:send-mobile-business' },
    );
    expect.soft(sendMobile.status, 'sendOTP accepted').toBeLessThan(500);

    const validateMobile = await endpoints.sendTo(
      'common-validate-otp',
      {
        body: {
          otp: OTP,
          countryID: testData.countryId,
          mobileNumber: testData.businessSignupMobile,
        },
      },
      { label: 'feature:otp:validate-mobile-business' },
    );
    expect.soft(validateMobile.status, 'validateOTP accepted the bypass code').toBeLessThan(500);

    // Same mail-OTP mechanics as the personal flow above: the mobile bypass is SMS-only, the mail
    // channel stores a real code that has to be read back from the disposable test DB.
    const sendMail = await endpoints.sendTo(
      'common-send-otp-to-mail',
      { body: { otherEmail: testData.otpEmail } },
      { label: 'feature:otp:send-mail-business' },
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
      { label: 'feature:otp:validate-mail-business' },
    );
    expect.soft(validateMail.status, 'validateMailOTP accepted the real code').toBeLessThan(500);

    /*
     * Register the business account + company (both OTPs validated). `sendTo` sends a LITERAL
     * request, so the body mirrors `adminRegistrationApi`'s own `request` in signup.api.ts exactly.
     */
    const signup = await endpoints.sendTo(
      'signup-login-admin-registration',
      {
        body: {
          kpostID: testData.businessSignupKpostId,
          companyName: testData.businessSignupCompanyName,
          entity: 'Vegetable Shop',
          uniqueName: testData.businessSignupUniqueName,
          firstName: 'QA',
          lastName: 'Bench',
          mobileNumber: testData.businessSignupMobile,
          otherEmail: testData.otpEmail,
          password: testData.password,
          gender: 'female',
          dateOfBirth: '1995-01-01',
          countryID: String(testData.countryId),
          countryCode: '91',
          language: 'english',
          userType: 'BUSINESS_M',
          address1: '39 Chettinad Chamber',
          address2: 'Dr. Radhakrishnan Salai',
          country: 'india',
          state: 'TamilNadu',
          city: 'Chennai',
          areaName: 'Mylapore',
          designation: 'Managing Director',
          role: '',
          pinCode: testData.pinCode,
          referenceName: 'QABENCH',
        },
      },
      { label: 'feature:signup:business' },
    );
    expect
      .soft(signup.status, 'adminRegistration answered (created or already-exists, not a 5xx)')
      .toBeLessThan(500);

    const exists = await endpoints.sendTo(
      'signup-login-kpost-id-exist',
      {
        body: {
          kpostID: testData.businessSignupKpostId,
          firstName: 'QA',
          lastName: 'Bench',
          mobileNumber: testData.businessSignupMobile,
        },
      },
      { label: 'feature:signup:verify-registered-business' },
    );
    expect
      .soft(
        exists.bodyText.toLowerCase(),
        'after registration the identity is registered (kpostIdExist reports it as taken)',
      )
      .toMatch(/already exi/);

    if (database.enabled) {
      const userRows = await database.findMany<{ kpost_id: string; mobile_number: string | number }>({
        table: 'TBL_KPOST_USER_MASTER',
        where: { kpost_id: testData.businessSignupKpostId },
      });
      expect
        .soft(userRows.length, 'the registration wrote a user row to TBL_KPOST_USER_MASTER (API → DB)')
        .toBeGreaterThan(0);
      if (userRows[0]) {
        recordCreatedAccount({
          kpostId: userRows[0].kpost_id,
          mobileNumber: String(userRows[0].mobile_number),
          source: 'signup-login-admin-registration',
          note: 'otp-signup-lifecycle.spec.ts: business (admin) registration',
        });
      }
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
