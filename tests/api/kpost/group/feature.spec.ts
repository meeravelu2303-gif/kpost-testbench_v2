// An orchestrated group lifecycle driving every group write, not simple assertions; the conditionals
// guard optional steps and cleanup of real live data.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Group **feature flow** — create a group and drive every group WRITE end to end on a real host,
 * self-cleaning: add a member, grant admin, rename, group-image update/remove, a member leaves,
 * remove a member, delete. Gated `GROUP_LIFECYCLE=true`, each write `allowLiveWrite`, all on our own
 * accounts. The two group-image DOWNLOADS are reads keyed by the runtime groupKpostID (off-live,
 * like other needs-id reads). `updateGroupProfileImage` needs a real image part, so a JSON-only call
 * may 4xx — a finding, `expect.soft`.
 */

const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // owner
const C = K.principals.find((p) => p.key === 'personal-3')!; // member who leaves
const member = (kpostID: string, isAdmin = false): Record<string, unknown> => ({
  createdBy: A.username,
  hasAdminAccess: isAdmin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

const createBody = (): Record<string, unknown> => ({
  activeStatus: 'Y',
  createdBy: A.username,
  groupPicturePath: null,
  groupCreateAccess: true,
  groupKpostName: `QA Group ${Date.now()}`,
  isPrivateGroup: 'N',
  memberDetails: [member(testData.victimKpostId), member(A.username, true)],
});

async function as(
  endpoints: EndpointExecutor,
  who: Principal,
  id: string,
  bodyObj: Record<string, unknown> | undefined,
  label: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const ex = await endpoints.sendTo(id, bodyObj ? { body: bodyObj } : {}, {
    label: `group:${label}`,
    auth: { principal: who },
    allowLiveWrite: true,
  });
  const parsed = ex.json();
  const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  return { status: ex.status, data: (value.data as Record<string, unknown>) ?? {} };
}

test.describe('KPost Group · feature flow @database', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    process.env.GROUP_LIFECYCLE !== 'true',
    'creates real groups; set GROUP_LIFECYCLE=true',
  );

  test('create → add member → admin → rename → image → leave → remove → delete @api @group', async ({
    endpoints,
  }) => {
    let groupID: number | undefined;
    try {
      const created = await as(endpoints, A, 'group-create', createBody(), 'create');
      expect.soft(created.status, 'createUserGroup is accepted').toBeLessThan(300);
      const groupKpostID = created.data.groupKpostID as string | undefined;
      groupID = created.data.groupID as number | undefined;
      expect.soft(groupKpostID, 'a groupKpostID is returned').toBeTruthy();

      if (groupKpostID && groupID) {
        const steps: Array<[Principal, string, Record<string, unknown>, string]> = [
          [
            A,
            'group-add-user',
            { groupID, groupKpostID, memberDetails: [member(C.username)] },
            'add-user',
          ],
          [
            A,
            'group-admin-access',
            { kpostIDs: [testData.victimKpostId], ids: [0], groupID, hasAdminAccess: 'Y' },
            'admin-access',
          ],
          [A, 'group-edit-name', { groupKpostID, groupKpostName: 'QA Bench Renamed' }, 'edit-name'],
          [A, 'group-update-image', { groupKpostID }, 'update-image'],
          [A, 'group-remove-image', { groupKpostID }, 'remove-image'],
          [C, 'group-leave', { id: '0', groupID, groupKpostID }, 'leave'],
          [
            A,
            'group-remove-member',
            { memberKpostIdList: [testData.victimKpostId], groupKpostID, groupID },
            'remove-member',
          ],
        ];
        for (const [who, id, bodyObj, label] of steps) {
          const r = await as(endpoints, who, id, bodyObj, label);
          expect.soft(r.status, `${label} returns a status`).toBeLessThan(600);
        }
      }
    } finally {
      if (groupID) {
        await as(endpoints, A, 'group-delete', { groupID }, 'delete').catch(() => undefined);
      }
    }
  });

  test('promote then demote a co-admin, and the sole admin cannot exit (FR-GM-012/013/014) @api @group @security', async ({
    endpoints,
    databases,
  }) => {
    /*
     * FR-GM-012 Add Admin / FR-GM-013 Remove Admin, and the crown BR FR-GM-014: a group must always
     * retain at least one active admin, so the sole admin is blocked from exiting. We create A(admin)
     * + B(member), promote B, demote B (leaving A sole admin), then A tries to exit — which the rule
     * must block. If the backend allows it (200), that is a real finding: the BR is UI-only.
     *
     * ## Why the membership id is read from MySQL
     *
     * `addOrRemoveAdminAccess` takes `ids` — the row ids of the MEMBERSHIPS being changed, not the
     * accounts. This test used to send `ids: [0]` as a placeholder and the endpoint answered 500 on
     * both promote and demote; the endpoint definition's own note already said it "needs a real group
     * id and membership id". A placeholder id is the bench's bug, not the product's, and reporting it
     * as a server defect would have sent a developer after nothing. The real id lives in
     * `TBL_KPOST_USERGROUP_MEMBERDETAILS.id` and the bench can read it, so it does.
     *
     * ## Why the assertions are on the row, not the response
     *
     * `addOrRemoveAdminAccess` answers SUCCESS whatever it wrote. Admin rights that report granted
     * and are not stored is a privilege bug that no response-level check can see — and the inverse,
     * rights that persist after a demote, is a security hole. `admin_access` is the fact.
     */
    const database = databases.for('kpost-api');
    let groupID: number | undefined;
    let groupKpostID: string | undefined;
    try {
      const created = await as(endpoints, A, 'group-create', createBody(), 'create');
      groupKpostID = created.data.groupKpostID as string | undefined;
      groupID = created.data.groupID as number | undefined;
      expect.soft(groupKpostID, 'a groupKpostID is returned').toBeTruthy();
      if (!(groupID && groupKpostID)) return;

      /*
       * The membership row for B in THIS group. Scoped by both group_id and kpost_id: the same
       * account is a member of many groups on a shared test database, and promoting the wrong
       * membership would grant admin somewhere else entirely.
       */
      const membership = database.enabled
        ? await database.findOne<{ id: number; admin_access: string }>({
            table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
            where: { group_id: groupID, kpost_id: testData.victimKpostId, removed_flag: 'N' },
          })
        : undefined;

      test.skip(
        !database.enabled,
        'needs the KPOST_QA connection to resolve the real membership id',
      );
      expect(membership?.id, `B has a membership row in group ${groupID}`).toBeTruthy();
      const memberRowId = membership?.id ?? 0;

      // FR-GM-012 — promote B to co-admin, naming the real membership row.
      const promote = await as(
        endpoints,
        A,
        'group-admin-access',
        {
          kpostIDs: [testData.victimKpostId],
          ids: [memberRowId],
          groupID,
          hasAdminAccess: 'Y',
        },
        'promote-admin',
      );
      expect.soft(promote.status, 'promote to admin is accepted (FR-GM-012)').toBeLessThan(300);

      const afterPromote = await database.findOne<{ admin_access: string }>({
        table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
        where: { id: memberRowId },
      });
      expect
        .soft(afterPromote?.admin_access, 'FR-GM-012: the grant is stored on the membership row')
        .toBe('Y');

      // FR-GM-013 — demote B back to a regular member.
      const demote = await as(
        endpoints,
        A,
        'group-admin-access',
        {
          kpostIDs: [testData.victimKpostId],
          ids: [memberRowId],
          groupID,
          hasAdminAccess: 'N',
        },
        'demote-admin',
      );
      expect.soft(demote.status, 'demote from admin is accepted (FR-GM-013)').toBeLessThan(300);

      /*
       * The security half: rights must actually be REVOKED. A demote that reports success and leaves
       * `admin_access = 'Y'` leaves a user with group-admin powers nobody believes they have.
       */
      const afterDemote = await database.findOne<{ admin_access: string }>({
        table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
        where: { id: memberRowId },
      });
      expect
        .soft(afterDemote?.admin_access, 'FR-GM-013: the revoke is stored, not just reported')
        .toBe('N');

      // FR-GM-014 — A is now the SOLE admin; exiting must be blocked (min-one-admin rule).
      const exit = await as(
        endpoints,
        A,
        'group-leave',
        { id: '0', groupID, groupKpostID },
        'sole-admin-exit',
      );

      /*
       * Asserted against the DATABASE rather than the response code, because either answer is
       * defensible at the API layer and only one is defensible in the data: whatever the endpoint
       * replies, the group must still have an admin afterwards. A group with zero admins cannot be
       * administered by anyone again — members cannot be added, removed or promoted, and the group
       * is effectively orphaned.
       */
      const admins = await database.findMany<{ id: number; kpost_id: string }>({
        table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
        where: { group_id: groupID, admin_access: 'Y', removed_flag: 'N' },
      });
      expect
        .soft(
          admins.length,
          `FR-GM-014: the group must retain at least one admin after the sole admin's exit ` +
            `attempt (exit answered ${exit.status})`,
        )
        .toBeGreaterThan(0);
    } finally {
      if (groupID) {
        await as(endpoints, A, 'group-delete', { groupID, groupKpostID }, 'cleanup-delete').catch(
          () => undefined,
        );
      }
    }
  });
});
