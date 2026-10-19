// An orchestrated group lifecycle driving every group write, not simple assertions; the conditionals
// guard optional steps and cleanup of real live data.

import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Group **feature flow** — create a group and drive every group WRITE end to end on a real host,
 * self-cleaning: add a member, grant admin, rename, group-image update/download/remove, a member
 * leaves, remove a member, delete. Gated `GROUP_LIFECYCLE=true`, each write `allowLiveWrite`, all on
 * our own accounts. The two group-image DOWNLOADS are reads keyed by the runtime groupKpostID this
 * flow just created — `destructive: false` with no `productionSafe`, so they need `allowLiveRead`
 * (added to the engine for exactly this class of dependency-driven read) to run at all.
 * `updateGroupProfileImage` needs a real image part, so a JSON-only call may 4xx — a finding,
 * `expect.soft`.
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

const GROUP_IMAGE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64',
);

/** Reads a "needs-id" endpoint fed a real id this flow just minted (`allowLiveRead`, not a write). */
async function readAs(
  endpoints: EndpointExecutor,
  who: Principal,
  id: string,
  pathParams: Record<string, unknown>,
  label: string,
): Promise<{ status: number; bodyText: string }> {
  const ex = await endpoints.sendTo(
    id,
    { pathParams: pathParams as Record<string, string | number> },
    { label: `group:${label}`, auth: { principal: who }, allowLiveRead: true },
  );
  return { status: ex.status, bodyText: ex.bodyText ?? '' };
}

/**
 * `group-details-by-id` (added this session) returns the group record (name, members, image) — the
 * route that previously didn't exist, which is why `group-edit-name`/`group-add-user` could only be
 * checked for "answered a status," not for the field they actually changed.
 */
async function groupDetails(
  endpoints: EndpointExecutor,
  who: Principal,
  groupKpostID: string,
): Promise<Record<string, unknown>> {
  const ex = await endpoints.sendTo(
    'group-details-by-id',
    { pathParams: { groupKpostID } },
    { label: 'group:details-recheck', auth: { principal: who }, allowLiveRead: true },
  );
  const parsed = ex.json();
  const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  // The real response wraps the group under `known_group`, not the usual `data` envelope key.
  return (value.known_group as Record<string, unknown> | undefined) ?? {};
}

/**
 * The ACTIVE members of a group. A removed or departed member stays in `memberDetails` with
 * `removedFlag: true` (live-verified 2026-10-15), so "listed" and "count" mean the unflagged rows.
 */
async function activeMembers(
  endpoints: EndpointExecutor,
  groupKpostID: string,
): Promise<Array<{ id: number; kpostID: string }>> {
  const details = await groupDetails(endpoints, A, groupKpostID);
  const rows = (details.memberDetails ?? []) as Array<{
    id: number;
    kpostID: string;
    removedFlag?: boolean;
  }>;
  return rows.filter((m) => m.removedFlag !== true);
}

test.describe(
  'KPost Group · feature flow @database',
  { tag: ['@api', '@group', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default' });
    test.skip(
      process.env.GROUP_LIFECYCLE !== 'true',
      'creates real groups; set GROUP_LIFECYCLE=true',
    );

    test(
      'create → add member → admin → rename → image → leave → remove → delete @api @group',
      {
        tag: '@sanity',
        annotation: [
          { type: 'requirement', description: 'FR-GM-003' },
          { type: 'requirement', description: 'FR-GM-015' },
          { type: 'requirement', description: 'FR-GM-008' },
          { type: 'requirement', description: 'FR-GM-010' },
          { type: 'requirement', description: 'FR-GM-011' },
        ],
      },
      async ({ endpoints }) => {
        let groupID: number | undefined;
        let createdKpostID: string | undefined;
        try {
          const created = await as(endpoints, A, 'group-create', createBody(), 'create');
          expect.soft(created.status, 'createUserGroup is accepted').toBeLessThan(300);
          const groupKpostID = created.data.groupKpostID as string | undefined;
          groupID = created.data.groupID as number | undefined;
          createdKpostID = groupKpostID;
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
              [
                A,
                'group-edit-name',
                { groupKpostID, groupKpostName: 'QA Bench Renamed' },
                'edit-name',
              ],
              // Downloads keyed by the REAL groupKpostID this flow just created — previously untestable
              // on live (destructive:false, no productionSafe: allowLiveWrite alone cannot unlock a
              // read). Run right after update-image (below), before remove-image takes the image away
              // again. Handled via readAs() below (branched on the "group-download-" id prefix), not as().
              [A, 'group-download-image', { groupKpostID, kpostID: A.username }, 'download-image'],
              [
                A,
                'group-download-full-image',
                { groupKpostID, kpostID: A.username },
                'download-full-image',
              ],
              [A, 'group-remove-image', { groupKpostID }, 'remove-image'],
              // `id` is C's own membership-row id, resolved when the step runs (an id of '0' answers
              // 400 "you are not a member" — live 2026-10-15 — so the exit was never really driven).
              [C, 'group-leave', { groupID, groupKpostID }, 'leave'],
              [
                A,
                'group-remove-member',
                { memberKpostIdList: [testData.victimKpostId], groupKpostID, groupID },
                'remove-member',
              ],
            ];

            /*
             * `group-update-image` run separately, BEFORE the loop: live-verified 2026-09-26, this route
             * is multipart/form-data with a `file` part — the loop's generic JSON-body `as()` helper
             * always sent a plain JSON body, which 400d "Request must be multipart/form-data..." every
             * time (hidden by a `status < 600` check). Fixed in group.api.ts; here it's driven directly
             * with the real groupKpostID and its own JPEG fixture (PNG is rejected — same class of
             * restriction as `profile-update-image`), then the download steps below confirm a real image
             * now comes back, not an empty/stale one.
             */
            const imageUpdate = await endpoints.sendTo(
              'group-update-image',
              {
                multipart: {
                  file: { name: 'qa-bench.jpg', mimeType: 'image/jpeg', buffer: GROUP_IMAGE_JPEG },
                  text: JSON.stringify({ groupKpostID }),
                },
              },
              { label: 'group:update-image', auth: { principal: A }, allowLiveWrite: true },
            );
            expect
              .soft(imageUpdate.status, 'updateGroupProfileImage is accepted')
              .toBeLessThan(300);

            for (const [who, id, bodyObj, label] of steps) {
              // The two group-image downloads are GET reads keyed by PATH params, not a body write —
              // and need allowLiveRead (destructive:false), not allowLiveWrite. Branched here rather
              // than given their own loop: they still need to run interleaved, right after update-image
              // and before remove-image takes the image away.
              if (id.startsWith('group-download-')) {
                const read = await readAs(endpoints, who, id, bodyObj, label);
                expect.soft(read.status, `${label} returns a status`).toBeLessThan(600);
                if (imageUpdate.status < 300 && read.status === 200) {
                  // A real, freshly-uploaded image must come back non-trivially sized, not an empty or
                  // placeholder response — a coarse but honest check given the transport encodes binary
                  // image bytes as text here (no raw-buffer access), so an exact byte match isn't made.
                  expect
                    .soft(
                      read.bodyText.length,
                      `${label} returns real image content, not empty, after a fresh upload`,
                    )
                    .toBeGreaterThan(0);
                }
              } else {
                const before = await activeMembers(endpoints, groupKpostID);
                const body =
                  id === 'group-leave'
                    ? { ...bodyObj, id: String(before.find((m) => m.kpostID === C.username)?.id) }
                    : bodyObj;
                const status = (await as(endpoints, who, id, body, label)).status;
                expect.soft(status, `${label} returns a status`).toBeLessThan(600);

                // Membership arithmetic, judged by the group's own member read-back: the active-member
                // count moves by exactly one and the right person appears / disappears.
                const memberStep: Record<string, [string, string, number]> = {
                  'group-add-user': ['FR-GM-010', C.username, +1],
                  'group-leave': ['FR-GM-015', C.username, -1],
                  'group-remove-member': ['FR-GM-011', testData.victimKpostId, -1],
                };
                const rule = memberStep[id];
                if (rule) {
                  const [req, who_, delta] = rule;
                  expect(status, `${req}: ${label} is accepted`).toBeLessThan(300);
                  const after = await activeMembers(endpoints, groupKpostID);
                  test.info().annotations.push({
                    type: 'observed',
                    description: `${label}: active members ${before.length} → ${after.length}`,
                  });
                  expect(
                    after,
                    `${req}: ${label} changes the active-member count by ${delta} (was ${before.length})`,
                  ).toHaveLength(before.length + delta);
                  expect(
                    after.some((m) => m.kpostID === who_),
                    `${req}: after ${label}, ${who_} is ${delta > 0 ? 'listed' : 'no longer listed'}`,
                  ).toBe(delta > 0);
                }

                /*
                 * Field-level recheck via `group-details-by-id` (added this session — previously no
                 * registered group read exposed the name/members, so `group-add-user`/`group-edit-name`
                 * could only be checked for "answered a status," not for the field each one actually
                 * changed. Soft so a recheck failure doesn't hide a later step's finding.
                 */
                if (status < 300 && id === 'group-edit-name') {
                  const details = await groupDetails(endpoints, A, groupKpostID);
                  expect(
                    details.groupKpostName,
                    'FR-GM-008: group-edit-name actually renamed the group',
                  ).toBe('QA Bench Renamed');
                }
              }
            }
          }
        } finally {
          if (groupID) {
            // deleteGroup refuses while members remain, so remove whoever is still active first —
            // otherwise a failed step leaves the group behind on the shared test server.
            if (createdKpostID) {
              const left = (await activeMembers(endpoints, createdKpostID).catch(() => []))
                .map((m) => m.kpostID)
                .filter((k) => k !== A.username);
              if (left.length)
                await as(
                  endpoints,
                  A,
                  'group-remove-member',
                  { memberKpostIdList: left, groupKpostID: createdKpostID, groupID },
                  'cleanup-remove',
                ).catch(() => undefined);
            }
            const deleted = await as(endpoints, A, 'group-delete', { groupID }, 'delete').catch(
              () => ({ status: 0, data: {} }),
            );
            expect
              .soft(deleted.status, 'the test group is deleted (nothing left behind)')
              .toBe(200);
          }
        }
      },
    );

    test(
      'promote then demote a co-admin, and the sole admin cannot exit (FR-GM-012/013/014) @api @group @security',
      {
        annotation: [
          { type: 'requirement', description: 'FR-GM-012' },
          { type: 'requirement', description: 'FR-GM-013' },
        ],
      },
      async ({ endpoints, databases }) => {
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
                // removed_flag is numeric (0 = present, 1 = removed) on live, not 'Y'/'N' — confirmed by
                // direct query 2026-10-02.
                where: { group_id: groupID, kpost_id: testData.victimKpostId, removed_flag: 0 },
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
          expect(promote.status, 'FR-GM-012: promote to admin is accepted').toBeLessThan(300);

          const afterPromote = await database.findOne<{ admin_access: string }>({
            table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
            where: { id: memberRowId },
          });
          expect(
            afterPromote?.admin_access,
            'FR-GM-012: the grant is stored on the membership row',
          ).toBe('Y');

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
          expect(
            afterDemote?.admin_access,
            'FR-GM-013: the revoke is stored, not just reported',
          ).toBe('N');

          // FR-GM-014 — A is now the SOLE admin; exiting must be blocked (min-one-admin rule). The
          // leave names A's OWN membership-row id: an id of '0' is answered 400 "you are not a member"
          // (live 2026-10-15), which made this check pass without ever attempting the exit.
          //
          // OPT-IN (GROUP_SOLE_ADMIN_EXIT=true): while the rule is violated, a genuine attempt leaves a
          // group with ZERO admins that nobody can administer or delete (group 5214, 2026-10-15) — so a
          // default run does not attempt it, and says so, instead of orphaning a group every run.
          if (process.env.GROUP_SOLE_ADMIN_EXIT !== 'true') {
            test.info().annotations.push({
              type: 'skipped-check',
              description:
                'FR-GM-014 sole-admin exit NOT attempted: set GROUP_SOLE_ADMIN_EXIT=true (orphans a ' +
                'zero-admin group while the rule is violated — reproduced live 2026-10-15, group 5214)',
            });
            return;
          }
          const ownRow = (await activeMembers(endpoints, groupKpostID)).find(
            (m) => m.kpostID === A.username,
          );
          expect(ownRow?.id, 'A has a membership row to exit with').toBeTruthy();
          const exit = await as(
            endpoints,
            A,
            'group-leave',
            { id: String(ownRow?.id), groupID, groupKpostID },
            'sole-admin-exit',
          );
          test.info().annotations.push({
            type: 'observed',
            description: `sole-admin exit (group ${groupID}): HTTP ${exit.status} ${JSON.stringify(exit.data).slice(0, 160)}`,
          });
          console.log(
            `GROUP sole-admin exit (group ${groupID} / ${groupKpostID}): HTTP ${exit.status}`,
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
            where: { group_id: groupID, admin_access: 'Y', removed_flag: 0 },
          });
          expect
            .soft(
              admins.length,
              `FR-GM-014: the group must retain at least one admin after the sole admin's exit ` +
                `attempt (exit answered ${exit.status} — #1366)`,
            )
            .toBeGreaterThan(0);
        } finally {
          if (groupID && groupKpostID) {
            // deleteGroup refuses while members remain: remove B first (A is still admin unless the
            // opt-in sole-admin exit ran and succeeded — then nobody can delete it; see above).
            const left = (await activeMembers(endpoints, groupKpostID).catch(() => []))
              .map((m) => m.kpostID)
              .filter((k) => k !== A.username);
            if (left.length)
              await as(
                endpoints,
                A,
                'group-remove-member',
                { memberKpostIdList: left, groupKpostID, groupID },
                'cleanup-remove',
              ).catch(() => undefined);
            const deleted = await as(
              endpoints,
              A,
              'group-delete',
              { groupID, groupKpostID },
              'cleanup-delete',
            ).catch(() => ({ status: 0, data: {} }));
            if (process.env.GROUP_SOLE_ADMIN_EXIT !== 'true')
              expect
                .soft(deleted.status, 'the test group is deleted (nothing left behind)')
                .toBe(200);
          }
        }
      },
    );

    test(
      'a group cannot be created with no member besides the creator (FR-GC-006) @api @group',
      { annotation: [{ type: 'requirement', description: 'FR-GC-006' }] },
      async ({ endpoints }) => {
        const soloBody: Record<string, unknown> = {
          activeStatus: 'Y',
          createdBy: A.username,
          groupPicturePath: null,
          groupCreateAccess: true,
          groupKpostName: `QA Solo Group ${Date.now()}`,
          isPrivateGroup: 'N',
          memberDetails: [member(A.username, true)],
        };
        const created = await as(endpoints, A, 'group-create', soloBody, 'create-solo');
        // Cleanup first, so a surprising 2xx (the rule not being enforced) doesn't leak a real group.
        const groupID = created.data.groupID as number | undefined;
        const groupKpostID = created.data.groupKpostID as string | undefined;
        if (groupID && groupKpostID) {
          // A group that never had a second member cannot be deleted — deleteGroup answers 400
          // "invalid Parameters" (live 2026-10-15; the admin-delete UPDATE inner-joins a group
          // read-status row such a group never gets). Adding and removing one member first makes it
          // deletable, so this check no longer leaves a "QA Solo Group" behind on every run.
          await as(
            endpoints,
            A,
            'group-add-user',
            { groupID, groupKpostID, memberDetails: [member(C.username)] },
            'cleanup-solo-add',
          ).catch(() => undefined);
          await as(
            endpoints,
            A,
            'group-remove-member',
            { memberKpostIdList: [C.username], groupKpostID, groupID },
            'cleanup-solo-remove',
          ).catch(() => undefined);
          const deleted = await as(
            endpoints,
            A,
            'group-delete',
            { groupID, groupKpostID },
            'cleanup-solo-delete',
          ).catch(() => ({ status: 0, data: {} }));
          expect
            .soft(deleted.status, 'the solo test group is deleted (nothing left behind)')
            .toBe(200);
        }
        expect
          .soft(
            created.status,
            `FR-GC-006: a group with only its creator (no other member) must be rejected ` +
              `(createUserGroup replied ${created.status} — #1369)`,
          )
          .toBeGreaterThanOrEqual(400);
      },
    );

    test(
      'a sole admin cannot be demoted — Remove Admin needs >1 admin to exist (FR-GM-013) @api @group @security',
      { annotation: [{ type: 'requirement', description: 'FR-GM-013' }] },
      async ({ endpoints, databases }) => {
        /*
         * FR-GM-013 is distinct from FR-GM-014 (sole-admin EXIT is blocked, tested above): this is about
         * DEMOTION — addOrRemoveAdminAccess(hasAdminAccess:'N') targeting the only admin a group has.
         * A is created as the group's sole admin, C as a plain member; A then tries to demote themself.
         */
        const database = databases.for('kpost-api');
        let groupID: number | undefined;
        let groupKpostID: string | undefined;
        try {
          const created = await as(endpoints, A, 'group-create', createBody(), 'create-sole-admin');
          groupID = created.data.groupID as number | undefined;
          groupKpostID = created.data.groupKpostID as string | undefined;
          expect(groupID, 'the group was created with A as its only admin').toBeTruthy();
          if (!groupID) return;

          const ownMembership = database.enabled
            ? await database.findOne<{ id: number }>({
                table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
                where: { group_id: groupID, kpost_id: A.username, removed_flag: 0 },
              })
            : undefined;
          const ownMembershipId = ownMembership?.id ?? 0;

          const demoteSelf = await as(
            endpoints,
            A,
            'group-admin-access',
            { kpostIDs: [A.username], ids: [ownMembershipId], groupID, hasAdminAccess: 'N' },
            'demote-sole-admin',
          );

          // Asserted against the database, not the status code: whatever the endpoint replies, A must
          // still be an admin afterward — a group that loses its only admin is orphaned, same reasoning
          // as FR-GM-014 above.
          const afterwards = database.enabled
            ? await database.findOne<{ admin_access: string }>({
                table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
                where: { id: ownMembershipId },
              })
            : undefined;
          expect
            .soft(
              afterwards?.admin_access ?? 'Y',
              `FR-GM-013: the sole admin must remain an admin after a self-demotion attempt ` +
                `(demote replied ${demoteSelf.status})`,
            )
            .toBe('Y');
        } finally {
          if (groupID && groupKpostID) {
            const left = (await activeMembers(endpoints, groupKpostID).catch(() => []))
              .map((m) => m.kpostID)
              .filter((k) => k !== A.username);
            if (left.length)
              await as(
                endpoints,
                A,
                'group-remove-member',
                { memberKpostIdList: left, groupKpostID, groupID },
                'cleanup-sole-admin-remove',
              ).catch(() => undefined);
            const deleted = await as(
              endpoints,
              A,
              'group-delete',
              { groupID, groupKpostID },
              'cleanup-sole-admin-delete',
            ).catch(() => ({ status: 0, data: {} }));
            expect
              .soft(deleted.status, 'the test group is deleted (nothing left behind)')
              .toBe(200);
          }
        }
      },
    );

    /*
     * FR-GM-014 as the owner states it (Meera, 2026-10-15): a promoted admin has exactly the creator's
     * rights, and NO admin may exit — admins remove members; only a member exits. (The FRD's older
     * wording blocked only the SOLE admin; the web app follows that wording, the server checks nothing.)
     *
     * Each case uses its own group with a SECOND admin who stays, so even when the server wrongly lets
     * the leaver go the group keeps an admin and is cleaned up by that admin — nothing is orphaned.
     * The sole-admin case (which does orphan a group while the bug exists) stays opt-in above.
     */
    for (const [leaverKey, label] of [
      ['creator', 'the creator, while a promoted co-admin remains'],
      ['co-admin', 'a promoted co-admin, while the creator remains'],
    ] as const) {
      test(
        `an admin cannot exit the group — ${label} (FR-GM-014) @api @group @security`,
        { annotation: [{ type: 'requirement', description: 'FR-GM-014' }] },
        async ({ endpoints }) => {
          const leaver = leaverKey === 'creator' ? A : C;
          const stayer = leaverKey === 'creator' ? C : A;
          const rowsAs = async (who: Principal, gk: string) =>
            ((await groupDetails(endpoints, who, gk)).memberDetails ?? []) as Array<{
              id: number;
              kpostID: string;
              hasAdminAccess?: string;
              removedFlag?: boolean;
            }>;
          let groupID: number | undefined;
          let groupKpostID: string | undefined;
          try {
            const created = await as(
              endpoints,
              A,
              'group-create',
              {
                ...createBody(),
                memberDetails: [member(C.username), member(A.username, true)],
              },
              `create-${leaverKey}-exit`,
            );
            groupID = created.data.groupID as number | undefined;
            groupKpostID = created.data.groupKpostID as string | undefined;
            expect(groupID && groupKpostID, 'the group is created').toBeTruthy();
            if (!groupID || !groupKpostID) return;

            // C becomes a co-admin — the same rights as the creator.
            const cRow = (await rowsAs(A, groupKpostID)).find((m) => m.kpostID === C.username);
            const promote = await as(
              endpoints,
              A,
              'group-admin-access',
              { kpostIDs: [C.username], ids: [cRow?.id ?? 0], groupID, hasAdminAccess: 'Y' },
              'promote-co-admin',
            );
            expect(promote.status, 'C is promoted to co-admin').toBeLessThan(300);
            const admins = (await rowsAs(A, groupKpostID))
              .filter((m) => m.removedFlag !== true && m.hasAdminAccess === 'Y')
              .map((m) => m.kpostID);
            expect(admins.sort(), 'the group has two admins').toEqual(
              [A.username, C.username].sort(),
            );

            const ownRow = (await rowsAs(A, groupKpostID)).find(
              (m) => m.kpostID === leaver.username,
            );
            const exit = await as(
              endpoints,
              leaver,
              'group-leave',
              { id: String(ownRow?.id), groupID, groupKpostID },
              `${leaverKey}-exit`,
            );
            const after = await rowsAs(stayer, groupKpostID);
            const stillAdmin = after.some(
              (m) =>
                m.kpostID === leaver.username && m.removedFlag !== true && m.hasAdminAccess === 'Y',
            );
            test.info().annotations.push({
              type: 'observed',
              description: `${label}: exit answered ${exit.status} ${JSON.stringify(exit.data).slice(0, 100)}; still an admin afterwards: ${stillAdmin}`,
            });
            expect(
              stillAdmin,
              `FR-GM-014: an admin cannot exit — ${label} must stay an admin (exit answered ${exit.status} — #1366)`,
            ).toBe(true);
          } finally {
            if (groupID && groupKpostID) {
              // Clean up as whichever admin is still active (the leaver may be gone).
              for (const who of [A, C]) {
                const rows = await rowsAs(who, groupKpostID).catch(() => []);
                const me = rows.find(
                  (m) =>
                    m.kpostID === who.username &&
                    m.removedFlag !== true &&
                    m.hasAdminAccess === 'Y',
                );
                if (!me) continue;
                const others = rows
                  .filter((m) => m.removedFlag !== true && m.kpostID !== who.username)
                  .map((m) => m.kpostID);
                if (others.length)
                  await as(
                    endpoints,
                    who,
                    'group-remove-member',
                    { memberKpostIdList: others, groupKpostID, groupID },
                    'cleanup-remove',
                  ).catch(() => undefined);
                const deleted = await as(
                  endpoints,
                  who,
                  'group-delete',
                  { groupID, groupKpostID },
                  'cleanup-delete',
                ).catch(() => ({ status: 0, data: {} }));
                expect
                  .soft(deleted.status, 'the test group is deleted (nothing left behind)')
                  .toBe(200);
                break;
              }
              // A group the creator has left still shows in the creator's own group list until the
              // creator deletes it too (live 2026-10-15: the co-admin's delete answered 200, yet the
              // group remained listed for qatest1), so the creator always deletes last, best-effort.
              await as(
                endpoints,
                A,
                'group-delete',
                { groupID, groupKpostID },
                'cleanup-creator-delete',
              ).catch(() => undefined);
            }
          }
        },
      );
    }
  },
);
