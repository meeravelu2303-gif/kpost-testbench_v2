import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { checkOnRealRecord, realRecordIds } from '@engine/real-record';
import { expect, test } from '@fixtures';
import { expectStored, filled } from '../../../support/db-stored';

/**
 * Group feature flow: create a group and drive every group write (members, admin, rename, image,
 * leave, remove, delete) on our own accounts, self-cleaning. Gated behind `GROUP_LIFECYCLE=true`
 * because it writes real groups on the shared test server.
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

/** Where updateGroupProfileImage stores the photo (AWSs3ClientServiceImpl.java:731-739). */
const groupPicturePath = (groupKpostID: string): string => {
  const at = (s: string): string => s.split('@').join('_');
  return `${at(groupKpostID)}/profile/${at(groupKpostID.split('.')[0] ?? groupKpostID)}.jpg`;
};

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

/** The group record (name, members, image), used to recheck the field each write changed. */
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

/** The ACTIVE members of a group: removed or departed members stay listed with `removedFlag: true`. */
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
      async ({ endpoints, validationEngine, databases }) => {
        const db = databases.for('kpost-api');
        let groupID: number | undefined;
        let createdKpostID: string | undefined;
        try {
          const sentCreate = createBody();
          const created = await as(endpoints, A, 'group-create', sentCreate, 'create');
          expect.soft(created.status, 'createUserGroup is accepted').toBeLessThan(300);
          const groupKpostID = created.data.groupKpostID as string | undefined;
          groupID = created.data.groupID as number | undefined;
          createdKpostID = groupKpostID;
          expect.soft(groupKpostID, 'a groupKpostID is returned').toBeTruthy();

          if (created.status < 300 && groupKpostID && groupID) {
            // GroupServiceImpl.java:141-179 saves the group (name capitalised, admin from the token) and its members.
            await expectStored(
              db,
              'group-create',
              {
                table: 'TBL_KPOST_USERGROUP_MASTER',
                where: { group_id: groupID },
                columns: {
                  group_kpost_id: groupKpostID,
                  group_name: sentCreate.groupKpostName,
                  admin_kpost_id: A.username,
                  active_status: 'Y',
                  is_private_group: 'N',
                  created_by: A.username,
                },
                rule: 'createUserGroup stores the group with the name, flags and creator it was sent, the caller as admin',
              },
              endpoints,
            );
            // GroupServiceImpl.java:158-179: each memberDetails entry becomes a member row (cascade save).
            await expectStored(
              db,
              'group-create',
              {
                table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
                where: { group_id: groupID, kpost_id: testData.victimKpostId },
                columns: {
                  name: 'QA Bench',
                  admin_access: 'N',
                  privacy_status: 'Y',
                  remarks: 'created',
                  removed_flag: false,
                },
                rule: 'createUserGroup stores a membership row for each member it was sent',
              },
              endpoints,
            );
          }

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
              // Image downloads (reads via readAs()): after update-image, before remove-image.
              [A, 'group-download-image', { groupKpostID, kpostID: A.username }, 'download-image'],
              [
                A,
                'group-download-full-image',
                { groupKpostID, kpostID: A.username },
                'download-full-image',
              ],
              [A, 'group-remove-image', { groupKpostID }, 'remove-image'],
              // `id` (C's own membership-row id) is resolved when the step runs; '0' answers 400.
              [C, 'group-leave', { groupID, groupKpostID }, 'leave'],
              [
                A,
                'group-remove-member',
                { memberKpostIdList: [testData.victimKpostId], groupKpostID, groupID },
                'remove-member',
              ],
            ];

            // update-image is multipart with a `file` part (JPEG; PNG is rejected), so it runs here
            // rather than through the JSON-body `as()` loop.
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
            if (imageUpdate.status < 300)
              // GroupServiceDaoImpl.java:135-143 sets group_picture_path to the uploaded file's S3 key.
              await expectStored(
                db,
                'group-update-image',
                {
                  table: 'TBL_KPOST_USERGROUP_MASTER',
                  where: { group_id: groupID },
                  columns: { group_picture_path: groupPicturePath(groupKpostID) },
                  rule: "updateGroupProfileImage stores the uploaded photo's path on the group",
                },
                endpoints,
              );

            // The id-keyed group reads the sweep cannot send, through the full engine on this group.
            for (const [id, pathParams] of realRecordIds([
              ['group-details-by-id', { groupKpostID }],
              ['group-download-image', { groupKpostID, kpostID: A.username }],
              ['group-download-full-image', { groupKpostID, kpostID: A.username }],
            ]))
              await checkOnRealRecord(validationEngine, id, { pathParams: { ...pathParams } }, [
                groupKpostID,
              ]);

            for (const [who, id, bodyObj, label] of steps) {
              // Image downloads are path-param reads (allowLiveRead), kept in order with the writes.
              if (id.startsWith('group-download-')) {
                const read = await readAs(endpoints, who, id, bodyObj, label);
                expect.soft(read.status, `${label} returns a status`).toBeLessThan(600);
                if (imageUpdate.status < 300 && read.status === 200) {
                  // Bytes arrive as text (no raw buffer), so only "not empty" is checked.
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

                // What each accepted write stored, read back from its row.
                if (status < 300 && id === 'group-add-user')
                  // GroupServiceImpl.java:379-399 adds a member row (removed_flag false) and saves the group.
                  await expectStored(
                    db,
                    'group-add-user',
                    {
                      table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
                      where: { group_id: groupID, kpost_id: C.username },
                      columns: {
                        name: 'QA Bench',
                        admin_access: 'N',
                        privacy_status: 'Y',
                        remarks: 'created',
                        removed_flag: false,
                      },
                      rule: 'addUserToGroup stores an active membership row with the details it was sent',
                    },
                    endpoints,
                  );
                if (status < 300 && id === 'group-edit-name')
                  // GroupRepository.java:116-118 sets group_name on the group row.
                  await expectStored(
                    db,
                    'group-edit-name',
                    {
                      table: 'TBL_KPOST_USERGROUP_MASTER',
                      where: { group_id: groupID },
                      columns: { group_name: 'QA Bench Renamed' },
                      rule: 'editGroupName stores the new group name',
                    },
                    endpoints,
                  );
                if (status < 300 && id === 'group-remove-image')
                  // GroupServiceDaoImpl.java:135-143 (profileImagePath null) clears group_picture_path.
                  await expectStored(
                    db,
                    'group-remove-image',
                    {
                      table: 'TBL_KPOST_USERGROUP_MASTER',
                      where: { group_id: groupID },
                      columns: { group_picture_path: null },
                      rule: "removeGroupProfileImage clears the group's photo path",
                    },
                    endpoints,
                  );
                if (status < 300 && id === 'group-leave')
                  // GroupServiceDaoImpl.java:226-234 flags the caller's own row removed, admin_access N, remarks "left".
                  await expectStored(
                    db,
                    'group-leave',
                    {
                      table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
                      where: { group_id: groupID, kpost_id: C.username },
                      columns: { removed_flag: true, admin_access: 'N', remarks: 'left' },
                      rule: 'leaveFromGroup marks the caller\'s membership row removed with remarks "left"',
                    },
                    endpoints,
                  );
                if (status < 300 && id === 'group-remove-member')
                  // GroupServiceDaoImpl.java:201-207 flags each named member removed, admin_access N, remarks "removed".
                  await expectStored(
                    db,
                    'group-remove-member',
                    {
                      table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
                      where: { group_id: groupID, kpost_id: testData.victimKpostId },
                      columns: { removed_flag: true, admin_access: 'N', remarks: 'removed' },
                      rule: 'removeGroupMember marks the removed member\'s row removed with remarks "removed"',
                    },
                    endpoints,
                  );

                // The active-member count moves by exactly one and the right person appears/disappears.
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

                // Read the group back to confirm the rename actually landed.
                if (status < 300 && id === 'group-edit-name') {
                  const details = await groupDetails(endpoints, A, groupKpostID);
                  expect(
                    details.groupKpostName,
                    'FR-GM-008: group-edit-name actually renamed the group',
                  ).toBe('QA Bench Renamed');
                }
              }
            }

            // The group writes the sweep cannot aim at a real group, through the full engine on this
            // one (its negative, boundary and security probes reach the limits only here). In this
            // order: rename, re-add C (who left above), give C admin, remove C. The finally deletes the
            // group whatever the probes did; the boundary cleanup removes any filler member rows.
            const realGroupID = groupID;
            const onThisGroup = (id: string, body: Record<string, unknown>) =>
              checkOnRealRecord(validationEngine, id, { body }, [groupKpostID, realGroupID]);
            for (const [id, body] of realRecordIds([
              ['group-edit-name', { groupKpostID, groupKpostName: 'QA Bench Renamed' }],
              ['group-add-user', { groupID, groupKpostID, memberDetails: [member(C.username)] }],
            ]))
              await onThisGroup(id, { ...body });
            // updateGroupAdminAccess matches the membership row id (ids: [0] matches none and 400s,
            // GroupServiceDaoImpl.java:67-71), so C's real row id is read first.
            const cRow = (await activeMembers(endpoints, groupKpostID)).find(
              (m) => m.kpostID === C.username,
            );
            if (cRow)
              await checkOnRealRecord(
                validationEngine,
                'group-admin-access',
                {
                  body: { kpostIDs: [C.username], ids: [cRow.id], groupID, hasAdminAccess: 'Y' },
                },
                [groupKpostID, groupID, cRow.id],
              );
            else
              test.info().annotations.push({
                type: 'not-judged',
                description: 'group-admin-access: C was not an active member after the re-add',
              });
            await checkOnRealRecord(
              validationEngine,
              'group-remove-member',
              { body: { memberKpostIdList: [C.username], groupKpostID, groupID } },
              [groupKpostID, groupID],
            );
          }
        } finally {
          if (groupID) {
            // deleteGroup refuses while members remain, so remove whoever is still active first.
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
            if (deleted.status === 200) {
              // GroupServiceDaoImpl.java:290-297 (the admin, its last member): own row "Group Deleted" + removed,
              // and the group inactive.
              await expectStored(
                db,
                'group-delete',
                {
                  table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
                  where: { group_id: groupID, kpost_id: A.username },
                  columns: { remarks: 'Group Deleted', removed_flag: true },
                  rule: 'deleteGroup marks the admin\'s membership row "Group Deleted" and removed',
                },
                endpoints,
              );
              await expectStored(
                db,
                'group-delete',
                {
                  table: 'TBL_KPOST_USERGROUP_MASTER',
                  where: { group_id: groupID },
                  columns: { active_status: 'N' },
                  rule: 'deleteGroup by its admin, once every member is removed, sets the group inactive',
                },
                endpoints,
              );
            }
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
        // Promote B, demote B (A is now sole admin), then A tries to exit, which must be blocked.
        // `ids` are membership-row ids (read from MySQL), and results are checked on the row because
        // addOrRemoveAdminAccess answers success whatever it stored.
        const database = databases.for('kpost-api');
        let groupID: number | undefined;
        let groupKpostID: string | undefined;
        try {
          const created = await as(endpoints, A, 'group-create', createBody(), 'create');
          groupKpostID = created.data.groupKpostID as string | undefined;
          groupID = created.data.groupID as number | undefined;
          expect.soft(groupKpostID, 'a groupKpostID is returned').toBeTruthy();
          if (!(groupID && groupKpostID)) return;

          // B's membership row in THIS group (B belongs to many groups on the shared DB).
          const membership = database.enabled
            ? await database.findOne<{ id: number; admin_access: string }>({
                table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
                // removed_flag is numeric: 0 = present, 1 = removed.
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
          // GroupServiceDaoImpl.java:67-77 sets admin_access and modified_date on the named membership row.
          await expectStored(
            database,
            'group-admin-access',
            {
              table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
              where: { id: memberRowId, group_id: groupID },
              columns: { admin_access: 'Y', modified_date: filled, removed_flag: false },
              rule: "addOrRemoveAdminAccess stores the grant (admin_access Y) on the member's row",
            },
            endpoints,
          );

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

          // The revoke must be stored, or B keeps admin powers nobody believes B has.
          const afterDemote = await database.findOne<{ admin_access: string }>({
            table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
            where: { id: memberRowId },
          });
          expect(
            afterDemote?.admin_access,
            'FR-GM-013: the revoke is stored, not just reported',
          ).toBe('N');

          // FR-GM-014: the sole admin's exit (with A's own membership-row id) must be blocked. Opt-in
          // via GROUP_SOLE_ADMIN_EXIT=true: while #1366 is open, the exit orphans a zero-admin group.
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

          // Checked in the DB: whatever the reply, the group must still have an admin afterwards.
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
            // deleteGroup refuses while members remain: remove B first. (If the opt-in sole-admin
            // exit succeeded, nobody can delete the group.)
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
          // A group that never had a second member cannot be deleted (400), so add and remove one first.
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
        // Demotion (not exit): A, the group's only admin, tries to demote themself.
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

          // Checked in the DB: whatever the reply, A must still be an admin afterwards.
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

    // FR-GM-014: NO admin may exit; only members exit. Each case keeps a second admin who stays, so
    // the group can still be cleaned up even if the exit is wrongly allowed.
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
              // The group stays in the creator's list until the creator deletes it too, so the
              // creator always deletes last, best-effort.
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
