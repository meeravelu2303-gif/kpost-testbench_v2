import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Object-level authorization (IDOR/BOLA): can an outsider administer, empty or rename another
 * account's group by its `groupID`? The database row is the verdict, not the response.
 * The owner creates a throwaway group and deletes it in teardown.
 */
test.describe(
  'KPost Security · object-level authorization (IDOR/BOLA) @api @kpost-api @security @database',
  {
    tag: ['@api', '@auth', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
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
     * Send `id` as a principal. A probe the identifier guard blocks returns status -1 instead of
     * throwing, so it cannot abort the other attacks' verdicts.
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
      // Known defect #507: removeGroupMember lets an outsider remove a member.
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

        // The counterparty's membership row id: knowing it must not be enough to act on it.
        const victimMembership = await database.findOne<{ id: number; admin_access: string }>({
          table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
          // removed_flag is numeric (0 = present, 1 = removed); admin_access is 'Y'/'N'.
          where: { group_id: groupID, kpost_id: testData.victimKpostId, removed_flag: 0 },
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

        // The verdicts, read from the database.
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

        const memberStillThere = await database.findOne<{ removed_flag: number }>({
          table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
          where: { group_id: groupID, kpost_id: testData.victimKpostId },
        });
        // 0 = still a member, 1 = removed; a vanished row counts as removed.
        const removedFlag = Number(memberStillThere?.removed_flag ?? 1);
        if (removedFlag !== 0) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'group-remove-member',
            ruleId: 'BOLA-outsider-removes-member',
            rule: 'removeGroupMember must refuse a caller who neither owns nor belongs to the group — an outsider must not be able to remove another group’s member.',
            expected: 'removed_flag stays 0 (the outsider’s call is refused)',
            actual: `removed_flag=${removedFlag} (removeGroupMember replied ${kickMember.status}) — the outsider's removal took effect`,
            request: { body: { memberKpostIdList: [testData.victimKpostId], groupID } },
          });
        }
        expect
          .soft(
            removedFlag,
            `BOLA: an outsider must not remove a member (removeGroupMember replied ${kickMember.status})`,
          )
          .toBe(0);

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
        // deleteGroup refuses while anyone but the admin remains, so the member goes first.
        if (groupID) {
          await as(
            endpoints,
            owner!,
            'group-remove-member',
            { memberKpostIdList: [testData.victimKpostId], groupID, groupKpostID },
            'cleanup-remove',
          );
          const deleted = await as(
            endpoints,
            owner!,
            'group-delete',
            { groupID, groupKpostID },
            'cleanup',
          );
          expect
            .soft(deleted.status, 'the throwaway group is deleted (nothing left behind)')
            .toBe(200);
        }
      }
    });
  },
);
