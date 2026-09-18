import { testData } from '@config/test-data.config';
import { body } from '../kpost-endpoint';
import { defineKdiaryEndpoint } from './kdiary-endpoint';

/**
 * KDiary **writes** — create / update / delete a schedule-event, add participants, set remarks, and
 * save / edit a report. Each modifies the caller's own diary and **none is `productionSafe`**; they
 * run through the gated feature flow (`KDIARY_LIFECYCLE=true`) with `allowLiveWrite`, self-cleaning
 * (create → … → delete). The `createEvent` shape is the live client's (`Diary.js`); the other bodies
 * are documented nowhere and are taken from it / inferred, each noted.
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
});

export const createScheduleApi = defineKdiaryEndpoint({
  id: 'kdiary-create-schedule',
  method: 'POST',
  path: '/dairySchedule/createSchedule',
  summary: 'Create a diary schedule',
  tags: [...WRITE_TAGS, 'schedule'],
  destructive: true,
  request: body(() => scheduleShape()),
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
  note: 'needs a real eventID from createEvent; exercised by the lifecycle',
});

export const addParticipantsApi = defineKdiaryEndpoint({
  id: 'kdiary-add-participants',
  method: 'POST',
  path: '/dairySchedule/addparticipants',
  summary: 'Add participants to a diary schedule',
  tags: [...WRITE_TAGS, 'participants'],
  destructive: true,
  // Live client (Diary.js AddDiaryScheduleParticipants): the field is `eventID` (SINGULAR), not the
  // `eventIds` array of updateScheduleRemarks — the earlier array shape is what produced the 400 on
  // this endpoint. Verified against the frontend, 2026-09-18. `participants` is a list the app maps
  // from selected contacts; a QA kpostID exercises the path.
  request: body(() => ({ eventID: 0, participants: [testData.victimKpostId] })),
  note: 'live-client payload {eventID, participants}; needs a real eventID from createEvent',
});

export const updateRemarksApi = defineKdiaryEndpoint({
  id: 'kdiary-update-remarks',
  method: 'POST',
  path: '/dairySchedule/updateScheduleRemarks',
  summary: 'Set the remarks/status on a diary schedule',
  tags: [...WRITE_TAGS, 'remarks'],
  /*
   * The live client's shape (Diary.js): `{eventIds: [id], remarks, remarksDescription}` — `eventIds`
   * is a plural ARRAY. `remarks` is a kdiaryRemarks code (1 = Completed).
   */
  destructive: true,
  request: body(() => ({ eventIds: [0], remarks: 1, remarksDescription: 'Completed by QA' })),
});

export const saveReportApi = defineKdiaryEndpoint({
  id: 'kdiary-save-report',
  method: 'POST',
  path: '/dairySchedule/saveReport',
  summary: 'Save a diary report',
  tags: [...WRITE_TAGS, 'report'],
  destructive: true,
  request: body(() => ({ eventID: 0, report: 'QA bench report' })),
  note: 'workbook documents no body; report shape inferred',
});

export const editReportApi = defineKdiaryEndpoint({
  id: 'kdiary-edit-report',
  method: 'POST',
  path: '/dairySchedule/editReport',
  summary: 'Edit a diary report',
  tags: [...WRITE_TAGS, 'report'],
  destructive: true,
  request: body(() => ({ eventID: 0, report: 'QA bench report edited' })),
  note: 'workbook documents no body; report shape inferred',
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
];
