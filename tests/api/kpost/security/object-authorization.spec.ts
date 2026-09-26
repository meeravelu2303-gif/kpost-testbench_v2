// A cross-account authorization (IDOR / BOLA) flow: an outsider acting on another account's group.
// Conditionals guard the setup/teardown of real live data, so they are intentional here.
/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Object-level authorization — can an outsider act on a group they neither own nor belong to?
 *
 * ## Why this is the check that mattered most to add
 *
 * The contract sweep proves each endpoint validates its own input. What it never asked is the
 * authorization question that only appears across TWO accounts: `addOrRemoveAdminAccess`,
 * `removeGroupMember` and `editGroupName` all take a `groupID`, and nothing in the payload ties that
 * id to the caller. So the real test is: does the server check that the caller actually administers
 * the group, or does it act on any `groupID` it is handed? The second is the classic BOLA / IDOR
 * hole — one account silently administering another's group.
 *
 * This was chosen over the other deny-list candidates deliberately. `deleteContact` and the
 * other-domain contact edits are NOT exploitable this way: their payload names no other account's
 * list — the owner is always the token — so an attacker can only ever affect their own data. A group
 * id, by contrast, is an object handle an attacker can point anywhere. Testing an endpoint that has
 * no cross-account surface would only manufacture a false negative.
 *
 * ## Why the database is the judge, not the response
 *
 * KPost answers HTTP 200 with a failure envelope, and an authorization bug is precisely the case
 * where the response cannot be trusted — a server that wrongly allows the action may still answer
 * "success". The authoritative assertion is therefore the ROW: after the outsider's attempt, the
 * group's admin set, membership and name must be UNCHANGED. A response is an opinion; the table is
 * the fact.
 *
 * ## Safety
 *
 * The owner creates a throwaway group and deletes it in teardown. Every write is on that group only,
 * carries `allowLiveWrite`, and acts on accounts the bench owns. The attacker's writes are EXPECTED
 * to be denied; if the product is vulnerable they would take effect on the throwaway group, which is
 * removed either way.
 */
test.describe('KPost Security · object-level authorization (IDOR/BOLA) @api @kpost-api @security @database', () => {
  const K = AUTH_PROFILES.kpost;
  const owner = K.principals.find((p) => p.key === 'personal');
  const attacker = K.principals.find((p) => p.key === 'personal-3');

  test.skip(!owner || !attacker, 'needs two distinct KPost principals (personal + personal-3)');
  test.skip(!testData.password, 'needs the shared QA password to act as a second account');

  const member = (kpostID: string, isAdmin = false): Record<string, unknown> => ({
    createdBy: owner?.username,
    hasAdminAccess: isAdmin ? 'Y' : 'N',
    kpostID,
    name: 'QA Bench',
    memberDesignation: '',
    privacyStatus: 'Y',
    remarks: 'created',
  });

  /**
   * Send `id` as a specific principal, returning status + the envelope's data.
   *
   * An attacker probe that the identifier guard refuses to send comes back as status -1 rather than
   * throwing, so one blocked probe cannot abort the database verdicts for the others — each attack is
   * judged independently by the row it did or did not change.
   */
  async function as(
    endpoints: EndpointExecutor,
    who: Principal,
    id: string,
    body: Record<string, unknown> | undefined,
    label: string,
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    try {
      const ex = await endpoints.sendTo(id, body ? { body } : {}, {
        label: `idor:${label}`,
        auth: { principal: who },
        allowLiveWrite: true,
      });
      const parsed = ex.json();
      const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
      return { status: ex.status, data: (value.data as Record<string, unknown>) ?? {} };
    } catch (error) {
      return { status: -1, data: { error: (error as Error).message } };
    }
  }

  test('an outsider cannot administer a group they do not belong to @api @security', async ({
    endpoints,
    databases,
  }) => {
    /*
     * Bugzilla #507 was closed RESOLVED/FIXED on 2026-09-22 — but live-verified again 2026-09-26,
     * with a real outsider account (`personal-3`) and a fresh throwaway group, the BOLA hole is
     * still there: `removeGroupMember` lets an outsider remove a legitimate member from a group they
     * neither own nor belong to (`removed_flag` moves to 1 in the database — a 200 that actually
     * mutated another tenant's data). The other two attacks (grant-self-admin, rename) are correctly
     * denied — only the remove-member path is vulnerable. #507 reopened with this evidence. Filed
     * explicitly below (a soft assertion alone was never enough to get this tracked — it takes a
     * DB-level check to see a BOLA hole at all, and nothing upstream auto-files a 200 that shouldn't
     * have worked). The first run after this fix filed a new ticket (#623) instead of commenting on
     * the reopened #507 — a new `recordBusinessRuleViolation` call always mints its own fingerprint,
     * it doesn't know about a differently-fingerprinted ticket for the same fault. #623 closed as a
     * duplicate of #507; #507 is the ticket of record going forward.
     */
    const database = databases.for('kpost-api');
    test.skip(
      !database.enabled,
      'needs the KPOST_QA connection to judge by the row, not the reply',
    );

    let groupID: number | undefined;
    let groupKpostID: string | undefined;
    try {
      // --- Owner creates a throwaway group, with the counterparty as a plain member ---------------
      const created = await as(
        endpoints,
        owner!,
        'group-create',
        {
          activeStatus: 'Y',
          createdBy: owner!.username,
          groupPicturePath: null,
          groupCreateAccess: true,
          groupKpostName: `QA IDOR Group ${Date.now()}`,
          isPrivateGroup: 'N',
          memberDetails: [member(testData.victimKpostId), member(owner!.username, true)],
        },
        'create',
      );
      groupID = created.data.groupID as number | undefined;
      groupKpostID = created.data.groupKpostID as string | undefined;
      expect(groupID, 'the owner created the group').toBeTruthy();
      if (!groupID) return;

      /*
       * The membership row for the counterparty in this group — the id addOrRemoveAdminAccess and
       * removeGroupMember operate on. Read from MySQL because the attacker would have to know or
       * guess it, and we are testing whether knowing it is enough to act (it must not be).
       */
      const victimMembership = await database.findOne<{ id: number; admin_access: string }>({
        table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
        where: { group_id: groupID, kpost_id: testData.victimKpostId, removed_flag: 'N' },
      });
      const membershipId = victimMembership?.id ?? 0;

      // --- The attacker: an account that is neither the group's admin nor a member ---------------
      // 1) Try to grant THEMSELVES admin on the owner's group.
      const grabAdmin = await as(
        endpoints,
        attacker!,
        'group-admin-access',
        {
          kpostIDs: [attacker!.username],
          ids: [membershipId],
          groupID,
          hasAdminAccess: 'Y',
        },
        'attacker-grants-self-admin',
      );

      // 2) Try to remove the legitimate member from the owner's group.
      const kickMember = await as(
        endpoints,
        attacker!,
        'group-remove-member',
        { memberKpostIdList: [testData.victimKpostId], groupID },
        'attacker-removes-member',
      );

      // 3) Try to rename the owner's group.
      const rename = await as(
        endpoints,
        attacker!,
        'group-edit-name',
        { groupID, groupKpostID, groupName: 'HACKED BY QA BENCH' },
        'attacker-renames',
      );

      /*
       * The verdicts, read from the database — the only source that cannot be spoofed by a 200.
       */
      const attackerRow = await database.findOne<{ admin_access: string }>({
        table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
        where: { group_id: groupID, kpost_id: attacker!.username },
      });
      const attackerAdminAccess = attackerRow?.admin_access ?? 'absent';
      if (attackerAdminAccess === 'Y') {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'group-admin-access',
          ruleId: 'BOLA-outsider-grants-self-admin',
          rule: 'addOrRemoveAdminAccess must refuse a caller who neither owns nor belongs to the group — an outsider must not be able to grant themselves admin.',
          expected: "admin_access stays not 'Y' (the outsider's call is refused)",
          actual: `admin_access=Y (addOrRemoveAdminAccess replied ${grabAdmin.status}) — the outsider became admin`,
          request: { body: { kpostIDs: [attacker!.username], groupID } },
        });
      }
      expect
        .soft(
          attackerAdminAccess,
          'BOLA: an outsider must not become admin of a group they do not belong to ' +
            `(addOrRemoveAdminAccess replied ${grabAdmin.status})`,
        )
        .not.toBe('Y');

      const memberStillThere = await database.findOne<{ removed_flag: string }>({
        table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
        where: { group_id: groupID, kpost_id: testData.victimKpostId },
      });
      const removedFlag = String(memberStillThere?.removed_flag ?? 'Y');
      if (removedFlag !== 'N') {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'group-remove-member',
          ruleId: 'BOLA-outsider-removes-member',
          rule: 'removeGroupMember must refuse a caller who neither owns nor belongs to the group — an outsider must not be able to remove another group’s member.',
          expected: "removed_flag stays 'N' (the outsider's call is refused)",
          actual: `removed_flag=${removedFlag} (removeGroupMember replied ${kickMember.status}) — the outsider's removal took effect`,
          request: { body: { memberKpostIdList: [testData.victimKpostId], groupID } },
        });
      }
      expect
        .soft(
          removedFlag,
          `BOLA: an outsider must not remove a member (removeGroupMember replied ${kickMember.status})`,
        )
        .toBe('N');

      const groupRow = await database.findOne<{ group_name: string }>({
        table: 'TBL_KPOST_USERGROUP_MASTER',
        where: { group_id: groupID },
      });
      const groupName = String(groupRow?.group_name ?? '');
      if (groupName === 'HACKED BY QA BENCH') {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'group-edit-name',
          ruleId: 'BOLA-outsider-renames-group',
          rule: 'editGroupName must refuse a caller who neither owns nor belongs to the group — an outsider must not be able to rename it.',
          expected: "group_name unchanged (the outsider's call is refused)",
          actual: `group_name="HACKED BY QA BENCH" (editGroupName replied ${rename.status}) — the outsider's rename took effect`,
          request: { body: { groupID, groupName: 'HACKED BY QA BENCH' } },
        });
      }
      expect
        .soft(
          groupName,
          `BOLA: an outsider must not rename the group (editGroupName replied ${rename.status})`,
        )
        .not.toBe('HACKED BY QA BENCH');
    } finally {
      // Remove the throwaway group whatever happened, so a vulnerability does not leave litter.
      if (groupID) {
        await as(endpoints, owner!, 'group-delete', { groupID, groupKpostID }, 'cleanup').catch(
          () => undefined,
        );
      }
    }
  });
});
