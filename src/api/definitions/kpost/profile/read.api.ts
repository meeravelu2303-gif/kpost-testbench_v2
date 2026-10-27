import { testData } from '@config/test-data.config';
import { pathParamSchema, typesOnlySchema } from '@api/schema/sample-schema';
import { body, pathParams } from '../kpost-endpoint';
import { defineProfileEndpoint, defineUndocumentedProfileEndpoint } from './profile-endpoint';

/**
 * Profile reads: fetch, search, digital card, languages, device state. All run on live with our own
 * ids or a harmless search term; the lookups are an information-disclosure surface the central
 * validators check.
 */
const READ_TAGS = ['profile-read'] as const;

export const fetchUserDetailsApi = defineProfileEndpoint({
  id: 'profile-fetch-user-details',
  // GET with no payload: the caller comes from the token.
  method: 'GET',
  path: '/v2/profile/fetchUserDetails/',
  summary: "Fetch the caller's profile details",
  tags: [...READ_TAGS, 'pii'],
  productionSafe: true,
  // Our own account, so the row must exist; only `active_status` tells a deactivated account apart.
  database: { validations: ['kpost-user-active'] },
});

export const userProfileByKpostIdApi = defineProfileEndpoint({
  id: 'profile-user-profile-by-kpostid',
  // Confirms the account is real and active: on the wire a deactivated one looks like "no such
  // user".
  database: { validations: ['kpost-user-active'] },
  // KDirectory "view full profile".
  requirements: ['FR-KD-005'],
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/profile/getUserProfileUsingKpostID/',
  summary: 'Fetch a profile by KPost ID',
  tags: [...READ_TAGS, 'pii', 'enumeration-surface'],
  productionSafe: true,
  // Looks up the second personal account: the primary one gets a wrong 404 here (pinned in
  // directory-lookup.spec.ts), and the probes need an account that resolves.
  request: body(() => ({ kpostID: testData.personal3KpostId })),
});

export const userBasicByKpostIdApi = defineProfileEndpoint({
  id: 'profile-user-basic-by-kpostid',
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/profile/getUserBasicDetailsUsingKpostID',
  summary: 'Fetch basic profile details by mobile number',
  tags: [...READ_TAGS, 'pii', 'enumeration-surface'],
  productionSafe: true,
  request: body(() => ({ mobileNumber: testData.mobileExists, countryID: testData.countryId })),
});

export const digitalCardApi = defineProfileEndpoint({
  id: 'profile-digital-card',
  // POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/profile/getDigitalCard/',
  summary: "Fetch a contact's digital card",
  tags: [...READ_TAGS, 'pii'],
  productionSafe: true,
  request: body(() => ({ contactID: testData.kpostId, userType: 'KnownContacts' })),
});

export const autoSearchApi = defineProfileEndpoint({
  id: 'profile-auto-search',
  // POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/profile/autoSearchWithName/',
  summary: 'Search profiles by name',
  tags: [...READ_TAGS, 'search', 'enumeration-surface'],
  productionSafe: true,
  // `data` is an array of name strings but the workbook types them as objects, so the schema check
  // is skipped.
  skipValidators: ['response.schema'],
  request: body(() => ({ fullName: 'qa', country: 'india' })),
});

export const advancedSearchApi = defineProfileEndpoint({
  id: 'profile-advanced-search',
  // POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/profile/advancedSearch/',
  summary: 'Advanced profile search',
  tags: [...READ_TAGS, 'search', 'enumeration-surface'],
  productionSafe: true,
  // Every documented filter is sent, so a strict presence check cannot 400 us. `mobileNumber` uses
  // our own number: the QA guard refuses an empty one like any unowned identifier.
  request: body(() => ({
    fullName: 'qa',
    mobileNumber: testData.mobileExists,
    gender: null,
    ageFrom: null,
    ageTo: null,
    profession: null,
    pincode: '',
    state: '',
    city: '',
    country: '',
  })),
});

export const getLanguagesApi = defineProfileEndpoint({
  id: 'profile-get-languages',
  method: 'GET',
  path: '/v2/profile/getlanguages/',
  summary: 'Languages the caller can pick for their profile',
  tags: [...READ_TAGS, 'reference'],
  // Answers an empty language list on the test build; not treated as a defect.
  productionSafe: true,
});

export const isDevicePrimaryApi = defineProfileEndpoint({
  id: 'profile-is-device-primary',
  // The workbook documents POST; the live API answers only GET (POST -> 405).
  method: 'GET',
  contractMethod: 'POST',
  path: '/v2/profile/isDevicePrimaryOrNot/',
  summary: 'Whether the current device is the primary device for the account',
  tags: [...READ_TAGS, 'device'],
  productionSafe: true,
});

export const downloadProfileImageApi = defineProfileEndpoint({
  id: 'profile-download-image',
  method: 'GET',
  path: '/v2/profile/downloadProfileImage/{kpostID}',
  summary: 'Download a profile image',
  tags: [...READ_TAGS, 'image', 'binary'],
  productionSafe: true,
  envelope: false,
  // Returns whatever format was uploaded (png or jpeg), so the contract is `image/*`.
  contentType: 'image/*',
  // 200 (image) or 204 (no image) are both correct.
  expectedStatus: [200, 204],
  request: pathParams(() => ({ kpostID: testData.kpostId })),
  pathParamsSchema: pathParamSchema('kpostID'),
});

export const downloadFullProfileImageApi = defineProfileEndpoint({
  id: 'profile-download-full-image',
  method: 'GET',
  path: '/v2/profile/downloadFullProfileImage/{kpostID}',
  summary: 'Download a full-size profile image',
  tags: [...READ_TAGS, 'image', 'binary'],
  productionSafe: true,
  envelope: false,
  contentType: 'image/*',
  // 204 (no image) is correct — see downloadProfileImage above.
  expectedStatus: [200, 204],
  request: pathParams(() => ({ kpostID: testData.kpostId })),
  pathParamsSchema: pathParamSchema('kpostID'),
});

export const downloadCoverImageApi = defineProfileEndpoint({
  id: 'profile-download-cover',
  method: 'GET',
  path: '/v2/profile/downloadCoverImage/{kpostID}',
  summary: 'Download a cover image',
  tags: [...READ_TAGS, 'image', 'binary'],
  productionSafe: true,
  envelope: false,
  contentType: 'image/*',
  // 200 (image) or 204 (no cover image) are both correct.
  expectedStatus: [200, 204],
  request: pathParams(() => ({ kpostID: testData.kpostId })),
  pathParamsSchema: pathParamSchema('kpostID'),
});

export const getSignatureImageApi = defineProfileEndpoint({
  id: 'profile-get-signature',
  method: 'GET',
  path: '/v2/profile/getSignatureImage',
  summary: "Fetch the caller's signature image",
  tags: [...READ_TAGS, 'image', 'binary'],
  productionSafe: true,
  envelope: false,
  contentType: 'image/*',
  // No signature on the account answers 404, so 200/204/404 are all valid.
  expectedStatus: [200, 204, 404],
});

/**
 * Not in the workbook: the caller's full profile, read right after every login and by 16 other
 * screens. A bodyless GET; the caller comes from the token.
 */
export const getUserProfileApi = defineUndocumentedProfileEndpoint({
  id: 'profile-get-user-profile',
  method: 'GET',
  path: '/v2/profile/getUserProfile/',
  summary: "Fetch the caller's full profile (used immediately after login)",
  tags: [...READ_TAGS, 'pii'],
  evidence: 'Setting.js:345-371 (getUserProfileList), caller Login.js:1282 + 16 others',
  productionSafe: true,
  // Bodyless GET, so no requestSchema. Types-only response schema from a captured live body.
  responseSchema: typesOnlySchema({ data: {}, urlPath: '', status: 'SUCCESS', statusCode: 200 }),
});

export const profileReadApis = [
  fetchUserDetailsApi,
  getUserProfileApi,
  userProfileByKpostIdApi,
  userBasicByKpostIdApi,
  digitalCardApi,
  autoSearchApi,
  advancedSearchApi,
  getLanguagesApi,
  isDevicePrimaryApi,
  downloadProfileImageApi,
  downloadFullProfileImageApi,
  downloadCoverImageApi,
  getSignatureImageApi,
];
