// An orchestrated diary lifecycle driving every write, not simple assertions; the conditionals
// guard optional steps and the per-endpoint soft threshold.

import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { scheduleShape } from '@api/definitions/kpost/kdiary/write.api';

/**
 * KDiary feature flow: every diary write end to end on our own account. Gated by KDIARY_LIFECYCLE=true
 * (real writes); a `finally` deletes every QA-titled event. Frontend-unused routes may 4xx/5xx (findings).
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

test.describe('KPost KDiary · feature flow', { tag: ['@api', '@verticals', '@regression'] }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    process.env.KDIARY_LIFECYCLE !== 'true',
    'writes real diary events; set KDIARY_LIFECYCLE=true',
  );

  test(
    'every diary write, end to end (create → update → participants → remarks → reports → delete) @api @kdiary',
    { tag: '@sanity' },
    async ({ endpoints, databases }) => {
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

        // A 200 is not proof a row exists; check the table.
        if (eventID && database.enabled) {
          const row = await database.findOne<{ event_id: number; title: string }>({
            table: 'TBL_KPOST_KDIARY_SCHEDULE',
            where: { event_id: eventID },
          });
          expect
            .soft(row, 'createEvent actually wrote a row to TBL_KPOST_KDIARY_SCHEDULE')
            .toBeDefined();
          // title holds plain text here; no decoding needed.
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
            // The field is `taskReport` (`report` is accepted but not stored); one report per day.
            ['kdiary-save-report', { eventID, taskReport: 'QA bench report' }, 'save-report'],
          ];
          // Client-used endpoints must succeed; the rest may 4xx/5xx (findings). addparticipants'
          // participant form is not pinned, so it stays finding-tolerant.
          const clientUsed = new Set(['remarks']);
          for (const [id, bodyObj, label] of steps) {
            const r = await write(endpoints, id, bodyObj, label);
            expect
              .soft(r.status, `${label} status`)
              .toBeLessThan(clientUsed.has(label) ? 300 : 600);
          }

          // update-remarks must persist both fields.
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

          // Cross-check the API read-back against the table.
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

          // editReport needs the report's own id, read from getTodayReport (exists either way).
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

            // Today's report can be deleted the same day; afterwards there is no report for today.
            const removed = await write(
              endpoints,
              'kdiary-delete-report',
              { id: reportId },
              'delete-report',
            );
            expect.soft(removed.status, 'deleteReport removes our own report of today').toBe(200);
            const after = await endpoints
              .sendTo(
                'kdiary-today-report',
                {},
                { label: 'kdiary:report-after-delete', auth: { principal: A } },
              )
              .catch(() => undefined);
            expect.soft(after?.status, 'and no report for today is left (404)').toBe(404);
          }

          // Deleted here (not by the sweep) so the row's post-delete state can be checked.
          const deleted = await write(
            endpoints,
            'kdiary-delete-event',
            { eventID },
            'delete-event',
          );
          expect.soft(deleted.status, 'deleteEvent is accepted').toBeLessThan(300);
          if (database.enabled) {
            const afterDelete = await database.findOne<{ delete_by_sender: number | null }>({
              table: 'TBL_KPOST_KDIARY_SCHEDULE',
              where: { event_id: eventID },
            });
            // Row gone (hard delete) or flag set (soft delete) both count as deleted.
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
    },
  );

  test("an unrelated account cannot delete another account's private diary event (IDOR) @api @kdiary @security", async ({
    endpoints,
  }) => {
    // A creates a private event (no participants); unrelated B tries to delete it by eventID.
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

      // Verdict from the owner's read-back, not the attacker's status.
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
