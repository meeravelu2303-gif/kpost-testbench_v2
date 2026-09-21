import { env } from '@config/env';
// An orchestrated multi-step call lifecycle (initiate → status → members → end → clean up), not
// simple assertions; the conditionals guard optional steps and best-effort cleanup of real live data.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import type { Principal } from '@config/auth.config';
import { slotPrincipals } from '../../../../src/test-data/index';
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

/*
 * Caller, callee/joiner and the member added mid-call — from the account pool, so no other worker
 * can log in as them and displace this flow's sessions. Slot 0 resolves to the same three accounts
 * this spec has always used.
 */
const [A, B, C] = slotPrincipals(3) as [Principal, Principal, Principal];

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

test.describe('KPost Kall · feature flow', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    !env.KALL_LIFECYCLE,
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
  }) => {
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

        // FR-C04: the invitee joins.
        const joined = await endpoints.sendTo(
          'kall-join-schedule',
          { body: { id: kallID, kallID } },
          { label: 'feature:kall:join', auth: { principal: B }, allowLiveWrite: true },
        );
        expect.soft(joined.status, 'joinScheduleKall is accepted').toBeLessThan(300);

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
          expect
            .soft(
              String(rescheduledId),
              'BR-C01: reschedule must keep the SAME kallID — a new id means it created a second call instead of updating the original',
            )
            .toBe(String(kallID));
        }
        // BR-C01 / FR-KL-003: the status tag must move to ReScheduled (7). Measured shape:
        // data[0].senderKallStatus. (On the current build it stays 6 = Scheduled — part of the defect.)
        const row = Array.isArray(rescheduledBody.data)
          ? (rescheduledBody.data[0] as Record<string, unknown> | undefined)
          : undefined;
        if (row?.senderKallStatus !== undefined) {
          expect
            .soft(row.senderKallStatus, 'BR-C01: reschedule sets the status tag to ReScheduled (7)')
            .toBe(7);
        }

        const ended = await endpoints.sendTo(
          'kall-end-kool',
          { body: { id: kallID, kallID } },
          { label: 'feature:kall:end-kool', auth: { principal: A }, allowLiveWrite: true },
        );
        expect.soft(ended.status, 'endKoolKall is accepted').toBeLessThan(300);
      }
    } finally {
      await clearHistory(endpoints, [A, B, C]);
    }
  });

  test('a repeating scheduled call is created (FR-C02) @api @kall', async ({ endpoints }) => {
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
});
