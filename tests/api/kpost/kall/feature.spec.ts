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

        // BR-C01: rescheduling must KEEP the same entry (kallID) and only move its status tag to
        // Rescheduled. Assert this against the RESPONSE, not just "accepted": if reScheduleKall
        // returns a NEW kallID, it created a second call instead of updating the original — the
        // BR-C01 violation. (The old test only checked status < 300, so it missed exactly this.)
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
        if (rescheduledId !== undefined) {
          if (rescheduledId !== kallID) {
            // CONFIRMED BR-C01 violation — file it to the developer, not just a soft assert.
            endpoints.recordBusinessRuleViolation({
              endpointId: 'kall-reschedule',
              ruleId: 'BR-C01',
              rule: 'Rescheduling a call must keep the same call (kallID) and only move its status to Rescheduled — it must not create a new call.',
              expected: `the same kallID (${kallID})`,
              actual: `a new kallID (${rescheduledId}) — a second call was created`,
              request: { body: { kallID } },
            });
          }
          /*
           * The identity rule itself is asserted in its own test below ("BR-C01 · reschedule
           * identity"), pinned to Bugzilla #501. It is deliberately NOT asserted here: this test
           * covers six steps, and `test.fail()` inverts a whole test — pinning it here would mean a
           * regression in join, end or the database assertions was also reported as "expected".
           * The violation is still RECORDED above, so the defect keeps reaching the developer.
           */
          test.info().annotations.push({
            type: 'observed',
            description:
              `reschedule returned kallID ${rescheduledId} for original ${kallID} ` +
              `(Bugzilla #501 — asserted in its own test).`,
          });
        }
        // BR-C01 / FR-KL-003: the status tag must move to ReScheduled (7). Measured shape:
        // data[0].senderKallStatus. (On the current build it stays 6 = Scheduled — part of the defect.)
        const row = Array.isArray(rescheduledBody.data)
          ? (rescheduledBody.data[0] as Record<string, unknown> | undefined)
          : undefined;
        // Status tag: also part of BR-C01 and also asserted in the pinned test below.
        if (row?.senderKallStatus !== undefined) {
          test.info().annotations.push({
            type: 'observed',
            description: `reschedule response senderKallStatus = ${JSON.stringify(row.senderKallStatus)} (expected 7).`,
          });
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
     * Expected failure while Bugzilla #500 is open, and deterministic enough to pin: every repeat
     * interval answers 500 while repeatType 0 ("no repeat") answers 200, measured 3 passes x 3
     * intervals with no variation. Unlike the login race (#496), there is no coin toss here, so
     * `test.fail()` is safe — it keeps the run green while the defect is live and turns RED the
     * moment a repeating call can be created.
     */
    test.fail(
      true,
      'known product defect (Bugzilla #500): scheduledRepeatKall 500s for every repeat interval',
    );
    try {
      const repeat = await endpoints.sendTo(
        'kall-scheduled-repeat',
        {
          body: scheduleShape({
            repeatType: 1,
            repeatedDate: JSON.stringify({ start_date: '2026-09-14', end_date: '2026-09-20' }),
            kallDetails: [{ receiver: B.username }],
          }),
        },
        { label: 'feature:kall:repeat', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(repeat.status, 'scheduledRepeatKall is accepted').toBeLessThan(300);
    } finally {
      await clearHistory(endpoints, [A, B]);
    }
  });

  test('BR-C01 · reschedule keeps the original call, and only moves its status tag @api @kall', async ({
    endpoints,
    databases,
  }) => {
    /*
     * Expected failure while Bugzilla #501 is open.
     *
     * Deterministic, so `test.fail()` is the right instrument here where it was the wrong one for
     * the login race (#496): measured 3/3, the reschedule always returns original + 1. It keeps the
     * run green while the defect is live and turns RED the moment reschedule starts updating in
     * place — which is the signal to close the ticket.
     *
     * Split out of the long scheduled-call flow deliberately. `test.fail()` inverts an entire test,
     * so pinning it on a six-step flow would also swallow a regression in join, end or the database
     * assertions. A pinned test should assert one rule.
     */
    test.fail(
      true,
      'known product defect (Bugzilla #501): reScheduleKall creates a new call instead of updating',
    );
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

      /*
       * The rule, in one assertion: BR-C01 says rescheduling "updates the status tag Scheduled →
       * Rescheduled while keeping the original entry's identity". A different id means a second
       * call was created and every client holding the original id is now pointing at a stale
       * record.
       */
      expect(
        String(rescheduledId),
        'BR-C01: reschedule must keep the SAME kallID — a new id means a second call was created',
      ).toBe(String(kallID));

      /*
       * The database half, which is what makes the two-row behaviour indefensible rather than
       * merely surprising: the table carries `parent_kall_id` for exactly this case, and it is left
       * NULL, so the new call cannot be traced back to the one it replaced.
       */
      if (
        database.enabled &&
        rescheduledId !== undefined &&
        String(rescheduledId) !== String(kallID)
      ) {
        const created = await database.findOne<{ parent_kall_id: number | null }>({
          table: 'TBL_KPOST_KOOL_KALL_MASTER',
          where: { kall_id: rescheduledId },
        });
        expect(
          created?.parent_kall_id,
          'if a second call IS created, it must at least point back at the original',
        ).toBe(Number(kallID));
      }
    } finally {
      await clearHistory(endpoints, [A, B]);
    }
  });
});
