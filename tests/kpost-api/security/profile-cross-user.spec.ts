// Cross-user credential writes: can C change another account's access code or KMail password by
// naming its kpostID? The victim is a throwaway apiflowkpost<N> account this test signs up and
// deletes, so a successful attack damages nothing shared.
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { isSqlClient, type SqlDatabaseClient } from '@database/database-client';
import { expect, test } from '@fixtures';
import { deleteSanityAccount } from '../../kpost-ui/support/sanity-account';

/**
 * - setAccessCode (public, ignores the token) sets the access code of the body's `kpostID` when
 *   `currentPassword` matches that account's password (UserProfileDaoImpl.changeAccessCode). C sends
 *   the victim's id with C's OWN password, which differs from the victim's: nothing may change. The
 *   shared QA accounts all use one password, so a QA victim would be changed by design; hence the
 *   throwaway, whose password is its own.
 * - kmailPasswordPatchWork overwrites the KMail password of every listed account and is open only to
 *   two named admins (UserProfileControllerV2.java:1912-1928). Nobody else, the account itself
 *   included, can make the call succeed, so the owner control is the DB read-back itself.
 * Proof is the victim's row in TBL_KPOST_USER_MASTER; the values are compared, never printed.
 */
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;
const PASSWORD = 'Apiflow@2026#kp';

interface Throwaway {
  kpostId: string;
  mobile: string;
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
    if (!ids.has(kpostId) && !mobiles.has(mobile)) return { kpostId, mobile };
  }
  throw new Error('apiflowkpost1..99 are all taken — earlier clean-ups failed; clear them first');
}

test.describe(
  'KPost Security · Profile cross-user credential writes @api @kpost-api @security',
  {
    tag: ['@api', '@auth', '@security', '@regression', '@profile', '@database'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      process.env.PROFILE_LIFECYCLE !== 'true',
      'signs up a throwaway account; set PROFILE_LIFECYCLE=true',
    );
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'the throwaway signup needs the confirmed OTP test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true',
    );
    test.skip(
      process.env.DB_ALLOW_WRITES !== 'true' || process.env.GLOBAL_LIFECYCLE !== 'true',
      'the account is deleted from the test DB and the attack is a `global` write: set DB_ALLOW_WRITES=true + GLOBAL_LIFECYCLE=true',
    );
    test.skip(!C, 'needs the personal-3 principal');

    test("an unrelated user cannot set another account's access code or KMail password @api @kpost-api @security", async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      if (!isSqlClient(db)) {
        test.skip(true, 'needs the KPOST_QA database for the throwaway account and the read-back');
        return;
      }
      expect(C.password, 'the attacker password must differ from the victim’s').not.toBe(PASSWORD);
      const me = await nextThrowaway(db);
      const owned = [me.kpostId, me.mobile];
      const victim: Principal = {
        key: 'throwaway-xu',
        role: 'USER',
        username: me.kpostId,
        password: PASSWORD,
        userType: 'PERSONAL',
      };
      /** A public call naming the throwaway account. */
      const pub = (id: string, body: Record<string, unknown>, label: string) =>
        endpoints.sendTo(
          id,
          { body },
          {
            label: `profile-xu:${label}`,
            ownedIdentifiers: owned,
            throwawayAccount: me.kpostId,
          },
        );
      const credentials = async (): Promise<{ accessCode: unknown; kmailPassword: unknown }> => {
        const [row] = await db.query<{ access_code: string | null; kmail_password: string | null }>(
          'SELECT access_code, kmail_password FROM TBL_KPOST_USER_MASTER WHERE kpost_id = ?',
          [me.kpostId],
        );
        return { accessCode: row?.access_code, kmailPassword: row?.kmail_password };
      };

      let failure: unknown;
      try {
        // 1. Sign up the victim (OTP bypass on the test gateway; no SMS, the e-mail OTP is read from the DB).
        for (const [id, body, label] of [
          [
            'common-send-otp',
            { countryID: testData.countryId, mobileNumber: me.mobile, requestType: 'signup' },
            'otp-send',
          ],
          [
            'common-validate-otp',
            {
              otp: testData.bypassOtp,
              countryID: testData.countryId,
              mobileNumber: me.mobile,
              sendDate: Date.now(),
            },
            'otp-check',
          ],
          ['common-send-otp-to-mail', { otherEmail: me.kpostId }, 'mail-otp-send'],
        ] as const)
          expect((await pub(id, body, label)).status, `${label} for the throwaway signup`).toBe(
            200,
          );
        const [mailRow] = await db.query<{ otp: string }>(
          'SELECT otp FROM TBL_KPOST_EMAIL_OTP_VALIDATION WHERE email = ? ORDER BY id DESC LIMIT 1',
          [me.kpostId],
        );
        const mailChecked = await pub(
          'common-validate-mail-otp',
          { email: me.kpostId, otp: Number(mailRow?.otp) },
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
            email: me.kpostId,
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

        // 2. setAccessCode. Owner control: the victim sets its own code with its own password.
        const ownerCode = await endpoints.sendTo(
          'signup-login-set-access-code',
          { body: { kpostID: me.kpostId, currentPassword: PASSWORD, accessCode: '1357' } },
          {
            label: 'profile-xu:access-code-owner-control',
            auth: { principal: victim },
            ownedIdentifiers: owned,
            throwawayAccount: me.kpostId,
          },
        );
        const afterOwner = await credentials();
        expect
          .soft(
            ownerCode.status === 200 && afterOwner.accessCode === '1357',
            `owner control: the account sets its own access code (HTTP ${ownerCode.status})`,
          )
          .toBe(true);

        const attackBody = { kpostID: me.kpostId, currentPassword: C.password, accessCode: '8642' };
        const attack = await endpoints.sendTo(
          'signup-login-set-access-code',
          { body: attackBody },
          {
            label: 'profile-xu:access-code-attack',
            auth: { principal: C },
            allowGlobalLifecycle: true,
            ownedIdentifiers: owned,
          },
        );
        const afterAttack = await credentials();
        const codeChanged = afterAttack.accessCode !== afterOwner.accessCode;
        if (codeChanged)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'signup-login-set-access-code',
            ruleId: 'IDOR-signup-login-set-access-code-cross-user',
            rule: "setAccessCode must change only the access code of the account whose password is given: a signed-in user must not set another account's access code by naming its kpostID with the caller's own password.",
            expected: "HTTP 400 and the other account's access code unchanged",
            actual: `HTTP ${attack.status}: ${C.username}, with its own password, changed the access code of ${me.kpostId}`,
            request: { body: { ...attackBody, currentPassword: '<attacker own password>' } },
          });
        expect
          .soft(
            codeChanged,
            `BOLA: ${C.username} must not change another account's access code (HTTP ${attack.status})`,
          )
          .toBe(false);

        // 3. kmailPasswordPatchWork naming the victim: 403, and its KMail password untouched.
        const patchBody = { kpostIDs: [me.kpostId] };
        const patch = await endpoints.sendTo(
          'profile-kmail-password-patch-work',
          { body: patchBody },
          {
            label: 'profile-xu:kmail-password-attack',
            auth: { principal: C },
            ownedIdentifiers: owned,
          },
        );
        const afterPatch = await credentials();
        const kmailChanged = afterPatch.kmailPassword !== afterAttack.kmailPassword;
        if (kmailChanged || patch.status < 300)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'profile-kmail-password-patch-work',
            ruleId: 'IDOR-profile-kmail-password-patch-work-cross-user',
            rule: "kmailPasswordPatchWork is open only to the two named admins: any other signed-in user must not reset another account's KMail password by naming its kpostID.",
            expected: "HTTP 403 and the other account's KMail password unchanged",
            actual: `HTTP ${patch.status}; ${me.kpostId}'s KMail password ${kmailChanged ? 'was overwritten' : 'is unchanged'}`,
            request: { body: patchBody },
          });
        expect
          .soft(
            kmailChanged,
            `BOLA: ${C.username} must not reset another account's KMail password (HTTP ${patch.status})`,
          )
          .toBe(false);
        expect.soft(patch.status, 'kmailPasswordPatchWork refuses a non-admin caller').toBe(403);
      } catch (error) {
        failure = error;
      }

      // Always removed, whatever happened above (a patch-work success also leaves a GROUP KMail row).
      let cleanupError: unknown;
      try {
        // TBL_KMAIL_USER_MASTER is in the KMail DB; best effort, so the KPost rows always go.
        const kmailDb = databases.for('kmail-api');
        if (kmailDb.enabled && isSqlClient(kmailDb))
          await kmailDb
            .query('DELETE FROM TBL_KMAIL_USER_MASTER WHERE kpost_id = ? AND user_type = ?', [
              me.kpostId,
              'GROUP',
            ])
            .catch(() => undefined);
        await db.query('DELETE FROM TBL_KPOST_EMAIL_OTP_VALIDATION WHERE email = ?', [me.kpostId]);
        await deleteSanityAccount(db, { kpostId: me.kpostId, mobile: me.mobile });
      } catch (error) {
        cleanupError = error;
        test.info().annotations.push({
          type: 'cleanup-failed',
          description: `${me.kpostId} may be left in the test DB: ${String(error)}`,
        });
      }
      const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));
      if (failure) throw asError(failure);
      if (cleanupError) throw asError(cleanupError);
    });
  },
);
