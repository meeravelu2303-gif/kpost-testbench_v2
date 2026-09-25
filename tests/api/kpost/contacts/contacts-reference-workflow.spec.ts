import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Contacts **reference/search business rules** — `globalSearch`'s filter enforcement and
 * `getSearchDetails`'s location cascade. Both `productionSafe: true`, ungated.
 *
 * ## `getSearchDetails` is a cascade, not independent lookups
 *
 * The endpoint definition's own default request used to ask for `requestType: 'areaName'` with
 * `provienceName`/`state`/`city` all empty — live-verified 2026-09-24: the server 400s that with
 * "Missing required fields for requestType 'areaName'", so the endpoint's own baseline call always
 * failed (fixed in `read.api.ts`, default now `provienceName`). The real chain, traced live:
 * `country` -> `provienceName` (a ZONE, e.g. "Southern Zone" — NOT a state) -> `state` (needs
 * `provienceName`) -> `city` (needs `provienceName` + `state`) -> `areaName` (needs all three, and
 * values are case-sensitive: cities came back upper-cased, e.g. "CHENNAI"). Driven end to end below.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

interface SearchDetailsBody {
  data?: (string | null)[];
}

async function searchDetails(
  endpoints: EndpointExecutor,
  body: Record<string, unknown>,
): Promise<string[]> {
  const requestType = String(body.requestType);
  const ex = await endpoints.sendTo(
    'contacts-search-details',
    { body },
    { label: `contacts-reference:${requestType}`, auth: { principal: A } },
  );
  expect(ex.status, `getSearchDetails(${requestType}) succeeds`).toBe(200);
  const parsed = JSON.parse(ex.bodyText || '{}') as SearchDetailsBody;
  return (parsed.data ?? []).filter((v): v is string => Boolean(v));
}

test.describe('KPost Contacts · reference and search business rules @api @kpost-api @contacts', () => {
  test('globalSearch enforces every filter it is given, not just the search term', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'contacts-global-search',
      {
        body: {
          search: 'a',
          languageList: ['english'],
          userTypeList: ['personal'],
          countryList: ['india'],
        },
      },
      { label: 'contacts-reference:global-search', auth: { principal: A } },
    );
    expect(ex.status, 'globalSearch succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as {
      data?: Array<{ userType?: string; country?: string; kpostID?: string }>;
    };
    const rows = body.data ?? [];
    expect(rows.length, 'the broad search returns real results to check filters against').toBeGreaterThan(
      0,
    );
    for (const row of rows) {
      expect(row.userType, `every result matches the userTypeList filter (${row.kpostID})`).toBe(
        'PERSONAL',
      );
      expect(
        (row.country ?? '').toLowerCase(),
        `every result matches the countryList filter (${row.kpostID})`,
      ).toBe('india');
    }
    const ids = rows.map((r) => r.kpostID);
    expect(ids, 'no duplicate accounts across the result set').toHaveLength(new Set(ids).size);
  });

  test('getSearchDetails resolves a real zone → state → city → areaName cascade', async ({
    endpoints,
  }) => {
    const zones = await searchDetails(endpoints, {
      requestType: 'provienceName',
      country: 'INDIA',
      provienceName: '',
      state: '',
      city: '',
    });
    expect(zones.length, 'India resolves at least one zone').toBeGreaterThan(0);
    const zone = zones[0]!;

    const states = await searchDetails(endpoints, {
      requestType: 'state',
      country: 'INDIA',
      provienceName: zone,
      state: '',
      city: '',
    });
    expect(states.length, `zone "${zone}" resolves at least one state`).toBeGreaterThan(0);
    const state = states[0]!;

    const cities = await searchDetails(endpoints, {
      requestType: 'city',
      country: 'INDIA',
      provienceName: zone,
      state,
      city: '',
    });
    expect(cities.length, `state "${state}" resolves at least one city`).toBeGreaterThan(0);
    const city = cities[0]!;

    const areas = await searchDetails(endpoints, {
      requestType: 'areaName',
      country: 'INDIA',
      provienceName: zone,
      state,
      city,
    });
    expect(areas.length, `city "${city}" resolves at least one area`).toBeGreaterThan(0);
  });
});
