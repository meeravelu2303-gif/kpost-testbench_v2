import { KALL_MODE, KALL_REPEAT_TYPE } from '@api/contract/kpost-types';
import { testData } from '@config/test-data.config';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { body } from '../kpost-endpoint';
import { defineKallEndpoint } from './kall-endpoint';

/**
 * Kall scheduled-call (Kool Kall) writes: schedule, reschedule, join, end, repeat, members. None is
 * `productionSafe` (it notifies participants); the gated KALL_LIFECYCLE flow drives them.
 */
const SCHEDULE_TAGS = ['kall-schedule'] as const;

const now = (): number => Date.now();

/**
 * The live client's `scheduledKall` object for a one-off audio call; `repeatedDate` is stringified
 * JSON, as the client sends it.
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
  requirements: ['FR-KL-001', 'FR-KL-002'],
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
  requirements: ['FR-KL-003', 'FR-KL-004'],
  method: 'POST',
  path: '/v2/kall/reScheduleKall',
  summary: 'Reschedule an existing scheduled call (Scheduled → Rescheduled)',
  tags: [...SCHEDULE_TAGS, 'critical'],
  // Needs a real `kallID` from `scheduledKall`, so the lifecycle flow drives it.
  destructive: true,
  request: body(() => scheduleShape({ kallID: 0 })),
  note: 'needs a real kallID from scheduledKall; exercised by the lifecycle flow',
});

export const joinScheduleKallApi = defineKallEndpoint({
  id: 'kall-join-schedule',
  requirements: ['FR-KL-004'],
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
  requirements: ['FR-KL-008'],
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
  requirements: ['FR-KL-002'],
  method: 'POST',
  path: '/v2/kall/scheduledRepeatKall',
  summary: 'Create a repeating scheduled call',
  tags: [...SCHEDULE_TAGS, 'schedule'],
  // The client reuses the schedule shape with a `repeatType` and a `repeatedDate` range.
  destructive: true,
  request: body(() =>
    scheduleShape({
      repeatType: KALL_REPEAT_TYPE.daily,
      repeatedDate: JSON.stringify({ start_date: '2026-09-14', end_date: '2026-09-20' }),
    }),
  ),
  requestSchema: typesOnlySchema(
    scheduleShape({
      repeatType: KALL_REPEAT_TYPE.daily,
      repeatedDate: JSON.stringify({ start_date: '2026-09-14', end_date: '2026-09-20' }),
    }),
  ),
  note: 'workbook documents no request body; shape taken from the live client',
});

export const modifyKallMembersApi = defineKallEndpoint({
  id: 'kall-modify-members',
  requirements: ['FR-KL-007'],
  method: 'POST',
  path: '/v2/kall/modifyKallMembers',
  summary: 'Add or remove members on a scheduled call',
  tags: [...SCHEDULE_TAGS, 'members'],
  // The guard checks every participant id, so they must be our own accounts. Needs a real `kallID`.
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
