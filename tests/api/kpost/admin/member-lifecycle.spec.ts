/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Admin **throwaway-member lifecycle** — closes the real testability gap behind 4 of
 * `docs/scope/blocked-endpoints-rationale.md`'s "Admin company-admin writes": `addingUserByAdmin`,
 * `createOrRemoveBackupAdmin`, `resetPassword`, `terminateUser`.
 *
 * ## Why these were blocked, and why that premise was wrong
 *
 * The module's own header comment said "there is no expendable member to safely act on" — but that
 * assumed a FIXED, pre-existing member had to be used (`businessMUser1KpostId`, a named fixture other
 * tests may rely on; `terminateUser` is explicitly PERMANENT). The fix is not finding an expendable
 * member — it's MINTING one with `addingUserByAdmin` itself, then `terminateUser`-ing it at the end,
 * exactly the self-cleaning lifecycle pattern used everywhere else in this bench.
 *
 * ## Payload shapes — measured from the real frontend, not guessed
 *
 * `addingUserByAdmin`'s full payload and the `kpostID` domain-derivation rule were read directly from
 * `UserManagement.js:319-349` and `:155-161`:
 *
 *     kpostID = `${localPart}.${domain}`
 *     domain  = admin.contactID.includes('@') ? admin.contactID.replace(/^[^.]*\./, '') : null
 *
 * i.e. strip the admin's own kpostID up to and including its first `.`. The remaining required
 * fields (`companyName`, `countryID`, `countryCode`, `country`, `state`) are the ADMIN's own
 * profile/company values (`Authuser.userProfile.*` in the frontend) — fetched live here from
 * `profile-user-profile-by-kpostid` (confirmed live 2026-10-02 to return `countryID`/`countryCode`
 * top-level and `userProfile.{country,state}`), not hardcoded, so this keeps working if the admin
 * account's own details ever change.
 *
 * ## Why this is safe to run — and why it still cannot run here
 *
 * Every write here targets ONLY the throwaway member this test creates in its own first step —
 * never `businessMUser1` or any other pre-existing fixture. `terminateUser` in `finally` removes it
 * permanently, same as the product intends for a real offboarded employee.
 *
 * **Confirmed live 2026-10-02: `ADMIN_MEMBER_LIFECYCLE=true` does NOT unblock this.** Every endpoint
 * here is `sideEffect: 'global'`, and `src/validation-engine/production-guard.ts` refuses ANY
 * `global` write on `TEST_ENV=production` unconditionally — no env var, including
 * `ALLOW_DESTRUCTIVE_TESTS`, grants anything on production, by deliberate design (see its own
 * comment: this is exactly the class of write "that must never run unattended" on a shared
 * production environment). This test is written and ready, but it will throw
 * `ProductionSafetyError` on this environment every time, by design, not by accident. It would run
 * if this suite ever pointed at a genuine non-production/staging environment — see
 * `docs/scope/blocked-endpoints-rationale.md`.
 */

const ADMIN: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'business-m')!;
const companyID = String(testData.businessMCompanyId);

interface AdminProfile {
  countryID?: number;
  countryCode?: string;
  userProfile?: { country?: string; state?: string; companyName?: string };
}

/** `admin.contactID.replace(/^[^.]*\./, '')` — strip up to and including the admin's own first `.`. */
function domainFrom(adminKpostId: string): string {
  return adminKpostId.includes('@') ? adminKpostId.replace(/^[^.]*\./, '') : adminKpostId;
}

/** A 10-digit Indian mobile, [6-9]-led, deliberately NOT in this bench's `9000000xxx` sentinel family. */
function throwawayMobile(): string {
  const suffix = String(Date.now()).slice(-6);
  return `98${suffix}0`.padEnd(10, '1').slice(0, 10);
}

test.describe('KPost Admin · throwaway-member lifecycle @api @admin', () => {
  // Confirmed live 2026-10-02: every endpoint below is `sideEffect: 'global'`, which
  // production-guard.ts refuses unconditionally on TEST_ENV=production, by deliberate design — no
  // env var (ADMIN_MEMBER_LIFECYCLE included) can change that on THIS environment. This stays
  // test.skip'd rather than left to fail with ProductionSafetyError every run; it will run as soon
  // as this suite points at a genuine non-production/staging environment.
  test.skip(
    true,
    'PERMANENT on this environment: addingUserByAdmin/createOrRemoveBackupAdmin/resetPassword/' +
      'terminateUser are all sideEffect:"global", which production-guard.ts refuses unconditionally ' +
      'on TEST_ENV=production — needs a non-production environment, not a flag (see docs/scope/blocked-endpoints-rationale.md)',
  );

  test('create → backup-admin toggle → reset password → terminate, on a throwaway member only', async ({
    endpoints,
  }) => {
    const localPart = `qa-bench-throwaway-${Date.now()}`;
    const domain = domainFrom(testData.businessMKpostId);
    const kpostID = `${localPart}.${domain}`;
    let created = false;

    try {
      // --- learn the admin's own company/profile fields, rather than hardcode them ---------------
      const adminProfile = await endpoints.sendTo(
        'profile-user-profile-by-kpostid',
        { body: { kpostID: testData.businessMKpostId } },
        { label: 'admin-lifecycle:admin-profile', auth: { principal: ADMIN }, allowLiveRead: true },
      );
      expect(adminProfile.status, "fetching the admin's own profile succeeds").toBe(200);
      const profileJson = JSON.parse(adminProfile.bodyText ?? '{}') as { data?: AdminProfile };
      const admin = profileJson.data ?? {};

      // --- create the throwaway member ------------------------------------------------------------
      const create = await endpoints.sendTo(
        'admin-adding-user-by-admin',
        {
          body: {
            companyID,
            companyName: admin.userProfile?.companyName ?? testData.companyName,
            firstName: 'QA',
            lastName: 'Throwaway',
            mobileNumber: throwawayMobile(),
            gender: 'male',
            countryID: admin.countryID ?? testData.countryId,
            countryCode: admin.countryCode ?? '91',
            userType: 'BUSINESS_M',
            language: 'english',
            country: admin.userProfile?.country ?? 'India',
            designation: 'QA Tester',
            role: null,
            state: admin.userProfile?.state ?? 'Tamil Nadu',
            referenceName: 'QA Throwaway',
            activeStatus: 'yes',
            kpostID,
            requestType: 'newUser',
          },
        },
        { label: 'admin-lifecycle:create', auth: { principal: ADMIN }, allowLiveWrite: true },
      );
      expect(create.status, `addingUserByAdmin succeeds for a brand-new kpostID (${kpostID})`).toBe(
        200,
      );
      created = true;

      // --- backup-admin toggle: make, then remove ---------------------------------------------------
      const makeBackup = await endpoints.sendTo(
        'admin-create-remove-backup-admin',
        { body: { kpostID, isBackUpAdmin: true, companyID } },
        { label: 'admin-lifecycle:backup-admin-on', auth: { principal: ADMIN }, allowLiveWrite: true },
      );
      expect.soft(makeBackup.status, 'createOrRemoveBackupAdmin(true) succeeds on the throwaway member').toBeLessThan(
        300,
      );
      const removeBackup = await endpoints.sendTo(
        'admin-create-remove-backup-admin',
        { body: { kpostID, isBackUpAdmin: false, companyID } },
        {
          label: 'admin-lifecycle:backup-admin-off',
          auth: { principal: ADMIN },
          allowLiveWrite: true,
        },
      );
      expect
        .soft(removeBackup.status, 'createOrRemoveBackupAdmin(false) succeeds on the throwaway member')
        .toBeLessThan(300);

      // --- reset the throwaway member's password (never the shared fixture's) ----------------------
      const reset = await endpoints.sendTo(
        'admin-reset-password',
        {
          body: {
            kpostID,
            countryID: admin.countryID ?? testData.countryId,
            mobileNumber: throwawayMobile(),
            entityType: 'BUSINESS_M',
          },
        },
        { label: 'admin-lifecycle:reset-password', auth: { principal: ADMIN }, allowLiveWrite: true },
      );
      expect.soft(reset.status, 'resetPassword succeeds on the throwaway member').toBeLessThan(300);
    } finally {
      if (created) {
        await endpoints
          .sendTo(
            'admin-terminate-user',
            { body: { kpostID, companyID } },
            { label: 'admin-lifecycle:terminate', auth: { principal: ADMIN }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    }
  });
});
