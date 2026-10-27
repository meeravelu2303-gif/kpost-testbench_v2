import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint } from '../kpost-endpoint';

/**
 * Platform endpoints under `/common`: service status, the mobile version gate, enquiry capture and
 * a usage count. `updateFlutterAppVersion` changes every mobile client's upgrade prompt, so it is
 * destructive.
 */
export const msStatusApi = defineKpostEndpoint({
  id: 'common-ms-status',
  // Live: Service status. No payload, no identifier, no write.
  productionSafe: true,
  method: 'GET',
  path: '/v2/common/msStatus/',
  summary: 'Microservice health status',
  tags: ['common', 'common-platform'],
  // The cheapest reachability check. Not tagged `@smoke`: that tag is reserved for run levels.
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
  // Every field the server requires, `timeToContact` included.
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

// `saveUnsubscriberDetails` belongs to KMail (`/common/saveUnsubscriberDetails`), not the KPost
// API.

export const totalCountByDateApi = defineKpostEndpoint({
  id: 'common-total-count-by-date',
  // Live: Aggregate read keyed by a date, not by an identifier.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/getTotalCountByDate',
  summary: 'Usage totals for a date',
  tags: ['common', 'common-platform', 'reporting'],
  destructive: false,
  // Unlike the rest of the common module, this one requires a token.
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
