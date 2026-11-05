// Cross-company disclosure via /admin/userManagementDetails. Read-only — no live setup needed.
import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * `GET /admin/userManagementDetails/{companyID}` uses the path companyID unchecked for the member
 * counts and plan. Verdict: does an admin naming ANOTHER company get that company's data back?
 */
test.describe('KPost Security · Admin userManagementDetails cross-company disclosure @api @kpost-api @security @admin', () => {
  test("a company admin can read another company's member counts and subscription plan @api @security", async ({
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
      'admin-user-management-details',
      { pathParams: { companyID: otherCompanyId } },
      {
        label: 'idor:admin-usermanagement-cross-company',
        auth: { principal: attacker! },
        allowLiveRead: true,
      },
    );

    expect(attack.status, 'the request completes').toBeLessThan(500);
    const json = attack.json();
    const body = (json.ok ? json.value : {}) as Record<string, unknown>;
    const counts = body.memberCountDetails as Record<string, unknown> | undefined;

    const disclosed =
      attack.status < 300 &&
      json.ok &&
      !!counts &&
      typeof counts.totalMembersCount === 'number' &&
      counts.totalMembersCount > 0;

    if (disclosed) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'admin-user-management-details',
        ruleId: 'IDOR-admin-usermanagement-cross-company-metrics',
        rule:
          "A company admin must not be able to read another company's member counts or " +
          'subscription plan by naming its companyID in the path.',
        expected: 'the request is refused, or returns no usable member-count/plan data',
        actual: `status=${attack.status}, memberCountDetails=${JSON.stringify(counts)} for companyID ${otherCompanyId}`,
        request: { pathParams: { companyID: otherCompanyId } },
      });
    }

    expect
      .soft(
        disclosed,
        `BOLA: a company admin must not see another company's (${otherCompanyId}) member counts/plan ` +
          `(replied ${attack.status}, memberCountDetails=${JSON.stringify(counts)})`,
      )
      .toBe(false);
  });
});
