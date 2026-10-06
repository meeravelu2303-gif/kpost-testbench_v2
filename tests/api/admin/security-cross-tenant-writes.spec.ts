import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

const K = AUTH_PROFILES.kpost;
const businessM = K.principals.find((p) => p.key === 'business-m');
const businessS = K.principals.find((p) => p.key === 'business-s');

/**
 * Admin HR-Setup — systemic unscoped-delete IDOR, confirmed live 2026-10-05 (bug #KPV2-ADMINDEPTDEL).
 * The 2026-10-05 backend ground-truth audit found 15 of 15 checked delete code paths across this
 * module delete by raw `id` alone with NO companyId/ownership check whatsoever — `DepartmentServiceImpl
 * .deleteDepartment` (`DepartmentServiceImpl.java:48-50`, pure `deleteById(id)`) is the live-reproduced
 * instance here; the rest (Employee, User, RolePosting, Designation, Location, every Variable/
 * Attribute/Tier V1+V2) are the identical shape, cited by file:line in that same audit's report.
 *
 * `businessM` creates a disposable department of its own; `businessS` deletes it by id alone. Both
 * companies are bench-owned (QA_BUSINESS_M/S_COMPANY_ID) — this never touches a real third party's
 * data regardless of outcome.
 */
test.describe('KPost Admin · cross-tenant unscoped-delete IDOR @api @admin-api @security', () => {
  test.skip(!businessM || !businessS, 'needs both BUSINESS_M and BUSINESS_S principals');
  test.skip(
    testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  test('a department created by company 242 must survive a delete attempt from company 1034\'s token', async ({
    endpoints,
  }) => {
    const marker = `QA XTENANT DEL ${Date.now()}`;
    const created = await endpoints.sendTo(
      'admin-department-save',
      {
        body: [
          {
            companyId: String(testData.businessMCompanyId),
            departmentName: marker,
            abbreviation: 'QXD',
            code: 'QXD',
          },
        ],
      },
      { label: 'admin:xtenant-dept-create', auth: { principal: businessM! }, allowLiveWrite: true },
    );
    expect(created.status, 'the disposable department is created').toBeLessThan(300);

    const list = await endpoints.sendTo(
      'admin-department-by-company',
      { body: { companyId: String(testData.businessMCompanyId) } },
      { label: 'admin:xtenant-dept-list', auth: { principal: businessM! }, allowLiveRead: true },
    );
    const parsed = JSON.parse(list.bodyText || '{}') as {
      value?: Array<{ id: string; departmentName: string }>;
    };
    const mine = (parsed.value ?? []).find((d) => d.departmentName === marker);
    test.skip(!mine, 'could not find the just-created department to get its real id');
    if (!mine) return;

    // The attack: BUSINESS_S (company 1034) deletes BUSINESS_M's department by id alone.
    await endpoints.sendTo(
      'admin-department-delete',
      { body: { id: mine.id } },
      { label: 'admin:xtenant-dept-attack-delete', auth: { principal: businessS! }, allowLiveWrite: true },
    );

    const listAfter = await endpoints.sendTo(
      'admin-department-by-company',
      { body: { companyId: String(testData.businessMCompanyId) } },
      { label: 'admin:xtenant-dept-list-after', auth: { principal: businessM! }, allowLiveRead: true },
    );
    const parsedAfter = JSON.parse(listAfter.bodyText || '{}') as {
      value?: Array<{ id: string; departmentName: string }>;
    };
    const stillThere = (parsedAfter.value ?? []).some((d) => d.id === mine.id);

    if (!stillThere) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'admin-department-delete',
        ruleId: 'IDOR-admin-unscoped-delete-department',
        rule:
          'A delete must verify the caller\'s own companyId owns the target record before deleting ' +
          'it — a BUSINESS_S-authenticated caller must not be able to delete a department created ' +
          'by BUSINESS_M by naming its id alone.',
        expected: 'the delete is refused; the department survives in BUSINESS_M\'s own list',
        actual: 'the delete succeeded (200); the department is gone from BUSINESS_M\'s own list',
        request: { body: { id: mine.id } },
      });
    }

    expect(
      stillThere,
      'a department created by company 242 must survive a delete attempt from company 1034\'s token',
    ).toBe(true);
  });
});
