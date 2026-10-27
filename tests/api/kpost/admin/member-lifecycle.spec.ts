import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Admin throwaway-member lifecycle: mint a member with addingUserByAdmin, toggle backup-admin, reset its
 * password, terminate it in `finally`. Payload and kpostID domain rule follow UserManagement.js.
 * Skipped: these are sideEffect 'global', which production-guard.ts refuses on TEST_ENV=production.
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
  test.skip(
    true,
    'PERMANENT on this environment: addingUserByAdmin/createOrRemoveBackupAdmin/resetPassword/' +
      'terminateUser are all sideEffect:"global", which production-guard.ts refuses unconditionally ' +
      'on TEST_ENV=production — needs a non-production environment, not a flag (see docs/generated/blocked-endpoints.md)',
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
        {
          label: 'admin-lifecycle:backup-admin-on',
          auth: { principal: ADMIN },
          allowLiveWrite: true,
        },
      );
      expect
        .soft(makeBackup.status, 'createOrRemoveBackupAdmin(true) succeeds on the throwaway member')
        .toBeLessThan(300);
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
        .soft(
          removeBackup.status,
          'createOrRemoveBackupAdmin(false) succeeds on the throwaway member',
        )
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
        {
          label: 'admin-lifecycle:reset-password',
          auth: { principal: ADMIN },
          allowLiveWrite: true,
        },
      );
      expect.soft(reset.status, 'resetPassword succeeds on the throwaway member').toBeLessThan(300);
    } finally {
      if (created) {
        await endpoints
          .sendTo(
            'admin-terminate-user',
            { body: { kpostID, companyID } },
            {
              label: 'admin-lifecycle:terminate',
              auth: { principal: ADMIN },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
      }
    }
  });
});
