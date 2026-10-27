import { testData } from '@config/test-data.config';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineKpostEndpoint } from '../kpost-endpoint';

/**
 * Existence checks and identity lookups. They answer questions about other people's data without a
 * token, so the central security validators carry most of the weight. `mobileNoExist` is POST only.
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
  // Exactly the documented contract (countryID + mobileNumber, no companyID); no workaround fields.
  request: body(() => ({
    countryID: testData.countryId,
    mobileNumber: testData.mobileAbsent,
  })),
});

export const mobileNoExistInsideCompanyApi = defineKpostEndpoint({
  id: 'common-mobile-no-exist-in-company',
  // Live: read-only membership check on our own business company with the admin's own mobile.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/mobileNoExistInsideCompany/',
  summary: 'Check whether a mobile number is registered inside a company',
  tags: IDENTITY_TAGS,
  destructive: false,
  request: body(() => ({
    mobileNumber: testData.businessMMobile,
    companyID: testData.businessMCompanyId,
  })),
  // Types-only, from a captured live body.
  responseSchema: typesOnlySchema({
    statusCode: 200,
    status: 'SUCCESS',
    message: '',
    urlPath: '',
    data: true,
  }),
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
  // Live: read-only availability check with a known-absent, allowlisted company name — names no one.
  productionSafe: true,
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
  // Types-only, from a captured live body.
  responseSchema: typesOnlySchema({ message: '', urlPath: '', status: 'SUCCESS', statusCode: 200 }),
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
  // Live: read-only suggestion for OUR kpostID + a known-absent, allowlisted company name.
  productionSafe: true,
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
