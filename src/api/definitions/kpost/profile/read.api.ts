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
  /*
   * The caller's OWN account, so the row is guaranteed to exist whenever the call succeeds — which
   * is what makes this the right endpoint to anchor the account check on. It confirms in
   * TBL_KPOST_USER_MASTER that the account behind a 200 is genuinely active: a deactivated account
   * and a healthy one return the same shape on the wire, and only `active_status` separates them.
   */
  database: { validations: ['kpost-user-active'] },
});

export const userProfileByKpostIdApi = defineProfileEndpoint({
  id: 'profile-user-profile-by-kpostid',
  // Confirms the account behind this profile is real and active in TBL_KPOST_USER_MASTER: an
  // empty 200 from a deactivated account is indistinguishable from 'no such user' on the wire.
  database: { validations: ['kpost-user-active'] },
  // KDirectory "view full profile" (FR-KD-005) — opening a directory entry's full profile.
  requirements: ['FR-KD-005'],
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/profile/getUserProfileUsingKpostID/',
  summary: 'Fetch a profile by KPost ID',
  tags: [...READ_TAGS, 'pii', 'enumeration-surface'],
  productionSafe: true,
  /*
   * Looks up the SECOND personal account, not our own (`testData.kpostId`), and the reason is a
   * product defect rather than a preference.
   *
   * `testData.kpostId` (the primary QA account) is answered `404 "No user found for the given
   * kpostID"` by this endpoint — while the row demonstrably exists: active in
   * TBL_KPOST_USER_MASTER, one row in TBL_KPOST_USER_PROFILE, present in both VW_KPOST_USER_DETAIL
   * and VW_KPOST_USER_MASTER, absent from TBL_KPOST_DEACTIVATED_DETAILS, and reachable through
   * `fetchUserDetails` (200) and `userLogin` (200) with the same credentials.
   *
   * It is NOT a self-lookup rule and NOT the privacy flag — both were tested and refuted:
   * a second account looking itself up succeeds, a third caller asking for THIS account still gets
   * 404, and three of four `privacy_status = 1` accounts answer 200. See
   * `tests/api/kpost/profile/directory-lookup.spec.ts`, which pins the behaviour so it stays
   * visible and gets filed instead of being hidden by this change.
   *
   * Pointing the contract probes at a resolvable account is what lets them exercise the endpoint's
   * real success path (schema, envelope, auth, headers) instead of reporting one 404 forty times
   * over and burying every other finding on it.
   */
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
  // The API returns `data` as an array of NAME STRINGS (autocomplete suggestions), but the workbook
  // response schema types the elements as objects — a documentation mismatch, not a product defect.
  // Skip the schema check here (the other validators still run); confirm the intended shape with the dev.
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
  // Every documented filter is sent so the payload matches the contract in full (an empty filter is
  // a no-op, exactly like omitting it, but a strict presence check on the API cannot then 400 us —
  // the missing-field class that filed a false bug on the KMail signature). Values are empty, so no
  // real person or place is named.
  request: body(() => ({
    fullName: 'qa',
    mobileNumber: '',
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
  // The endpoint returns the format the user uploaded (png OR jpeg), so `image/*` is the real
  // contract — hard-coding `image/png` filed a false content-type bug on a JPEG.
  contentType: 'image/*',
  // 204 (no image present) is a CORRECT response, not a defect — the QA account may have no image.
  // Only 200 (image) or 204 (none) are valid; a 500 here would (rightly) still fail.
  expectedStatus: [200, 204],
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
  contentType: 'image/*',
  // 204 (no image) is correct — see downloadProfileImage above.
  expectedStatus: [200, 204],
  request: pathParams(() => ({ kpostID: testData.kpostId })),
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
  // 204 (no cover image) is correct. The old 500-on-no-image is fixed on the test build (now 204);
  // 200 (image) / 204 (none) are the valid responses.
  expectedStatus: [200, 204],
  request: pathParams(() => ({ kpostID: testData.kpostId })),
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
  // No signature on the account answers 404 (a missing resource); 200/204/404 are all valid. (A
  // sibling image read returns 204 for "none" — the 404-vs-204 inconsistency is a minor note, not a
  // fileable CRITICAL.)
  expectedStatus: [200, 204, 404],
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
