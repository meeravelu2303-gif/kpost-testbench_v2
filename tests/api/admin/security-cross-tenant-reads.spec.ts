import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

const K = AUTH_PROFILES.kpost;
const businessM = K.principals.find((p) => p.key === 'business-m');
const businessS = K.principals.find((p) => p.key === 'business-s');

/**
 * Admin HR-Setup — cross-tenant read-by-id, confirmed live 2026-10-05 on the REAL, frontend-used V2
 * controllers (bug #KPV2-ADMINV2READBYID) — worse than the already-filed #KPV2-ADMINV1LEGACYLEAK,
 * which was the same shape on DEAD legacy controllers. `getAttribute`/`getLocationById` take a bare
 * id with no companyId cross-check anywhere in the call chain, despite their sibling `ByCompanyId`
 * reads on the same controllers being correctly scoped.
 *
 * `businessM` creates a disposable record of its own; `businessS` reads it back by id alone. Both
 * companies are bench-owned (QA_BUSINESS_M/S_COMPANY_ID) — never touches a real third party's data.
 */
test.describe('KPost Admin · cross-tenant read-by-id IDOR @api @admin-api @security', () => {
  test.skip(!businessM || !businessS, 'needs both BUSINESS_M and BUSINESS_S principals');
  test.skip(
    testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  test('a workplace tier attribute created by company 242 must not be readable by id from company 1034\'s token', async ({
    endpoints,
  }) => {
    const marker = `QA V2 ATTR XTENANT ${Date.now()}`;
    await endpoints.sendTo(
      'admin-workplace-tier-attribute-save',
      {
        body: [
          { companyId: String(testData.businessMCompanyId), attributeName: marker, createdBy: String(testData.businessMCompanyId) },
        ],
      },
      { label: 'admin:xtenant-attr-create', auth: { principal: businessM! }, allowLiveWrite: true },
    );
    const list = await endpoints.sendTo(
      'admin-workplace-tier-attribute-by-company',
      { body: { companyId: String(testData.businessMCompanyId) } },
      { label: 'admin:xtenant-attr-list', auth: { principal: businessM! }, allowLiveRead: true },
    );
    const parsed = JSON.parse(list.bodyText || '{}') as { value?: Array<{ id: string; attributeName: string }> };
    const mine = (parsed.value ?? []).find((a) => a.attributeName === marker);
    test.skip(!mine, 'could not find the just-created attribute');
    if (!mine) return;

    const cross = await endpoints.sendTo(
      'admin-workplace-tier-attribute-get',
      { body: { id: mine.id } },
      { label: 'admin:xtenant-attr-cross-read', auth: { principal: businessS! }, allowLiveRead: true },
    );

    const leaked = cross.status < 300 && cross.bodyText.includes(mine.id);
    if (leaked) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'admin-workplace-tier-attribute-get',
        ruleId: 'IDOR-admin-cross-tenant-read-attribute',
        rule:
          'A read-by-id must verify the caller\'s own companyId owns the target record before ' +
          'returning it — a BUSINESS_S-authenticated caller must not be able to read a workplace ' +
          'tier attribute created by BUSINESS_M by naming its id alone.',
        expected: 'the read is refused; the attribute is not returned to a non-owning caller',
        actual: `the read succeeded (${cross.status}) and returned the full record to BUSINESS_S`,
        request: { body: { id: mine.id } },
      });
    }
    expect(
      leaked,
      'a workplace tier attribute created by company 242 must not be readable by company 1034\'s token',
    ).toBe(false);
  });

  test('a workplace location created by company 242 must not be readable by id from company 1034\'s token', async ({
    endpoints,
  }) => {
    const marker = `QA Loc XTENANT ${Date.now()}`;
    const created = await endpoints.sendTo(
      'admin-workplace-location-save',
      {
        body: [
          {
            companyId: String(testData.businessMCompanyId),
            locationName: marker,
            addressLine1: 'QA address',
            pincode: testData.pinCode,
            country: 'India',
          },
        ],
      },
      { label: 'admin:xtenant-loc-create', auth: { principal: businessM! }, allowLiveWrite: true },
    );
    const createdParsed = JSON.parse(created.bodyText || '{}') as { value?: Array<{ id: string }> };
    const mine = (createdParsed.value ?? [])[0];
    test.skip(!mine, 'could not get the created location id from the save response');
    if (!mine) return;

    const cross = await endpoints.sendTo(
      'admin-workplace-location-by-id',
      { body: { id: mine.id } },
      { label: 'admin:xtenant-loc-cross-read', auth: { principal: businessS! }, allowLiveRead: true, allowLiveWrite: true },
    );

    const leaked = cross.status < 300 && cross.bodyText.includes(mine.id);
    if (leaked) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'admin-workplace-location-by-id',
        ruleId: 'IDOR-admin-cross-tenant-read-location',
        rule:
          'A read-by-id must verify the caller\'s own companyId owns the target record before ' +
          'returning it — a BUSINESS_S-authenticated caller must not be able to read a location ' +
          'created by BUSINESS_M by naming its id alone.',
        expected: 'the read is refused; the location is not returned to a non-owning caller',
        actual: `the read succeeded (${cross.status}) and returned the full record to BUSINESS_S`,
        request: { body: { id: mine.id } },
      });
    }
    expect(
      leaked,
      'a workplace location created by company 242 must not be readable by company 1034\'s token',
    ).toBe(false);
  });

  test('a department created by company 242 must survive an update attempt from company 1034\'s token', async ({
    endpoints,
  }) => {
    const marker = `QA UPD XTENANT ${Date.now()}`;
    const created = await endpoints.sendTo(
      'admin-department-save',
      { body: [{ companyId: String(testData.businessMCompanyId), departmentName: marker, abbreviation: 'QXU', code: 'QXU' }] },
      { label: 'admin:xtenant-deptupd-create', auth: { principal: businessM! }, allowLiveWrite: true },
    );
    const createdParsed = JSON.parse(created.bodyText || '{}') as { value?: Array<{ id: string }> };
    const mine = (createdParsed.value ?? [])[0];
    test.skip(!mine, 'could not get the created department id');
    if (!mine) return;

    await endpoints.sendTo(
      'admin-department-update',
      { body: { id: mine.id, companyId: String(testData.businessMCompanyId), departmentName: 'QA HIJACKED BY 1034' } },
      { label: 'admin:xtenant-deptupd-attack', auth: { principal: businessS! }, allowLiveWrite: true },
    );

    const listAfter = await endpoints.sendTo(
      'admin-department-by-company',
      { body: { companyId: String(testData.businessMCompanyId) } },
      { label: 'admin:xtenant-deptupd-verify', auth: { principal: businessM! }, allowLiveRead: true },
    );
    const after = JSON.parse(listAfter.bodyText || '{}') as {
      value?: Array<{ id: string; departmentName: string }>;
    };
    const mineAfter = after.value?.find((d) => d.id === mine.id);
    const hijacked = mineAfter?.departmentName !== marker;

    if (hijacked) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'admin-department-update',
        ruleId: 'IDOR-admin-cross-tenant-update-department',
        rule:
          'An update must verify the caller\'s own companyId owns the target record before applying ' +
          'it — a BUSINESS_S-authenticated caller must not be able to rename a department created ' +
          'by BUSINESS_M by naming its id alone.',
        expected: 'the department\'s name is unchanged after the cross-tenant update attempt',
        actual: `the department's name changed to "${mineAfter?.departmentName}" (was "${marker}")`,
        request: { body: { id: mine.id, departmentName: 'QA HIJACKED BY 1034' } },
      });
    }
    expect(
      hijacked,
      'a department created by company 242 must survive an update attempt from company 1034\'s token',
    ).toBe(false);
  });
});
