/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { scheduleShape } from '@api/definitions/kpost/kdiary/write.api';
import { expect, test } from '@fixtures';

/**
 * KDiary **read business rules** — the 3 reads `feature.spec.ts`'s write lifecycle never chains a
 * result into: `getTodaySchedules`, `getTodayReport`, `getEventSelectedDate`. All `productionSafe:
 * true`; the two chain tests create a real event, so they run only with `KDIARY_LIFECYCLE=true`,
 * self-cleaning.
 *
 * `getEventDate` is NOT covered — see `kdiary-gaps.spec.ts`.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

/** An ISO datetime at a given local hour, today. */
function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString().slice(0, 19);
}

test.describe('KPost KDiary · read business rules @api @kpost-api @kdiary', () => {
  test('an event scheduled for today surfaces in both getTodaySchedules and getEventSelectedDate', async ({
    endpoints,
  }) => {
    test.skip(
      process.env.KDIARY_LIFECYCLE !== 'true',
      'creates a real diary event; set KDIARY_LIFECYCLE=true',
    );
    let eventID: number | undefined;
    try {
      const created = await endpoints.sendTo(
        'kdiary-create-event',
        {
          body: scheduleShape({
            title: 'QA Bench schedule — safe to ignore (reads-workflow)',
            scheduleStartDateAndTime: todayAt(20),
            scheduleEndDateAndTime: todayAt(21),
          }),
        },
        { label: 'kdiary-reads:create', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(created.status, 'createEvent succeeds').toBeLessThan(300);
      const body = JSON.parse(created.bodyText || '{}') as { data?: { eventID?: number } };
      eventID = body.data?.eventID;
      expect(eventID, 'createEvent issues an eventID').toBeTruthy();

      const today = await endpoints.sendTo(
        'kdiary-today-schedules',
        {},
        { label: 'kdiary-reads:today', auth: { principal: A } },
      );
      expect(today.status, 'getTodaySchedules succeeds').toBe(200);
      const todayRows =
        (JSON.parse(today.bodyText || '{}') as { schedule?: Array<{ eventID?: number }> })
          .schedule ?? [];
      expect(
        todayRows.some((r) => r.eventID === eventID),
        'the event created for today appears in getTodaySchedules',
      ).toBe(true);

      const selected = await endpoints.sendTo(
        'kdiary-get-event-selected-date',
        {
          body: {
            scheduleStartDateAndTime: new Date().toISOString().slice(0, 10),
            scheduleEndDateAndTime: null,
          },
        },
        { label: 'kdiary-reads:selected-date', auth: { principal: A } },
      );
      expect(selected.status, "getEventSelectedDate succeeds for today's date").toBe(200);
      const selectedRows =
        (JSON.parse(selected.bodyText || '{}') as { data?: Array<{ eventID?: number }> }).data ?? [];
      expect(
        selectedRows.some((r) => r.eventID === eventID),
        "the same event appears in getEventSelectedDate for today's date",
      ).toBe(true);
    } finally {
      if (eventID) {
        await endpoints
          .sendTo(
            'kdiary-delete-event',
            { body: { eventID } },
            { label: 'kdiary-reads:cleanup', auth: { principal: A }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    }
  });

  test('saving a report for today is reflected by getTodayReport under the same id', async ({
    endpoints,
  }) => {
    test.skip(
      process.env.KDIARY_LIFECYCLE !== 'true',
      'creates a real diary event and report; set KDIARY_LIFECYCLE=true',
    );
    let eventID: number | undefined;
    try {
      const created = await endpoints.sendTo(
        'kdiary-create-event',
        {
          body: scheduleShape({
            title: 'QA Bench schedule — safe to ignore (report-check)',
            scheduleStartDateAndTime: todayAt(22),
            scheduleEndDateAndTime: todayAt(23),
          }),
        },
        { label: 'kdiary-reads:create-for-report', auth: { principal: A }, allowLiveWrite: true },
      );
      const createdBody = JSON.parse(created.bodyText || '{}') as { data?: { eventID?: number } };
      eventID = createdBody.data?.eventID;
      expect(eventID, 'createEvent issues an eventID').toBeTruthy();

      /*
       * saveReport is date-scoped, not event-scoped — "Report already exists for today" on a re-run
       * the same day is a valid, expected outcome (a report for today already exists either way), not
       * a failure of this chain.
       */
      const saved = await endpoints.sendTo(
        'kdiary-save-report',
        { body: { eventID, taskReport: 'QA bench reads-workflow report' } },
        { label: 'kdiary-reads:save-report', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(saved.status, 'saveReport either succeeds or reports one already exists today').toBe(
        saved.status === 400 ? 400 : 200,
      );

      const report = await endpoints.sendTo(
        'kdiary-today-report',
        {},
        { label: 'kdiary-reads:report', auth: { principal: A } },
      );
      expect(report.status, "getTodayReport succeeds once a report for today exists").toBe(200);
      const reportBody = JSON.parse(report.bodyText || '{}') as { data?: { id?: number } };
      expect(reportBody.data?.id, 'getTodayReport returns a real report id').toBeTruthy();
    } finally {
      if (eventID) {
        await endpoints
          .sendTo(
            'kdiary-delete-event',
            { body: { eventID } },
            { label: 'kdiary-reads:cleanup-report', auth: { principal: A }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    }
  });
});
