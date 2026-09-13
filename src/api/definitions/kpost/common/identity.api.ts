import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint } from '../kpost-endpoint';

/**
 * Existence checks and identity lookups: is this mobile number registered, is this company name
 * taken, which KPost ID belongs to this module.
 *
 * ## These are enumeration endpoints, and that is the point of testing them
 *
 * Each one answers a question about somebody else's data, without a token. `mobileNoExist` tells
 * an anonymous caller whether a phone number belongs to a KPost user; `getUserDetailsByMobNo`
 * goes further and returns details. That is a legitimate signup feature and a legitimate privacy
 * risk at the same time, so the central security validators (information disclosure, sensitive
 * data, injection, rate limiting) carry most of the weight here — a 200 with a name and email in
 * it is a finding, not a pass.
 *
 * `/v2/common/mobileNoExist/` is POST only. The workbook's Sheet3 R11 row documents it with no
 * payload, which made the method rule derive a GET; the API owner confirmed that row is
 * incomplete, so the GET variant is recorded as stale rather than tested.
 */
const IDENTITY_TAGS = ['common', 'common-identity', 'enumeration-surface'] as const;

export const mobileNoExistApi = defineKpostEndpoint({
  id: 'common-mobile-no-exist',
  // Live: Read-only lookup, asked with QA_MOBILE_ABSENT (a known-unused number).
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/mobileNoExist/',
  summary: 'Check whether a mobile number is already registered',
  tags: IDENTITY_TAGS,
  destructive: false,
  request: body(() => ({
    countryID: testData.countryId,
    mobileNumber: testData.mobileAbsent,
  })),
});

export const mobileNoExistInsideCompanyApi = defineKpostEndpoint({
  id: 'common-mobile-no-exist-in-company',
  method: 'POST',
  path: '/v2/common/mobileNoExistInsideCompany/',
  summary: 'Check whether a mobile number is registered inside a company',
  tags: IDENTITY_TAGS,
  destructive: false,
  request: body(() => ({
    mobileNumber: testData.mobileAbsent,
    companyID: testData.companyId,
  })),
});

export const userDetailsByMobileApi = defineKpostEndpoint({
  id: 'common-user-details-by-mobile',
  // Live: Read-only lookup, asked with OUR OWN registered mobile.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/getUserDetailsByMobNo',
  summary: 'Fetch user details for a mobile number',
  tags: [...IDENTITY_TAGS, 'pii'],
  destructive: false,
  request: body(() => ({ mobileNumber: Number(testData.mobileExists) })),
});

export const kpostIdUsingModuleApi = defineKpostEndpoint({
  id: 'common-kpost-id-using-module',
  // Live: Read-only; its only argument is a module code, not an identifier.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/getKpostIdUsingModule',
  summary: 'List KPost IDs subscribed to given modules',
  tags: [...IDENTITY_TAGS, 'pii'],
  destructive: false,
  // Module codes come from the types contract (KPOST_MODULE), not from an invented literal.
  request: body(() => ({ module: [testData.moduleId] })),
});

export const uniqueNameExistApi = defineKpostEndpoint({
  id: 'common-unique-name-exist',
  method: 'POST',
  path: '/v2/common/uniqueNameExist',
  summary: 'Check whether a company unique name is taken',
  tags: ['common', 'common-identity'],
  destructive: false,
  request: body(() => ({
    companyName: testData.companyNameAbsent,
    uniqueName: testData.uniqueName,
    domain: testData.domain,
  })),
});

export const domainApi = defineKpostEndpoint({
  id: 'common-domain',
  // Live: Read-only; arguments are countryID and a user type. Owns nothing.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/domain/',
  summary: 'List domains available for a country and user type',
  tags: ['common', 'common-identity'],
  destructive: false,
  // userType values are label-only in the workbook's Types tab; BUSINESS is the documented sample.
  request: body(() => ({ countryID: testData.countryId, userType: 'BUSINESS' })),
});

export const generateDomainAndUniqueNameApi = defineKpostEndpoint({
  id: 'common-generate-domain-and-unique-name',
  method: 'POST',
  path: '/v2/common/generateDomainAndUniqueName',
  summary: 'Suggest a domain and unique name for a company',
  tags: ['common', 'common-identity'],
  destructive: false,
  request: body(() => ({
    kpostID: testData.kpostId,
    companyName: testData.companyNameAbsent,
  })),
});

export const identityApis = [
  mobileNoExistApi,
  mobileNoExistInsideCompanyApi,
  userDetailsByMobileApi,
  kpostIdUsingModuleApi,
  uniqueNameExistApi,
  domainApi,
  generateDomainAndUniqueNameApi,
];
