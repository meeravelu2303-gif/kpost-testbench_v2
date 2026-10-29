import { testData } from '@config/test-data.config';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineUndocumentedKpostEndpoint, queryParams } from '../kpost-endpoint';
import { defineKallEndpoint } from './kall-endpoint';

/**
 * Kall reads. Log and contact reads run on live; `kallID`-keyed reads are `needs-kall-id` until the
 * lifecycle creates a call. POST reads set `destructive: false`.
 */
const READ_TAGS = ['kall-read'] as const;

export const kallDashboardApi = defineKallEndpoint({
  id: 'kall-dashboard',
  requirements: ['FR-KL-008'],
  method: 'POST',
  path: '/v2/kall/kallDashboard',
  summary: 'Recent calls for the caller — the Kall home panel',
  tags: [...READ_TAGS, 'log'],
  // Reads our own recent calls. `kallID: ""` means "the latest page", as the live client sends.
  destructive: false,
  productionSafe: true,
  request: body(() => ({ kallID: '' })),
});

export const todayKoolKallApi = defineKallEndpoint({
  id: 'kall-today-kool',
  requirements: ['FR-KL-002'],
  method: 'GET',
  path: '/v2/kall/todayKoolKall/',
  summary: "Today's scheduled (Kool) calls for the caller",
  tags: [...READ_TAGS, 'schedule'],
  productionSafe: true,
});

export const frequentKallContactsApi = defineKallEndpoint({
  id: 'kall-frequent-contacts',
  method: 'GET',
  path: '/v2/kall/frequentKallContacts',
  summary: 'Contacts the caller calls most often',
  tags: [...READ_TAGS, 'contacts'],
  productionSafe: true,
});

export const kallInfoApi = defineKallEndpoint({
  id: 'kall-info',
  requirements: ['FR-KL-008'],
  method: 'POST',
  path: '/v2/kall/kallInfo',
  summary: 'The call history with one contact',
  tags: [...READ_TAGS, 'log'],
  // History with our second account; `kallID: null` means all calls with this contact.
  destructive: false,
  productionSafe: true,
  request: body(() => ({ contactID: testData.victimKpostId, kallID: null })),
});

export const contactInfoApi = defineKallEndpoint({
  id: 'kall-contact-info',
  method: 'POST',
  path: '/v2/kall/contactInfo/',
  summary: "Contact details for the caller's call contacts",
  tags: [...READ_TAGS, 'contacts'],
  // Needs a `contactID` (an empty body 400s); sends our own second account.
  destructive: false,
  productionSafe: true,
  request: body(() => ({ contactID: testData.victimKpostId, kallID: null })),
  requestSchema: typesOnlySchema({ contactID: testData.victimKpostId, kallID: null }),
  note: 'needs a contactID in the body (empty body 400s "Malformed or missing request body")',
});

export const fetchScheduledRepeatKallApi = defineKallEndpoint({
  id: 'kall-fetch-scheduled-repeat',
  requirements: ['FR-KL-002'],
  method: 'POST',
  path: '/v2/kall/fetchScheduledRepeatKall',
  summary: "The caller's repeating scheduled calls from a start date",
  tags: [...READ_TAGS, 'schedule'],
  // Reads our own repeat schedules from a date. No identifier naming anyone else.
  destructive: false,
  productionSafe: true,
  request: body(() => ({ scheduledStartTime: '2024-06-14' })),
});

// Reads keyed by a real `kallID` we own; blocked on live until the lifecycle creates one.
export const getKallStatusApi = defineKallEndpoint({
  id: 'kall-get-status',
  requirements: ['FR-KL-008'],
  method: 'POST',
  path: '/v2/kall/getKallStatus',
  summary: 'The status of one call between a sender and receiver',
  tags: [...READ_TAGS, 'status', 'needs-kall-id'],
  request: body(() => ({
    sender: testData.kpostId,
    receiver: testData.victimKpostId,
    kallID: 0,
  })),
  note: 'needs a real kallID between the two accounts',
});

export const getKallStatusUsingKallIdApi = defineKallEndpoint({
  id: 'kall-get-status-by-id',
  requirements: ['FR-KL-008'],
  method: 'POST',
  path: '/v2/kall/getKallStatusUsingKallID',
  summary: 'The status of one call by its id',
  tags: [...READ_TAGS, 'status', 'needs-kall-id'],
  request: body(() => ({ kpostID: testData.kpostId, kallID: 0 })),
  note: 'needs a real kallID',
});

export const firebaseKallNotificationApi = defineUndocumentedKpostEndpoint({
  id: 'kall-firebase-notification-test',
  authentication: { required: true },
  method: 'GET',
  path: '/v2/firebase/notificationForKall',
  summary: 'Send a test incoming-call push to a user (a debug route left in the build)',
  tags: ['kall', 'kall-read', 'notification', 'security'],
  // Sends a real call push to every device of ANY receiver, with no check on who that is: never driven.
  destructive: true,
  sideEffect: 'external',
  request: queryParams(() => ({ receiver: testData.victimKpostId })),
  evidence:
    'FireBaseTestController.java:34 → FireBaseServiceImpl.java:568-606 (FCM call push to the receiver); no client calls it',
  note: 'security defect candidate: a debug controller in the QA build lets any user ring anyone’s phone — verify live with QA accounts only',
});

export const kallReadApis = [
  firebaseKallNotificationApi,
  kallDashboardApi,
  todayKoolKallApi,
  frequentKallContactsApi,
  kallInfoApi,
  contactInfoApi,
  fetchScheduledRepeatKallApi,
  getKallStatusApi,
  getKallStatusUsingKallIdApi,
];
