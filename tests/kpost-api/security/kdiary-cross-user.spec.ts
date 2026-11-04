// KDiary cross-user writes by id. Gated on KDIARY_LIFECYCLE: A creates (and deletes) a real event
// and, when it has none for today, a real report.
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { scheduleShape } from '@api/definitions/kpost/kdiary/write.api';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * The KDiary writes that name a record by id, beyond getEventDate/updateEvent
 * (kdiary-object-authorization.spec.ts): editScheduleEvent, addparticipants, updateScheduleRemarks
 * (an event's `eventID`/`eventIds`) and editReport, deleteReport (a report's `id`). The backend
 * scopes each by the token's kpostID (KdiaryScheduleServiceImpl.java:121-128, 383-407, 450-537,
 * 578-585), and this proves it live: A owns the record, A's identical call succeeds first (owner
 * control), then C (unrelated) makes the same call, and A's own read-back decides. The status code
 * alone is not trusted.
 *
 * saveReport is not here: it takes no record id (the `eventID` in its body is ignored) and always
 * writes the caller's own report for today (KdiaryScheduleServiceImpl.java:410-447).
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

type Row = Record<string, unknown>;

/** `YYYY-MM-DDTHH:00:00`, `days` from now (editScheduleEvent only edits an event that has not started). */
function future(days: number, hour: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().slice(0, 19);
}

function bodyOf(ex: { json(): { ok: boolean; value?: unknown } }): Row {
  const parsed = ex.json();
  return (parsed.ok ? parsed.value : {}) as Row;
}

/** A finding when `harm` describes one, recorded and soft-asserted (false = no harm). */
function verdict(
  endpoints: EndpointExecutor,
  v: {
    endpointId: string;
    ruleId: string;
    rule: string;
    expected: string;
    request: Row;
    status: number;
    harm: string | undefined;
  },
): void {
  if (v.harm)
    endpoints.recordBusinessRuleViolation({
      endpointId: v.endpointId,
      ruleId: v.ruleId,
      rule: v.rule,
      expected: v.expected,
      actual: `HTTP ${v.status}: ${v.harm}`,
      request: { body: v.request },
    });
  expect
    .soft(Boolean(v.harm), `BOLA (${v.endpointId}, HTTP ${v.status}): ${v.harm ?? ''}`)
    .toBe(false);
}

test.describe(
  'KPost Security · KDiary cross-user writes by id @api @kpost-api @security',
  {
    tag: ['@api', '@auth', '@security', '@regression', '@kdiary'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ timeout: 120_000 });
    test.skip(
      process.env.KDIARY_LIFECYCLE !== 'true',
      'creates a real diary event and report; set KDIARY_LIFECYCLE=true',
    );
    test.skip(!A || !C, 'needs the personal and personal-3 principals');

    test("an unrelated principal cannot edit, add participants to, or set remarks on another user's event @api @kpost-api @security", async ({
      endpoints,
    }) => {
      const stamp = Date.now();
      const start = future(7, 10);
      const end = future(7, 11);
      const shape = (extra: Row): Row =>
        scheduleShape({ scheduleStartDateAndTime: start, scheduleEndDateAndTime: end, ...extra });

      const created = await endpoints.sendTo(
        'kdiary-create-event',
        { body: shape({ title: `QA Bench KDiary XU owner ${stamp}` }) },
        { label: 'kdiary-xu:create', auth: { principal: A }, allowLiveWrite: true },
      );
      const data = bodyOf(created).data as Row | Row[] | undefined;
      const first = (Array.isArray(data) ? data[0] : data) ?? {};
      const eventID = typeof first.eventID === 'number' ? first.eventID : undefined;
      test.skip(!eventID, `createEvent returned no eventID (HTTP ${created.status})`);

      const asA = { auth: { principal: A }, allowLiveWrite: true, ownedIdentifiers: [eventID!] };
      const asC = { auth: { principal: C }, allowLiveWrite: true, ownedIdentifiers: [eventID!] };
      /** A's own view of the event (getEventDate is scoped to owner and participants). */
      const ownerView = async (step: string): Promise<Row | undefined> => {
        const ex = await endpoints.sendTo(
          'kdiary-get-event-date',
          { body: { eventIds: [eventID] } },
          {
            label: `kdiary-xu:owner-${step}`,
            auth: { principal: A },
            allowLiveRead: true,
            ownedIdentifiers: [eventID!],
          },
        );
        const rows = bodyOf(ex).data;
        return Array.isArray(rows) ? (rows as Row[]).find((r) => r.eventID === eventID) : undefined;
      };
      const hasParticipant = (row: Row | undefined, id: string): boolean =>
        Array.isArray(row?.participants) &&
        (row.participants as Row[]).some(
          (p) =>
            typeof p.participant === 'string' && p.participant.toLowerCase() === id.toLowerCase(),
        );

      try {
        // --- editScheduleEvent --------------------------------------------------------------
        const ownerTitle = `QA Bench KDiary XU owner edit ${stamp}`;
        const hijackTitle = `QA Bench KDiary XU HIJACK ${stamp}`;
        const ownerEdit = await endpoints.sendTo(
          'kdiary-edit-schedule-event',
          { body: shape({ eventID, title: ownerTitle }) },
          { label: 'kdiary-xu:edit-owner-control', ...asA },
        );
        const editControl = (await ownerView('after-owner-edit'))?.title === ownerTitle;
        expect
          .soft(editControl, `owner control: A edits its own event (HTTP ${ownerEdit.status})`)
          .toBe(true);
        if (editControl) {
          const editBody = shape({ eventID, title: hijackTitle });
          const edit = await endpoints.sendTo(
            'kdiary-edit-schedule-event',
            { body: editBody },
            { label: 'kdiary-xu:edit-attack', ...asC },
          );
          const title = (await ownerView('after-edit-attack'))?.title;
          verdict(endpoints, {
            endpointId: 'kdiary-edit-schedule-event',
            ruleId: 'IDOR-kdiary-edit-schedule-event-cross-user',
            rule: "editScheduleEvent must change only an event the caller created: an unrelated user must not rename another user's diary event by naming its eventID.",
            expected: "the request is refused and the owner's event keeps its title",
            request: editBody,
            status: edit.status,
            harm:
              title !== ownerTitle
                ? `${C.username} changed ${A.username}'s event ${eventID}: its title is now ${JSON.stringify(title)}`
                : edit.bodyText.includes(ownerTitle)
                  ? `the refusal echoed back ${A.username}'s event title "${ownerTitle}"`
                  : undefined,
          });
        }

        // --- addparticipants ----------------------------------------------------------------
        const ownerAdd = await endpoints.sendTo(
          'kdiary-add-participants',
          {
            body: {
              eventID,
              participants: [{ participant: testData.victimKpostId, userType: 'PERSONAL' }],
            },
          },
          { label: 'kdiary-xu:participants-owner-control', ...asA },
        );
        const addControl = hasParticipant(
          await ownerView('after-owner-add'),
          testData.victimKpostId,
        );
        expect
          .soft(
            addControl,
            `owner control: A adds a participant to its own event (HTTP ${ownerAdd.status})`,
          )
          .toBe(true);
        if (addControl) {
          // C tries to add itself, which would let it read the event afterwards.
          const addBody = {
            eventID,
            participants: [{ participant: C.username, userType: 'PERSONAL' }],
          };
          const add = await endpoints.sendTo(
            'kdiary-add-participants',
            { body: addBody },
            { label: 'kdiary-xu:participants-attack', ...asC },
          );
          const joined = hasParticipant(await ownerView('after-add-attack'), C.username);
          verdict(endpoints, {
            endpointId: 'kdiary-add-participants',
            ruleId: 'IDOR-kdiary-add-participants-cross-user',
            rule: "addparticipants must add only to an event the caller created: an unrelated user must not add itself to another user's diary event by naming its eventID.",
            expected: "the request is refused and the owner's participant list is unchanged",
            request: addBody,
            status: add.status,
            harm: joined
              ? `${C.username} added itself to ${A.username}'s event ${eventID}`
              : add.bodyText.includes(ownerTitle)
                ? `the response disclosed ${A.username}'s event title "${ownerTitle}"`
                : undefined,
          });
        }

        // --- updateScheduleRemarks ----------------------------------------------------------
        const ownerRemark = `QA bench owner remark ${stamp}`;
        const ownerRemarks = await endpoints.sendTo(
          'kdiary-update-remarks',
          { body: { eventIds: [eventID], remarks: 1, remarksDescription: ownerRemark } },
          { label: 'kdiary-xu:remarks-owner-control', ...asA },
        );
        const remarkControl =
          (await ownerView('after-owner-remarks'))?.remarksDescription === ownerRemark;
        expect
          .soft(
            remarkControl,
            `owner control: A sets remarks on its own event (HTTP ${ownerRemarks.status})`,
          )
          .toBe(true);
        if (remarkControl) {
          const remarksBody = {
            eventIds: [eventID],
            remarks: 1,
            remarksDescription: `QA bench HIJACK remark ${stamp}`,
          };
          const remarks = await endpoints.sendTo(
            'kdiary-update-remarks',
            { body: remarksBody },
            { label: 'kdiary-xu:remarks-attack', ...asC },
          );
          const now = (await ownerView('after-remarks-attack'))?.remarksDescription;
          verdict(endpoints, {
            endpointId: 'kdiary-update-remarks',
            ruleId: 'IDOR-kdiary-update-remarks-cross-user',
            rule: "updateScheduleRemarks must change only events the caller created: an unrelated user must not set the remarks of another user's diary event by naming its eventID.",
            expected: "the request changes nothing and the owner's remarks stay as they were",
            request: remarksBody,
            status: remarks.status,
            harm:
              now !== ownerRemark
                ? `${C.username} changed the remarks on ${A.username}'s event ${eventID} to ${JSON.stringify(now)}`
                : undefined,
          });
        }
      } finally {
        await endpoints
          .sendTo(
            'kdiary-delete-event',
            { body: { eventID } },
            { label: 'kdiary-xu:cleanup', ...asA },
          )
          .catch(() => undefined);
      }
    });

    test("an unrelated principal cannot edit or delete another user's diary report @api @kpost-api @security", async ({
      endpoints,
    }) => {
      const stamp = Date.now();
      /** A's report for today (one per user per day), or undefined. */
      const todayReport = async (step: string): Promise<{ id?: number; taskReport?: unknown }> => {
        const ex = await endpoints.sendTo(
          'kdiary-today-report',
          {},
          { label: `kdiary-xu:report-owner-${step}`, auth: { principal: A } },
        );
        if (ex.status !== 200) return {};
        const data = (bodyOf(ex).data ?? {}) as Row;
        return {
          id: typeof data.id === 'number' ? data.id : undefined,
          taskReport: data.taskReport,
        };
      };

      // A uses its report for today, or writes one (another flow may already have).
      const before = await todayReport('before');
      const preExisting = before.id !== undefined;
      if (!preExisting) {
        const saved = await endpoints.sendTo(
          'kdiary-save-report',
          { body: { taskReport: `QA bench XU report ${stamp}` } },
          { label: 'kdiary-xu:report-save', auth: { principal: A }, allowLiveWrite: true },
        );
        expect.soft(saved.status, 'A saves its report for today').toBe(200);
      }
      const reportId = preExisting ? before.id : (await todayReport('after-save')).id;
      test.skip(!reportId, 'A has no report for today to attack');

      const asA = { auth: { principal: A }, allowLiveWrite: true, ownedIdentifiers: [reportId!] };
      const asC = { auth: { principal: C }, allowLiveWrite: true, ownedIdentifiers: [reportId!] };
      let deleted = false;
      try {
        // Owner control: A's own edit lands, so C's identical call is meaningful.
        const ownerText = `QA bench XU owner report ${stamp}`;
        const ownerEdit = await endpoints.sendTo(
          'kdiary-edit-report',
          { body: { id: reportId, taskReport: ownerText } },
          { label: 'kdiary-xu:report-edit-owner-control', ...asA },
        );
        test.skip(
          (await todayReport('after-owner-edit')).taskReport !== ownerText,
          `owner control: A's own editReport did not land (HTTP ${ownerEdit.status}), so the probe proves nothing`,
        );

        const editBody = { id: reportId, taskReport: `QA bench XU HIJACK report ${stamp}` };
        const edit = await endpoints.sendTo(
          'kdiary-edit-report',
          { body: editBody },
          { label: 'kdiary-xu:report-edit-attack', ...asC },
        );
        const afterEdit = await todayReport('after-edit-attack');
        verdict(endpoints, {
          endpointId: 'kdiary-edit-report',
          ruleId: 'IDOR-kdiary-edit-report-cross-user',
          rule: "editReport must change only a report the caller wrote: an unrelated user must not rewrite another user's diary report by naming its id.",
          expected: "HTTP 404 and the owner's report text unchanged",
          request: editBody,
          status: edit.status,
          harm:
            afterEdit.taskReport !== ownerText
              ? `${C.username} rewrote ${A.username}'s report ${reportId}: it now reads ${JSON.stringify(afterEdit.taskReport)}`
              : edit.bodyText.includes(ownerText)
                ? `the response disclosed ${A.username}'s report text`
                : undefined,
        });

        const removal = await endpoints.sendTo(
          'kdiary-delete-report',
          { body: { id: reportId } },
          { label: 'kdiary-xu:report-delete-attack', ...asC },
        );
        deleted = (await todayReport('after-delete-attack')).id !== reportId;
        verdict(endpoints, {
          endpointId: 'kdiary-delete-report',
          ruleId: 'IDOR-kdiary-delete-report-cross-user',
          rule: "deleteReport must delete only a report the caller wrote: an unrelated user must not delete another user's diary report by naming its id.",
          expected: "HTTP 404 and the owner's report still there",
          request: { id: reportId },
          status: removal.status,
          harm: deleted
            ? `${C.username} deleted ${A.username}'s report ${reportId} (gone from A's getTodayReport)`
            : undefined,
        });
      } finally {
        if (!deleted) {
          // Leave A as it was: a report it already had keeps its text; one made here is deleted
          // (that delete is also the owner control for C's delete).
          if (preExisting) {
            await endpoints
              .sendTo(
                'kdiary-edit-report',
                { body: { id: reportId, taskReport: before.taskReport ?? '' } },
                { label: 'kdiary-xu:report-restore', ...asA },
              )
              .catch(() => undefined);
          } else {
            const own = await endpoints
              .sendTo(
                'kdiary-delete-report',
                { body: { id: reportId } },
                { label: 'kdiary-xu:report-cleanup', ...asA },
              )
              .catch(() => undefined);
            expect.soft(own?.status, 'owner control: A deletes its own report').toBe(200);
          }
        }
      }
    });
  },
);
