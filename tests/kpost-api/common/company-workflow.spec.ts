import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Common company-lookup rules (read-only, ungated): three routes answer the same "which company owns
 * this admin's mobile" question and must agree. The company-logo endpoints are in common-gaps.spec.ts.
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

test.describe(
  'KPost common · company-lookup business rules @api @kpost-api @common',
  { tag: ['@api', '@platform', '@regression'] },
  () => {
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
      expect(byMobileAndProduct.status, 'getCompanyDetailsByMobileNoAndproductId succeeds').toBe(
        200,
      );

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

      // Known defect: countryID disagrees across the three (1 vs 0). Recorded explicitly, since the
      // engine's validators cannot see a 2xx data-consistency fault.
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
  },
);
