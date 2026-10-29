import { testData } from '@config/test-data.config';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineKpostEndpoint, defineUndocumentedKpostEndpoint } from '../kpost-endpoint';
import { sendShape } from '../katchup/send.api';

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

export const publicSendMessageApi = defineUndocumentedKpostEndpoint({
  id: 'common-send-message',
  method: 'POST',
  path: '/v2/common/sendMessage',
  summary: 'Send a Katchup message without a login (the app’s "hidden sender" path)',
  tags: ['common', 'katchup', 'katchup-send', 'security'],
  // Public: the sender comes from the BODY. QA sender and QA receiver only; writes a real message.
  authentication: { required: false },
  destructive: true,
  sideEffect: 'data',
  request: body(() => sendShape({ sender: testData.kpostId })),
  requestSchema: typesOnlySchema(sendShape({ sender: testData.kpostId })),
  evidence:
    'CommonControllerV2.java:874 sendMessage (public under /v2/common/**, SecurityConfiguration:67); ' +
    'Flutter katchup_api.dart:1310-1328 sendMessageCommon from katchup_message_controller.dart:4335-4375',
  note:
    'security defect candidate: no token, sender taken from the body, so anyone can send as anyone ' +
    '(the authenticated /v2/katchup/sendMessage takes the sender from the token) — verify live with ' +
    'QA accounts before filing',
});

export const publicKeyApi = defineUndocumentedKpostEndpoint({
  id: 'crypto-public-key',
  // Live: a public key, by definition safe to read; no identifier at all.
  productionSafe: true,
  method: 'GET',
  path: '/crypto/public-key',
  summary: 'The server’s RSA public key for payload encryption (Base64 text)',
  tags: ['common', 'common-platform', 'platform', 'security'],
  envelope: false,
  contentType: 'text/plain',
  evidence: 'CryptoController.java:16-25 (public under /crypto/**, SecurityConfiguration:72)',
  note: 'payload encryption is off (security.payload.enabled=false), so no client calls it today',
});

export const platformApis = [
  msStatusApi,
  flutterAppVersionApi,
  updateFlutterAppVersionApi,
  saveEnquiryDetailsApi,
  totalCountByDateApi,
  publicSendMessageApi,
  publicKeyApi,
];
