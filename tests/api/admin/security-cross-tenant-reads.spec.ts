import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

const K = AUTH_PROFILES.kpost;
const businessM = K.principals.find((p) => p.key === 'business-m');
const businessS = K.principals.find((p) => p.key === 'business-s');

/**
 * Admin HR-Setup — cross-tenant read-by-id, confirmed live 2026-10-05 on the REAL, frontend-used V2
 * controllers. `getLocationById` takes a bare id with no companyId cross-check anywhere in the call
 * chain, despite its sibling `ByCompanyId` read on the same controller being correctly scoped.
 *
 * 2026-10-06: the companion `adminTierAttribute/getAttribute` cross-tenant case (and the department
 * cross-tenant update case below it) were removed along with their endpoint definitions — the Admin
 * module's test scope is now restricted to the endpoints in `Admin_module - API Services.pdf`, which
 * does not document either `adminTierAttribute/getAttribute` or any `department/*` path. The
 * already-filed finding on `adminTierAttribute/getAttribute` (bug #KPV2-ADMINV2READBYID, worse than
 * the already-filed #KPV2-ADMINV1LEGACYLEAK on the dead legacy controller) loses bench regression
 * coverage as a result — only a manual re-test can catch a future regression there.
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
});
