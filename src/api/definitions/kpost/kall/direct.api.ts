import { KALL_MODE, KALL_STATUS, KALL_TYPE } from '@api/contract/kpost-types';
import { testData } from '@config/test-data.config';
import { body } from '../kpost-endpoint';
import { defineKallEndpoint } from './kall-endpoint';

/**
 * Kall direct-call writes: place a call, move it through its statuses, clear the log. None is
 * `productionSafe`; `initiateKall` rings a real device, so only the gated KALL_LIFECYCLE flow
 * drives them.
 */
const DIRECT_TAGS = ['kall-direct'] as const;

const now = (): number => Date.now();

/**
 * The live client's `initiateKall` object for a 1:1 audio call to our second account; shared by
 * every variant.
 */
export function initiateShape(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    receiver: testData.victimKpostId,
    kallMode: KALL_MODE.audio,
    kallType: KALL_TYPE.normal,
    kallStatus: KALL_STATUS.new,
    kallSession: `qa-bench-kall-${now()}`,
    kallStartTime: now(),
    ...overrides,
  };
}

export const initiateKallApi = defineKallEndpoint({
  id: 'kall-initiate',
  requirements: ['FR-KL-005', 'FR-KL-006'],
  method: 'POST',
  path: '/v2/kall/initiateKall',
  summary: 'Place a normal (ad-hoc) call',
  tags: [...DIRECT_TAGS, 'critical'],
  // Rings a real device; never cleared for live, since a fuzzed `receiver` would ring a stranger.
  destructive: true,
  request: body(() => initiateShape()),
});

export const updateKallStatusApi = defineKallEndpoint({
  id: 'kall-update-status',
  requirements: ['FR-KL-008', 'FR-KL-004'],
  method: 'POST',
  path: '/v2/kall/updateKallStatus',
  summary: 'Move a call to a new status (connected, declined, cancelled…)',
  tags: [...DIRECT_TAGS, 'status'],
  destructive: true,
  request: body(() => ({ id: 0, kallStatus: KALL_STATUS.cancelled, kallID: 0 })),
  note: 'needs a real kallID from initiateKall; exercised by the lifecycle flow',
});

export const updateSenderAndReceiverKallStatusApi = defineKallEndpoint({
  id: 'kall-update-sender-receiver-status',
  requirements: ['FR-KL-008'],
  method: 'POST',
  path: '/v2/kall/updateSenderAndReceiverKallStatus',
  summary: 'Set a call status for both sender and receiver',
  tags: [...DIRECT_TAGS, 'status'],
  destructive: true,
  request: body(() => ({
    sender: testData.kpostId,
    kallStatus: KALL_STATUS.cancelled,
    kallID: 0,
  })),
  note: 'needs a real kallID; exercised by the lifecycle flow',
});

export const endIndividualKallApi = defineKallEndpoint({
  id: 'kall-end-individual',
  requirements: ['FR-KL-008'],
  method: 'POST',
  path: '/v2/kall/endIndividualKall/',
  summary: 'End an ongoing normal call',
  tags: [...DIRECT_TAGS, 'status'],
  destructive: true,
  request: body(() => ({ kallID: 0 })),
  note: 'needs a real kallID from initiateKall; exercised by the lifecycle flow',
});

export const clearKallByIdsApi = defineKallEndpoint({
  id: 'kall-clear-by-ids',
  method: 'POST',
  path: '/v2/kall/clearKallBykallIds',
  summary: 'Clear specific calls from the caller log by id',
  tags: [...DIRECT_TAGS, 'clear'],
  // Deletes our own call-log rows; only the lifecycle flow runs it, with ids it just created.
  destructive: true,
  request: body(() => ({ kallIds: [] as number[] })),
  note: 'deletes from the caller own log; lifecycle-only',
});

export const clearKallHistoryApi = defineKallEndpoint({
  id: 'kall-clear-history',
  method: 'GET',
  path: '/v2/kall/clearKallHistory',
  summary: "Clear the caller's entire call history",
  tags: [...DIRECT_TAGS, 'clear'],
  // A GET that irreversibly deletes the caller's whole call log, so it is never cleared for live.
  destructive: true,
  note: 'GET that clears the entire caller history; never run on a default live pass',
});

export const kallDirectApis = [
  initiateKallApi,
  updateKallStatusApi,
  updateSenderAndReceiverKallStatusApi,
  endIndividualKallApi,
  clearKallByIdsApi,
  clearKallHistoryApi,
];
