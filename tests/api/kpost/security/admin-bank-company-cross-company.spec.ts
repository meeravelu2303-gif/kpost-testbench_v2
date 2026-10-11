// Cross-company disclosure via /admin/getBankAndCompanyDetails. Read-only — no live setup needed.
import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * `GET /admin/getBankAndCompanyDetails/{companyID}` — a company admin's Company/Bank settings screen.
 *
 * The companyID travels in the path and (per the 2026-10-05 Admin backend ground-truth audit) is used
 * to resolve the record without checking it belongs to the CALLER's company — the same unscoped-lookup
 * class behind the member-count leak guarded by `admin-usermanagement-cross-company.spec.ts`. The
 * bank/PAN/GST half of this disclosure is already filed as **bug #982**; this spec is a REGRESSION
 * GUARD for that fix, not a new finding.
 *
 * Deliberately NON-FILING: it asserts the correct behaviour (a company admin naming another company's
 * ID must not get that company's details back) and surfaces a regression as a visible test failure,
 * but it does NOT call `recordBusinessRuleViolation`, so it can never auto-file a duplicate of #982.
 * When #982 is fixed the assertion passes; until then it fails loudly, which is the intended signal.
 *
 * Verdict: does a company admin calling this with a DIFFERENT company's ID get back that company's
 * real company/bank details (name, address, PAN, GST)?
 */
test.describe('KPost Security · Admin getBankAndCompanyDetails cross-company disclosure @api @kpost-api @security @admin', () => {
  test("a company admin must not read another company's bank/company details @api @security", async ({
    endpoints,
  }) => {
    const attacker = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'business-s');
    test.skip(!attacker, 'needs the BUSINESS_S admin principal');
    const otherCompanyId = String(testData.businessMCompanyId);
    test.skip(
      !otherCompanyId || otherCompanyId === '1',
      "needs a real QA_BUSINESS_M_COMPANY_ID distinct from the attacker's own company",
    );

    const attack = await endpoints.sendTo(
      'admin-bank-and-company-details',
      { pathParams: { companyID: otherCompanyId } },
      {
        label: 'idor:admin-bank-company-cross-company',
        auth: { principal: attacker! },
        allowLiveRead: true,
      },
    );

    expect(attack.status, 'the request completes').toBeLessThan(500);
    const json = attack.json();
    const body = (json.ok ? json.value : {}) as Record<string, unknown>;
    const data = (body.data ?? {}) as Record<string, unknown>;
    const details = Array.isArray(data.companyDetails)
      ? (data.companyDetails[0] as Record<string, unknown> | undefined)
      : undefined;

    // A leak = the foreign company's record comes back with real identifying/financial fields.
    const leakedField =
      details &&
      [
        details.companyName,
        details.address1,
        details.address2,
        details.panNumber,
        details.gstNumber,
      ]
        .map((v) => (typeof v === 'string' ? v.trim() : v))
        .some((v) => typeof v === 'string' && v.length > 0);

    const disclosed = attack.status < 300 && json.ok && !!leakedField;

    expect
      .soft(
        disclosed,
        `BOLA: a company admin must not see another company's (${otherCompanyId}) bank/company ` +
          `details (replied ${attack.status}, companyDetails=${JSON.stringify(details)}). ` +
          `Tracked as bug #982 — this is a regression guard, not a new filing.`,
      )
      .toBe(false);
  });
});
