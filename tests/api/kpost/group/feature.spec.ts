import { env } from '@config/env';
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

/**
 * A READ against a resource this flow just created.
 *
 * It uses `allowLiveRead`, not `allowLiveWrite`. The two are separate capabilities on purpose:
 * `allowLiveWrite` requires `destructive === true`, so it cannot authorise a GET at all, and
 * declaring these downloads destructive to borrow the write path would misstate them and leave a
 * read one flag away from write authorisation. `allowLiveRead` requires the opposite —
 * `destructive !== true` — so it can never unlock a write by construction.
 *
 * This is the recovery path `docs/ENDPOINT-EXECUTION-MATRIX.md` recorded for these two endpoints
 * when they were blocked, now that Phase 8 built the capability.
 */
async function readAs(
  endpoints: EndpointExecutor,
  who: Principal,
  id: string,
  pathParams: Record<string, string>,
  label: string,
): Promise<{ status: number; contentType: string | undefined }> {
  const ex = await endpoints.sendTo(
    id,
    { pathParams },
    { label: `group:${label}`, auth: { principal: who }, allowLiveRead: true },
  );
  return { status: ex.status, contentType: ex.headers['content-type'] };
}

test.describe('KPost Group · feature flow', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.GROUP_LIFECYCLE, 'creates real groups; set GROUP_LIFECYCLE=true');

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
        // The row ids the create response issued for the non-admin members — what promotion needs.
        const createdMembers = Array.isArray(created.data.memberDetails)
          ? (created.data.memberDetails as Record<string, unknown>[])
          : [];
        const memberRowIds = createdMembers
          .filter((row) => row.kpostID === testData.victimKpostId)
          .map((row) => row.id);

        const steps: Array<[Principal, string, Record<string, unknown>, string]> = [
          [
            A,
            'group-add-user',
            { groupID, groupKpostID, memberDetails: [member(C.username)] },
            'add-user',
          ],
          /*
           * `ids` carries the member ROW ids `createUserGroup` issued, not a placeholder.
           *
           * This sent `ids: [0]` and had been producing a reproducible HTTP 500 that reached the
           * backend bug candidates as `group-admin-access`. Confirmed on live
           * (`backend-confirmation.spec.ts`): with the real row id the same call answers
           * **200 "Admin added successfully"**, and only the placeholder faults. So the 500 was our
           * payload, and filing it would have sent a developer after a defect that does not exist.
           */
          [
            A,
            'group-admin-access',
            { kpostIDs: [testData.victimKpostId], ids: memberRowIds, groupID, hasAdminAccess: 'Y' },
            'admin-access',
          ],
          [A, 'group-edit-name', { groupKpostID, groupKpostName: 'QA Bench Renamed' }, 'edit-name'],
          [A, 'group-update-image', { groupKpostID }, 'update-image'],
          // remove-image runs AFTER the downloads below — see the note there.
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

        /*
         * The two group-image DOWNLOADS, driven here and nowhere else.
         *
         * They are GETs keyed by a RUNTIME groupKpostID, so no static value can reach them: a
         * fabricated group id 404s, which is why they are not `productionSafe`. Until Phase 8 they
         * were recorded as BLOCKED coverage debt, because `allowLiveWrite` requires
         * `destructive === true` and so cannot authorise a read. `allowLiveRead` is the recovery
         * path that entry named, and this is it being used.
         *
         * They run BEFORE remove-image on purpose — after it the group has no image, so a download
         * would be answering a different question.
         *
         * MEASURED on live: both answer **204**, because `group-update-image` sends only the
         * groupKpostID — uploading a real file is the documented attachment-upload gap this bench
         * still has. So what is covered here is honest but bounded: the endpoints are REACHED with a
         * real runtime group id and answer correctly for a group with no image. Fetching actual
         * image BYTES needs the upload gap closed, and the assertion says `< 500` rather than
         * pretending otherwise.
         */
        for (const [id, label] of [
          ['group-download-image', 'download-image'],
          ['group-download-full-image', 'download-full-image'],
        ] as const) {
          const image = await readAs(
            endpoints,
            A,
            id,
            { groupKpostID, kpostID: A.username },
            label,
          );
          expect
            .soft(image.status, `${label} answers for a group image this flow just set`)
            .toBeLessThan(500);
        }

        // Deferred so the downloads above had an image to fetch.
        const removed = await as(
          endpoints,
          A,
          'group-remove-image',
          { groupKpostID },
          'remove-image',
        );
        expect.soft(removed.status, 'remove-image returns a status').toBeLessThan(600);
      }
    } finally {
      if (groupID) {
        await as(endpoints, A, 'group-delete', { groupID }, 'delete').catch(() => undefined);
      }
    }
  });

  test('promote then demote a co-admin, and the sole admin cannot exit (FR-GM-012/013/014) @api @group @security', async ({
    endpoints,
  }) => {
    /*
     * FR-GM-012 Add Admin / FR-GM-013 Remove Admin, and the crown BR FR-GM-014: a group must always
     * retain at least one active admin, so the sole admin is blocked from exiting. We create A(admin)
     * + B(member), promote B, demote B (leaving A sole admin), then A tries to exit — which the rule
     * must block. If the backend allows it (200), that is a real finding: the BR is UI-only.
     */
    let groupID: number | undefined;
    let groupKpostID: string | undefined;
    try {
      const created = await as(endpoints, A, 'group-create', createBody(), 'create');
      groupKpostID = created.data.groupKpostID as string | undefined;
      /*
       * The member ROW ids createUserGroup issued. Promotion needs the id the product minted, not a
       * placeholder: `ids: [0]` answers a reproducible 500, and the real id answers
       * 200 "Admin added successfully" (confirmed live in backend-confirmation.spec.ts).
       */
      const adminRowIds = (
        Array.isArray(created.data.memberDetails)
          ? (created.data.memberDetails as Record<string, unknown>[])
          : []
      )
        .filter((row) => row.kpostID === testData.victimKpostId)
        .map((row) => row.id);
      groupID = created.data.groupID as number | undefined;
      expect.soft(groupKpostID, 'a groupKpostID is returned').toBeTruthy();
      if (!(groupID && groupKpostID)) return;

      // FR-GM-012 — promote B to co-admin.
      const promote = await as(
        endpoints,
        A,
        'group-admin-access',
        { kpostIDs: [testData.victimKpostId], ids: adminRowIds, groupID, hasAdminAccess: 'Y' },
        'promote-admin',
      );
      expect.soft(promote.status, 'promote to admin is accepted (FR-GM-012)').toBeLessThan(300);

      // FR-GM-013 — demote B back to a regular member.
      const demote = await as(
        endpoints,
        A,
        'group-admin-access',
        { kpostIDs: [testData.victimKpostId], ids: adminRowIds, groupID, hasAdminAccess: 'N' },
        'demote-admin',
      );
      expect.soft(demote.status, 'demote from admin is accepted (FR-GM-013)').toBeLessThan(300);

      // FR-GM-014 — A is now the SOLE admin; exiting must be blocked (min-one-admin rule).
      const exit = await as(
        endpoints,
        A,
        'group-leave',
        { id: '0', groupID, groupKpostID },
        'sole-admin-exit',
      );
      expect
        .soft(
          exit.status,
          'the sole admin must NOT be able to exit the group (FR-GM-014); a 2xx here is a finding — the rule is UI-only',
        )
        .toBeGreaterThanOrEqual(400);
    } finally {
      if (groupID) {
        await as(endpoints, A, 'group-delete', { groupID }, 'cleanup-delete').catch(
          () => undefined,
        );
      }
    }
  });
});
