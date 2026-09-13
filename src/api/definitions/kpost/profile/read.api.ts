import { testData } from '@config/test-data.config';
import { body, pathParams } from '../kpost-endpoint';
import { defineProfileEndpoint } from './profile-endpoint';

/**
 * Profile **reads** — fetch a profile, search, digital card, languages, device state.
 *
 * All run on live: each is asked with OUR OWN kpostID / mobile, or a harmless search term, so no
 * identifier naming a stranger is sent. `getUserProfileUsingKpostID` and the search endpoints are
 * an information-disclosure surface (they return another person's profile from a kpostID/name), so
 * the central sensitive-data and info-disclosure validators examine them — asked with our own id.
 */
const READ_TAGS = ['profile-read'] as const;

export const fetchUserDetailsApi = defineProfileEndpoint({
  id: 'profile-fetch-user-details',
  // FINDING: the workbook documents POST; the live API answers only GET (POST -> 405). Verified on
  // devapi2. `contractMethod` keeps the schema from the documented POST row.
  method: 'GET',
  contractMethod: 'POST',
  path: '/v2/profile/fetchUserDetails/',
  summary: "Fetch the caller's profile details",
  tags: [...READ_TAGS, 'pii'],
  productionSafe: true,
});

export const userProfileByKpostIdApi = defineProfileEndpoint({
  id: 'profile-user-profile-by-kpostid',
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/profile/getUserProfileUsingKpostID/',
  summary: 'Fetch a profile by KPost ID',
  tags: [...READ_TAGS, 'pii', 'enumeration-surface'],
  productionSafe: true,
  request: body(() => ({ kpostID: testData.kpostId })),
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
  request: body(() => ({
    fullName: 'qa',
    mobileNumber: '',
    gender: null,
    ageFrom: null,
    ageTo: null,
    profession: null,
  })),
});

export const getLanguagesApi = defineProfileEndpoint({
  id: 'profile-get-languages',
  method: 'GET',
  path: '/v2/profile/getlanguages/',
  summary: 'Languages the caller can pick for their profile',
  tags: [...READ_TAGS, 'reference'],
  /*
   * FINDING: neither verb works on live — GET answers 405, POST answers 500. The documented GET is
   * kept (the workbook's method), so the endpoint reports the 405 rather than being silently dropped.
   */
  productionSafe: true,
  note: 'GET -> 405 and POST -> 500 on live; no working verb found',
});

export const isDevicePrimaryApi = defineProfileEndpoint({
  id: 'profile-is-device-primary',
  // FINDING: workbook documents POST; the live API answers only GET (POST -> 405). Verified on devapi2.
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
  contentType: 'image/png',
  request: pathParams(() => ({ kpostID: testData.kpostId })),
});

export const downloadFullProfileImageApi = defineProfileEndpoint({
  id: 'profile-download-full-image',
  method: 'GET',
  path: '/v2/profile/downloadFullProfileImage/{kpostID}',
  summary: 'Download a full-size profile image',
  tags: [...READ_TAGS, 'image', 'binary'],
  productionSafe: true,
  envelope: false,
  contentType: 'image/png',
  request: pathParams(() => ({ kpostID: testData.kpostId })),
});

export const downloadCoverImageApi = defineProfileEndpoint({
  id: 'profile-download-cover',
  method: 'GET',
  path: '/v2/profile/downloadCoverImage/{kpostID}',
  summary: 'Download a cover image',
  tags: [...READ_TAGS, 'image', 'binary'],
  /*
   * FINDING: answers HTTP 500 when the account has no cover image, where its sibling
   * `downloadProfileImage` correctly answers 204. A missing image is not a server fault — this
   * should be 204/404. Verified on devapi2. The status-code validator keeps it red.
   */
  productionSafe: true,
  envelope: false,
  contentType: 'image/png',
  request: pathParams(() => ({ kpostID: testData.kpostId })),
  note: 'downloadCoverImage -> 500 with no cover image (downloadProfileImage -> 204)',
});

export const getSignatureImageApi = defineProfileEndpoint({
  id: 'profile-get-signature',
  method: 'GET',
  path: '/v2/profile/getSignatureImage',
  summary: "Fetch the caller's signature image",
  tags: [...READ_TAGS, 'image', 'binary'],
  productionSafe: true,
  envelope: false,
  contentType: 'image/png',
});

export const profileReadApis = [
  fetchUserDetailsApi,
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
