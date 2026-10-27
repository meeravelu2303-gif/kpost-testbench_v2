import { typesOnlySchema } from '@api/schema/sample-schema';
import { body } from '../kpost-endpoint';
import { defineKdiaryEndpoint } from './kdiary-endpoint';

/** KDiary reads of the caller's own diary, all run on live. POST reads set `destructive: false`. */
const READ_TAGS = ['kdiary-read'] as const;

export const todaySchedulesApi = defineKdiaryEndpoint({
  id: 'kdiary-today-schedules',
  method: 'GET',
  path: '/dairySchedule/getTodaySchedules',
  summary: "Today's diary schedules for the caller",
  tags: [...READ_TAGS, 'schedule'],
  productionSafe: true,
});

export const getEventsApi = defineKdiaryEndpoint({
  id: 'kdiary-get-events',
  method: 'GET',
  path: '/dairySchedule/getEvents',
  summary: 'All diary events for the caller',
  tags: [...READ_TAGS, 'event'],
  productionSafe: true,
  // Types-only, from a captured live body.
  responseSchema: typesOnlySchema({ data: [], urlPath: '', status: 'SUCCESS', statusCode: 200 }),
});

export const todayReportApi = defineKdiaryEndpoint({
  id: 'kdiary-today-report',
  method: 'GET',
  path: '/dairySchedule/getTodayReport',
  summary: "Today's diary report for the caller",
  tags: [...READ_TAGS, 'report'],
  productionSafe: true,
  // 404 "No report found for today" is a valid empty state (the caller has no diary report today).
  expectedStatus: [200, 404],
});

export const getEventDateApi = defineKdiaryEndpoint({
  id: 'kdiary-get-event-date',
  method: 'POST',
  path: '/dairySchedule/getEventDate',
  summary: 'Event details for a list of eventIDs',
  tags: [...READ_TAGS, 'event', 'needs-id'],
  destructive: false,
  // The required field is `eventIds` (KdiaryRO.java). No frontend caller, and the server reads the
  // events without checking ownership.
  request: body(() => ({ eventIds: [0] })),
  requestSchema: typesOnlySchema({ eventIds: [0] }),
  note: 'needs a real eventID; CONFIRMED cross-tenant read-IDOR (no ownership check) — see tests/api/kpost/security/kdiary-object-authorization.spec.ts',
});

export const getEventSelectedDateApi = defineKdiaryEndpoint({
  id: 'kdiary-get-event-selected-date',
  method: 'POST',
  path: '/dairySchedule/getEventSelectedDate',
  summary: "The caller's diary events on a selected date",
  tags: [...READ_TAGS, 'event'],
  destructive: false,
  productionSafe: true,
  // 204 (no events on the selected date) is valid.
  expectedStatus: [200, 204],
  // Live client (Diary.js GetDiaryScheduleBySelectedDate): the date range is start + (null) end.
  request: body(() => ({
    scheduleStartDateAndTime: '2026-09-14',
    scheduleEndDateAndTime: null,
  })),
  requestSchema: typesOnlySchema({
    scheduleStartDateAndTime: '2026-09-14',
    scheduleEndDateAndTime: null,
  }),
  note: 'body matches the live client (start date + null end); verified against the frontend',
});

export const kdiaryReadApis = [
  todaySchedulesApi,
  getEventsApi,
  todayReportApi,
  getEventDateApi,
  getEventSelectedDateApi,
];
