import { KALL_MODE, KALL_REPEAT_TYPE } from '@api/schemas/kpost-types';
import { testData } from '@config/test-data.config';
import { body } from '../kpost-endpoint';
import { defineKallEndpoint } from './kall-endpoint';

/**
 * Kall **scheduled-call (Kool Kall)** writes — scheduling a call for later, rescheduling it
 * (BR-C01: the status tag moves `Scheduled → Rescheduled` while the entry keeps its identity),
 * joining, ending, repeat scheduling, and modifying the member list.
 *
 * Every one is a write and **none is `productionSafe`**: scheduling notifies the participants and
 * puts an entry on their calendars, so it is treated like a Katchup send — exercised only through
 * the gated feature flow (`docs/kall-flow.md` §5, `KALL_LIFECYCLE=true`) with `allowLiveWrite`.
 * Payloads mirror the live web client (`Services/Kall.js`).
 */
const SCHEDULE_TAGS = ['kall-schedule'] as const;

const now = (): number => Date.now();

/**
 * The live client's `scheduledKall` object — a one-off audio Kool Kall to our own second account.
 *
 * `repeatedDate` is a **stringified JSON** object (not a nested object), exactly as the client
 * sends it. Exported so `reScheduleKall` and the feature spec build from one source.
 */
export function scheduleShape(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const start = now() + 3_600_000; // an hour out, so it is a real future slot
  return {
    kallSession: `qa-bench-kool-${now()}`,
    kallMode: KALL_MODE.audio,
    subject: 'QA Bench scheduled call — safe to ignore',
    scheduledStartTime: start,
    scheduledEndTime: start + 1_800_000,
    meetingLink: 'www.jitsi.com',
    repeatType: KALL_REPEAT_TYPE.none,
    repeatedDate: null,
    kallDetails: [{ receiver: testData.victimKpostId }],
    ...overrides,
  };
}

export const scheduledKallApi = defineKallEndpoint({
  id: 'kall-scheduled',
  requirements: ['FR-C01', 'FR-C02'],
  method: 'POST',
  path: '/v2/kall/scheduledKall',
  summary: 'Schedule a call (Kool Kall) for later',
  tags: [...SCHEDULE_TAGS, 'critical'],
  // Notifies the participants and puts an entry on their calendars. Lifecycle-only.
  destructive: true,
  request: body(() => scheduleShape()),
});

export const reScheduleKallApi = defineKallEndpoint({
  id: 'kall-reschedule',
  requirements: ['FR-C03', 'BR-C01'],
  method: 'POST',
  path: '/v2/kall/reScheduleKall',
  summary: 'Reschedule an existing scheduled call (Scheduled → Rescheduled)',
  tags: [...SCHEDULE_TAGS, 'critical'],
  /*
   * BR-C01: the entry keeps its identity (its `kallID`) while the status tag moves to Rescheduled.
   * Needs a real `kallID` from `scheduledKall`, so it is exercised by the lifecycle flow.
   */
  destructive: true,
  request: body(() => scheduleShape({ kallID: 0 })),
  note: 'needs a real kallID from scheduledKall; exercised by the lifecycle flow',
});

export const joinScheduleKallApi = defineKallEndpoint({
  id: 'kall-join-schedule',
  requirements: ['FR-C04'],
  method: 'POST',
  path: '/v2/kall/joinScheduleKall',
  summary: 'Join a scheduled call',
  tags: [...SCHEDULE_TAGS, 'status'],
  destructive: true,
  request: body(() => ({ id: 0, kallID: 0 })),
  note: 'needs a real kallID; exercised by the lifecycle flow',
});

export const endKoolKallApi = defineKallEndpoint({
  id: 'kall-end-kool',
  requirements: ['FR-C08'],
  method: 'POST',
  path: '/v2/kall/endKoolKall',
  summary: 'End a scheduled (Kool) call',
  tags: [...SCHEDULE_TAGS, 'status'],
  destructive: true,
  request: body(() => ({ id: 0, kallID: 0 })),
  note: 'needs a real kallID; exercised by the lifecycle flow',
});

export const scheduledRepeatKallApi = defineKallEndpoint({
  id: 'kall-scheduled-repeat',
  requirements: ['FR-C02'],
  method: 'POST',
  path: '/v2/kall/scheduledRepeatKall',
  summary: 'Create a repeating scheduled call',
  tags: [...SCHEDULE_TAGS, 'schedule'],
  /*
   * The workbook documents no payload; the client reuses the schedule shape with a non-none
   * `repeatType` and a `repeatedDate` range. Destructive, lifecycle-only.
   */
  destructive: true,
  request: body(() =>
    scheduleShape({
      repeatType: KALL_REPEAT_TYPE.daily,
      repeatedDate: JSON.stringify({ start_date: '2026-09-14', end_date: '2026-09-20' }),
    }),
  ),
  note: 'workbook documents no request body; shape taken from the live client',
});

export const modifyKallMembersApi = defineKallEndpoint({
  id: 'kall-modify-members',
  requirements: ['FR-C07'],
  method: 'POST',
  path: '/v2/kall/modifyKallMembers',
  summary: 'Add or remove members on a scheduled call',
  tags: [...SCHEDULE_TAGS, 'members'],
  /*
   * The `addingUserIds` / `removingUserIds` are participant kpostIDs — the guard checks each element,
   * so on live they must be our own accounts. Needs a real `kallID`, so lifecycle-only.
   */
  destructive: true,
  request: body(() => ({
    kallID: 0,
    addingUserIds: [testData.victimKpostId],
    removingUserIds: [] as string[],
  })),
  note: 'needs a real kallID; exercised by the lifecycle flow',
});

export const kallScheduleApis = [
  scheduledKallApi,
  reScheduleKallApi,
  joinScheduleKallApi,
  endKoolKallApi,
  scheduledRepeatKallApi,
  modifyKallMembersApi,
];
