import { randomUUID } from 'node:crypto';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { isSqlClient, type SqlDatabaseClient } from '@database/database-client';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { boundaryInFlow, negativeInFlow } from '@engine/flow-negative';
import { expect, test } from '@fixtures';
import { deleteSanityAccount } from '../../../kpost-ui/support/sanity-account';
import { expectStored, filled } from '../../../support/db-stored';

/**
 * The account actions no shared QA account may take, on a throwaway account made for this run:
 * signup, primary and secondary device, access code (both routes), password change and
 * deactivation. Every OTP comes from common/sendOTP, which honours the test bypass, so no SMS is
 * sent (the profile's own device/deactivation OTP senders ignore the bypass and stay blocked). The
 * account's rows are deleted from the test DB at the end, whatever happened.
 */

const COUNTRY = testData.countryId;
const BYPASS = testData.bypassOtp;
const PASSWORD = 'Apiflow@2026#kp';
const NEW_PASSWORD = 'Apiflow@2027#kp';

interface Throwaway {
  kpostId: string;
  mobile: string;
  email: string;
}

/** The lowest N whose `apiflowkpost<N>` id and `90000006NN` mobile are both free. */
async function nextThrowaway(db: SqlDatabaseClient): Promise<Throwaway> {
  const taken = await db.query<{ kpost_id: string; mobile_number: string }>(
    'SELECT kpost_id, mobile_number FROM TBL_KPOST_USER_MASTER WHERE kpost_id LIKE ? OR mobile_number LIKE ?',
    ['apiflowkpost%@kpostindia.com', '90000006%'],
  );
  const ids = new Set(taken.map((r) => String(r.kpost_id).toLowerCase()));
  const mobiles = new Set(taken.map((r) => String(r.mobile_number)));
  for (let n = 1; n <= 99; n++) {
    const kpostId = `apiflowkpost${n}@kpostindia.com`;
    const mobile = `90000006${String(n).padStart(2, '0')}`;
    if (!ids.has(kpostId) && !mobiles.has(mobile)) return { kpostId, mobile, email: kpostId };
  }
  throw new Error('apiflowkpost1..99 are all taken — earlier clean-ups failed; clear them first');
}

test.describe(
  'KPost Profile · throwaway account (test gateway) @database',
  { tag: ['@api', '@profile', '@regression'] },
  () => {
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'runs only on a confirmed OTP test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true',
    );
    test.skip(
      process.env.DB_ALLOW_WRITES !== 'true',
      'the account is deleted from the test DB afterwards; set DB_ALLOW_WRITES=true',
    );

    test('signup → devices → access code → password → logout all → deactivate, then the account is deleted', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      if (!isSqlClient(db)) {
        test.skip(true, 'needs the KPOST_QA database to pick the id and remove the account');
        return;
      }
      const me = await nextThrowaway(db);
      const owned = [me.kpostId, me.mobile, me.email];
      const principal: Principal = {
        key: 'throwaway',
        role: 'USER',
        username: me.kpostId,
        password: PASSWORD,
        userType: 'PERSONAL',
      };

      /** A public call naming the throwaway account (OTP, signup, login, access code by id). */
      const pub = (id: string, body: Record<string, unknown>, label: string) =>
        endpoints.sendTo(
          id,
          { body },
          {
            label: `throwaway:${label}`,
            ownedIdentifiers: owned,
            throwawayAccount: me.kpostId,
          },
        );
      /** A call signed in as the throwaway account. */
      const asMe = (id: string, body: Record<string, unknown>, label: string, as = principal) =>
        endpoints.sendTo(
          id,
          { body },
          {
            label: `throwaway:${label}`,
            auth: { principal: as },
            ownedIdentifiers: owned,
            throwawayAccount: me.kpostId,
          },
        );
      /** sendOTP (the bypass, no SMS) + validateOTP for one OTP type, as the app's own flow does. */
      const otp = async (requestType: string) => {
        const sent = await pub(
          'common-send-otp',
          { countryID: COUNTRY, mobileNumber: me.mobile, requestType },
          `otp-send:${requestType}`,
        );
        const checked = await pub(
          'common-validate-otp',
          { otp: BYPASS, countryID: COUNTRY, mobileNumber: me.mobile, sendDate: Date.now() },
          `otp-check:${requestType}`,
        );
        return { sent: sent.status, checked: checked.status };
      };

      let failure: unknown;
      try {
        // 1. Signup (blocker: every later step needs the account).
        const signupOtp = await otp('signup');
        expect(signupOtp, 'the signup mobile OTP is sent and accepted (bypass)').toEqual({
          sent: 200,
          checked: 200,
        });
        const mailSent = await pub(
          'common-send-otp-to-mail',
          { otherEmail: me.email },
          'mail-otp-send',
        );
        expect(mailSent.status, 'the signup e-mail OTP is sent').toBe(200);
        const [mailRow] = await db.query<{ otp: string }>(
          'SELECT otp FROM TBL_KPOST_EMAIL_OTP_VALIDATION WHERE email = ? ORDER BY id DESC LIMIT 1',
          [me.email],
        );
        const mailChecked = await pub(
          'common-validate-mail-otp',
          { email: me.email, otp: Number(mailRow?.otp) },
          'mail-otp-check',
        );
        expect(mailChecked.status, 'the e-mail OTP from the DB is accepted').toBe(200);
        const signup = await pub(
          'signup-login-signup',
          {
            kpostID: me.kpostId,
            firstName: 'Apiflow',
            lastName: 'Bench',
            mobileNumber: me.mobile,
            createdDate: Date.now(),
            password: PASSWORD,
            gender: 'female',
            dateOfBirth: '1995-01-01',
            module: 0,
            countryCode: '91',
            email: me.email,
            userProfile: {
              landLineNumber: '04400000000',
              referalId: '',
              pinCode: testData.pinCode,
              areaName: 'Pazhavanthangal',
              state: 'Tamil Nadu',
              city: 'Chennai',
            },
          },
          'signup',
        );
        expect(signup.status, `signup creates ${me.kpostId}`).toBe(200);
        // SignUpLoginServiceImpl.java:277-319 fills the user + profile rows from the body (kpostID and
        // email lower-cased, password hashed, PERSONAL, ENGLISH) and :377 saves them.
        const calendarDay = (v: unknown) => {
          if (!(v instanceof Date)) return typeof v === 'string' ? v.slice(0, 10) : '';
          const two = (n: number) => String(n).padStart(2, '0');
          return `${v.getFullYear()}-${two(v.getMonth() + 1)}-${two(v.getDate())}`;
        };
        const newAccount = { kpost_id: me.kpostId.toLowerCase() };
        await expectStored(
          db,
          'signup-login-signup',
          {
            table: 'TBL_KPOST_USER_MASTER',
            where: newAccount,
            columns: {
              first_name: 'Apiflow',
              last_name: 'Bench',
              mobile_number: me.mobile,
              gender: 'female',
              date_of_birth: (v: unknown) => calendarDay(v) === '1995-01-01',
              country_code: '91',
              email: me.kpostId.toLowerCase(),
              user_type: 'PERSONAL',
              active_status: 'yes',
              created_by: 'user',
              password: filled,
              created_date: filled,
            },
            rule: 'signup stores the new account’s name, mobile, gender, birth date and a password in the user row',
          },
          endpoints,
        );
        await expectStored(
          db,
          'signup-login-signup',
          {
            table: 'TBL_KPOST_USER_PROFILE',
            where: newAccount,
            columns: {
              state: 'Tamil Nadu',
              city: 'Chennai',
              area_name: 'Pazhavanthangal',
              pin_code: testData.pinCode,
              landline_number: '04400000000',
              preferred_language: 'ENGLISH',
              privacy_settings: 0,
            },
            rule: 'signup stores the sent address fields and the default language and privacy in the profile row',
          },
          endpoints,
        );

        // 2. Primary device, then a new primary (the token stays valid: the session is untouched).
        const primary = randomUUID();
        expect
          .soft(await otp('Primary Device'), 'the primary-device OTP')
          .toEqual({ sent: 200, checked: 200 });
        const setPrimary = await asMe(
          'profile-set-device-primary',
          { deviceIdentity_primary: primary },
          'set-primary',
        );
        expect.soft(setPrimary.status, 'setDeviceAsPrimary').toBe(200);
        expect
          .soft(setPrimary.bodyText, 'and it was really set, not "already mapped"')
          .toContain('Primary Device');

        // 2b. Phone contacts belong to the registered device (ContactsDirectoryServiceImpl
        //     importPhoneContacts: "No device found" otherwise, which is why the shared QA accounts
        //     cannot import), so a session signed in FROM that device imports. The account's own number
        //     only; the whole account is deleted afterwards.
        const onDevice: Principal = {
          ...principal,
          key: 'throwaway-on-device',
          deviceIdentity: primary,
        };
        const imported = await asMe(
          'contacts-import-phone',
          {
            deviceID: primary,
            mobileNumber: me.mobile,
            countryCode: '91',
            phoneContacts: [{ name: 'QA Bench', mobileNumber: me.mobile, countryCode: '91' }],
          },
          'import-phone',
          onDevice,
        );
        expect
          .soft(
            imported.status,
            `importPhoneContacts stores the number (${imported.bodyText.slice(0, 160)})`,
          )
          .toBe(200);
        /** The stored phone-contact JSON array holds an entry for our number with these fields. */
        const phoneEntry =
          (fields: Record<string, string>) =>
          (value: unknown): boolean => {
            let list: unknown = value;
            try {
              if (Buffer.isBuffer(value)) list = JSON.parse(value.toString('utf8'));
              else if (typeof value === 'string') list = JSON.parse(value);
            } catch {
              return false;
            }
            return (
              Array.isArray(list) &&
              list.some(
                (e: Record<string, unknown>) =>
                  String(e?.mobileNo) === me.mobile &&
                  Object.entries(fields).every(([k, want]) => String(e?.[k]) === want),
              )
            );
          };
        // ContactsDirectoryServiceImpl.java:159 writes the imported list (mobileNo, name, …) into
        // primary_phone_contacts when the session's device is the account's primary device.
        if (imported.status === 200)
          await expectStored(
            db,
            'contacts-import-phone',
            {
              table: 'TBL_KPOST_USER_PHONECONTACT_DETAILS',
              where: newAccount,
              columns: { primary_phone_contacts: phoneEntry({ name: 'QA Bench' }) },
              rule: "importPhoneContacts stores each imported number in the caller's primary_phone_contacts",
            },
            endpoints,
          );
        const invited = await asMe(
          'contacts-update-invite',
          { mobileNumber: me.mobile },
          'update-invite',
          onDevice,
        );
        expect
          .soft(
            invited.status,
            `updateInviteStatus marks it invited (${invited.bodyText.slice(0, 160)})`,
          )
          .toBe(200);
        // ContactsDirectoryServiceImpl.java:765 sets inviteStatus "Y" on the matching entry and :785
        // writes the list back to primary_phone_contacts.
        if (invited.status === 200)
          await expectStored(
            db,
            'contacts-update-invite',
            {
              table: 'TBL_KPOST_USER_PHONECONTACT_DETAILS',
              where: newAccount,
              columns: { primary_phone_contacts: phoneEntry({ inviteStatus: 'Y' }) },
              rule: "updateInviteStatus marks the named number invited (inviteStatus Y) in the caller's imported contacts",
            },
            endpoints,
          );
        const list = await asMe('contacts-imported-phone', {}, 'imported-phone', onDevice);
        expect
          .soft(list.bodyText, 'the imported number now reads as invited')
          .toMatch(/"inviteStatus\\?":\\?"Y/);

        const updPrimary = await asMe(
          'profile-update-device-primary',
          { deviceIdentity_primary: randomUUID() },
          'update-primary',
        );
        expect.soft(updPrimary.status, 'updateDeviceAsPrimary').toBe(200);

        // 3. Secondary device (needs the primary set above), then a new secondary.
        expect
          .soft(await otp('Secondary Device'), 'the secondary-device OTP')
          .toEqual({ sent: 200, checked: 200 });
        const setSecondary = await asMe(
          'profile-set-device-secondary',
          { deviceIdentity_secondary: randomUUID() },
          'set-secondary',
        );
        expect.soft(setSecondary.status, 'setDeviceAsSecondary').toBe(200);
        const updSecondary = await asMe(
          'profile-update-device-secondary',
          { deviceIdentity_secondary: randomUUID() },
          'update-secondary',
        );
        expect.soft(updSecondary.status, 'updateDeviceAsSecondary').toBe(200);

        // 4. Access code: the signed-in route and the public one (both need the login password).
        /** The account's stored credential column, read only to tell "changed" (never printed). */
        const storedSecret = async (column: 'access_code' | 'password') => {
          const [row] = await db.query<Record<string, unknown>>(
            `SELECT ${column} AS secret FROM TBL_KPOST_USER_MASTER WHERE kpost_id = ?`,
            [newAccount.kpost_id],
          );
          return typeof row?.secret === 'string' ? row.secret : undefined;
        };
        const codeBefore = await storedSecret('access_code');
        const changeCode = await asMe(
          'profile-change-or-forgot-access-code',
          { accessCode: '2468', currentPassword: PASSWORD },
          'change-access-code',
        );
        expect.soft(changeCode.status, 'changeOrForgotAccessCode').toBe(200);
        // UserProfileDaoImpl.java:857 sets access_code once the current password matches. A secret:
        // only that the column was set to something new is asserted, never its value.
        if (changeCode.status === 200)
          await expectStored(
            db,
            'profile-change-or-forgot-access-code',
            {
              table: 'TBL_KPOST_USER_MASTER',
              where: newAccount,
              columns: {
                access_code: (v: unknown) => typeof v === 'string' && v !== '' && v !== codeBefore,
              },
              rule: "changeOrForgotAccessCode replaces the caller's stored access code",
            },
            endpoints,
          );
        const codeBeforeSet = await storedSecret('access_code');
        const setCode = await asMe(
          'signup-login-set-access-code',
          { kpostID: me.kpostId, currentPassword: PASSWORD, accessCode: '1357' },
          'set-access-code',
        );
        expect.soft(setCode.status, `setAccessCode (${setCode.bodyText.slice(0, 160)})`).toBe(200);
        expect
          .soft(setCode.bodyText, 'and the body says SUCCESS, not a FAILURE at HTTP 200')
          .toMatch(/"status":"SUCCESS"/);
        // UserProfileDaoImpl.java:856-862 (via SignUpLoginControllerV2.java:337) sets access_code once
        // the current password matches. A secret: only that it was set to something new is asserted.
        if (setCode.status === 200)
          await expectStored(
            db,
            'signup-login-set-access-code',
            {
              table: 'TBL_KPOST_USER_MASTER',
              where: newAccount,
              columns: {
                access_code: (v: unknown) =>
                  typeof v === 'string' && v !== '' && v !== codeBeforeSet,
              },
              rule: 'setAccessCode replaces the access code stored on the caller’s account',
            },
            endpoints,
          );

        // 5. Password change: the old password no longer logs in, the new one does.
        const passwordBefore = await storedSecret('password');
        const changed = await asMe(
          'profile-change-password',
          { oldPassword: PASSWORD, confirmPassword: NEW_PASSWORD },
          'change-password',
        );
        expect.soft(changed.status, 'changePassword').toBe(200);
        // UserProfileDaoImpl.java:341 stores PasswordHasher.hash(confirmPassword), a BCrypt hash. A
        // secret: only that a new BCrypt hash replaced the old one is asserted, never its value.
        if (changed.status === 200)
          await expectStored(
            db,
            'profile-change-password',
            {
              table: 'TBL_KPOST_USER_MASTER',
              where: newAccount,
              columns: {
                password: (v: unknown) =>
                  typeof v === 'string' && /^\$2[aby]\$\d{2}\$/.test(v) && v !== passwordBefore,
              },
              rule: "changePassword replaces the caller's stored password with a new BCrypt hash",
            },
            endpoints,
          );

        // 6. Log out from all devices (FR-S12): a bodyless GET (the workbook and the deployed server
        //    agree; the local source copy's POST is older). Each check uses a fresh session.
        const session = (key: string): Principal => ({ ...principal, key, password: NEW_PASSWORD });
        const alive = async (as: Principal, label: string) =>
          (await asMe('contacts-my-contacts', { lastfetchDate: null }, label, as)).status !== 401;
        const logoutAll = (label: string, auth: object) =>
          endpoints.sendTo(
            'signup-login-logout-all-devices',
            {},
            {
              label: `throwaway:logout-all-${label}`,
              auth: auth as never,
              ownedIdentifiers: owned,
              throwawayAccount: me.kpostId,
            },
          );

        const anonymous = await logoutAll('no-token', { header: undefined });
        expect.soft(anonymous.status, 'without a token the call is refused (401)').toBe(401);

        const own = session('throwaway-own-logout');
        expect(await alive(own, 'session-before-logout'), 'a fresh session works').toBe(true);
        const loggedOut = await logoutAll('own', { principal: own });
        if (loggedOut.status >= 500) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'signup-login-logout-all-devices',
            ruleId: 'SESSION-logout-all-devices-fails',
            rule: 'GET /v2/signupLogin/userLogoutFromAllDevices/ (FR-S12) must end every session of the signed-in account.',
            expected: '200, and the account’s existing tokens are refused afterwards',
            actual: `${loggedOut.status}: ${(loggedOut.bodyText ?? '').slice(0, 160)}`,
            request: {},
          });
        }
        expect
          .soft(
            loggedOut.status,
            `the account can log itself out of all devices (${loggedOut.bodyText.slice(0, 200)})`,
          )
          .toBe(200);
        expect
          .soft(
            await alive(own, 'session-after-logout'),
            'and its token is refused afterwards (401)',
          )
          .toBe(false);
        // A new sign-in (its own cache key, the new password) carries on.
        const relogged = session('throwaway-relogin');

        // 6b. Bad input on the credential writes, by this flow on the throwaway account only (never the
        //     engine). A lenient answer may change a credential: the account is deleted at the end.
        const credentialWrite = {
          label: 'throwaway',
          auth: { principal: relogged },
          ownedIdentifiers: owned,
          throwawayAccount: me.kpostId,
        };
        for (const [id, body] of [
          [
            'signup-login-set-access-code',
            { kpostID: me.kpostId, currentPassword: NEW_PASSWORD, accessCode: '1357' },
          ],
          [
            'profile-change-or-forgot-access-code',
            { accessCode: '2468', currentPassword: NEW_PASSWORD },
          ],
          ['profile-change-password', { oldPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }],
        ] as const) {
          await negativeInFlow(endpoints, id, { body: { ...body } }, credentialWrite);
          await boundaryInFlow(endpoints, id, { body: { ...body } }, credentialWrite);
        }

        // 7. Deactivation (the account's session is gone afterwards; login answers 403).
        expect
          .soft(await otp('Deactivation'), 'the deactivation OTP')
          .toEqual({ sent: 200, checked: 200 });
        const deactivated = await asMe(
          'profile-deactivate-account',
          { reason: 'QA bench throwaway account' },
          'deactivate',
          relogged,
        );
        expect.soft(deactivated.status, 'deactivateAccount').toBe(200);
        const login = await loginStatus(endpoints, me, NEW_PASSWORD, owned);
        expect.soft(login, 'a deactivated account cannot log in (403)').toBe(403);
      } catch (error) {
        failure = error;
      }

      // Always removed, whatever happened above. The user row's mobile is overwritten to 9999999999
      // on deactivation: delete by id and the original mobile. The audit log is left alone, as in
      // the UI sanity clean-up (it is not indexed by account, so a delete there times out).
      let cleanupError: unknown;
      try {
        await db.query('DELETE FROM TBL_KPOST_DEACTIVATED_DETAILS WHERE kpost_id = ?', [
          me.kpostId,
        ]);
        await db.query('DELETE FROM TBL_KPOST_EMAIL_OTP_VALIDATION WHERE email = ?', [me.email]);
        await deleteSanityAccount(db, { kpostId: me.kpostId, mobile: me.mobile });
      } catch (error) {
        cleanupError = error;
        test.info().annotations.push({
          type: 'cleanup-failed',
          description: `${me.kpostId} may be left in the test DB: ${String(error)}`,
        });
      }
      // The failed step first: a clean-up error must never hide it. A lone clean-up error stays loud.
      const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));
      if (failure) throw asError(failure);
      if (cleanupError) throw asError(cleanupError);
    });
  },
);

/** The login status for the throwaway account, without the token provider's retries. */
async function loginStatus(
  endpoints: EndpointExecutor,
  me: Throwaway,
  password: string,
  owned: string[],
): Promise<number> {
  const exchange = await endpoints.sendTo(
    'signup-login-user-login',
    {
      body: {
        deviceType: 'Web',
        deviceIdentity_primary: randomUUID(),
        deviceIdentity_secondary: 'Desktop-Chrome',
        login_lattitude: 13.0476875,
        login_longitude: 80.2655737,
        oneSignal_Key: 'qa-bench',
        voip: 'voip',
        module: 0,
        sessionID: randomUUID(),
        kpostID: me.kpostId,
        loginRO: { countryID: String(testData.countryId), password, userType: 'PERSONAL' },
        logintime: Date.now(),
      },
    },
    {
      label: 'throwaway:login-after-deactivate',
      ownedIdentifiers: owned,
      throwawayAccount: me.kpostId,
    },
  );
  return exchange.status;
}
