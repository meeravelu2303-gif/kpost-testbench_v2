import { testData } from '@config/test-data.config';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineKpostEndpoint, defineUndocumentedKpostEndpoint } from '../kpost-endpoint';

/** Public, read-only reference data for address forms: countries, states, cities, postcodes. */
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

export const countryApi = defineUndocumentedKpostEndpoint({
  id: 'common-country',
  // Live: reference data; one country by id. No identifier of a person.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/country',
  summary: 'One country by id, code or name',
  tags: LOCATION_TAGS,
  destructive: false,
  request: body(() => ({ countryID: testData.countryId })),
  requestSchema: typesOnlySchema({ countryID: testData.countryId }),
  evidence:
    'CommonControllerV2.java:364 country (countryID, then countryCode, then LIKE countryName; one ' +
    'is required, else 400); no client calls it',
  note: 'a broad name match uses getSingleResult and 500s (CommonDaoImpl.java:63-88) — verify before filing',
});

export const professionsApi = defineUndocumentedKpostEndpoint({
  id: 'common-professions',
  productionSafe: true,
  method: 'GET',
  path: '/v2/common/getProfession',
  summary: 'List professions (signup reference data)',
  tags: [...LOCATION_TAGS.filter((t) => t !== 'location'), 'profession'],
  evidence:
    'CommonControllerV2.java:398 getProfession → professionRepository.findAll(); no client calls it',
});

export const designationsByProfessionApi = defineUndocumentedKpostEndpoint({
  id: 'common-designations-by-profession',
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/getDesignationByProfessionId',
  summary: 'Designations for one profession',
  tags: [...LOCATION_TAGS.filter((t) => t !== 'location'), 'profession'],
  destructive: false,
  request: body(() => ({ profession: { professionID: 1 } })),
  requestSchema: typesOnlySchema({ profession: { professionID: 1 } }),
  evidence:
    'CommonControllerV2.java:428 (profession.professionID > 0, else 400); an unknown id answers 200 ' +
    'with [] because the 404 branch is unreachable (CommonDaoImpl.java:129-137)',
});

export const locationApis = [
  countriesApi,
  statesApi,
  citiesByRegionApi,
  pinCodeApi,
  postalPinCodeApi,
  languagesApi,
  designationApi,
  countryApi,
  professionsApi,
  designationsByProfessionApi,
];
