/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Common **reference-data business rules** — countries/states/cities/postcodes/languages/
 * designations. Not gated: all `productionSafe: true`, safe on every default run.
 *
 * The real finding here is cross-endpoint consistency, not just "does it return 200": a region id
 * from `getStates` should resolve to real cities of `getCitiesByRegionId`, and a designation search
 * should actually filter by its prefix rather than return an unrelated list.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

interface Envelope<T> {
  data?: T;
}

test.describe('KPost common · reference-data business rules @api @kpost-api @common', () => {
  test('countries includes India, matching testData.countryId', async ({ endpoints }) => {
    const ex = await endpoints.sendTo(
      'common-countries',
      {},
      { label: 'common:countries', auth: { principal: A } },
    );
    expect(ex.status, 'countries succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as Envelope<
      Array<{ countryID: number; countryName: string }>
    >;
    const india = body.data?.find((c) => c.countryID === Number(testData.countryId));
    expect(india?.countryName, 'testData.countryId resolves to a real country name').toBe('India');
  });

  test('a region from getStates resolves to real cities via getCitiesByRegionId (cross-endpoint consistency)', async ({
    endpoints,
  }) => {
    const states = await endpoints.sendTo(
      'common-states',
      {},
      { label: 'common:states', auth: { principal: A } },
    );
    expect(states.status, 'getStates succeeds').toBe(200);
    const statesBody = JSON.parse(states.bodyText || '{}') as Envelope<
      Array<{ regionId: number; regionName: string }>
    >;
    const region = statesBody.data?.[0];
    expect(region, 'at least one state/region exists').toBeTruthy();
    if (!region) return;

    const cities = await endpoints.sendTo(
      'common-cities-by-region',
      { body: { regionId: region.regionId } },
      { label: 'common:cities-by-region', auth: { principal: A } },
    );
    expect(cities.status, 'getCitiesByRegionId succeeds for a real region id').toBe(200);
    const citiesBody = JSON.parse(cities.bodyText || '{}') as Envelope<string[]>;
    expect(
      Array.isArray(citiesBody.data) && citiesBody.data.length > 0,
      `region "${region.regionName}" (id ${region.regionId}) resolves to at least one real city`,
    ).toBe(true);
  });

  test('pinCode and postalPinCode agree on the same real postcode', async ({ endpoints }) => {
    const [pin, postal] = await Promise.all([
      endpoints.sendTo(
        'common-pincode',
        { body: { postalCode: Number(testData.pinCode) } },
        { label: 'common:pincode', auth: { principal: A } },
      ),
      endpoints.sendTo(
        'common-postal-pincode',
        { body: { postalCode: Number(testData.pinCode) } },
        { label: 'common:postal-pincode', auth: { principal: A } },
      ),
    ]);
    expect(pin.status, 'pinCode succeeds').toBe(200);
    expect(postal.status, 'postalPinCode succeeds').toBe(200);
    const pinBody = JSON.parse(pin.bodyText || '{}') as Envelope<Array<{ cityName?: string }>>;
    const postalBody = JSON.parse(postal.bodyText || '{}') as Envelope<
      Array<{ cityName?: string }>
    >;
    expect(
      pinBody.data?.[0]?.cityName,
      'pinCode resolves the postcode to a real city',
    ).toBeTruthy();
    expect(
      postalBody.data?.[0]?.cityName,
      'postalPinCode agrees with pinCode on the same city for the same postcode',
    ).toBe(pinBody.data?.[0]?.cityName);
  });

  test('languages for India includes English', async ({ endpoints }) => {
    const ex = await endpoints.sendTo(
      'common-languages',
      { body: { countryID: testData.countryId } },
      { label: 'common:languages', auth: { principal: A } },
    );
    expect(ex.status, 'languages succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as Envelope<Array<{ language: string }>>;
    expect(
      body.data?.some((l) => l.language === 'English'),
      'English is offered for India',
    ).toBe(true);
  });

  test('getDesignation actually filters by its prefix, not an unrelated list', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'common-designation',
      { body: { designation: 'soft' } },
      { label: 'common:designation', auth: { principal: A } },
    );
    expect(ex.status, 'getDesignation succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as Envelope<string[]>;
    expect(
      Array.isArray(body.data) && body.data.length > 0,
      'at least one designation matches the "soft" prefix',
    ).toBe(true);
    for (const designation of body.data ?? []) {
      expect(
        designation.toLowerCase().includes('soft'),
        `"${designation}" does not actually contain the "soft" search prefix — the filter is not working`,
      ).toBe(true);
    }
  });
});
