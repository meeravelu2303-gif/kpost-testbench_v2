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
    expect(
      areaNames.length > 0,
      'at least one real area name is resolved for this pincode',
    ).toBe(true);
  });
});
