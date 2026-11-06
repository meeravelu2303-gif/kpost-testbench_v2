import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { boundaryInFlow, negativeInFlow } from '@engine/flow-negative';
import { expect, test } from '@fixtures';
import { domainFrom, throwawayMobile } from '../../../support/company-member';
import { expectStored, filled } from '../../../support/db-stored';

/**
 * Admin throwaway-member lifecycle: mint a member with addingUserByAdmin, toggle backup-admin, hold
 * and release it, set and restore its role, reset its
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
      const db = databases.for('kpost-api');
      const member = { kpost_id: kpostID.toLowerCase() };
      // SignUpLoginServiceImpl.java:1086-1108 builds the user row from the body; :1173 saves it.
      await expectStored(
        db,
        'admin-adding-user-by-admin',
        {
          table: 'TBL_KPOST_USER_MASTER',
          where: member,
          columns: {
            first_name: memberBody.firstName,
            last_name: memberBody.lastName,
            mobile_number: mobile,
            gender: memberBody.gender,
            active_status: memberBody.activeStatus,
            company_id: companyID,
            user_type: memberBody.userType,
            country_code: memberBody.countryCode,
            email: kpostID.toLowerCase(),
            password: filled,
          },
          rule: 'addingUserByAdmin stores the new member’s name, mobile, company, type and status as sent',
        },
        endpoints,
      );
      // SignUpLoginServiceImpl.java:1132-1147 builds the profile row (saved with the user at :1173).
      await expectStored(
        db,
        'admin-adding-user-by-admin',
        {
          table: 'TBL_KPOST_USER_PROFILE',
          where: member,
          columns: {
            designation: memberBody.designation,
            role: null,
            company_name: memberBody.companyName,
            preferred_language: memberBody.language.toUpperCase(),
            reference_name: memberBody.referenceName,
            state: memberBody.state,
            country_name: memberBody.country,
          },
          rule: 'addingUserByAdmin stores the member’s designation, company, language and reference name in the profile',
        },
        endpoints,
      );

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
      // SignUpLoginDaoImpl.java:566-570 sets is_backup_admin on the member in the caller's company.
      if (makeBackup.status < 300)
        await expectStored(
          db,
          'admin-create-remove-backup-admin',
          {
            table: 'TBL_KPOST_USER_MASTER',
            where: member,
            columns: { is_backup_admin: true },
            rule: 'createOrRemoveBackupAdmin(true) sets is_backup_admin on the member',
          },
          endpoints,
        );
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
      // SignUpLoginDaoImpl.java:572-576 clears is_backup_admin on the member.
      if (removeBackup.status < 300)
        await expectStored(
          db,
          'admin-create-remove-backup-admin',
          {
            table: 'TBL_KPOST_USER_MASTER',
            where: member,
            columns: { is_backup_admin: false },
            rule: 'createOrRemoveBackupAdmin(false) clears is_backup_admin on the member',
          },
          endpoints,
        );

      // --- hold, then release (KSMACC User Management: activeStatus "No" holds, "yes" releases) ----
      for (const [activeStatus, label] of [
        ['No', 'hold'],
        ['yes', 'release'],
      ] as const) {
        const toggled = await endpoints.sendTo(
          'admin-hold-or-release',
          { body: { kpostID, activeStatus, companyID } },
          {
            label: `admin-lifecycle:${label}`,
            auth: { principal: ADMIN },
            allowGlobalLifecycle: true,
            ownedIdentifiers: owned,
          },
        );
        expect.soft(toggled.status, `holdOrRelease (${label}) succeeds on the member`).toBe(200);
        // SignUpLoginDaoImpl.java:546-550 sets active_status for the member in the caller's company.
        if (toggled.status === 200)
          await expectStored(
            db,
            'admin-hold-or-release',
            {
              table: 'TBL_KPOST_USER_MASTER',
              where: member,
              columns: { active_status: activeStatus },
              rule: `holdOrRelease (${label}) stores active_status "${activeStatus}" on the member`,
            },
            endpoints,
          );
      }

      // --- set a role, then put the original (null) back --------------------------------------
      for (const [role, label] of [
        ['QA Bench Role', 'role-set'],
        [null, 'role-restore'],
      ] as const) {
        const changed = await endpoints.sendTo(
          'admin-update-role',
          { body: { kpostID, role, companyID } },
          {
            label: `admin-lifecycle:${label}`,
            auth: { principal: ADMIN },
            allowGlobalLifecycle: true,
            ownedIdentifiers: owned,
          },
        );
        expect.soft(changed.status, `updateRole (${label}) succeeds on the member`).toBe(200);
        // SignUpLoginDaoImpl.java:715-717 sets the profile's role after checking the member's company.
        if (changed.status === 200)
          await expectStored(
            db,
            'admin-update-role',
            {
              table: 'TBL_KPOST_USER_PROFILE',
              where: member,
              columns: { role },
              rule: `updateRole (${label}) stores role ${JSON.stringify(role)} on the member's profile`,
            },
            endpoints,
          );
      }

      // --- bad input on the member's shared-state writes, by this flow (never the engine) ----------
      // On the throwaway member only; a lenient answer is recorded, a 5xx fails and is filed.
      const memberWrite = {
        label: 'admin-lifecycle',
        auth: { principal: ADMIN },
        allowGlobalLifecycle: true,
        ownedIdentifiers: owned,
      };
      for (const [id, body] of [
        ['admin-create-remove-backup-admin', { kpostID, isBackUpAdmin: false, companyID }],
        // The flow's own values: release is 'yes', the role it sets is 'QA Bench Role'.
        ['admin-hold-or-release', { kpostID, activeStatus: 'yes', companyID }],
        ['admin-update-role', { kpostID, role: 'QA Bench Role', companyID }],
      ] as const) {
        await negativeInFlow(endpoints, id, { body: { ...body } }, memberWrite);
        await boundaryInFlow(endpoints, id, { body: { ...body } }, memberWrite);
      }

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
      // SignUpLoginDaoImpl.java:619-662: active_status "No", is_backup_admin 0, the mobile parked at
      // 9999999999 and the leaving person's name appended to transfer_details.
      if (firstTerminate.status === 200)
        await expectStored(
          db,
          'admin-terminate-user',
          {
            table: 'TBL_KPOST_USER_MASTER',
            where: member,
            columns: {
              active_status: 'No',
              is_backup_admin: false,
              mobile_number: '9999999999',
              transfer_details: (v: unknown) =>
                typeof v === 'string' && v.includes(memberBody.lastName),
            },
            rule: 'terminateUser deactivates the member, frees its mobile and records the leaver in transfer_details',
          },
          endpoints,
        );
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
      // SignUpLoginServiceImpl.java:1086-1131 rebuilds the row for the new person (modified_date set
      // for a reallocation at :1126) and :1173 saves it over the terminated channel.
      if (reallocated.status === 200)
        await expectStored(
          db,
          'admin-adding-user-by-admin',
          {
            table: 'TBL_KPOST_USER_MASTER',
            where: member,
            columns: {
              active_status: 'yes',
              mobile_number: newMobile,
              last_name: reallocateBody.lastName,
              modified_date: filled,
            },
            rule: 'a reallocation through addingUserByAdmin makes the channel active again with the new person’s name and mobile',
          },
          endpoints,
        );
      // The admin-module reallocate route (no client sends it). It works only on a terminated channel
      // (SignUpLoginServiceImpl: an active user answers 409 "cannot be reallocated"), so the channel is
      // terminated again first and then reallocated through this route to a third person.
      const secondTerminate = await call(
        'admin-terminate-user',
        { kpostID, companyID },
        'terminate-again',
      );
      expect.soft(secondTerminate.status, 'terminateUser ends the reallocated member').toBe(200);
      // SignUpLoginDaoImpl.java:629-662: the second leaver is appended to transfer_details.
      if (secondTerminate.status === 200)
        await expectStored(
          db,
          'admin-terminate-user',
          {
            table: 'TBL_KPOST_USER_MASTER',
            where: member,
            columns: {
              active_status: 'No',
              mobile_number: '9999999999',
              transfer_details: (v: unknown) =>
                typeof v === 'string' && v.includes(reallocateBody.lastName),
            },
            rule: 'terminateUser on a reallocated channel deactivates it and records the second leaver in transfer_details',
          },
          endpoints,
        );
      const thirdMobile = `96${mobile.slice(2)}`;
      owned.push(thirdMobile);
      const otherRoute = await call(
        'admin-adding-user-for-reallocate',
        { ...reallocateBody, mobileNumber: thirdMobile, referenceName: 'QA Reallocated Twice' },
        'reallocate-route',
      );
      expect
        .soft(
          otherRoute.status,
          'addingUserForReallocateByAdmin gives a terminated channel to a new person',
        )
        .toBe(200);
      // SignUpLoginServiceImpl.java:2238-2265 rebuilds the row (modified_date for a reallocation at
      // :2265) and :2294 saves it.
      if (otherRoute.status === 200)
        await expectStored(
          db,
          'admin-adding-user-for-reallocate',
          {
            table: 'TBL_KPOST_USER_MASTER',
            where: member,
            columns: {
              active_status: 'yes',
              mobile_number: thirdMobile,
              last_name: reallocateBody.lastName,
              company_id: companyID,
              modified_date: filled,
            },
            rule: 'addingUserForReallocateByAdmin makes the terminated channel active again with the third person’s mobile',
          },
          endpoints,
        );
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
        // Bad input on terminate, after the member is already terminated, so a lenient answer
        // cannot end it early.
        await negativeInFlow(
          endpoints,
          'admin-terminate-user',
          { body: { kpostID, companyID } },
          {
            label: 'admin-lifecycle:terminate',
            auth: { principal: ADMIN },
            allowGlobalLifecycle: true,
            ownedIdentifiers: owned,
          },
        );
        await boundaryInFlow(
          endpoints,
          'admin-terminate-user',
          { body: { kpostID, companyID } },
          {
            label: 'admin-lifecycle:terminate',
            auth: { principal: ADMIN },
            allowGlobalLifecycle: true,
            ownedIdentifiers: owned,
          },
        );
      }
    }
  });
});
