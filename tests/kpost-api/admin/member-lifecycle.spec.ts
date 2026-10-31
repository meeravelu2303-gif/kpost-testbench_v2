import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Admin throwaway-member lifecycle: mint a member with addingUserByAdmin, toggle backup-admin, reset its
 * terminate it in `finally`. Payload and kpostID domain rule follow UserManagement.js. These are
 * shared-state (`global`) writes, so each call is authorized on its own and only on the QA test
 * server (GLOBAL_LIFECYCLE + TEST_DB_MODE). resetPassword texts the member's real mobile, so it is
 * left to the SMS kill-switch and only that refusal is checked.
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
    process.env.GLOBAL_LIFECYCLE !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'creates and terminates a real company member on the QA server; set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true',
  );

  test('create → backup-admin toggle → terminate → reallocate → terminate, on a throwaway member only', async ({
    endpoints,
    databases,
  }) => {
    const localPart = `qa-bench-throwaway-${Date.now()}`;
    const domain = domainFrom(testData.businessMKpostId);
    const kpostID = `${localPart}.${domain}`;
    const mobile = throwawayMobile();
    // The person the channel is reallocated to (a different mobile).
    const newMobile = `97${mobile.slice(2)}`;
    // Minted by this flow, so the QA-identifier guard trusts exactly these on its calls.
    const owned = [kpostID, mobile, newMobile];
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
      // The web’s Add Manually body (UserManagement.js addingUserToChannel).
      const memberBody = {
        companyID,
        companyName: admin.userProfile?.companyName ?? testData.companyName,
        firstName: 'QA',
        lastName: 'Throwaway',
        mobileNumber: mobile,
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
      };
      const create = await endpoints.sendTo(
        'admin-adding-user-by-admin',
        { body: memberBody },
        {
          label: 'admin-lifecycle:create',
          auth: { principal: ADMIN },
          allowGlobalLifecycle: true,
          ownedIdentifiers: owned,
        },
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
          allowGlobalLifecycle: true,
          ownedIdentifiers: owned,
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
          allowGlobalLifecycle: true,
          ownedIdentifiers: owned,
        },
      );
      expect
        .soft(
          removeBackup.status,
          'createOrRemoveBackupAdmin(false) succeeds on the throwaway member',
        )
        .toBeLessThan(300);

      // --- resetPassword texts the member's real mobile: the SMS kill-switch must refuse it ------
      await expect(
        endpoints.sendTo(
          'admin-reset-password',
          {
            body: {
              kpostID,
              countryID: admin.countryID ?? testData.countryId,
              entityType: 'BUSINESS_M',
            },
          },
          {
            label: 'admin-lifecycle:reset-password',
            auth: { principal: ADMIN },
            allowGlobalLifecycle: true,
            ownedIdentifiers: owned,
          },
        ),
        'resetPassword sends a real SMS, so it is never sent',
      ).rejects.toThrow(/kill-switch/);

      // --- terminate, then reallocate the channel to a new person (UserManagement.js: requestType
      //     "reallocate" keeps the kpostID) ------------------------------------------------------
      const call = (id: string, body: Record<string, unknown>, label: string) =>
        endpoints.sendTo(
          id,
          { body },
          {
            label: `admin-lifecycle:${label}`,
            auth: { principal: ADMIN },
            allowGlobalLifecycle: true,
            ownedIdentifiers: owned,
          },
        );
      const firstTerminate = await call(
        'admin-terminate-user',
        { kpostID, companyID },
        'terminate',
      );
      expect.soft(firstTerminate.status, 'terminateUser ends the member').toBe(200);
      const reallocateBody = {
        ...memberBody,
        lastName: 'Reallocated',
        mobileNumber: newMobile,
        referenceName: 'QA Reallocated',
        requestType: 'reallocate',
      };
      const reallocated = await call('admin-adding-user-by-admin', reallocateBody, 'reallocate');
      if (reallocated.status >= 400) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'admin-adding-user-by-admin',
          ruleId: 'ADMIN-reallocate-refused-as-existing-user',
          rule: 'Reallocating a terminated channel (User Management › Allocate: addingUserByAdmin with requestType "reallocate" and the channel’s own kpostID) must give it to the new person; the duplicate-kpostID check added for KP-1009 must not apply to a reallocation, and the reallocation message must not be sent when it fails.',
          expected: '200, the channel active again with the new person’s mobile',
          actual: `addingUserByAdmin answered ${reallocated.status}: ${(reallocated.bodyText ?? '').slice(0, 160)}`,
          request: { body: { ...reallocateBody, mobileNumber: '(throwaway)' } },
        });
      }
      expect
        .soft(reallocated.status, 'the web’s reallocate gives the channel to a new person')
        .toBe(200);
      const db = databases.for('kpost-api');
      if (db.enabled) {
        const row = await db.findOne<{ active_status: string; mobile_number: unknown }>({
          table: 'TBL_KPOST_USER_MASTER',
          where: { kpost_id: kpostID },
        });
        expect.soft(row?.active_status, 'the reallocated channel is active again').toBe('yes');
        expect
          .soft(String(row?.mobile_number), 'and belongs to the new person’s mobile')
          .toBe(newMobile);
      }
      // The admin-module reallocate route, sent the same body: no client sends it, but a body it
      // cannot use must be refused, not crash (its `entity` is dereferenced unchecked).
      const otherRoute = await call(
        'admin-adding-user-for-reallocate',
        reallocateBody,
        'reallocate-route',
      );
      expect
        .soft(otherRoute.status, 'addingUserForReallocateByAdmin answers a 4xx or 2xx, not a crash')
        .toBeLessThan(500);
    } finally {
      if (created) {
        const terminated = await endpoints
          .sendTo(
            'admin-terminate-user',
            { body: { kpostID, companyID } },
            {
              label: 'admin-lifecycle:terminate',
              auth: { principal: ADMIN },
              allowGlobalLifecycle: true,
              ownedIdentifiers: owned,
            },
          )
          .catch(() => undefined);
        expect
          .soft(
            terminated?.status,
            'terminateUser removes the throwaway member (nothing left behind)',
          )
          .toBe(200);
      }
    }
  });
});
