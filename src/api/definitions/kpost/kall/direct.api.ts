import { KALL_MODE, KALL_STATUS, KALL_TYPE } from '@api/schemas/kpost-types';
import { testData } from '@config/test-data.config';
import { body } from '../kpost-endpoint';
import { defineKallEndpoint } from './kall-endpoint';

/**
 * Kall **direct-call** writes — placing a normal (ad-hoc) call and moving it through its status
 * lifecycle, plus clearing the call log.
 *
 * Every one is a write and **none is `productionSafe`**. `initiateKall` rings the receiver's device
 * in real time — a real-time side effect on a real recipient, even our own second account — so it is
 * treated like a Katchup send: `data` + destructive, exercised only through the gated feature flow
 * (`docs/kall-flow.md` §5, `KALL_LIFECYCLE=true`) with `allowLiveWrite`, never by the engine. The
 * clear endpoints delete the caller's own log and are gated for the same reason.
 */
const DIRECT_TAGS = ['kall-direct'] as const;

const now = (): number => Date.now();

/**
 * The live client's `initiateKall` object for a normal 1:1 audio call to our own second account.
 *
 * Exported so the feature spec builds every variant (audio/video, status transitions) from one
 * source rather than hand-copying the payload per case.
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
  requirements: ['FR-C05', 'FR-C06'],
  method: 'POST',
  path: '/v2/kall/initiateKall',
  summary: 'Place a normal (ad-hoc) call',
  tags: [...DIRECT_TAGS, 'critical'],
  /*
   * Rings a real device in real time. `data`+destructive to our own second account, cleaned up by
   * the lifecycle test (end → clear). NOT cleared for live — a fuzzed `receiver`/`kallMode` would
   * ring a stranger. Payload is the live client's (flow doc §3).
   */
  destructive: true,
  request: body(() => initiateShape()),
});

export const updateKallStatusApi = defineKallEndpoint({
  id: 'kall-update-status',
  requirements: ['FR-C08', 'BR-C01'],
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
  requirements: ['FR-C08'],
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
  requirements: ['FR-C08'],
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
  /*
   * Deletes rows from our own call log. `data`+destructive. The `kallIds` are real ids the caller
   * owns; on live the guard would refuse fabricated ones (`[2,3]` are strangers' calls), which is
   * why this runs only through the lifecycle flow with ids it just created.
   */
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
  /*
   * A GET that DELETES the whole call log for the caller. Token-scoped (only our own history), but
   * destructive and irreversible, so `data`+destructive and never cleared for live — a default run
   * must not wipe the QA account's log.
   */
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
