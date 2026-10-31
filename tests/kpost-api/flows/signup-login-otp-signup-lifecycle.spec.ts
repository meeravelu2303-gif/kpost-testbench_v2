import { testData } from '@config/test-data.config';
import { ProductionSafetyError } from '@engine/production-guard';
import { recordCreatedAccount } from '@fixtures/created-accounts';
import { expect, test } from '@fixtures';

/**
 * Signup and password-recovery chains end to end. Runs only on the OTP test gateway
 * (OTP_TEST_GATEWAY + TEST_DB_MODE), where 123456 validates. A signup cannot be deleted, so a
 * re-run answers "already exists".
 */
const OTP = testData.bypassOtp;

test.describe(
  'Signup & OTP lifecycle (test gateway) @database',
  { tag: ['@api', '@auth', '@regression'] },
  () => {
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

      // 3. Send + validate the mail OTP. The bypass is SMS-only, so the real code is read from the
      // row the send just created on the test DB.
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

      // 4. Register the personal account. `sendTo` sends a literal body, so this mirrors `signupApi`'s
      // request in signup.api.ts.
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

      // 5. The identity is now registered (created this run or already there).
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

      // 6. The user row really exists in TBL_KPOST_USER_MASTER.
      if (database.enabled) {
        const userRows = await database.findMany<{
          kpost_id: string;
          mobile_number: string | number;
        }>({
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

    // BR-SL-PWD: password needs ≥8 chars with upper/lower/digit/special. Password validation runs
    // before the "already exists" check, so the registered `signupKpostId` can be reused.
    test(
      'a weak password is rejected at every missing requirement (BR-SL-PWD) @api',
      { annotation: [{ type: 'requirement', description: 'BR-SL-PWD' }] },
      async ({ endpoints }) => {
        const sendMobile = await endpoints.sendTo(
          'common-send-otp',
          {
            body: {
              countryID: testData.countryId,
              mobileNumber: testData.signupMobile,
              requestType: 'signup',
            },
          },
          { label: 'br-sl-pwd:send-mobile' },
        );
        expect.soft(sendMobile.status, 'sendOTP accepted').toBeLessThan(500);
        const validateMobile = await endpoints.sendTo(
          'common-validate-otp',
          {
            body: { otp: OTP, countryID: testData.countryId, mobileNumber: testData.signupMobile },
          },
          { label: 'br-sl-pwd:validate-mobile' },
        );
        expect
          .soft(validateMobile.status, 'validateOTP accepted the bypass code')
          .toBeLessThan(500);

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
      },
    );

    test('mobile + mail OTP → business (admin) registration @api', async ({
      endpoints,
      databases,
    }) => {
      // Creates a permanent company/tenant, so it needs its own opt-in (BUSINESS_SIGNUP_LIVE).
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

      // As above: the mail code is read back from the test DB.
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

      // Register the business account + company; the body mirrors `adminRegistrationApi`'s request.
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
        const userRows = await database.findMany<{
          kpost_id: string;
          mobile_number: string | number;
        }>({
          table: 'TBL_KPOST_USER_MASTER',
          where: { kpost_id: testData.businessSignupKpostId },
        });
        expect
          .soft(
            userRows.length,
            'the registration wrote a user row to TBL_KPOST_USER_MASTER (API → DB)',
          )
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
      // Rewrites a password, so it runs only on an explicitly configured spare account; the default
      // id deliberately does not exist.
      test.skip(
        testData.forgotPasswordKpostId === 'no.such.user.9f2a@kpost.in',
        'set QA_FORGOT_PASSWORD_KPOST_ID to a spare account whose password may be rewritten; ' +
          'unset, this flow has no safe target',
      );
      // The forgot-password sender texts a real phone even on the test gateway; the guard keeps the
      // one SMS a run may send for the browser lifecycle test, so here the flow is BLOCKED, not failed.
      const sendReset = await endpoints
        .sendTo(
          'common-forgot-password-otp',
          { body: { kpostID: testData.forgotPasswordKpostId, requestType: 'password' } },
          { label: 'feature:otp:forgot-send' },
        )
        .catch((error: unknown) => {
          if (error instanceof ProductionSafetyError)
            test.skip(
              true,
              'BLOCKED: the forgot-password sender sends a real SMS even on the test gateway; ' +
                'the one SMS a run may send belongs to the browser test',
            );
          throw error;
        });
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
  },
);
