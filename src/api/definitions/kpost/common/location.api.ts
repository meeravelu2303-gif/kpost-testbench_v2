import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint } from '../kpost-endpoint';

/**
 * Reference data for address forms: countries, states, cities, postcodes.
 *
 * Read-only and public, which makes them the ideal first endpoints to run: no token, no side
 * effects, and a failure here is unambiguous. They are also the endpoints most likely to expose
 * an unbounded response — a country list is small, a city list is not — so the central
 * payload-size and response-time validators matter more here than anywhere else.
 */
const LOCATION_TAGS = ['common', 'common-reference', 'location'] as const;

export const countriesApi = defineKpostEndpoint({
  id: 'common-countries',
  // Live: Reference data. No identifier in the request at all.
  productionSafe: true,
  method: 'GET',
  path: '/v2/common/countries',
  summary: 'List supported countries',
  tags: LOCATION_TAGS,
});

export const statesApi = defineKpostEndpoint({
  id: 'common-states',
  // Live: Reference data. No identifier in the request at all.
  productionSafe: true,
  method: 'GET',
  path: '/v2/common/getStates/',
  summary: 'List states',
  tags: LOCATION_TAGS,
});

export const citiesByRegionApi = defineKpostEndpoint({
  id: 'common-cities-by-region',
  // Live: Reference data, keyed by a region id (shared, not owned by anyone).
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/getCitiesByRegionId/',
  summary: 'List cities in a region',
  tags: LOCATION_TAGS,
  destructive: false,
  request: body(() => ({ regionId: testData.regionId })),
});

export const pinCodeApi = defineKpostEndpoint({
  id: 'common-pincode',
  // Live: Reference data, keyed by a postal code.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/pinCode',
  summary: 'Look up a postcode',
  tags: LOCATION_TAGS,
  destructive: false,
  request: body(() => ({ postalCode: Number(testData.pinCode) })),
});

export const postalPinCodeApi = defineKpostEndpoint({
  id: 'common-postal-pincode',
  // Live: Reference data, keyed by a postal code.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/postalPinCode/',
  summary: 'Look up postal details for a postcode',
  tags: LOCATION_TAGS,
  destructive: false,
  request: body(() => ({ postalCode: Number(testData.pinCode) })),
});

export const languagesApi = defineKpostEndpoint({
  id: 'common-languages',
  // Live: Reference data, keyed by countryID.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/languages',
  summary: 'List languages available for a country',
  tags: ['common', 'common-reference'],
  destructive: false,
  request: body(() => ({ countryID: testData.countryId })),
});

export const designationApi = defineKpostEndpoint({
  id: 'common-designation',
  // Live: Reference data. No identifier in the request at all.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/getDesignation/',
  summary: 'Search job designations by prefix',
  tags: ['common', 'common-reference'],
  destructive: false,
  // A prefix, not an identifier: safe to hard-code, and it exercises the search path.
  request: body(() => ({ designation: 'soft' })),
});

export const locationApis = [
  countriesApi,
  statesApi,
  citiesByRegionApi,
  pinCodeApi,
  postalPinCodeApi,
  languagesApi,
  designationApi,
];
