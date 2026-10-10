// Regression coverage for three V1 KallController (no `/v2` prefix, dead from the real frontend —
// see src/api/definitions/kpost/kall/legacy.api.ts) findings confirmed from source 2026-10-06/07.
// `setKallStatus` and `cancelScheduleKall` share the SAME root cause (cancelScheduleKall calls the
// identical kallService.setKallStatus) and are filed under the same ruleId so the bug-filing engine
// consolidates them into one ticket covering both routes, per the "state the affected count" rule.

import { AUTH_PROFILES } from '@config/auth-profile';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';
import { expect, test } from '@fixtures';

const K = AUTH_PROFILES.kpost;
const owner = K.principals.find((p) => p.key === 'personal');
const attacker = K.principals.find((p) => p.key === 'personal-3');

test.describe('KPost Security · Kall V1 legacy writes — unscoped by kallID/id @api @kpost-api @security @kall', () => {
  test.skip(!owner || !attacker, 'needs two distinct KPost principals');
  test.skip(
    process.env.KALL_LIFECYCLE !== 'true',
    'schedules a real call; set KALL_LIFECYCLE=true',
  );

  test("an attacker can cancel the owner's scheduled call via the legacy setKallStatus route by naming its raw kallID", async ({
    endpoints,
  }) => {
    const created = await endpoints.sendTo(
      'kall-scheduled',
      { body: scheduleShape() },
      { label: 'kall-legacy:schedule', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = created.json();
    const rawData = parsed.ok ? (parsed.value as Record<string, unknown>).data : undefined;
    const data = (Array.isArray(rawData) ? rawData[0] : rawData) as
      Record<string, unknown> | undefined;
    const kallID = data?.kallID as number | string | undefined;
    test.skip(!kallID, `scheduledKall did not return a kallID (status ${created.status})`);
    if (!kallID) return;

    const attack = await endpoints.sendTo(
      'kall-legacy-set-status',
      { body: { kallID, kallStatus: 'cancelled', kallEndTime: new Date().toISOString() } },
      {
        label: 'kall-legacy:setstatus-attack',
        auth: { principal: attacker! },
        allowLiveWrite: true,
      },
    );

    const succeeded = attack.status < 300;
    if (succeeded) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'kall-legacy-set-status',
        ruleId: 'KPV2-LEGACYKALLSTATUSUNSCOPED',
        rule:
          'A Kall status update must verify the caller owns the call (as sender or receiver) before ' +
          'applying it — an attacker authenticated as an unrelated account must not be able to ' +
          "cancel/modify another user's scheduled call by naming its raw kallID. This is the same " +
          'underlying fault as the legacy cancelScheduleKall route (it calls the identical service ' +
          'method) — affects 2 endpoints, one shared fix (an ownership check before the UPDATE) ' +
          'resolves both.',
        expected: 'the attack is refused (non-2xx) because the caller does not own this kall row',
        actual: `the attack succeeded (${attack.status}): ${attack.bodyText.slice(0, 300)}`,
        request: { body: { kallID, kallStatus: 'cancelled' } },
      });
    }
    expect(
      succeeded,
      "an attacker must not be able to modify another account's call via the legacy route",
    ).toBe(false);
  });

  test("an attacker can cancel the owner's scheduled call via the legacy cancelScheduleKall route by naming its raw kallID", async ({
    endpoints,
  }) => {
    const created = await endpoints.sendTo(
      'kall-scheduled',
      { body: scheduleShape() },
      { label: 'kall-legacy:schedule', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = created.json();
    const rawData = parsed.ok ? (parsed.value as Record<string, unknown>).data : undefined;
    const data = (Array.isArray(rawData) ? rawData[0] : rawData) as
      Record<string, unknown> | undefined;
    const kallID = data?.kallID as number | string | undefined;
    test.skip(!kallID, `scheduledKall did not return a kallID (status ${created.status})`);
    if (!kallID) return;

    const attack = await endpoints.sendTo(
      'kall-legacy-cancel-schedule',
      { body: { kallID, kallStatus: 'cancelled', kallEndTime: new Date().toISOString() } },
      {
        label: 'kall-legacy:cancelschedule-attack',
        auth: { principal: attacker! },
        allowLiveWrite: true,
      },
    );

    const succeeded = attack.status < 300;
    if (succeeded) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'kall-legacy-cancel-schedule',
        ruleId: 'KPV2-LEGACYKALLSTATUSUNSCOPED',
        rule:
          'Same fault as kall-legacy-set-status (this route calls the identical ' +
          "kallService.setKallStatus) — an attacker must not be able to cancel another account's " +
          'call by naming its raw kallID.',
        expected: 'the attack is refused (non-2xx) because the caller does not own this kall row',
        actual: `the attack succeeded (${attack.status}): ${attack.bodyText.slice(0, 300)}`,
        request: { body: { kallID, kallStatus: 'cancelled' } },
      });
    }
    expect(
      succeeded,
      "an attacker must not be able to modify another account's call via the legacy route",
    ).toBe(false);
  });

  test("an attacker can hard-delete the owner's scheduled call via the legacy removeMemberKatchupKall route", async ({
    endpoints,
  }) => {
    const created = await endpoints.sendTo(
      'kall-scheduled',
      { body: scheduleShape() },
      { label: 'kall-legacy:schedule', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = created.json();
    const rawData = parsed.ok ? (parsed.value as Record<string, unknown>).data : undefined;
    const data = (Array.isArray(rawData) ? rawData[0] : rawData) as
      Record<string, unknown> | undefined;
    const kallID = data?.kallID as number | string | undefined;
    test.skip(!kallID, `scheduledKall did not return a kallID (status ${created.status})`);
    if (!kallID) return;

    const attack = await endpoints.sendTo(
      'kall-legacy-remove-member',
      { body: { idsList: [kallID] } },
      {
        label: 'kall-legacy:removemember-attack',
        auth: { principal: attacker! },
        allowLiveWrite: true,
      },
    );

    const succeeded = attack.status < 300;
    if (succeeded) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'kall-legacy-remove-member',
        ruleId: 'KPV2-LEGACYKALLBULKDELETE',
        rule:
          'A delete must verify the caller owns every id in the list before deleting it — an ' +
          'attacker authenticated as an unrelated account must not be able to permanently delete ' +
          "another user's scheduled-call row by naming its raw id. This is a bulk hard DELETE with " +
          'no ownership predicate at any layer (controller, service or DAO).',
        expected:
          'the attack is refused (non-2xx), or at minimum deletes nothing the caller does not own',
        actual: `the attack succeeded (${attack.status}): ${attack.bodyText.slice(0, 300)}`,
        request: { body: { idsList: [kallID] } },
      });
    }
    expect(
      succeeded,
      "an attacker must not be able to delete another account's scheduled call via the legacy route",
    ).toBe(false);
  });
});
