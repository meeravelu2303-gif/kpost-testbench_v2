// A cross-account authorization (IDOR / BOLA) flow: an outsider acting on another account's group.
// Conditionals guard the setup/teardown of real live data, so they are intentional here.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
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
     * Expected failure while Bugzilla #507 is open. The removeGroupMember assertion below fails
     * because an outsider CAN remove members (the confirmed BOLA hole). `test.fail()` keeps the run
     * green while the vulnerability is live and turns it RED the moment removeGroupMember starts
     * enforcing authorization — which is exactly when someone must know, so this can be flipped back
     * and the ticket closed. The other two assertions (grant-admin, rename) already pass — the
     * server protects those — so this test also fails if either of THEM regresses into a hole.
     */
    // Bugzilla #507 reported fixed — now asserted normally (an outsider must NOT be able to remove
    // members / administer a group they don't belong to). Was pinned with test.fail() while the
    // BOLA hole was live.
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
      expect
        .soft(
          attackerRow?.admin_access ?? 'absent',
          'BOLA: an outsider must not become admin of a group they do not belong to ' +
            `(addOrRemoveAdminAccess replied ${grabAdmin.status})`,
        )
        .not.toBe('Y');

      const memberStillThere = await database.findOne<{ removed_flag: string }>({
        table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
        where: { group_id: groupID, kpost_id: testData.victimKpostId },
      });
      expect
        .soft(
          memberStillThere?.removed_flag ?? 'Y',
          `BOLA: an outsider must not remove a member (removeGroupMember replied ${kickMember.status})`,
        )
        .toBe('N');

      const groupRow = await database.findOne<{ group_name: string }>({
        table: 'TBL_KPOST_USERGROUP_MASTER',
        where: { group_id: groupID },
      });
      expect
        .soft(
          String(groupRow?.group_name ?? ''),
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
