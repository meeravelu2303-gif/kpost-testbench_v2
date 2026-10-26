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
    expect.soft(body.value?.Country, 'the country matches what was asked for').toBe('India');
    expect.soft(body.value?.State, 'a real state is resolved').toBeTruthy();
    expect.soft(body.value?.District, 'a real district is resolved').toBeTruthy();
    const areaNames = body.value?.areaName ?? [];
    expect
      .soft(areaNames.length > 0, 'at least one real area name is resolved for this pincode')
      .toBe(true);
  });

  for (const requestType of ['suspend', 'terminate'] as const) {
    test(`getSuspendOrTerminateEmployee answers the ${requestType} list (#320: an empty list may be a 400)`, async ({
      endpoints,
    }) => {
      // The Admin UI's own call (EmployeeManagement/Suspend.js:302, Terminate.js:205). A list with members
      // is 200 SUCCESS + the array. An EMPTY list is answered 400 "requestType is Empty or Invalid"
      // (RolePostingSetUpController:348); #320 (adopting this finding's tag, KP-63C403) was closed INVALID
      // by the team, so that answer is accepted as "nobody listed" and never re-filed. Anything else fails.
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
      if (ex.status === 400) {
        expect(env.error, 'the empty-list answer accepted under #320').toBe(
          'requestType is Empty or Invalid',
        );
        return;
      }
      expect(ex.status, 'a list with members is answered 200').toBe(200);
      expect.soft(env.status, 'with a SUCCESS envelope').toBe('SUCCESS');
      expect.soft(Array.isArray(env.value), 'and the list').toBe(true);
    });
  }

  test('getSuspendOrTerminateEmployee without a body is refused as a bad request', async ({
    endpoints,
  }) => {
    // Control: an empty body is the one genuine input error; the server checks the body before the field
    // (live 2026-10-23: 400 "Request body is empty or invalid").
    const ex = await endpoints.sendTo(
      'admin-role-posting-suspended-list',
      { body: {} },
      { label: 'admin:suspend-list-no-type', auth: { principal: businessM! }, allowLiveRead: true },
    );
    expect(ex.status, 'an empty body is a 400').toBe(400);
    expect
      .soft(ex.bodyText ?? '', 'saying what is wrong with the request')
      .toMatch(/requestType|body is empty or invalid/i);
  });
});
