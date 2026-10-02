import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Admin module security probes — proofs for plan items 0c and 0d (TEST_BENCH_100_PERCENT_PLAN.md
 * §16 P0), both READ-ONLY and both against the bench's already-configured `ADMIN_API_BASE_URL`
 * (confirmed on-prem/local test box, never the live `adminmodule.kpostindia.com` host — see the
 * plan's §3/§5 notes on this). Nothing here writes to the Admin database, which the bench's own
 * code-level `WRITE_BANNED_SUITES` guard enforces regardless.
 *
 * ## What's being proven
 *
 * The Admin_Module backend source audit (2026-10-02) found two architectural gaps:
 *   0c — Spring Security's filter chain permits every request unconditionally; the custom
 *        `AuthenticationFilter` only rejects a PRESENT-but-invalid token, defaulting
 *        `kpostID`/`companyID` to null/"0" when no `Authorization` header is sent at all, rather
 *        than rejecting the request outright.
 *   0d — most Admin service methods take `companyId` from the request BODY rather than
 *        cross-checking it against the JWT's own `companyID` claim, so tenancy is enforced by what
 *        the caller SAYS, not by what their token actually grants.
 *
 * Three genuinely different, bench-owned companies exist (`QA_BUSINESS_S/M/L_COMPANY_ID` = 1034 /
 * 242 / 1075), which makes 0d directly testable rather than theoretical: can the BUSINESS_M token
 * read BUSINESS_S's or BUSINESS_L's company data by naming their companyId in the body?
 */
const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);

test.describe('Admin module · security probes (plan items 0c/0d) @api @admin-api @security', () => {
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  test('0c: a request with NO Authorization header at all is not rejected outright', async ({
    endpoints,
  }) => {
    /*
     * Calls a plain, read-only, company-scoped endpoint with no auth header whatsoever, naming a
     * real company (BUSINESS_M's own, 242 — our own data either way, so even a worst-case "it works"
     * result exposes nothing we do not already own). If the backend's filter genuinely rejects a
     * missing header the way it rejects an invalid one, this must be a 401/403. If it instead
     * defaults kpostID/companyID and still serves the request, that is 0c confirmed.
     */
    const ex = await endpoints.sendTo(
      'admin-department-by-company',
      { body: { companyId: String(testData.businessMCompanyId) } },
      { label: 'admin:0c-no-auth-header', auth: { header: undefined }, allowLiveRead: true },
    );

    if (ex.status < 300) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'admin-department-by-company',
        ruleId: 'AUTH-BYPASS-admin-missing-header',
        rule:
          'An Admin endpoint must reject a request with no Authorization header at all, the same ' +
          'way it rejects a present-but-invalid one — not silently default kpostID/companyID and ' +
          'serve the request.',
        expected: 'a request with no Authorization header is refused (401/403)',
        actual: `getDepartmentByCompanyId answered ${ex.status} with no Authorization header sent at all`,
        request: { body: { companyId: String(testData.businessMCompanyId) } },
      });
    }
    expect
      .soft(
        ex.status,
        `0c: an Admin endpoint must reject a request with no Authorization header (replied ${ex.status})`,
      )
      .toBeGreaterThanOrEqual(400);
  });

  test('0d: BUSINESS_M\'s token can read BUSINESS_S\'s company data by naming its companyId', async ({
    endpoints,
  }) => {
    /*
     * Authenticated as BUSINESS_M (company 242, a real token, a real valid session) but asking for
     * company 1034's (BUSINESS_S's) departments. If the backend scopes by the token's own companyID
     * claim, this must be refused or return nothing. If it scopes by whatever companyId the caller
     * typed in the body, BUSINESS_S's real department data comes back to an account that has no
     * business seeing it — 0d confirmed. Both 1034 and 242 are bench-owned (QA_BUSINESS_S/M_COMPANY_ID),
     * so this never touches a real third party's data regardless of the outcome.
     */
    const otherCompanyId = '1034'; // QA_BUSINESS_S_COMPANY_ID — a DIFFERENT bench-owned tenant
    const ex = await endpoints.sendTo(
      'admin-department-by-company',
      { body: { companyId: otherCompanyId } },
      { label: 'admin:0d-cross-company', auth: { principal: businessM! }, allowLiveRead: true },
    );

    let returnedOtherCompanyData = false;
    if (ex.status < 300) {
      try {
        const parsed = JSON.parse(ex.bodyText || '{}') as { value?: unknown[]; data?: unknown[] };
        const rows = parsed.value ?? parsed.data ?? [];
        returnedOtherCompanyData = Array.isArray(rows) && rows.length > 0;
      } catch {
        returnedOtherCompanyData = false;
      }
    }

    if (returnedOtherCompanyData) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'admin-department-by-company',
        ruleId: 'IDOR-admin-cross-company-tenant',
        rule:
          'An Admin endpoint must scope company-scoped data by the CALLER\'S OWN companyId (from ' +
          'their token), not by whatever companyId the request body names — a BUSINESS_M-authenticated ' +
          'caller must not be able to read BUSINESS_S\'s company data by naming company 1034 in the body.',
        expected: 'company 1034\'s data is refused or empty to a company-242-authenticated caller',
        actual: `getDepartmentByCompanyId(companyId=1034) answered ${ex.status} with non-empty data to a BUSINESS_M (company 242) token`,
        request: { body: { companyId: otherCompanyId } },
      });
    }
    expect
      .soft(
        returnedOtherCompanyData,
        '0d: BUSINESS_M\'s token must not read BUSINESS_S\'s (company 1034) department data',
      )
      .toBe(false);
  });
});
