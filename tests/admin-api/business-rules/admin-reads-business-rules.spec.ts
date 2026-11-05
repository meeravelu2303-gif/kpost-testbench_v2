import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Admin plain reads with no lifecycle dependency (pincode lookup, suspend/terminate lists). They write
 * nothing, so they are not gated by ADMIN_LIFECYCLE; they need only the BUSINESS_M account.
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
      // The Admin UI's own call. A list with members is 200 SUCCESS; an empty list answers 400
      // "requestType is Empty or Invalid", accepted as "nobody listed" (#320 closed INVALID).
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
    // Control: an empty body is a genuine input error, checked before the field.
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
