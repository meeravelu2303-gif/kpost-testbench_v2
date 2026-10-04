import { body } from '../kpost-endpoint';
import { defineKdiaryEndpoint } from './kdiary-endpoint';

/**
 * KDiary **reads** — today's schedules, all events, today's report, and events by date. Each reads
 * only the caller's own diary, so all run on live. The date the client sends matches the create
 * field name (`scheduleStartDateAndTime`); the workbook documents no body, so the empty-body and
 * null probes also carry the load. POST reads state `destructive: false` (the grep-drop trap).
 */
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
  // CORRECTED 2026-10-04: the previous body (scheduleStartDateAndTime/scheduleEndDateAndTime) was
  // wrong — confirmed via direct source read of KdiaryRO.java and
  // KdiaryScheduleServiceImpl.getEventDate (line 279): the real required field is `eventIds: List
  // <Long>`, passed straight into `kdiaryScheduleRepository.findByEventIDIn(eventIds)` with NO
  // ownership/participant scoping at all — a confirmed cross-tenant read-IDOR (filed, see Bugzilla).
  // The old date-shaped payload left `eventIds` null, which is exactly what produced the "Value must
  // not be null" 500 — a wrong payload, not a server bug. No frontend caller exists for this route
  // (the app uses getEvents + getEventSelectedDate instead), but it is live, authenticated, and
  // directly callable.
  request: body(() => ({ eventIds: [0] })),
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
  // 204 (no events on the selected date) is a valid empty response, not a defect.
  expectedStatus: [200, 204],
  // Live client (Diary.js GetDiaryScheduleBySelectedDate): the date range is start + (null) end.
  request: body(() => ({
    scheduleStartDateAndTime: '2026-09-14',
    scheduleEndDateAndTime: null,
  })),
  note: 'body matches the live client (start date + null end); verified against the frontend',
});

export const kdiaryReadApis = [
  todaySchedulesApi,
  getEventsApi,
  todayReportApi,
  getEventDateApi,
  getEventSelectedDateApi,
];
