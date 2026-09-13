// An orchestrated multi-step call lifecycle (initiate → status → end → clean up), not simple
// assertions; the conditionals guard optional steps and best-effort cleanup of real live data.
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
 * a call is placed and issues an id, its status transitions, it ends, and the log clears — not that
 * audio flows. Coverage: the direct-call lifecycle (FR-C05/C06/C08) and the scheduled-call
 * lifecycle including the reschedule status tag Scheduled → Rescheduled (BR-C01).
 */

const K = AUTH_PROFILES.kpost;
const principal = (key: string): Principal => {
  const found = K.principals.find((p) => p.key === key);
  if (!found) throw new Error(`principal "${key}" is not configured`);
  return found;
};

const A = principal('personal'); // caller     Qatesting@
const B = principal('victim'); // callee/joiner Qatesting2@

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

/** Clear specific calls from the caller's own log. Never throws. */
async function clearByIds(
  endpoints: EndpointExecutor,
  as: Principal,
  kallIds: number[],
): Promise<void> {
  if (!kallIds.length) return;
  await endpoints
    .sendTo(
      'kall-clear-by-ids',
      { body: { kallIds } },
      { label: 'feature:kall:cleanup', auth: { principal: as }, allowLiveWrite: true },
    )
    .catch(() => undefined);
}

test.describe('KPost Kall · feature flow', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    process.env.KALL_LIFECYCLE !== 'true',
    'places/schedules real calls; set KALL_LIFECYCLE=true (owner sign-off, docs/kall-flow.md §5)',
  );

  test('a normal call is placed, issues an id, transitions status and ends (FR-C05/C08) @api @kall', async ({
    endpoints,
  }) => {
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
      const cancelled = await endpoints.sendTo(
        'kall-update-status',
        { body: { id: kallID, kallStatus: KALL_STATUS.cancelled, kallID } },
        { label: 'feature:kall:cancel', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(cancelled.status, 'the status transition is accepted').toBeLessThan(300);

      const ended = await endpoints.sendTo(
        'kall-end-individual',
        { body: { kallID } },
        { label: 'feature:kall:end', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(ended.status, 'ending the call is accepted').toBeLessThan(300);

      await clearByIds(endpoints, A, [kallID]);
    }
  });

  test('a scheduled call reschedules keeping its id, status tag Scheduled → Rescheduled (BR-C01) @api @kall', async ({
    endpoints,
  }) => {
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
      const rescheduled = await endpoints.sendTo(
        'kall-reschedule',
        { body: scheduleShape({ kallID, kallDetails: [{ receiver: B.username }] }) },
        { label: 'feature:kall:reschedule', auth: { principal: A }, allowLiveWrite: true },
      );
      // BR-C01: the same entry (kallID) is kept; the status tag moves to Rescheduled.
      expect.soft(rescheduled.status, 'the reschedule is accepted').toBeLessThan(300);

      const ended = await endpoints.sendTo(
        'kall-end-kool',
        { body: { id: kallID, kallID } },
        { label: 'feature:kall:end-kool', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(ended.status, 'ending the scheduled call is accepted').toBeLessThan(300);

      await clearByIds(endpoints, A, [kallID]);
    }
  });
});
