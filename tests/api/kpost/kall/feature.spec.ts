// An orchestrated multi-step call lifecycle (initiate → status → members → end → clean up), not
// simple assertions; the conditionals guard optional steps and best-effort cleanup of real live data.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { KALL_STATUS } from '@api/schemas/kpost-types';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { initiateShape } from '@api/definitions/kpost/kall/direct.api';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';

/**
 * Kall **feature flow** — the FRD's calling behaviours, end to end, on a real KPost host, each
 * self-cleaning.
 *
 * Every test WRITES a real call (placing one rings a device; scheduling one notifies participants
 * and adds a calendar entry), so it runs only with `KALL_LIFECYCLE=true` and each write carries
 * `allowLiveWrite: true` — the same authorized-write control Katchup and Profile use. It never fires
 * on a default run. Findings use `expect.soft` so one run reports every defect.
 *
 * A call cannot connect headlessly (no WebRTC peer), so these assert the API contract of the flow —
 * a call is placed and issues an id, its status transitions, members change, it ends, and the log
 * clears — not that audio flows. Together the three tests exercise **every** Kall write and the two
 * `kallID`-keyed status reads (fed the real id the flow creates):
 *
 *   direct-call    initiate → getKallStatus → getKallStatusUsingKallID → updateKallStatus →
 *                  updateSenderAndReceiverKallStatus → endIndividualKall → clearKallBykallIds
 *                  (FR-C05/C06/C08)
 *   scheduled-call scheduledKall → getKallStatusUsingKallID → modifyKallMembers → joinScheduleKall →
 *                  reScheduleKall (BR-C01: Scheduled → Rescheduled) → endKoolKall
 *                  (FR-C01/C03/C04/C07/C08)
 *   repeat         scheduledRepeatKall (FR-C02)
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

/**
 * Clear a principal's entire call history. `clearKallHistory` is a GET (no body, so no id to guard)
 * that wipes the caller's own log — the safety net that removes anything a failed step left behind.
 * Called for every party in a `finally`, so no run can leave an orphan call on the accounts.
 */
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

test.describe('KPost Kall · feature flow @database', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    process.env.KALL_LIFECYCLE !== 'true',
    'places/schedules real calls; set KALL_LIFECYCLE=true (owner sign-off, docs/kall-flow.md §5)',
  );

  test('direct call: place → read status (both ways) → transition → end → clear (FR-C05/C08) @api @kall', async ({
    endpoints,
  }) => {
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
          { label: 'feature:kall:get-status-by-id', auth: { principal: A }, allowLiveWrite: true },
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
          { label: 'feature:kall:sender-receiver', auth: { principal: A }, allowLiveWrite: true },
        );
        expect.soft(both.status, 'updateSenderAndReceiverKallStatus is accepted').toBeLessThan(300);

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
  });

  test('scheduled call: schedule → modify members → join → reschedule (BR-C01) → end (FR-C01/C03/C04/C07) @api @kall', async ({
    endpoints,
    databases,
  }) => {
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
          { label: 'feature:kall:modify-members', auth: { principal: A }, allowLiveWrite: true },
        );
        expect.soft(modified.status, 'modifyKallMembers is accepted').toBeLessThan(300);

        /*
         * FR-C04: the invitee joins.
         *
         * `id` is the **participant** row — `TBL_KPOST_KOOL_KALL_DETAILS.id` for this receiver on
         * this call — NOT the kallID. The bench sent `id: kallID` and read the resulting
         * 500 "Failed to Join KatchupKall" as a product defect; it was ours. Measured directly:
         *
         *   { id: <kallID>,        kallID }  -> 500
         *   { id: <detail row id>, kallID }  -> 200
         *
         * So the id is resolved from the database, the same way the Group flow resolves a
         * membership id. A placeholder or a guessed id here produces a server error that looks
         * exactly like a broken endpoint, which is how this one stayed misdiagnosed.
         */
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

        // The join must be RECORDED, not just accepted — join_status on the participant row is
        // what a "who turned up" report reads, and an accepted join that stores nothing is invisible
        // from the response.
        if (detail?.id) {
          const afterJoin = await database.findOne<{ join_status: number }>({
            table: 'TBL_KPOST_KOOL_KALL_DETAILS',
            where: { id: detail.id },
          });
          expect
            .soft(afterJoin?.join_status, 'FR-C04: the join is stored on the participant row')
            .not.toBe(0);
        }

        /*
         * BR-C01, CORRECTED 2026-09-26 by the owner: rescheduling a call is REQUIRED to create a new
         * call (a new kallID) — this is the intended design, not a defect. The original entry is
         * superseded, not overwritten. Live-verified against the database (not just the response):
         * the ORIGINAL row's senderKallStatus moves 6 (Scheduled) -> 7 (ReScheduled), correctly
         * marking it superseded, while the NEW row starts fresh at 6 (Scheduled) — exactly what a
         * "new call" should do. The bench had this backwards for a while: #501 (new kallID),
         * #620 (new row not linked back) and #621 (status not moved) were all filed against a wrong
         * reading of the requirement — the status transition IS correct, just on the original row,
         * not the response's row (the earlier check read the wrong one). All three closed INVALID.
         */
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

        /*
         * `kallID` ALONE. Sending `id` alongside it makes the endpoint answer
         * 500 {"urlPath":"endKoolKall","status":"error"} — measured:
         *
         *   { id: <kallID>, kallID }  -> 500
         *   { kallID }                -> 200, sender_kall_status moves to 8 (closed)
         *
         * The second "helpful" field was the whole defect. This was the third of three Kall
         * endpoints previously written down as a server-side cluster; two of the three were the
         * bench's own payloads.
         */
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
  });

  test('a repeating scheduled call is created (FR-C02) @api @kall', async ({ endpoints }) => {
    /*
     * Bugzilla #500 was closed RESOLVED/FIXED (2026-09-22) — but that only fixed the SEVERITY, not
     * the feature. Live-verified again 2026-09-26: every repeat interval still fails identically
     * ("Invalid Request", tried with both past and future date ranges — the date isn't the cause),
     * just with a 400 now instead of the original 500. A repeating call still cannot be created at
     * all. Since this is a 4xx, the engine's automatic write-flow filing does not pick it up by
     * design (it only auto-files 5xx) — filed explicitly here so this regression doesn't go
     * silently untracked just because its status code improved.
     *
     * CORRECTED 2026-09-26: originally filed as #622 [KP-1F469E] via ruleId
     * `REGRESSION-kall-repeat-still-broken` — but that finding's `request` evidence was only
     * `{"repeatType": 1}` (what this test happened to override), not the full body actually sent.
     * The ticket's "Reproduce" curl box is generated once, from the bug's original description, and
     * Bugzilla has no API to edit a description/comment after posting — so the wrong curl could not
     * be corrected in place. #622 closed WONTFIX; re-filed under a new ruleId
     * (`REGRESSION-kall-repeat-still-broken-v2`) so the fresh ticket's own "Reproduce" box carries
     * the complete, correct request from the moment it's created.
     */
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

  test('BR-C01 · reschedule creates a new call, and moves the ORIGINAL to ReScheduled @api @kall', async ({
    endpoints,
    databases,
  }) => {
    /*
     * BR-C01, CORRECTED 2026-09-26 by the owner: creating a new call on reschedule is the intended
     * requirement, not a defect. #501, #620 and #621 were all filed against a wrong reading of the
     * rule and are closed INVALID. The real rule, live-verified against the database: rescheduling
     * issues a genuinely NEW kallID, that new call starts fresh at senderKallStatus 6 (Scheduled),
     * and the ORIGINAL call's row moves to senderKallStatus 7 (ReScheduled) — marking it superseded.
     * This test was previously checking the RESPONSE's row (the new call) for the 6->7 transition,
     * which is why it looked broken: the transition is real, it just happens on the ORIGINAL row.
     */
    const database = databases.for('kpost-api');

    const scheduled = await endpoints.sendTo(
      'kall-scheduled',
      { body: scheduleShape({ kallDetails: [{ receiver: B.username }] }) },
      { label: 'feature:kall:brc01-schedule', auth: { principal: A }, allowLiveWrite: true },
    );
    const scheduledJson = scheduled.json();
    const scheduledBody = (scheduledJson.ok ? scheduledJson.value : {}) as Record<string, unknown>;
    const kallID = extractKallId(scheduledBody);
    expect(kallID, 'the call was scheduled and issued an id').toBeTruthy();

    try {
      const rescheduled = await endpoints.sendTo(
        'kall-reschedule',
        { body: scheduleShape({ kallID, kallDetails: [{ receiver: B.username }] }) },
        { label: 'feature:kall:brc01-reschedule', auth: { principal: A }, allowLiveWrite: true },
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
  });

  test('reScheduleKall: an incomplete payload crashes (500) instead of a clean validation error @api @kall', async ({
    endpoints,
  }) => {
    /*
     * Live-verified 2026-09-26, while investigating BR-C01 above: `reScheduleKall` fed only
     * `{ kallID }`, or `{ kallID, subject }`, answers `500 "Unable to reschedule kool kall"` both
     * times — a missing required field should be a 400, not a server error. Auto-filed by the
     * engine's own write-flow pipeline (it auto-files any 5xx on an authorized live write) as
     * **#619** [KP-FFF743], CRITICAL, KPost API — recorded here too, as a permanent regression test,
     * rather than left to only ever be caught by chance during an unrelated investigation.
     */
    const scheduled = await endpoints.sendTo(
      'kall-scheduled',
      { body: scheduleShape({ kallDetails: [{ receiver: B.username }] }) },
      { label: 'feature:kall:incomplete-resched-setup', auth: { principal: A }, allowLiveWrite: true },
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
        { label: 'feature:kall:incomplete-resched', auth: { principal: A }, allowLiveWrite: true },
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
});
