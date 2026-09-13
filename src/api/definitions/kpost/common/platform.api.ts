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
  tags: ['common', 'common-platform', 'smoke'],
  /*
   * The cheapest possible reachability check, and the only common endpoint whose documented
   * response is just `{ status }`. Tagged smoke so `--grep @smoke` answers "is the API up?"
   * without sending an SMS or touching data.
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
  request: body(() => ({
    companyName: testData.companyNameAbsent,
    entity: 'Cake Shop',
    maximumMembersCount: 10,
    firstName: 'QA',
    lastName: 'Bench',
    designation: 'CEO',
    mobileNumber: testData.otpMobile,
    email: testData.otpEmail,
  })),
});

export const saveUnsubscriberDetailsApi = defineKpostEndpoint({
  id: 'common-save-unsubscriber-details',
  method: 'POST',
  path: '/v2/common/saveUnsubscriberDetails',
  summary: 'Record an unsubscribe request',
  tags: ['common', 'common-platform', 'public-write'],
  destructive: true,
  request: body(() => ({
    sender: testData.kpostId,
    receiver: testData.otpEmail,
    reason: 'QA bench unsubscribe check',
    createdBy: testData.kpostId,
  })),
});

export const totalCountByDateApi = defineKpostEndpoint({
  id: 'common-total-count-by-date',
  // Live: Aggregate read keyed by a date, not by an identifier.
  productionSafe: true,
  method: 'POST',
  path: '/v2/common/getTotalCountByDate',
  summary: 'Usage totals for a date',
  tags: ['common', 'common-platform', 'reporting'],
  destructive: false,
  // Epoch milliseconds, as documented. Midnight today keeps the query deterministic.
  request: body(() => ({ date: new Date(new Date().toDateString()).getTime() })),
});

export const platformApis = [
  msStatusApi,
  flutterAppVersionApi,
  updateFlutterAppVersionApi,
  saveEnquiryDetailsApi,
  saveUnsubscriberDetailsApi,
  totalCountByDateApi,
];
