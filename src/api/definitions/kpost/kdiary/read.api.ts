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
  summary: 'Dates that have diary events (for a month view)',
  tags: [...READ_TAGS, 'event'],
  destructive: false,
  productionSafe: true,
  // The field is a DATE-TIME: the frontend (Diary.js `toDateTimeQueryValue`) sends `${date}T${time}`
  // (e.g. 2026-09-01T00:00:00). A date-only value leaves the time component null and the API NPEs
  // (500 "Value must not be null"). Sends a full month range in the client's datetime format.
  request: body(() => ({
    scheduleStartDateAndTime: '2026-09-01T00:00:00',
    scheduleEndDateAndTime: '2026-09-30T00:00:00',
  })),
  note: 'date-time field: send YYYY-MM-DDT00:00:00 (date-only → 500 "Value must not be null")',
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
