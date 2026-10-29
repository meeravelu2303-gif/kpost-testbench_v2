import { testData } from '@config/test-data.config';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineUndocumentedKpostEndpoint } from '../kpost-endpoint';
import { defineKdiaryEndpoint } from './kdiary-endpoint';

/**
 * KDiary writes on the caller's own diary (events, participants, remarks, reports). None is
 * `productionSafe`; the self-cleaning KDIARY_LIFECYCLE flow drives them. Bodies follow `Diary.js`.
 */
const WRITE_TAGS = ['kdiary-write'] as const;

/** The live client's diary-event payload (Diary.js). A one-off, non-reminder, non-repeating event. */
export function scheduleShape(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'QA Bench schedule — safe to ignore',
    description: 'QA bench diary event',
    isReminder: false,
    priority: 1,
    isKoolKall: false,
    scheduleStartDateAndTime: '2026-09-14T10:00:00',
    scheduleEndDateAndTime: '2026-09-14T10:30:00',
    snoozeDetails: null,
    remarksDescription: '',
    participants: [],
    repeat: false,
    daily: false,
    weekly: false,
    monthly: false,
    ...overrides,
  };
}

export const createEventApi = defineKdiaryEndpoint({
  id: 'kdiary-create-event',
  method: 'POST',
  path: '/dairySchedule/createEvent',
  summary: 'Create a diary schedule-event',
  tags: [...WRITE_TAGS, 'critical', 'event'],
  destructive: true,
  request: body(() => scheduleShape()),
  requestSchema: typesOnlySchema(scheduleShape()),
});

export const createScheduleApi = defineKdiaryEndpoint({
  id: 'kdiary-create-schedule',
  method: 'POST',
  path: '/dairySchedule/createSchedule',
  summary: 'Create a diary schedule',
  tags: [...WRITE_TAGS, 'schedule'],
  destructive: true,
  request: body(() => scheduleShape()),
  requestSchema: typesOnlySchema(scheduleShape()),
  note: 'workbook documents no body; reuses the createEvent shape',
});

export const updateEventApi = defineKdiaryEndpoint({
  id: 'kdiary-update-event',
  method: 'POST',
  path: '/dairySchedule/updateEvent',
  summary: 'Update a diary event',
  tags: [...WRITE_TAGS, 'event'],
  destructive: true,
  request: body(() => scheduleShape({ eventID: 0 })),
  requestSchema: typesOnlySchema(scheduleShape({ eventID: 0 })),
  note: 'needs a real eventID from createEvent; exercised by the lifecycle',
});

export const editScheduleEventApi = defineKdiaryEndpoint({
  id: 'kdiary-edit-schedule-event',
  method: 'POST',
  path: '/dairySchedule/editScheduleEvent',
  summary: 'Edit a diary schedule-event',
  tags: [...WRITE_TAGS, 'event'],
  destructive: true,
  request: body(() => scheduleShape({ eventID: 0 })),
  requestSchema: typesOnlySchema(scheduleShape({ eventID: 0 })),
  note: 'needs a real eventID; exercised by the lifecycle',
});

export const deleteEventApi = defineKdiaryEndpoint({
  id: 'kdiary-delete-event',
  method: 'POST',
  path: '/dairySchedule/deleteEvent',
  summary: 'Delete a diary event',
  tags: [...WRITE_TAGS, 'critical', 'event'],
  destructive: true,
  request: body(() => ({ eventID: 0 })),
  requestSchema: typesOnlySchema({ eventID: 0 }),
  note: 'needs a real eventID from createEvent; exercised by the lifecycle',
});

export const addParticipantsApi = defineKdiaryEndpoint({
  id: 'kdiary-add-participants',
  method: 'POST',
  path: '/dairySchedule/addparticipants',
  summary: 'Add participants to a diary schedule',
  tags: [...WRITE_TAGS, 'participants'],
  destructive: true,
  // `eventID` is singular here (Diary.js), unlike updateScheduleRemarks' `eventIds` array.
  request: body(() => ({ eventID: 0, participants: [testData.victimKpostId] })),
  requestSchema: typesOnlySchema({ eventID: 0, participants: [testData.victimKpostId] }),
  note: 'live-client payload {eventID, participants}; needs a real eventID from createEvent',
});

export const updateRemarksApi = defineKdiaryEndpoint({
  id: 'kdiary-update-remarks',
  method: 'POST',
  path: '/dairySchedule/updateScheduleRemarks',
  summary: 'Set the remarks/status on a diary schedule',
  tags: [...WRITE_TAGS, 'remarks'],
  // `eventIds` is an array; `remarks` is a kdiaryRemarks code (1 = Completed).
  destructive: true,
  request: body(() => ({ eventIds: [0], remarks: 1, remarksDescription: 'Completed by QA' })),
  requestSchema: typesOnlySchema({
    eventIds: [0],
    remarks: 1,
    remarksDescription: 'Completed by QA',
  }),
});

export const saveReportApi = defineKdiaryEndpoint({
  id: 'kdiary-save-report',
  method: 'POST',
  path: '/dairySchedule/saveReport',
  summary: 'Save a diary report',
  tags: [...WRITE_TAGS, 'report'],
  destructive: true,
  // The field is `taskReport`, the key the reads return; the server silently ignores `report`.
  request: body(() => ({ eventID: 0, taskReport: 'QA bench report' })),
  requestSchema: typesOnlySchema({ eventID: 0, taskReport: 'QA bench report' }),
  note: 'field is `taskReport`, not `report` (live-verified 2026-09-24 — see saveReportApi comment)',
});

export const editReportApi = defineKdiaryEndpoint({
  id: 'kdiary-edit-report',
  method: 'POST',
  path: '/dairySchedule/editReport',
  summary: "Edit today's diary report",
  tags: [...WRITE_TAGS, 'report', 'needs-id'],
  destructive: true,
  // Needs the report's own `id` from a prior saveReport (not the event id) plus `taskReport`.
  request: body(() => ({ id: 0, taskReport: 'QA bench report edited' })),
  requestSchema: typesOnlySchema({ id: 0, taskReport: 'QA bench report edited' }),
  note: 'needs the REPORT id (not eventID) from saveReport/getTodayReport; field is `taskReport`',
});

export const deleteReportApi = defineUndocumentedKpostEndpoint({
  id: 'kdiary-delete-report',
  authentication: { required: true },
  method: 'POST',
  path: '/dairySchedule/deleteReport',
  summary: 'Delete the caller’s own diary report (only on the day it was written)',
  tags: ['kdiary', ...WRITE_TAGS, 'report', 'needs-id'],
  // Our own report id from saveReport/getTodayReport: the KDiary lifecycle deletes the one it saved.
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ id: 0 })),
  requestSchema: typesOnlySchema({ id: 0 }),
  evidence:
    'KdiaryScheduleController.java:478-499; KdiaryScheduleServiceImpl.java:505-526 (findByIdAndCreatedBy: ' +
    'another user’s id → 404; a report from an earlier day → 403)',
});

export const kdiaryWriteApis = [
  createEventApi,
  createScheduleApi,
  updateEventApi,
  editScheduleEventApi,
  deleteEventApi,
  addParticipantsApi,
  updateRemarksApi,
  saveReportApi,
  editReportApi,
  deleteReportApi,
];
