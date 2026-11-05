import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Admin cross-tenant probe (0d), read-only: can the BUSINESS_M token read BUSINESS_S's company
 * (1034) data by naming its companyId in the request?
 */
const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);

test.describe('Admin module · security probes (plan items 0c/0d) @api @admin-api @security', () => {
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  // Every company-scoped read that takes companyId in its request.
  const CROSS_TENANT_CANDIDATES: Array<{
    id: string;
    extra?: Record<string, unknown>;
    shape: 'body' | 'pathParams' | 'queryParams';
  }> = [
    { id: 'admin-employee-details', shape: 'body' },
    { id: 'admin-hr-tier-attribute-by-company', shape: 'body' },
    { id: 'admin-hr-tier-variable-list', shape: 'body', extra: { parentVariableId: 0 } },
    { id: 'admin-role-posting-by-company', shape: 'body' },
    { id: 'admin-role-posting-employees', shape: 'body' },
    { id: 'admin-workplace-tier-attribute-by-company', shape: 'body' },
    { id: 'admin-workplace-tier-variable-list', shape: 'body', extra: { parentVariableId: 0 } },
    { id: 'admin-workplace-location-all', shape: 'body' },
  ];

  // Non-empty data is not a leak: the backend ignores the requested companyId and returns the
  // caller's own. A leak is content that differs from the caller's own AND carries company 1034's id.
  for (const candidate of CROSS_TENANT_CANDIDATES) {
    test(`0d (extended): BUSINESS_M's token cannot read BUSINESS_S's company data via ${candidate.id}`, async ({
      endpoints,
    }) => {
      const ownCompanyId = String(testData.businessMCompanyId);
      const otherCompanyId = '1034'; // QA_BUSINESS_S_COMPANY_ID — a DIFFERENT bench-owned tenant
      const ownParams = { companyId: ownCompanyId, ...candidate.extra };
      const otherParams = { companyId: otherCompanyId, ...candidate.extra };

      const own = await endpoints.sendTo(
        candidate.id,
        { [candidate.shape]: ownParams },
        {
          label: `admin:0d-extended:${candidate.id}:own`,
          auth: { principal: businessM! },
          allowLiveRead: true,
        },
      );
      const other = await endpoints.sendTo(
        candidate.id,
        { [candidate.shape]: otherParams },
        {
          label: `admin:0d-extended:${candidate.id}:other`,
          auth: { principal: businessM! },
          allowLiveRead: true,
        },
      );

      // Identical bytes means the endpoint ignored companyId and returned the caller's own data
      // regardless — safe (if confusing), and definitely not a cross-tenant disclosure.
      const identicalToOwn = own.bodyText === other.bodyText;

      let returnedOtherCompanyData = false;
      if (!identicalToOwn && other.status < 300) {
        try {
          const parsed = JSON.parse(other.bodyText || '{}') as {
            value?: unknown[];
            data?: unknown[];
          };
          const rows = parsed.value ?? parsed.data ?? [];
          const rowArray = Array.isArray(rows) ? rows : [];
          // A real leak carries the other company's id, not just a non-empty array.
          returnedOtherCompanyData =
            rowArray.length > 0 &&
            JSON.stringify(rowArray).includes(`"companyId":"${otherCompanyId}"`);
        } catch {
          returnedOtherCompanyData = false;
        }
      }

      if (returnedOtherCompanyData) {
        endpoints.recordBusinessRuleViolation({
          endpointId: candidate.id,
          ruleId: `IDOR-admin-cross-company-tenant-${candidate.id}`,
          rule:
            "An Admin endpoint must scope company-scoped data by the CALLER'S OWN companyId (from " +
            `their token), not by whatever companyId the request names — a BUSINESS_M-authenticated ` +
            "caller must not be able to read BUSINESS_S's company data by naming company 1034.",
          expected: "company 1034's data is refused, empty, or identical to the caller's own",
          actual: `${candidate.id}(companyId=1034) answered ${other.status} with company-1034-tagged data, distinct from the caller's own (company ${ownCompanyId}) response`,
          request: { [candidate.shape]: otherParams },
        });
      }
      expect
        .soft(
          returnedOtherCompanyData,
          `0d (${candidate.id}): BUSINESS_M's token must not read BUSINESS_S's (company 1034) data`,
        )
        .toBe(false);
    });
  }
});
