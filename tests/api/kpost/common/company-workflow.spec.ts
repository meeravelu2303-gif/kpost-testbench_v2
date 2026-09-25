/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Common **company-lookup business rules**. Not gated: all `productionSafe: true`, safe on every
 * default run.
 *
 * `getCompanyDetails`, `getCompanyDetailsByAdmin` and `getCompanyDetailsByMobileNoAndproductId` all
 * answer the SAME question (which company does this business-M admin's mobile number belong to)
 * through three different routes — a real consistency check, not just "does each one respond".
 *
 * The three admin-token-gated endpoints (`common-update-company-logo`, `common-download-company-logo`,
 * `common-remove-company-logo`) are NOT exercised here — see the endpoint definitions' own extensive
 * documented investigation (uploading a logo on a token given for reference, not something to do
 * unasked) and `common-gaps.spec.ts` for the recorded gap.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

interface CompanyRow {
  companyName?: string;
  companyID?: number;
  kpostID?: string;
  countryID?: number;
}
interface Envelope {
  data?: CompanyRow[];
  itemList?: CompanyRow[];
}

test.describe('KPost common · company-lookup business rules @api @kpost-api @common', () => {
  test('getCompanyDetails, getCompanyDetailsByAdmin and getCompanyDetailsByMobileNoAndproductId agree on the same company', async ({
    endpoints,
  }) => {
    const [details, byAdmin, byMobileAndProduct] = await Promise.all([
      endpoints.sendTo(
        'common-company-details',
        { body: { mobileNumber: Number(testData.businessMMobile) } },
        { label: 'common:company-details', auth: { principal: A } },
      ),
      endpoints.sendTo(
        'common-company-details-by-admin',
        { body: { mobileNumber: testData.businessMMobile } },
        { label: 'common:company-details-by-admin', auth: { principal: A } },
      ),
      endpoints.sendTo(
        'common-company-details-by-mobile-and-product',
        { body: { mobileNumber: testData.businessMMobile, productId: testData.productObjectId } },
        { label: 'common:company-details-by-mobile-product', auth: { principal: A } },
      ),
    ]);
    expect(details.status, 'getCompanyDetails succeeds').toBe(200);
    expect(byAdmin.status, 'getCompanyDetailsByAdmin succeeds').toBe(200);
    expect(byMobileAndProduct.status, 'getCompanyDetailsByMobileNoAndproductId succeeds').toBe(200);

    const detailsRow = (JSON.parse(details.bodyText || '{}') as Envelope).data?.[0];
    const byAdminRow = (JSON.parse(byAdmin.bodyText || '{}') as Envelope).data?.[0];
    const byMobileProductRow = (JSON.parse(byMobileAndProduct.bodyText || '{}') as Envelope)
      .itemList?.[0];

    expect(detailsRow?.companyID, 'getCompanyDetails resolves a real company').toBeTruthy();
    expect(
      byAdminRow?.companyID,
      'getCompanyDetailsByAdmin agrees with getCompanyDetails on the companyID for the same mobile number',
    ).toBe(detailsRow?.companyID);
    expect(
      byMobileProductRow?.companyID,
      'getCompanyDetailsByMobileNoAndproductId agrees with getCompanyDetails on the companyID for the same mobile number',
    ).toBe(detailsRow?.companyID);

    /*
     * Live-verified 2026-09-24: countryID does NOT agree across these three — getCompanyDetails
     * answered 1 (India) while the other two answered 0, for the identical company/mobile number in
     * the same run. CONFIRMED (2xx-but-wrong-behaviour, not a bench mistake) — filed via
     * recordBusinessRuleViolation rather than left as a plain soft-assert, since it's a read-side
     * data-consistency defect the engine's own validators cannot see.
     */
    if (byAdminRow?.countryID !== detailsRow?.countryID) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'common-company-details-by-admin',
        ruleId: 'REGRESSION-common-company-countryid-consistency',
        rule:
          'getCompanyDetailsByAdmin must report the same countryID as getCompanyDetails for the ' +
          'same company/mobile number — the two endpoints answer the same underlying question.',
        expected: `countryID ${detailsRow?.countryID} (matching getCompanyDetails)`,
        actual: `countryID ${byAdminRow?.countryID}`,
        request: { body: { mobileNumber: testData.businessMMobile } },
      });
    }
    if (byMobileProductRow?.countryID !== detailsRow?.countryID) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'common-company-details-by-mobile-and-product',
        ruleId: 'REGRESSION-common-company-countryid-consistency',
        rule:
          'getCompanyDetailsByMobileNoAndproductId must report the same countryID as ' +
          'getCompanyDetails for the same company/mobile number.',
        expected: `countryID ${detailsRow?.countryID} (matching getCompanyDetails)`,
        actual: `countryID ${byMobileProductRow?.countryID}`,
        request: {
          body: { mobileNumber: testData.businessMMobile, productId: testData.productObjectId },
        },
      });
    }
    expect
      .soft(
        byAdminRow?.countryID,
        `countryID disagrees across company lookups for the same company: getCompanyDetails=${detailsRow?.countryID}, getCompanyDetailsByAdmin=${byAdminRow?.countryID}`,
      )
      .toBe(detailsRow?.countryID);
    expect
      .soft(
        byMobileProductRow?.countryID,
        `countryID disagrees across company lookups for the same company: getCompanyDetails=${detailsRow?.countryID}, getCompanyDetailsByMobileNoAndproductId=${byMobileProductRow?.countryID}`,
      )
      .toBe(detailsRow?.countryID);
  });

  test('getCompanyNameExistOnKpostAndKsmacc reports a known-absent company name as available', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'common-company-name-exist',
      { pathParams: { companyName: testData.companyNameAbsent } },
      { label: 'common:company-name-exist', auth: { principal: A } },
    );
    expect(ex.status, 'getCompanyNameExistOnKpostAndKsmacc succeeds').toBe(200);
    expect(
      ex.bodyText,
      'a known-absent company name is reported available, not "already exists"',
    ).toContain('Available');
  });
});
