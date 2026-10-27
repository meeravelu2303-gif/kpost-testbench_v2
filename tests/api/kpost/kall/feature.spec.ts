import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { KALL_STATUS } from '@api/contract/kpost-types';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { initiateShape } from '@api/definitions/kpost/kall/direct.api';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';

/**
 * Kall feature flow: place, schedule, join, reschedule and end real calls, each test self-cleaning.
 * Gated behind `KALL_LIFECYCLE=true` because every test writes a real call (rings a device, notifies
 * participants). No WebRTC peer, so this asserts the API contract of the flow, not audio.
 */

const K = AUTH_PROFILES.kpost;
const principal = (key: string): Principal => {
  const found = K.principals.find((p) => p.key === key);
  if (!found) throw new Error(`principal "${key}" is not configured`);
  return found;
};

const A = principal('personal'); // caller           Qatesting@
const B = principal('victim'); // callee / joiner     Qatesting2@
const C = principal('personal-3'); // added member    Qatesting3@

/** The kallID from a create response, across the shapes the API might use. */
function extractKallId(body: Record<string, unknown>): number | undefined {
  const data = body.data;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const obj =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  for (const candidate of [obj?.kallID, obj?.id, row?.kallID, row?.id, body.kallID]) {
    if (typeof candidate === 'number') return candidate;
  }
  return undefined;
}

/** Wipe each principal's own call log; run in `finally` so a failed step leaves no orphan call. */
async function clearHistory(endpoints: EndpointExecutor, who: Principal[]): Promise<void> {
  for (const as of who) {
    await endpoints
      .sendTo(
        'kall-clear-history',
        {},
        { label: `feature:kall:cleanup:${as.key}`, auth: { principal: as }, allowLiveWrite: true },
      )
      .catch(() => undefined);
  }
}

test.describe(
  'KPost Kall · feature flow @database',
  { tag: ['@api', '@kall', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default' });
    test.skip(
      process.env.KALL_LIFECYCLE !== 'true',
      'places/schedules real calls; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5)',
    );

    test(
      'direct call: place → read status (both ways) → transition → end → clear (FR-C05/C08) @api @kall',
      { tag: '@sanity', annotation: [{ type: 'requirement-partial', description: 'FR-KL-005' }] },
      async ({ endpoints }) => {
        try {
          const placed = await endpoints.sendTo(
            'kall-initiate',
            { body: initiateShape({ receiver: B.username }) },
            { label: 'feature:kall:initiate', auth: { principal: A }, allowLiveWrite: true },
          );
          expect.soft(placed.status, 'placing a call succeeds').toBeLessThan(300);

          const placedJson = placed.json();
          const body = (placedJson.ok ? placedJson.value : {}) as Record<string, unknown>;
          const kallID = extractKallId(body);
          expect.soft(kallID, 'the placed call issues a kallID').toBeTruthy();

          if (kallID) {
            // The two kallID-keyed reads, fed the real id the call just created.
            const byPair = await endpoints.sendTo(
              'kall-get-status',
              { body: { sender: A.username, receiver: B.username, kallID } },
              { label: 'feature:kall:get-status', auth: { principal: A }, allowLiveWrite: true },
            );
            expect.soft(byPair.status, 'getKallStatus reads the call').toBeLessThan(300);

            const byId = await endpoints.sendTo(
              'kall-get-status-by-id',
              { body: { kpostID: A.username, kallID } },
              {
                label: 'feature:kall:get-status-by-id',
                auth: { principal: A },
                allowLiveWrite: true,
              },
            );
            expect.soft(byId.status, 'getKallStatusUsingKallID reads the call').toBeLessThan(300);

            const cancelled = await endpoints.sendTo(
              'kall-update-status',
              { body: { id: kallID, kallStatus: KALL_STATUS.cancelled, kallID } },
              { label: 'feature:kall:cancel', auth: { principal: A }, allowLiveWrite: true },
            );
            expect.soft(cancelled.status, 'updateKallStatus is accepted').toBeLessThan(300);

            const both = await endpoints.sendTo(
              'kall-update-sender-receiver-status',
              { body: { sender: A.username, kallStatus: KALL_STATUS.cancelled, kallID } },
              {
                label: 'feature:kall:sender-receiver',
                auth: { principal: A },
                allowLiveWrite: true,
              },
            );
            expect
              .soft(both.status, 'updateSenderAndReceiverKallStatus is accepted')
              .toBeLessThan(300);

            const ended = await endpoints.sendTo(
              'kall-end-individual',
              { body: { kallID } },
              { label: 'feature:kall:end', auth: { principal: A }, allowLiveWrite: true },
            );
            expect.soft(ended.status, 'endIndividualKall is accepted').toBeLessThan(300);

            const cleared = await endpoints.sendTo(
              'kall-clear-by-ids',
              { body: { kallIds: [kallID] } },
              { label: 'feature:kall:clear-by-ids', auth: { principal: A }, allowLiveWrite: true },
            );
            expect.soft(cleared.status, 'clearKallBykallIds is accepted').toBeLessThan(300);
          }
        } finally {
          await clearHistory(endpoints, [A, B]);
        }
      },
    );

    test(
      'scheduled call: schedule → modify members → join → reschedule (BR-C01) → end (FR-C01/C03/C04/C07) @api @kall',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KL-002' },
          { type: 'requirement', description: 'BR-C01' },
        ],
      },
      async ({ endpoints, databases }) => {
        const database = databases.for('kpost-api');
        try {
          const scheduled = await endpoints.sendTo(
            'kall-scheduled',
            { body: scheduleShape({ kallDetails: [{ receiver: B.username }] }) },
            { label: 'feature:kall:schedule', auth: { principal: A }, allowLiveWrite: true },
          );
          expect.soft(scheduled.status, 'scheduling a call succeeds').toBeLessThan(300);

          const scheduledJson = scheduled.json();
          const body = (scheduledJson.ok ? scheduledJson.value : {}) as Record<string, unknown>;
          const kallID = extractKallId(body);
          expect.soft(kallID, 'the scheduled call issues a kallID').toBeTruthy();

          if (kallID) {
            const byId = await endpoints.sendTo(
              'kall-get-status-by-id',
              { body: { kpostID: A.username, kallID } },
              { label: 'feature:kall:sched-status', auth: { principal: A }, allowLiveWrite: true },
            );
            expect.soft(byId.status, 'the scheduled call is readable by id').toBeLessThan(300);

            // FR-C07: add a third member to the scheduled call.
            const modified = await endpoints.sendTo(
              'kall-modify-members',
              { body: { kallID, addingUserIds: [C.username], removingUserIds: [] } },
              {
                label: 'feature:kall:modify-members',
                auth: { principal: A },
                allowLiveWrite: true,
              },
            );
            expect.soft(modified.status, 'modifyKallMembers is accepted').toBeLessThan(300);

            // FR-C04: the invitee joins. `id` is the participant row (TBL_KPOST_KOOL_KALL_DETAILS.id),
            // not the kallID; sending the kallID returns a misleading 500, so it is read from the DB.
            const detail = database.enabled
              ? await database.findOne<{ id: number }>({
                  table: 'TBL_KPOST_KOOL_KALL_DETAILS',
                  where: { kall_id: kallID, receiver: B.username },
                })
              : undefined;
            expect.soft(detail?.id, `B has a participant row on call ${kallID}`).toBeTruthy();

            const joined = await endpoints.sendTo(
              'kall-join-schedule',
              { body: { id: detail?.id, kallID } },
              { label: 'feature:kall:join', auth: { principal: B }, allowLiveWrite: true },
            );
            expect.soft(joined.status, 'joinScheduleKall is accepted').toBeLessThan(300);

            // The join must be stored (join_status on the participant row), not just accepted.
            if (detail?.id) {
              const afterJoin = await database.findOne<{ join_status: number }>({
                table: 'TBL_KPOST_KOOL_KALL_DETAILS',
                where: { id: detail.id },
              });
              expect
                .soft(afterJoin?.join_status, 'FR-C04: the join is stored on the participant row')
                .not.toBe(0);
            }

            // BR-C01: reschedule creates a NEW call (new kallID, status 6) and moves the ORIGINAL row to
            // 7 (ReScheduled). The transition is checked on the original row, not the response's row.
            const rescheduled = await endpoints.sendTo(
              'kall-reschedule',
              { body: scheduleShape({ kallID, kallDetails: [{ receiver: B.username }] }) },
              { label: 'feature:kall:reschedule', auth: { principal: A }, allowLiveWrite: true },
            );
            expect.soft(rescheduled.status, 'reScheduleKall is accepted').toBeLessThan(300);

            const rescheduledJson = rescheduled.json();
            const rescheduledBody = (rescheduledJson.ok ? rescheduledJson.value : {}) as Record<
              string,
              unknown
            >;
            const rescheduledId = extractKallId(rescheduledBody);
            expect
              .soft(rescheduledId, 'reschedule issues a real, NEW kallID for the rescheduled call')
              .toBeTruthy();
            expect
              .soft(
                rescheduledId,
                'BR-C01: rescheduling creates a new call — a different kallID from the original, by design',
              )
              .not.toBe(kallID);

            const newRow = Array.isArray(rescheduledBody.data)
              ? (rescheduledBody.data[0] as Record<string, unknown> | undefined)
              : undefined;
            expect
              .soft(newRow?.senderKallStatus, 'the new call starts fresh as Scheduled (6)')
              .toBe(6);

            if (database.enabled && rescheduledId !== undefined) {
              const originalRow = await database.findOne<{ sender_kall_status: number }>({
                table: 'TBL_KPOST_KOOL_KALL_MASTER',
                where: { kall_id: kallID },
              });
              expect
                .soft(
                  originalRow?.sender_kall_status,
                  'BR-C01: the ORIGINAL call moves to ReScheduled (7), marking it superseded',
                )
                .toBe(7);
            }

            // Send `kallID` alone: adding `id` makes endKoolKall answer 500.
            const ended = await endpoints.sendTo(
              'kall-end-kool',
              { body: { kallID } },
              { label: 'feature:kall:end-kool', auth: { principal: A }, allowLiveWrite: true },
            );
            expect.soft(ended.status, 'endKoolKall is accepted').toBeLessThan(300);

            // Ending a call is a state transition, so it is asserted where the state lives: 8 = closed.
            if (database.enabled) {
              const master = await database.findOne<{ sender_kall_status: number }>({
                table: 'TBL_KPOST_KOOL_KALL_MASTER',
                where: { kall_id: kallID },
              });
              expect
                .soft(master?.sender_kall_status, 'FR-C07: ending the call closes it (status 8)')
                .toBe(8);
            }
          }
        } finally {
          await clearHistory(endpoints, [A, B, C]);
        }
      },
    );

    test('a repeating scheduled call is created (FR-C02) @api @kall', async ({ endpoints }) => {
      // A 4xx is not auto-filed by the write-flow pipeline (5xx only), so a rejected repeat interval
      // is recorded explicitly as a business-rule violation.
      try {
        const repeatBody = scheduleShape({
          repeatType: 1,
          repeatedDate: JSON.stringify({ start_date: '2026-09-14', end_date: '2026-09-20' }),
          kallDetails: [{ receiver: B.username }],
        });
        const repeat = await endpoints.sendTo(
          'kall-scheduled-repeat',
          { body: repeatBody },
          { label: 'feature:kall:repeat', auth: { principal: A }, allowLiveWrite: true },
        );
        if (repeat.status >= 400) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kall-scheduled-repeat',
            ruleId: 'REGRESSION-kall-repeat-still-broken-v2',
            rule: 'scheduledRepeatKall must actually create a repeating call for a real repeat interval, not reject every one — #500 fixed the status code (500→400) but not the underlying capability.',
            expected: 'status < 300 for a well-formed repeat interval',
            actual: `status=${repeat.status}, body=${repeat.bodyText}`,
            request: { body: repeatBody },
          });
        }
        expect.soft(repeat.status, 'scheduledRepeatKall is accepted').toBeLessThan(300);
      } finally {
        await clearHistory(endpoints, [A, B]);
      }
    });

    test(
      'BR-C01 · reschedule creates a new call, and moves the ORIGINAL to ReScheduled @api @kall',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KL-003' },
          { type: 'requirement', description: 'FR-KL-004' },
          { type: 'requirement', description: 'BR-C01' },
        ],
      },
      async ({ endpoints, databases }) => {
        // BR-C01: new kallID at status 6 (Scheduled); the ORIGINAL row moves to 7 (ReScheduled).
        const database = databases.for('kpost-api');

        const scheduled = await endpoints.sendTo(
          'kall-scheduled',
          { body: scheduleShape({ kallDetails: [{ receiver: B.username }] }) },
          { label: 'feature:kall:brc01-schedule', auth: { principal: A }, allowLiveWrite: true },
        );
        const scheduledJson = scheduled.json();
        const scheduledBody = (scheduledJson.ok ? scheduledJson.value : {}) as Record<
          string,
          unknown
        >;
        const kallID = extractKallId(scheduledBody);
        expect(kallID, 'the call was scheduled and issued an id').toBeTruthy();

        try {
          const rescheduled = await endpoints.sendTo(
            'kall-reschedule',
            { body: scheduleShape({ kallID, kallDetails: [{ receiver: B.username }] }) },
            {
              label: 'feature:kall:brc01-reschedule',
              auth: { principal: A },
              allowLiveWrite: true,
            },
          );
          const rescheduledJson = rescheduled.json();
          const rescheduledBody = (rescheduledJson.ok ? rescheduledJson.value : {}) as Record<
            string,
            unknown
          >;
          const rescheduledId = extractKallId(rescheduledBody);

          expect(rescheduledId, 'reschedule issues a real, NEW kallID').toBeTruthy();
          expect(
            String(rescheduledId),
            'BR-C01: reschedule creates a NEW call — a different kallID from the original, by design',
          ).not.toBe(String(kallID));

          const newRow = Array.isArray(rescheduledBody.data)
            ? (rescheduledBody.data[0] as Record<string, unknown> | undefined)
            : undefined;
          expect(newRow?.senderKallStatus, 'the new call starts fresh as Scheduled (6)').toBe(6);

          if (database.enabled && kallID !== undefined) {
            const originalRow = await database.findOne<{ sender_kall_status: number }>({
              table: 'TBL_KPOST_KOOL_KALL_MASTER',
              where: { kall_id: kallID },
            });
            expect(
              originalRow?.sender_kall_status,
              'BR-C01: the ORIGINAL call moves to ReScheduled (7), marking it superseded',
            ).toBe(7);
          }
        } finally {
          await clearHistory(endpoints, [A, B]);
        }
      },
    );

    test('reScheduleKall: an incomplete payload crashes (500) instead of a clean validation error @api @kall', async ({
      endpoints,
    }) => {
      // Known defect #619: reScheduleKall with only `{ kallID }` answers 500 instead of a 400.
      const scheduled = await endpoints.sendTo(
        'kall-scheduled',
        { body: scheduleShape({ kallDetails: [{ receiver: B.username }] }) },
        {
          label: 'feature:kall:incomplete-resched-setup',
          auth: { principal: A },
          allowLiveWrite: true,
        },
      );
      const scheduledJson = scheduled.json();
      const kallID = extractKallId(
        (scheduledJson.ok ? scheduledJson.value : {}) as Record<string, unknown>,
      );
      expect(kallID, 'the call was scheduled and issued an id').toBeTruthy();

      try {
        const incomplete = await endpoints.sendTo(
          'kall-reschedule',
          { body: { kallID } },
          {
            label: 'feature:kall:incomplete-resched',
            auth: { principal: A },
            allowLiveWrite: true,
          },
        );
        expect
          .soft(
            incomplete.status,
            'an incomplete reschedule payload is rejected with a 4xx, not a 500 crash',
          )
          .toBeLessThan(500);
      } finally {
        await clearHistory(endpoints, [A, B]);
      }
    });

    test(
      'a scheduled call keeps the exact title, start and end it was given, and records every invitee (FR-KL-002) @api @kall',
      { tag: '@sanity', annotation: [{ type: 'requirement', description: 'FR-KL-002' }] },
      async ({ endpoints, databases }) => {
        // Hard checks: the returned row keeps the exact subject/start/end sent, and every invitee
        // (B, then C via modifyKallMembers) is recorded. DB DATETIMEs have no zone, so only API times
        // are compared.
        const database = databases.for('kpost-api');
        const sent = scheduleShape({
          subject: `QA schedule fields ${Date.now()}`,
          kallDetails: [{ receiver: B.username }],
        });
        try {
          const scheduled = await endpoints.sendTo(
            'kall-scheduled',
            { body: sent },
            { label: 'feature:kall:fields-schedule', auth: { principal: A }, allowLiveWrite: true },
          );
          expect(scheduled.status, 'scheduling the call succeeds').toBe(200);
          const parsed = scheduled.json();
          const body = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
          const row = (Array.isArray(body.data) ? body.data[0] : body.data) as
            Record<string, unknown> | undefined;
          const kallID = extractKallId(body);
          expect(kallID, 'the scheduled call issues a kallID').toBeTruthy();
          expect(row?.subject, 'the call keeps the exact title it was given').toBe(sent.subject);
          expect(
            Date.parse(String(row?.scheduledStartTime)),
            'the call keeps the exact start time it was given',
          ).toBe(sent.scheduledStartTime);
          expect(
            Date.parse(String(row?.scheduledEndTime)),
            'the call keeps the exact end time it was given',
          ).toBe(sent.scheduledEndTime);
          const invitees = (row?.kallDetails ?? []) as Array<{ receiver?: string }>;
          expect(
            invitees.map((d) => d.receiver),
            'the invitee is recorded on the call',
          ).toContain(B.username);
          if (!kallID) return;

          const modified = await endpoints.sendTo(
            'kall-modify-members',
            { body: { kallID, addingUserIds: [C.username], removingUserIds: [] } },
            { label: 'feature:kall:fields-add', auth: { principal: A }, allowLiveWrite: true },
          );
          expect(modified.status, 'adding a participant is accepted').toBe(200);
          const mParsed = modified.json();
          const mBody = (mParsed.ok ? mParsed.value : {}) as Record<string, unknown>;
          const mRow = (Array.isArray(mBody.data) ? mBody.data[0] : mBody.data) as
            Record<string, unknown> | undefined;
          const after = ((mRow?.kallDetails ?? []) as Array<{ receiver?: string }>).map(
            (d) => d.receiver,
          );
          expect(after, 'the original invitee is still recorded').toContain(B.username);
          expect(after, 'the added participant is recorded as an invitee').toContain(C.username);

          if (database.enabled) {
            const rows = await database.findMany<{ receiver: string }>({
              table: 'TBL_KPOST_KOOL_KALL_DETAILS',
              where: { kall_id: kallID },
            });
            expect(
              rows.map((r) => r.receiver).sort(),
              'the database holds exactly one participant row for each invitee',
            ).toEqual([B.username, C.username].sort());
          }
        } finally {
          await clearHistory(endpoints, [A, B, C]);
        }
      },
    );

    test(
      'scheduledKall requires title/date/start/end — missing a required field is blocked (FR-KL-001) @api @kall',
      { annotation: [{ type: 'requirement', description: 'FR-KL-001' }] },
      async ({ endpoints }) => {
        // Each case omits exactly one required field from an otherwise-valid body.
        const requiredFieldCases: Array<[string, Record<string, unknown>]> = [
          ['subject', { subject: undefined }],
          ['scheduledStartTime', { scheduledStartTime: undefined }],
          ['scheduledEndTime', { scheduledEndTime: undefined }],
        ];

        for (const [fieldName, override] of requiredFieldCases) {
          const attempt = await endpoints.sendTo(
            'kall-scheduled',
            { body: scheduleShape({ ...override, kallDetails: [{ receiver: B.username }] }) },
            {
              label: `feature:kall:missing-${fieldName}`,
              auth: { principal: A },
              allowLiveWrite: true,
            },
          );
          // An accepted incomplete payload created a real call: clean it up (still reported below).
          if (attempt.status < 300) {
            await clearHistory(endpoints, [A, B]).catch(() => undefined);
          }
          expect
            .soft(
              attempt.status,
              `FR-KL-001: scheduledKall must reject a payload missing "${fieldName}" ` +
                `(replied ${attempt.status})`,
            )
            .toBeGreaterThanOrEqual(400);
        }
      },
    );

    test(
      'a placed call appears in the dashboard log with its participants (FR-KL-008) @api @kall',
      { annotation: [{ type: 'requirement', description: 'FR-KL-008' }] },
      async ({ endpoints }) => {
        // Only participants are asserted: duration and start/end times stay null without a real
        // WebRTC peer, so they cannot be checked headlessly.
        let kallID: number | undefined;
        try {
          const placed = await endpoints.sendTo(
            'kall-initiate',
            { body: initiateShape({ receiver: B.username }) },
            { label: 'feature:kall:log-setup', auth: { principal: A }, allowLiveWrite: true },
          );
          const placedJson = placed.json();
          const placedValue = (placedJson.ok ? placedJson.value : {}) as Record<string, unknown>;
          kallID = extractKallId(placedValue);
          expect(kallID, 'a call was placed').toBeTruthy();
          if (!kallID) return;

          await endpoints.sendTo(
            'kall-end-individual',
            { body: { kallID } },
            { label: 'feature:kall:log-end', auth: { principal: A }, allowLiveWrite: true },
          );

          const dashboard = await endpoints.sendTo(
            'kall-dashboard',
            { body: { kallID: '' } },
            { label: 'feature:kall:log-read', auth: { principal: A } },
          );
          const dashboardJson = dashboard.json();
          const dashboardValue = (dashboardJson.ok ? dashboardJson.value : {}) as Record<
            string,
            unknown
          >;
          const entries = (dashboardValue.kall as Array<Record<string, unknown>> | undefined) ?? [];
          const entry = entries.find((row) => row.kallID === kallID);
          expect
            .soft(
              entry,
              `FR-KL-008: the placed call (kallID ${kallID}) appears in the dashboard log`,
            )
            .toBeTruthy();

          if (entry) {
            const details = (entry.kallDetails as Array<Record<string, unknown>> | undefined) ?? [];
            const participant = details.find((d) => d.receiver === B.username);
            expect
              .soft(participant, `FR-KL-008: the log entry records ${B.username} as a participant`)
              .toBeTruthy();
            expect
              .soft(
                entry.sender as string | undefined,
                'FR-KL-008: the log entry records the caller (sender)',
              )
              .toBe(A.username);
          }
        } finally {
          if (kallID) await clearHistory(endpoints, [A, B]);
        }
      },
    );
  },
);
