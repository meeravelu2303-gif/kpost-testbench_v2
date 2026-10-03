// Cross-account authorization (IDOR/BOLA) for Kall. Conditionals guard live setup.
/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import { KALL_STATUS } from '@api/schemas/kpost-types';
import { initiateShape } from '@api/definitions/kpost/kall/direct.api';
import { expect, test } from '@fixtures';

/**
 * Can an outsider end or change the status of a call they are neither the sender nor the receiver
 * of? `updateKallStatus`/`endIndividualKall` take a bare `kallID` and nothing else that ties it to
 * the caller — the same object-handle shape that made `removeGroupMember` exploitable (Bugzilla
 * #507) and that this bench already proved safe for Katchup's recall/delete. Kall had zero IDOR
 * coverage of any kind before this (confirmed: 0/20 endpoints, see the 2026-10-03 ground-truth
 * re-audit) despite several of its writes being exactly this shape.
 *
 * ## The database is the judge
 *
 * `updateKallStatus` answers SUCCESS regardless, so the verdict is the row: after the outsider's
 * attempt, the call's `sender_kall_status` in `TBL_KPOST_KOOL_KALL_MASTER` must be unchanged.
 */
test.describe('KPost Security · Kall call authorization (IDOR/BOLA) @api @kpost-api @security @kall @database', () => {
  const K = AUTH_PROFILES.kpost;
  const owner = K.principals.find((p) => p.key === 'personal');
  const receiver = K.principals.find((p) => p.key === 'victim');
  const attacker = K.principals.find((p) => p.key === 'personal-3');

  test.skip(!owner || !receiver || !attacker, 'needs three distinct KPost principals');
  test.skip(process.env.KALL_LIFECYCLE !== 'true', 'places a real call; set KALL_LIFECYCLE=true');

  test('an outsider cannot change the status of a call they are not party to @api @security', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

    // --- Setup: the owner places a call to the receiver -------------------------------------------
    const placed = await endpoints.sendTo(
      'kall-initiate',
      { body: initiateShape({ receiver: receiver!.username }) },
      { label: 'idor:kall-initiate', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = placed.json();
    const body = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
    const data = body.data;
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    const obj =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : undefined;
    const kallID = [obj?.kallID, obj?.id, row?.kallID, row?.id, body.kallID].find(
      (candidate) => typeof candidate === 'number',
    ) as number | undefined;

    // No kallID means initiate didn't create one; skip with a reason rather than failing.
    test.skip(
      !kallID,
      `kall-initiate did not return a kallID to attack (placed replied ${placed.status})`,
    );

    const realKallId = kallID as number;

    try {
      const before = await database.findOne<{ sender_kall_status: number }>({
        table: 'TBL_KPOST_KOOL_KALL_MASTER',
        where: { kall_id: realKallId },
      });

      // --- Attack: the outsider tries to cancel and then end the owner's call -------------------
      const attackCancel = await endpoints.sendTo(
        'kall-update-status',
        { body: { id: kallID, kallStatus: KALL_STATUS.cancelled, kallID } },
        { label: 'idor:kall-update-status', auth: { principal: attacker! }, allowLiveWrite: true },
      );
      const attackEnd = await endpoints.sendTo(
        'kall-end-individual',
        { body: { kallID } },
        { label: 'idor:kall-end-individual', auth: { principal: attacker! }, allowLiveWrite: true },
      );

      const after = await database.findOne<{ sender_kall_status: number }>({
        table: 'TBL_KPOST_KOOL_KALL_MASTER',
        where: { kall_id: realKallId },
      });

      expect
        .soft(
          after?.sender_kall_status ?? before?.sender_kall_status,
          `BOLA: an outsider must not change a call they are not party to ` +
            `(updateKallStatus replied ${attackCancel.status}, endIndividualKall replied ${attackEnd.status})`,
        )
        .toBe(before?.sender_kall_status);
    } finally {
      // Cleanup: the owner ends and clears their own call so nothing is left dangling.
      await endpoints
        .sendTo(
          'kall-end-individual',
          { body: { kallID } },
          { label: 'idor:kall-cleanup-end', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
      await endpoints
        .sendTo(
          'kall-clear-by-ids',
          { body: { kallIds: [kallID] } },
          { label: 'idor:kall-cleanup-clear', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });
});
