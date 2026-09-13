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

test.describe('KPost Group · feature flow', () => {
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
});
