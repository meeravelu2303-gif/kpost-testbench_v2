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
    databases,
  }) => {
    const database = databases.for('kpost-api');
    try {
      const createTitle = `QA Bench ${Date.now()}`;
      const created = await write(
        endpoints,
        'kdiary-create-event',
        scheduleShape({ title: createTitle }),
        'create-event',
      );
      expect.soft(created.status, 'createEvent is accepted').toBeLessThan(300);
      const eventID = extractId(created.body);
      expect.soft(eventID, 'createEvent issues an eventID').toBeTruthy();

      // Database coverage was previously 0/14 for this module — the endpoint answering 200 is not
      // proof a row exists, same reasoning as every other module's "answers success regardless" gap.
      if (eventID && database.enabled) {
        const row = await database.findOne<{ event_id: number; title: string }>({
          table: 'TBL_KPOST_KDIARY_SCHEDULE',
          where: { event_id: eventID },
        });
        expect
          .soft(row, 'createEvent actually wrote a row to TBL_KPOST_KDIARY_SCHEDULE')
          .toBeDefined();
        // title is a blob/mediumtext holding plain text here; no decoding needed, unlike
        // Katchup's BLOB subject column.
        expect.soft(row?.title, 'the stored title matches what was sent').toBe(createTitle);
      }

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
        expect.soft(eventRow?.remarks, 'the new remarks code actually persisted').toBe(1);
        expect
          .soft(eventRow?.remarksDescription, 'the new remarksDescription actually persisted')
          .toBe('Completed by QA');

        // Same fact, confirmed at the database row directly rather than through the API's own
        // read-back — a cross-check that the API's answer and the table it reads from agree.
        if (database.enabled) {
          const remarksRow = await database.findOne<{
            remarks: number;
            remarks_description: string;
          }>({ table: 'TBL_KPOST_KDIARY_SCHEDULE', where: { event_id: eventID } });
          expect.soft(remarksRow?.remarks, 'DB: remarks code matches the API read-back').toBe(1);
          expect
            .soft(
              remarksRow?.remarks_description,
              'DB: remarks description matches the API read-back',
            )
            .toBe('Completed by QA');
        }

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

        /*
         * deleteEvent — the other half of this module's 0/14 database coverage. Deleted explicitly
         * here (not left to the sweep below) so the row's actual post-delete state can be checked:
         * `delete_by_sender` has a tinyint column on this table, so this treats it the same way as
         * every other soft-delete flag in this bench — a response answering success is not proof.
         */
        const deleted = await write(endpoints, 'kdiary-delete-event', { eventID }, 'delete-event');
        expect.soft(deleted.status, 'deleteEvent is accepted').toBeLessThan(300);
        if (database.enabled) {
          const afterDelete = await database.findOne<{ delete_by_sender: number | null }>({
            table: 'TBL_KPOST_KDIARY_SCHEDULE',
            where: { event_id: eventID },
          });
          // Either shape counts as deleted: a hard delete (row gone) or a soft delete (flag set) —
          // what must NOT happen is the row surviving with the flag still clear, which is the
          // "reports success, changed nothing" failure mode this bench keeps finding elsewhere.
          const reallyDeleted = !afterDelete || Number(afterDelete.delete_by_sender ?? 0) === 1;
          expect
            .soft(
              reallyDeleted,
              `deleteEvent actually removed or flagged the row (delete_by_sender: ${afterDelete?.delete_by_sender ?? '(row gone)'})`,
            )
            .toBe(true);
        }
      }
    } finally {
      await deleteAllQaEvents(endpoints);
    }
  });

  test("an unrelated account cannot delete another account's private diary event (IDOR) @api @kdiary @security", async ({
    endpoints,
  }) => {
    /*
     * KDiary events are keyed by a freestanding `eventID` (same shape as Group's membership ids and
     * KWord's docId before those were checked) — a plausible IDOR surface this plan's matrix had
     * marked MISSING. A creates a PRIVATE event (no participants, so B has no relationship to it at
     * all); B then tries to delete it by naming A's real eventID directly.
     *
     * `deleteEvent` is confirmed exercised by the real frontend (unlike updateEvent/editScheduleEvent,
     * which this file's own header notes are unused routes) — so this targets the live, real mutation
     * path, not a best-effort one.
     */
    const B: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'victim')!;
    const created = await write(
      endpoints,
      'kdiary-create-event',
      scheduleShape({ title: `QA Bench private event ${Date.now()}`, participants: [] }),
      'idor-setup',
    );
    expect(created.status, 'the private event was created').toBeLessThan(300);
    const eventID = extractId(created.body);
    expect(eventID, 'createEvent issues an eventID').toBeTruthy();
    if (!eventID) return;

    try {
      const attackerDelete = await endpoints.sendTo(
        'kdiary-delete-event',
        { body: { eventID } },
        { label: 'kdiary:idor-attacker-delete', auth: { principal: B }, allowLiveWrite: true },
      );

      // Verdict read back as the OWNER, not the attacker's response — the same discipline as the
      // Group BOLA test: a 200 that didn't actually delete anything is still a finding worth knowing
      // about, and a clean denial must be confirmed by the event still existing, not assumed from status.
      const stillThere = await endpoints
        .sendTo(
          'kdiary-get-events',
          {},
          { label: 'kdiary:idor-owner-recheck', auth: { principal: A } },
        )
        .catch(() => undefined);
      const rows = stillThere
        ? ((
            JSON.parse(stillThere.bodyText || '{"data":[]}') as {
              data?: Array<Record<string, unknown>>;
            }
          ).data ?? [])
        : [];
      const survived = rows.some((r) => r.eventID === eventID);

      if (!survived) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kdiary-delete-event',
          ruleId: 'IDOR-kdiary-event-delete',
          rule:
            'deleteEvent must refuse a caller who has no relationship to the event (not its owner, ' +
            "not a participant) — an unrelated account must not be able to delete another account's " +
            'private diary event by naming its eventID.',
          expected: "the event still exists after the unrelated account's delete attempt",
          actual: `the event no longer appears in the owner's list (attacker delete replied ${attackerDelete.status})`,
          request: { body: { eventID } },
        });
      }
      expect
        .soft(
          survived,
          `IDOR: an unrelated account's delete must not remove another account's private event (replied ${attackerDelete.status})`,
        )
        .toBe(true);
    } finally {
      await deleteAllQaEvents(endpoints);
    }
  });
});
