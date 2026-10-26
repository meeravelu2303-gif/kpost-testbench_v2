import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { isProvided, testData } from '@config/test-data.config';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';
import {
  employeePayload,
  locationPayload,
  tierPayload,
  variablePayload,
} from '../support/screen-payloads';

/**
 * ONE-TIME SETUP (owner 2026-10-26): a permanent, ordinary (non-admin) employee of QA company 242 with a real
 * KPost login, for role/permission tests. Same path as the Admin screens: Employee Data save → Role Posting
 * Setup save (creates the KPost login) → Assign Role Posting (links it to the employee).
 *
 * The password is then set BY THE OWNER, by hand, through forgot-password on testingapi (its SMS goes to the
 * employee's mobile), and stored in .env. Nothing here is deleted: the names carry no timestamp, so the bench's
 * clean-up tools never match them. Re-running reuses the existing posting instead of creating another.
 *
 * Run only on purpose: ADMIN_CREATE_STAFF=true ADMIN_LIFECYCLE=true ADMIN_ROLE_POSTING_LIVE=true.
 */
const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);
const DESIGNATION = 'QA Staff Role';

type Json = Record<string, unknown>;

test.describe('Admin · one-time: a permanent non-admin employee for QA company 242 @api @admin-api', () => {
  test.describe.configure({ timeout: 300_000 });
  test.skip(
    process.env.ADMIN_CREATE_STAFF !== 'true' || process.env.ADMIN_ROLE_POSTING_LIVE !== 'true',
    'one-time setup: set ADMIN_CREATE_STAFF=true and ADMIN_ROLE_POSTING_LIVE=true',
  );
  test.skip(
    !businessM ||
      testData.businessMKpostId.includes('qa.business.m') ||
      !isProvided('roleEmployeeMobile') ||
      !isProvided('roleEmployeeEmail'),
    'needs the QA company admin (QA_BUSINESS_M_*) and the QA employee identity (QA_ROLE_EMPLOYEE_*)',
  );

  test('create the employee, a role posting, and assign them (prints the KPost login)', async ({
    endpoints,
  }) => {
    expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
      '242',
    );
    const send = async (id: string, body: unknown, minted: Array<string | number> = []) => {
      const ex = await endpoints.sendTo(
        id,
        { body },
        {
          label: `staff:${id}`,
          auth: { principal: businessM! },
          allowLiveWrite: true,
          allowLiveRead: true,
          ownedIdentifiers: minted,
          timeoutMs: 60_000,
        },
      );
      let value: unknown;
      try {
        const parsed: unknown = JSON.parse(ex.bodyText || '{}');
        value = isPlainObject(parsed) ? parsed.value : undefined;
      } catch {
        value = undefined;
      }
      return { status: ex.status, text: ex.bodyText ?? '', value };
    };
    const idOf = (value: unknown): string => {
      const rec: unknown = Array.isArray(value) ? value[0] : value;
      return isPlainObject(rec) && typeof rec.id === 'string' ? rec.id : '';
    };
    const postings = async (): Promise<Json[]> => {
      const r = await send('admin-role-posting-by-company', {});
      return (Array.isArray(r.value) ? r.value : []).filter(isPlainObject);
    };

    const me = await endpoints.sendTo(
      'signup-login-fetch-user-details',
      { body: { kpostID: testData.businessMKpostId, countryID: testData.countryId } },
      { label: 'staff:company-name', auth: { principal: businessM! }, allowLiveRead: true },
    );
    const companyName = /"companyName"\s*:\s*"([^"]+)"/.exec(me.bodyText ?? '')?.[1] ?? '';
    expect(companyName, "the QA company's name (sent by the screen)").toBeTruthy();

    // Re-run safe: an existing staff posting is reused.
    let posting = (await postings()).find((p) => p.displayName === DESIGNATION.toUpperCase());

    if (!posting) {
      const wpTier = idOf(
        (await send('admin-workplace-tier-attribute-save', [tierPayload('QA Staff WP Tier')]))
          .value,
      );
      const wpVar = idOf(
        (
          await send('admin-workplace-tier-variable-save', [
            variablePayload(wpTier, 'QA Staff WP Var'),
          ])
        ).value,
      );
      const loc = idOf(
        (
          await send('admin-workplace-location-save', [
            locationPayload(wpTier, wpVar, 'QA Staff Location'),
          ])
        ).value,
      );
      const hrTier = idOf(
        (await send('admin-hr-tier-attribute-save', [tierPayload('QA Staff HR Tier')])).value,
      );
      const hrVar = idOf(
        (await send('admin-hr-tier-variable-save', [variablePayload(hrTier, DESIGNATION)])).value,
      );
      for (const [what, id] of Object.entries({ wpTier, wpVar, loc, hrTier, hrVar }))
        expect(id, `${what} created`).toBeTruthy();

      const saved = await send('admin-role-posting-save', [
        {
          companyName,
          userType: 'BUSINESS_M',
          countryId: 1,
          countryCode: 91,
          lastworkplaceTierId: wpTier,
          lastWorkplaceVariableId: wpVar,
          workplaceJson: JSON.stringify([
            {
              attributeId: wpTier,
              variableId: wpVar,
              label: 'QA Staff WP Var',
              code: '',
              abbreviation: '',
            },
          ]),
          workplaceLocationId: [loc],
          lastHrTierId: hrTier,
          lastHrVariableId: hrVar,
          hrJson: JSON.stringify([
            {
              parentAttributeId: hrTier,
              variableId: hrVar,
              parentVariableName: DESIGNATION,
              code: '',
              abbreviation: '',
            },
          ]),
          reportingWorkplaceJson: JSON.stringify([
            { workplaceLocationId: '', variableName: ['-'], locationName: '-' },
          ]),
          reportingHrJson: JSON.stringify([
            { variableId: '', variableName: '-', attributeId: hrTier },
          ]),
          requestType: 'allocate',
          displayName: DESIGNATION.toUpperCase(),
          ksmaccDisplayName: DESIGNATION.toUpperCase(),
        },
      ]);
      expect(saved.status, `role posting saved: ${saved.text.slice(0, 200)}`).toBe(200);
      posting = (await postings()).find((p) => p.lastHrVariableId === hrVar);
      expect(posting?.kpostID, 'the posting has its KPost login').toBeTruthy();
    }

    const minted = ['kpostID', 'ksmaccID', 'ksmaccCompanyID']
      .map((k) => posting![k])
      .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');

    if (!posting!.employeeId) {
      const emp = idOf((await send('admin-employee-save', employeePayload('Staff'))).value);
      expect(emp, 'the employee is saved').toBeTruthy();
      const assign = await send(
        'admin-role-posting-update',
        {
          companyId: '242',
          ...posting,
          employeeId: emp,
          userType: 'BUSINESS_M',
          companyName,
          requestType: 'reallocate',
        },
        minted,
      );
      expect(assign.status, `the employee is assigned: ${assign.text.slice(0, 200)}`).toBe(200);
    }

    const final = (await postings()).find((p) => p.id === posting!.id);
    test.info().annotations.push({
      type: 'STAFF EMPLOYEE',
      description: `kpostID=${String(final?.kpostID)} employeeId=${String(final?.employeeId)} postingId=${String(final?.id)} userType=BUSINESS_M`,
    });
    expect(final?.employeeId, 'the posting names the employee').toBeTruthy();
  });
});
