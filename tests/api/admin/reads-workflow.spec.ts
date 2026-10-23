import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Admin module **plain reads** — reference-data lookups with no dependency on the org-build
 * lifecycle. Not gated behind `ADMIN_LIFECYCLE`: `admin-country-address-by-pincode` is
 * `productionSafe: true` and writes nothing, so it runs on every default run once the BUSINESS_M
 * account is configured (same account the gated lifecycle spec needs).
 */

const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);

test.describe('Admin module · plain-read business rules @api @admin-api', () => {
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  test('getAddressUsingPincodeAndCountry resolves a real, known Indian pincode', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'admin-country-address-by-pincode',
      { pathParams: { pincode: testData.pinCode, country: 'India' } },
      { label: 'admin:country-address', auth: { principal: businessM! }, allowLiveRead: true },
    );
    expect(ex.status, 'the lookup succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as {
      value?: { areaName?: string[]; State?: string; Country?: string; District?: string };
    };
    // A real, known pincode must resolve to a real place, not an empty/placeholder envelope.
    expect(body.value?.Country, 'the country matches what was asked for').toBe('India');
    expect(body.value?.State, 'a real state is resolved').toBeTruthy();
    expect(body.value?.District, 'a real district is resolved').toBeTruthy();
    const areaNames = body.value?.areaName ?? [];
    expect(areaNames.length > 0, 'at least one real area name is resolved for this pincode').toBe(
      true,
    );
  });

  for (const requestType of ['suspend', 'terminate'] as const) {
    test(`getSuspendOrTerminateEmployee lists the ${requestType}ed members — an empty list is a list, not an error`, async ({
      endpoints,
    }) => {
      // The Admin UI's own call (EmployeeManagement/Suspend.js:302, Terminate.js:205). The backend
      // validates only that requestType is present (RolePostingSetUpController:330); a valid request
      // whose list is empty is answered 400 "requestType is Empty or Invalid" (:348), which tells the
      // screen its own valid input was wrong. Expected: 200 SUCCESS with the (possibly empty) list.
      const ex = await endpoints.sendTo(
        'admin-role-posting-suspended-list',
        { body: { requestType } },
        {
          label: `admin:${requestType}-list`,
          auth: { principal: businessM! },
          allowLiveRead: true,
        },
      );
      const env = JSON.parse(ex.bodyText || '{}') as {
        status?: string;
        value?: unknown;
        error?: unknown;
      };
      test.info().annotations.push({
        type: 'observed',
        description: `HTTP ${ex.status}: ${(ex.bodyText ?? '').slice(0, 200)}`,
      });
      expect(ex.status, 'a valid request is answered 200').toBe(200);
      expect(env.status, 'with a SUCCESS envelope').toBe('SUCCESS');
      expect(Array.isArray(env.value), 'and the list (empty when nobody is listed)').toBe(true);
    });
  }

  test('getSuspendOrTerminateEmployee without a requestType is refused as a bad request', async ({
    endpoints,
  }) => {
    // Control for the test above: the one genuine input error the controller checks.
    const ex = await endpoints.sendTo(
      'admin-role-posting-suspended-list',
      { body: {} },
      { label: 'admin:suspend-list-no-type', auth: { principal: businessM! }, allowLiveRead: true },
    );
    expect(ex.status, 'a missing requestType is a 400').toBe(400);
    expect(ex.bodyText ?? '', 'naming the missing field').toMatch(/requestType/i);
  });
});
