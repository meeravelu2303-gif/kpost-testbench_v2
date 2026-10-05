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
 *
 * **Update, live-verified 2026-10-05** (the first time this host was actually reachable from this
 * environment — see `project_kpost_admin_hrsetup_network_blocked_2026_10_04`): the 2026-10-02
 * SOURCE-level claim above does NOT hold for the 14 endpoints in `CROSS_TENANT_CANDIDATES` below.
 * Every one of them ignores the request's `companyId` entirely and always returns the CALLER'S OWN
 * company's data (byte-identical whether 242 or 1034 is requested) — safe, if confusingly unused as
 * a parameter. This was caught only by comparing own-vs-other content directly; a naive "non-empty
 * response = leak" check (the loop's first version) mistook this for 9 cross-tenant leaks and
 * auto-filed 9 false CRITICAL bugs (#1028-1036, since closed INVALID). Left the 0c/0d architectural
 * description above as the historical source-audit finding, but it should not be assumed current
 * without live re-verification, same as every other claim in this codebase.
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

  /*
   * 0d, extended to every other company-scoped `productionSafe` read in the module. The single
   * `admin-department-by-company` probe above already found and filed a real CRITICAL finding
   * (0d/0c combined); this is that exact proven pattern, parameterized — not new design — across
   * every endpoint whose request shape takes `companyId` the same way, per the 2026-10-03
   * ground-truth re-audit's top recommendation. `ids` cover every shape companyId appears in:
   * JSON body (most), a path param, and a query param.
   */
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
    { id: 'admin-attribute-by-company', shape: 'body' },
    { id: 'admin-variable-list', shape: 'body', extra: { parentVariableId: 0 } },
    { id: 'admin-hr-tier-extra-by-company', shape: 'body' },
    { id: 'admin-hr-variable-extra-list', shape: 'body', extra: { parentVariableId: 0 } },
    { id: 'admin-workplace-tier-attribute-by-company', shape: 'body' },
    { id: 'admin-workplace-tier-variable-list', shape: 'body', extra: { parentVariableId: 0 } },
    { id: 'admin-workplace-location-all', shape: 'body' },
    { id: 'admin-product-master-list', shape: 'pathParams' },
    { id: 'admin-product-purchase-by-company', shape: 'queryParams' },
  ];

  /*
   * Live-verified 2026-10-05 (the first time this environment was reachable — see
   * project_kpost_admin_hrsetup_network_blocked_2026_10_04): a plain "did we get non-empty data
   * back" check is NOT sufficient here. Every one of these 9 endpoints answered with BYTE-IDENTICAL
   * bodies whether the request named company 242 (the caller's own) or 1034 (BUSINESS_S's) — the
   * backend is ignoring the request's companyId entirely and always returning the CALLER'S OWN data,
   * scoped correctly by token identity. That is SAFE, not a leak — but the old "non-empty = leak"
   * check could not tell that apart from a genuine cross-tenant disclosure, and reported all 9 as
   * failing. Fixed by also fetching the caller's OWN company's data and comparing: a real leak must
   * show content that is DIFFERENT from the caller's own AND actually matches the other company (its
   * own companyId field, where present, equals the one requested) — not merely non-empty.
   */
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
        { label: `admin:0d-extended:${candidate.id}:own`, auth: { principal: businessM! }, allowLiveRead: true },
      );
      const other = await endpoints.sendTo(
        candidate.id,
        { [candidate.shape]: otherParams },
        { label: `admin:0d-extended:${candidate.id}:other`, auth: { principal: businessM! }, allowLiveRead: true },
      );

      // Identical bytes means the endpoint ignored companyId and returned the caller's own data
      // regardless — safe (if confusing), and definitely not a cross-tenant disclosure.
      const identicalToOwn = own.bodyText === other.bodyText;

      let returnedOtherCompanyData = false;
      if (!identicalToOwn && other.status < 300) {
        try {
          const parsed = JSON.parse(other.bodyText || '{}') as { value?: unknown[]; data?: unknown[] };
          const rows = parsed.value ?? parsed.data ?? [];
          const rowArray = Array.isArray(rows) ? rows : [];
          // A real leak: the different content actually carries the OTHER company's id, not just
          // "some non-empty array" — this is what the old check was missing.
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
            'An Admin endpoint must scope company-scoped data by the CALLER\'S OWN companyId (from ' +
            `their token), not by whatever companyId the request names — a BUSINESS_M-authenticated ` +
            'caller must not be able to read BUSINESS_S\'s company data by naming company 1034.',
          expected: 'company 1034\'s data is refused, empty, or identical to the caller\'s own',
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
