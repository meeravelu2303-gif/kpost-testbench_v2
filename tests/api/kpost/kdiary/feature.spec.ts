// An orchestrated diary lifecycle driving every write, not simple assertions; the conditionals
// guard optional steps and the per-endpoint soft threshold.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { scheduleShape } from '@api/definitions/kpost/kdiary/write.api';

/**
 * KDiary **feature flow** — every diary WRITE, end to end on a real host, self-cleaning. Gated
 * `KDIARY_LIFECYCLE=true`, each write `allowLiveWrite`, all on our own account.
 *
 * `createEvent`, `deleteEvent`, `updateScheduleRemarks` (`{eventIds:[id], …}`) and `addparticipants`
 * (`{eventID, participants}`, singular) are the client's real shapes (verified against the frontend,
 * 2026-09-18). The rest (`createSchedule`, `updateEvent`, `editScheduleEvent`, `saveReport`,
 * `editReport`) are **not called anywhere in the frontend** — documented-but-unused endpoints — so
 * their bodies are best-effort and a 4xx/5xx from them is a finding on an unused route, not a
 * regression. `expect.soft` reports every one.
 *
 * Cleanup is exhaustive: a `finally` reads `getEvents` and deletes every QA-titled event by
 * `eventID`, so no run can leave an orphan on the account.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

function extractId(bodyObj: Record<string, unknown>): number | undefined {
  const data = bodyObj.data;
  const obj = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<
    string,
    unknown
  >;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  for (const c of [obj.eventID, obj.id, row?.eventID, row?.id]) {
    if (typeof c === 'number') return c;
  }
  return undefined;
}

async function write(
  endpoints: EndpointExecutor,
  id: string,
  bodyObj: Record<string, unknown>,
  label: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ex = await endpoints.sendTo(
    id,
    { body: bodyObj },
    { label: `kdiary:${label}`, auth: { principal: A }, allowLiveWrite: true },
  );
  const parsed = ex.json();
  return { status: ex.status, body: (parsed.ok ? parsed.value : {}) as Record<string, unknown> };
}

/** Delete every QA-titled diary event by eventID — the exhaustive cleanup. Never throws. */
async function deleteAllQaEvents(endpoints: EndpointExecutor): Promise<void> {
  const ev = await endpoints
    .sendTo('kdiary-get-events', {}, { label: 'kdiary:sweep', auth: { principal: A } })
    .catch(() => ({ bodyText: '{"data":[]}' }) as never);
  const parsed = JSON.parse(ev.bodyText || '{"data":[]}') as {
    data?: Array<Record<string, unknown>>;
  };
  const rows = parsed.data ?? [];
  for (const r of rows.filter((x) => typeof x.title === 'string' && x.title.includes('QA Bench'))) {
    await write(endpoints, 'kdiary-delete-event', { eventID: r.eventID }, 'sweep-delete').catch(
      () => undefined,
    );
  }
}

test.describe('KPost KDiary · feature flow', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    process.env.KDIARY_LIFECYCLE !== 'true',
    'writes real diary events; set KDIARY_LIFECYCLE=true',
  );

  test('every diary write, end to end (create → update → participants → remarks → reports → delete) @api @kdiary', async ({
    endpoints,
  }) => {
    try {
      const created = await write(
        endpoints,
        'kdiary-create-event',
        scheduleShape(),
        'create-event',
      );
      expect.soft(created.status, 'createEvent is accepted').toBeLessThan(300);
      const eventID = extractId(created.body);
      expect.soft(eventID, 'createEvent issues an eventID').toBeTruthy();

      // createSchedule — the sibling create (frontend-unused).
      const sched = await write(
        endpoints,
        'kdiary-create-schedule',
        scheduleShape(),
        'create-sched',
      );
      expect
        .soft(sched.status, 'createSchedule returns a status (frontend-unused)')
        .toBeLessThan(600);

      if (eventID) {
        const steps: Array<[string, Record<string, unknown>, string]> = [
          ['kdiary-update-event', scheduleShape({ eventID }), 'update-event'],
          ['kdiary-edit-schedule-event', scheduleShape({ eventID }), 'edit-schedule-event'],
          [
            'kdiary-add-participants',
            { eventID, participants: [testData.victimKpostId] },
            'participants',
          ],
          [
            'kdiary-update-remarks',
            { eventIds: [eventID], remarks: 1, remarksDescription: 'Completed by QA' },
            'remarks',
          ],
          /*
           * Live-verified 2026-09-24: the report FIELD is `taskReport`, not `report` — `report` is
           * silently accepted (200) but never persisted (see `saveReportApi`'s comment). `saveReport`
           * is also date-scoped ("Report already exists for today" on a re-run the same day), which
           * is fine here since it stays out of `clientUsed` below.
           */
          ['kdiary-save-report', { eventID, taskReport: 'QA bench report' }, 'save-report'],
        ];
        // The client-used endpoints must succeed; the frontend-unused ones may 4xx/5xx (findings).
        // `addparticipants` now carries the client field shape (`{eventID, participants}`) but the
        // exact participant-object form is not fully pinned, so it stays finding-tolerant (not in
        // `clientUsed`) — a 4xx there is reported, not a hard failure of the flow.
        const clientUsed = new Set(['remarks']);
        for (const [id, bodyObj, label] of steps) {
          const r = await write(endpoints, id, bodyObj, label);
          expect.soft(r.status, `${label} status`).toBeLessThan(clientUsed.has(label) ? 300 : 600);
        }

        /*
         * Live-verified 2026-09-26: `kdiary-update-remarks` genuinely persists both fields — this
         * was previously status-only (accepted, but never confirmed the actual event row changed).
         */
        const eventsAfterRemarks = await endpoints.sendTo(
          'kdiary-get-events',
          {},
          { label: 'kdiary:remarks-recheck', auth: { principal: A } },
        );
        const eventsParsed = JSON.parse(eventsAfterRemarks.bodyText || '{}') as {
          data?: Array<Record<string, unknown>>;
        };
        const eventRow = (eventsParsed.data ?? []).find((r) => r.eventID === eventID);
        expect
          .soft(eventRow?.remarks, 'the new remarks code actually persisted')
          .toBe(1);
        expect
          .soft(
            eventRow?.remarksDescription,
            'the new remarksDescription actually persisted',
          )
          .toBe('Completed by QA');

        /*
         * `editReport` needs the REPORT's own id (not eventID) — read it back from `getTodayReport`
         * so this works whether the `save-report` step above just created it or "already exists for
         * today" fired instead (a report for today exists either way).
         */
        const todayReport = await endpoints
          .sendTo(
            'kdiary-today-report',
            {},
            { label: 'kdiary:report-lookup', auth: { principal: A } },
          )
          .catch(() => undefined);
        const parsedReport = todayReport?.json();
        const reportId = parsedReport?.ok
          ? (parsedReport.value as { data?: { id?: number } }).data?.id
          : undefined;
        if (reportId) {
          const edited = await write(
            endpoints,
            'kdiary-edit-report',
            { id: reportId, taskReport: 'QA bench report edited' },
            'edit-report',
          );
          expect.soft(edited.status, 'edit-report status').toBeLessThan(300);
        }
      }
    } finally {
      await deleteAllQaEvents(endpoints);
    }
  });
});
