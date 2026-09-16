import { testData } from '@config/test-data.config';
import { body } from '../kpost-endpoint';
import { defineKallEndpoint } from './kall-endpoint';

/**
 * Kall **reads** — the call log, today's scheduled calls, frequent contacts, and status lookups.
 *
 * The log/contact reads need only our own account, so they run on live. The two `kallID`-keyed
 * status reads need a real call id we do not have on live (a fabricated one would 404 or name a
 * stranger's call), so they stay registered and blocked, tagged `needs-kall-id`, until the write
 * lifecycle (`docs/kall-flow.md` §5) creates one. All are POST reads except the two GETs, so each
 * POST states `destructive: false` — without it the resolved endpoint defaults destructive true for
 * POST, is tagged `@destructive`, and the production `grepInvert` silently drops every one of its
 * tests (see the Dashboard decision-log entry).
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
  /*
   * The contact is our own second account, so this reads a history we are a party to. `kallID: null`
   * means "all calls with this contact", exactly as the client sends on first open.
   */
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
  /*
   * The workbook documents no payload, so the central empty-body and null probes carry the load. It
   * reads our own contacts, so it owns nothing and is cleared for live.
   */
  destructive: false,
  productionSafe: true,
  note: 'workbook documents no request body',
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

/*
 * Reads keyed by a real `kallID` we own. Blocked on live until the lifecycle test creates one — a
 * fabricated id would 404 or name a stranger's call. Tagged `needs-kall-id`.
 */
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

export const kallReadApis = [
  kallDashboardApi,
  todayKoolKallApi,
  frequentKallContactsApi,
  kallInfoApi,
  contactInfoApi,
  fetchScheduledRepeatKallApi,
  getKallStatusApi,
  getKallStatusUsingKallIdApi,
];
