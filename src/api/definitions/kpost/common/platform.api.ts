import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint } from '../kpost-endpoint';

/**
 * Platform and back-office endpoints that happen to live under `/common`: service status, the
 * mobile app's version gate, enquiry and unsubscribe capture, and a usage count.
 *
 * Two of them deserve attention rather than a routine pass:
 *
 * - `updateFlutterAppVersion` **changes what every mobile client is told to install**, with no
 *   token. A wrong value here is a production incident, not a test failure, so it is destructive.
 * - `saveEnquiryDetails` and `saveUnsubscriberDetails` are public write endpoints: anyone can
 *   insert rows. They are the natural target for spam and injection, which is what the central
 *   validators probe.
 */
export const msStatusApi = defineKpostEndpoint({
  id: 'common-ms-status',
  // Live: Service status. No payload, no identifier, no write.
  productionSafe: true,
  method: 'GET',
  path: '/v2/common/msStatus/',
  summary: 'Microservice health status',
  tags: ['common', 'common-platform'],
  /*
   * The cheapest possible reachability check, and the only common endpoint whose documented response
   * is just `{ status }`. The run-level "is the API up?" smoke check lives in the curated smoke spec
   * (tests/api/smoke.spec.ts); `@smoke` is reserved for run levels, so it is NOT an endpoint tag here.
   * (Live this returns plaintext `SUCCESS` instead of the documented `{ status }` JSON — an API
   * contract drift the engine surfaces for the normal review workflow; not suppressed, not filed here.)
   */
  destructive: false,
});

export const flutterAppVersionApi = defineKpostEndpoint({
  id: 'common-flutter-app-version',
  // Live: Reads the published version. The WRITE twin stays blocked.
  productionSafe: true,
  method: 'GET',
  path: '/v2/common/getFlutterAppVersion/',
  summary: 'Current required mobile app version',
  tags: ['common', 'common-platform'],
  destructive: false,
});

export const updateFlutterAppVersionApi = defineKpostEndpoint({
  id: 'common-update-flutter-app-version',
  method: 'POST',
  path: '/v2/common/updateFlutterAppVersion',
  summary: 'Set the required mobile app version',
  tags: ['common', 'common-platform', 'privileged-write'],
  // Public, unauthenticated, and it drives every mobile client's upgrade prompt.
  destructive: true,
  sideEffect: 'global',
  request: body(() => ({ currentVersion: '1.0.35:117' })),
});

export const saveEnquiryDetailsApi = defineKpostEndpoint({
  id: 'common-save-enquiry-details',
  method: 'POST',
  path: '/v2/common/saveEnquiryDetails',
  summary: 'Capture a sales enquiry',
  tags: ['common', 'common-platform', 'public-write'],
  destructive: true,
  // Confirmed live 2026-09-30: the server's own 400 spells out the full required set —
  // "companyName, entity, maximumMembersCount, firstName, lastName, designation, mobileNumber,
  // email and timeToContact are required". This definition was missing `timeToContact`, so the
  // "primary" request was never actually well-formed — a bench fixture bug, not a product defect
  // (it produced a false CRITICAL "expected 200, got 400" candidate before this fix).
  request: body(() => ({
    companyName: testData.companyNameAbsent,
    entity: 'Cake Shop',
    maximumMembersCount: 10,
    firstName: 'QA',
    lastName: 'Bench',
    designation: 'CEO',
    mobileNumber: testData.otpMobile,
    email: testData.otpEmail,
    timeToContact: '10:00 AM',
  })),
});

/*
 * `saveUnsubscriberDetails` is NOT a KPost API endpoint — it belongs to KMail. It was defined here
 * against the KPost API host (`/v2/common/saveUnsubscriberDetails` on testingapi.kpostindia.com),
 * which does not serve it, so every call 404'd — a wrong-service artifact tracked as #725 (KP-D25BBE),
 * closed WORKSFORME 2026-10-12. The real endpoint is KMail's CommonMailController
 * (`@RequestMapping("v2/common")` + `@PostMapping("/saveUnsubscriberDetails")`):
 *   https://testkmail.kpostindia.com/testkmail/v2/common/saveUnsubscriberDetails
 * The KPost React frontend never calls it (it is a server-side email-footer unsubscribe endpoint).
 * Removed from the KPost API here; add it to the KMail suite (defineKmailEndpoint, path
 * '/common/saveUnsubscriberDetails') with a verified KmailUnsubscriber body if KMail coverage is wanted.
 */

export const totalCountByDateApi = defineKpostEndpoint({
  id: 'common-total-count-by-date',
  // Live: Aggregate read keyed by a date, not by an identifier.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/getTotalCountByDate',
  summary: 'Usage totals for a date',
  tags: ['common', 'common-platform', 'reporting'],
  destructive: false,
  // The common module defaults to public, but this one answers 401 "Login required" without a token
  // (measured 2026-10-09). Declared public, the bench sent no token and filed that 401 as a defect.
  authentication: { required: true },
  // Epoch milliseconds, as documented. Midnight today keeps the query deterministic.
  request: body(() => ({ date: new Date(new Date().toDateString()).getTime() })),
});

export const platformApis = [
  msStatusApi,
  flutterAppVersionApi,
  updateFlutterAppVersionApi,
  saveEnquiryDetailsApi,
  totalCountByDateApi,
];
