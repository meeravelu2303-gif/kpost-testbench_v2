import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Contacts search rules (read-only, ungated): globalSearch's filters and getSearchDetails' cascade
 * provienceName (a zone) → state → city → areaName, each needing the previous; values are case-sensitive.
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

test.describe(
  'KPost Contacts · reference and search business rules @api @kpost-api @contacts',
  { tag: ['@api', '@contacts', '@regression'] },
  () => {
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
      expect(
        rows.length,
        'the broad search returns real results to check filters against',
      ).toBeGreaterThan(0);
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
  },
);
