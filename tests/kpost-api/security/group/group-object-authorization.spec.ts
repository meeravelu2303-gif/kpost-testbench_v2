import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { DatabaseClient } from '@database/database-client';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Group access control: only a group's admin may rename it, change or remove its photo, add or
 * remove members, grant admin, or delete it (FR-GM-007..013; the web shows those actions to admins
 * only). Each test has the owner create a throwaway group, lets a plain member, an outsider or a
 * removed member try the admin actions, and judges by the database row, not the reply. The owner's
 * identical call is the control: it must succeed, or a refusal proves nothing. Self-cleaning.
 * The outsider's admin grab, member removal and rename are in object-authorization.spec.ts.
 */

const K = AUTH_PROFILES.kpost;
const OWNER = K.principals.find((p) => p.key === 'personal-3');
const MEMBER = K.principals.find((p) => p.key === 'personal-4');
const OUTSIDER = K.principals.find((p) => p.key === 'personal-5');
// Only ever a target, never logged in (personal-6 does not exist under QATEST_ONLY).
const OTHER_MEMBER_ID = testData.victimKpostId;

const MASTER = 'TBL_KPOST_USERGROUP_MASTER';
const MEMBERS = 'TBL_KPOST_USERGROUP_MEMBERDETAILS';

const GROUP_IMAGE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64',
);

const member = (kpostID: string, isAdmin = false): Record<string, unknown> => ({
  createdBy: OWNER?.username,
  hasAdminAccess: isAdmin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

interface Group {
  groupID: number;
  groupKpostID: string;
}

/** One call as `who`. A refusal by the bench's own guard comes back as status -1, never a throw. */
async function as(
  endpoints: EndpointExecutor,
  who: Principal,
  id: string,
  spec: { body?: Record<string, unknown>; multipart?: Record<string, unknown> },
  label: string,
  owned: readonly (string | number)[] = [],
): Promise<number> {
  try {
    const ex = await endpoints.sendTo(id, spec as never, {
      label: `group-authz:${label}`,
      auth: { principal: who },
      allowLiveWrite: true,
      ownedIdentifiers: owned,
    });
    return ex.status;
  } catch {
    return -1;
  }
}

const imageUpload = (groupKpostID: string) => ({
  multipart: {
    file: { name: 'qa-bench.jpg', mimeType: 'image/jpeg', buffer: GROUP_IMAGE_JPEG },
    text: JSON.stringify({ groupKpostID }),
  },
});

async function groupRow(database: DatabaseClient, group: Group) {
  const row = await database.findOne<{
    // A binary column: the driver returns a Buffer, which String() decodes as UTF-8.
    group_name: string;
    group_picture_path: string | null;
    active_status: string;
  }>({ table: MASTER, where: { group_id: group.groupID } });
  return {
    name: String(row?.group_name ?? ''),
    picture: row?.group_picture_path ?? null,
    active: String(row?.active_status ?? ''),
  };
}

async function membership(database: DatabaseClient, group: Group, kpostID: string) {
  const row = await database.findOne<{ id: number; admin_access: string; removed_flag: number }>({
    table: MEMBERS,
    where: { group_id: group.groupID, kpost_id: kpostID },
  });
  return row
    ? { id: row.id, admin: row.admin_access, present: Number(row.removed_flag) === 0 }
    : undefined;
}

/**
 * The owner creates a group with `members` as plain members, runs `body`, then removes whoever is
 * still active and deletes the group (deleteGroup refuses while anyone but the admin remains).
 */
async function withGroup(
  endpoints: EndpointExecutor,
  database: DatabaseClient,
  members: string[],
  body: (group: Group, owned: (string | number)[]) => Promise<void>,
): Promise<void> {
  let group: Group | undefined;
  const owned: (string | number)[] = [];
  try {
    const ex = await endpoints.sendTo(
      'group-create',
      {
        body: {
          activeStatus: 'Y',
          createdBy: OWNER!.username,
          groupPicturePath: null,
          groupCreateAccess: true,
          groupKpostName: `QA Authz Group ${Date.now()}`,
          isPrivateGroup: 'N',
          memberDetails: [...members.map((m) => member(m)), member(OWNER!.username, true)],
        },
      },
      { label: 'group-authz:create', auth: { principal: OWNER! }, allowLiveWrite: true },
    );
    const parsed = ex.json();
    const data = ((parsed.ok ? parsed.value : {}) as { data?: Record<string, unknown> }).data ?? {};
    const groupID = Number(data.groupID ?? 0);
    const groupKpostID = typeof data.groupKpostID === 'string' ? data.groupKpostID : '';
    // Blocker: without the group no other step can run.
    expect(groupID && groupKpostID, `the owner created the group (${ex.status})`).toBeTruthy();
    group = { groupID, groupKpostID };
    owned.push(groupID, groupKpostID);
    for (const m of members) {
      const row = await membership(database, group, m);
      if (row) owned.push(row.id);
    }
    await body(group, owned);
  } finally {
    if (group) {
      const rows = await database
        .findMany<{ kpost_id: string }>({
          table: MEMBERS,
          where: { group_id: group.groupID, removed_flag: 0 },
        })
        .catch(() => []);
      const left = rows.map((r) => r.kpost_id).filter((k) => k !== OWNER!.username);
      if (left.length) {
        await as(
          endpoints,
          OWNER!,
          'group-remove-member',
          {
            body: {
              memberKpostIdList: left,
              groupID: group.groupID,
              groupKpostID: group.groupKpostID,
            },
          },
          'cleanup-remove',
          owned,
        );
      }
      const deleted = await as(
        endpoints,
        OWNER!,
        'group-delete',
        { body: { groupID: group.groupID } },
        'cleanup-delete',
        owned,
      );
      expect.soft(deleted, 'the throwaway group is deleted (nothing left behind)').toBe(200);
    }
  }
}

/**
 * Edit Group (name and photo) is one admin-only screen whose three endpoints check only that the
 * caller has a membership row, so a plain member and a removed member pass. One rule per endpoint,
 * shared by both cases, so the run files one bug per endpoint, each naming the other two.
 */
const EDIT_GROUP_CAUSE =
  'Edit Group (name and photo) is admin-only (FR-GM-008; the web shows Edit Group to admins only), but editGroupName, updateGroupProfileImage and removeGroupProfileImage only check that the caller has a membership row in the group, not that they are an active admin, so a plain member, and even a member already removed, can change it.';
const EDIT_NAME_RULE = {
  ruleId: 'GROUP-AUTHZ-edit-name-not-admin-only',
  rule:
    'editGroupName must refuse a caller who is not an active admin of the group. ' +
    EDIT_GROUP_CAUSE,
};
const SET_PHOTO_RULE = {
  ruleId: 'GROUP-AUTHZ-set-photo-not-admin-only',
  rule:
    'updateGroupProfileImage must refuse a caller who is not an active admin of the group. ' +
    EDIT_GROUP_CAUSE,
};
const REMOVE_PHOTO_RULE = {
  ruleId: 'GROUP-AUTHZ-remove-photo-not-admin-only',
  rule:
    'removeGroupProfileImage must refuse a caller who is not an active admin of the group. ' +
    EDIT_GROUP_CAUSE,
};

/** Soft-checks one refused action and records it as a finding when the row shows it took effect. */
function judge(
  endpoints: EndpointExecutor,
  input: {
    endpointId: string;
    /** What this case checks, for the assertion message (the ruleId may be shared). */
    check: string;
    ruleId: string;
    rule: string;
    tookEffect: boolean;
    expected: string;
    actual: string;
    body: Record<string, unknown>;
  },
): void {
  if (input.tookEffect) {
    endpoints.recordBusinessRuleViolation({
      endpointId: input.endpointId,
      ruleId: input.ruleId,
      rule: input.rule,
      expected: input.expected,
      actual: input.actual,
      request: { body: input.body },
    });
  }
  expect.soft(input.tookEffect, `${input.check}: ${input.actual}`).toBe(false);
}

test.describe(
  'KPost Security · group access control (admin-only actions) @api @kpost-api @security @database',
  {
    tag: ['@api', '@auth', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      !OWNER || !MEMBER || !OUTSIDER || !OTHER_MEMBER_ID,
      'needs three KPost principals (personal-3..5) and the 2nd QA account (QA_VICTIM_KPOST_ID)',
    );

    test('a plain member cannot use the admin actions @api @security', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

      await withGroup(
        endpoints,
        database,
        [MEMBER!.username, OTHER_MEMBER_ID],
        async (group, owned) => {
          const original = await groupRow(database, group);
          const self = await membership(database, group, MEMBER!.username);

          // Rename.
          const renameBody = {
            groupKpostID: group.groupKpostID,
            groupKpostName: 'QA renamed by member',
          };
          const rename = await as(
            endpoints,
            MEMBER!,
            'group-edit-name',
            { body: renameBody },
            'member-rename',
            owned,
          );
          const afterRename = await groupRow(database, group);
          judge(endpoints, {
            endpointId: 'group-edit-name',
            check: 'GROUP-AUTHZ-member-renames',
            ...EDIT_NAME_RULE,
            tookEffect: afterRename.name === 'QA renamed by member',
            expected: `group_name stays "${original.name}"`,
            actual: `a plain member renamed the group (editGroupName replied ${rename}; group_name is now "${afterRename.name}")`,
            body: renameBody,
          });

          // Add a member.
          const addBody = {
            groupID: group.groupID,
            groupKpostID: group.groupKpostID,
            memberDetails: [member(OUTSIDER!.username)],
          };
          const add = await as(
            endpoints,
            MEMBER!,
            'group-add-user',
            { body: addBody },
            'member-adds',
            owned,
          );
          const added = await membership(database, group, OUTSIDER!.username);
          judge(endpoints, {
            endpointId: 'group-add-user',
            check: 'GROUP-AUTHZ-member-adds-member',
            ruleId: 'GROUP-AUTHZ-member-adds-member',
            rule: 'addUserToGroup must refuse a member who is not an admin of the group (FR-GM-009/010: the admin adds members).',
            tookEffect: Boolean(added?.present),
            expected: `${OUTSIDER!.username} is not added`,
            actual: `a plain member added ${OUTSIDER!.username} (addUserToGroup replied ${add})`,
            body: addBody,
          });

          // Remove another member.
          const removeBody = {
            memberKpostIdList: [OTHER_MEMBER_ID],
            groupID: group.groupID,
            groupKpostID: group.groupKpostID,
          };
          const remove = await as(
            endpoints,
            MEMBER!,
            'group-remove-member',
            { body: removeBody },
            'member-removes',
            owned,
          );
          const other = await membership(database, group, OTHER_MEMBER_ID);
          judge(endpoints, {
            endpointId: 'group-remove-member',
            check: 'GROUP-AUTHZ-member-removes-member',
            ruleId: 'GROUP-AUTHZ-member-removes-member',
            rule: 'removeGroupMember must refuse a member who is not an admin of the group (FR-GM-011: the admin removes members).',
            tookEffect: !other?.present,
            expected: `${OTHER_MEMBER_ID} stays a member`,
            actual: `a plain member removed ${OTHER_MEMBER_ID} (removeGroupMember replied ${remove})`,
            body: removeBody,
          });

          // Grant themselves admin.
          const adminBody = {
            kpostIDs: [MEMBER!.username],
            ids: [self?.id ?? 0],
            groupID: group.groupID,
            hasAdminAccess: 'Y',
          };
          const grab = await as(
            endpoints,
            MEMBER!,
            'group-admin-access',
            { body: adminBody },
            'member-self-admin',
            owned,
          );
          const selfAfter = await membership(database, group, MEMBER!.username);
          judge(endpoints, {
            endpointId: 'group-admin-access',
            check: 'GROUP-AUTHZ-member-grants-self-admin',
            ruleId: 'GROUP-AUTHZ-member-grants-self-admin',
            rule: 'addOrRemoveAdminAccess must refuse a member who is not an admin of the group (FR-GM-012: the admin promotes members).',
            tookEffect: selfAfter?.admin === 'Y',
            expected: "the member's admin_access stays 'N'",
            actual: `a plain member made themselves admin (addOrRemoveAdminAccess replied ${grab})`,
            body: adminBody,
          });

          // Set the photo while the group has none.
          const upload = await as(
            endpoints,
            MEMBER!,
            'group-update-image',
            imageUpload(group.groupKpostID),
            'member-sets-photo',
            owned,
          );
          const afterUpload = await groupRow(database, group);
          judge(endpoints, {
            endpointId: 'group-update-image',
            check: 'GROUP-AUTHZ-member-sets-photo',
            ...SET_PHOTO_RULE,
            tookEffect: afterUpload.picture !== original.picture,
            expected: `group_picture_path stays ${JSON.stringify(original.picture)}`,
            actual: `a plain member set the group photo (updateGroupProfileImage replied ${upload}; group_picture_path is now ${JSON.stringify(afterUpload.picture)})`,
            body: { groupKpostID: group.groupKpostID },
          });

          // Remove the photo the owner set (the owner's upload is the control).
          const ownerUpload = await as(
            endpoints,
            OWNER!,
            'group-update-image',
            imageUpload(group.groupKpostID),
            'owner-sets-photo',
            owned,
          );
          const withPhoto = await groupRow(database, group);
          expect
            .soft(withPhoto.picture, `control: the owner can set the photo (${ownerUpload})`)
            .toBeTruthy();
          if (withPhoto.picture) {
            const unsetBody = { groupKpostID: group.groupKpostID };
            const unset = await as(
              endpoints,
              MEMBER!,
              'group-remove-image',
              { body: unsetBody },
              'member-removes-photo',
              owned,
            );
            const afterUnset = await groupRow(database, group);
            judge(endpoints, {
              endpointId: 'group-remove-image',
              check: 'GROUP-AUTHZ-member-removes-photo',
              ...REMOVE_PHOTO_RULE,
              tookEffect: !afterUnset.picture,
              expected: 'group_picture_path stays set',
              actual: `a plain member removed the group photo (removeGroupProfileImage replied ${unset})`,
              body: unsetBody,
            });
          }

          // Delete the group.
          const deleteBody = { groupID: group.groupID };
          const del = await as(
            endpoints,
            MEMBER!,
            'group-delete',
            { body: deleteBody },
            'member-deletes',
            owned,
          );
          const afterDelete = await groupRow(database, group);
          judge(endpoints, {
            endpointId: 'group-delete',
            check: 'GROUP-AUTHZ-member-deletes-group',
            ruleId: 'GROUP-AUTHZ-member-deletes-group',
            rule: 'deleteGroup must not deactivate the group for a member who is not its admin.',
            tookEffect: afterDelete.active !== 'Y',
            expected: "active_status stays 'Y'",
            actual: `a plain member deleted the group (deleteGroup replied ${del}; active_status=${afterDelete.active})`,
            body: deleteBody,
          });

          // Control: the owner's own rename lands, so the member's refusal above was a real check.
          const ownerRename = await as(
            endpoints,
            OWNER!,
            'group-edit-name',
            { body: { groupKpostID: group.groupKpostID, groupKpostName: 'QA renamed by owner' } },
            'owner-rename',
            owned,
          );
          expect
            .soft(
              (await groupRow(database, group)).name,
              `control: the owner can rename (${ownerRename})`,
            )
            .toBe('QA renamed by owner');
        },
      );
    });

    test('an outsider cannot add themselves or change the photo @api @security', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

      await withGroup(endpoints, database, [MEMBER!.username], async (group, owned) => {
        const addBody = {
          groupID: group.groupID,
          groupKpostID: group.groupKpostID,
          memberDetails: [member(OUTSIDER!.username)],
        };
        const add = await as(
          endpoints,
          OUTSIDER!,
          'group-add-user',
          { body: addBody },
          'outsider-joins',
          owned,
        );
        const joined = await membership(database, group, OUTSIDER!.username);
        judge(endpoints, {
          endpointId: 'group-add-user',
          check: 'GROUP-AUTHZ-outsider-adds-self',
          ruleId: 'GROUP-AUTHZ-outsider-adds-self',
          rule: 'addUserToGroup must refuse a caller who does not belong to the group: an outsider must not be able to join by naming its id.',
          tookEffect: Boolean(joined?.present),
          expected: `${OUTSIDER!.username} is not added`,
          actual: `an outsider added themselves (addUserToGroup replied ${add})`,
          body: addBody,
        });

        const original = await groupRow(database, group);
        const upload = await as(
          endpoints,
          OUTSIDER!,
          'group-update-image',
          imageUpload(group.groupKpostID),
          'outsider-sets-photo',
          owned,
        );
        const afterUpload = await groupRow(database, group);
        judge(endpoints, {
          endpointId: 'group-update-image',
          check: 'GROUP-AUTHZ-outsider-sets-photo',
          ...SET_PHOTO_RULE,
          tookEffect: afterUpload.picture !== original.picture,
          expected: `group_picture_path stays ${JSON.stringify(original.picture)}`,
          actual: `an outsider set the group photo (updateGroupProfileImage replied ${upload})`,
          body: { groupKpostID: group.groupKpostID },
        });

        const ownerUpload = await as(
          endpoints,
          OWNER!,
          'group-update-image',
          imageUpload(group.groupKpostID),
          'owner-sets-photo',
          owned,
        );
        const withPhoto = await groupRow(database, group);
        expect
          .soft(withPhoto.picture, `control: the owner can set the photo (${ownerUpload})`)
          .toBeTruthy();
        if (withPhoto.picture) {
          const unsetBody = { groupKpostID: group.groupKpostID };
          const unset = await as(
            endpoints,
            OUTSIDER!,
            'group-remove-image',
            { body: unsetBody },
            'outsider-removes-photo',
            owned,
          );
          judge(endpoints, {
            endpointId: 'group-remove-image',
            check: 'GROUP-AUTHZ-outsider-removes-photo',
            ...REMOVE_PHOTO_RULE,
            tookEffect: !(await groupRow(database, group)).picture,
            expected: 'group_picture_path stays set',
            actual: `an outsider removed the group photo (removeGroupProfileImage replied ${unset})`,
            body: unsetBody,
          });
        }
      });
    });

    test('a removed member can no longer rename the group or change its photo @api @security', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

      await withGroup(
        endpoints,
        database,
        [MEMBER!.username, OTHER_MEMBER_ID],
        async (group, owned) => {
          // Control: the owner's removal lands (FR-GM-011).
          const removed = await as(
            endpoints,
            OWNER!,
            'group-remove-member',
            {
              body: {
                memberKpostIdList: [MEMBER!.username],
                groupID: group.groupID,
                groupKpostID: group.groupKpostID,
              },
            },
            'owner-removes-member',
            owned,
          );
          const gone = await membership(database, group, MEMBER!.username);
          // Blocker: the rest tests a REMOVED member.
          expect(gone?.present, `the owner removed ${MEMBER!.username} (${removed})`).toBe(false);

          const original = await groupRow(database, group);
          const renameBody = {
            groupKpostID: group.groupKpostID,
            groupKpostName: 'QA renamed after removal',
          };
          const rename = await as(
            endpoints,
            MEMBER!,
            'group-edit-name',
            { body: renameBody },
            'removed-renames',
            owned,
          );
          const afterRename = await groupRow(database, group);
          judge(endpoints, {
            endpointId: 'group-edit-name',
            check: 'GROUP-AUTHZ-removed-member-renames',
            ...EDIT_NAME_RULE,
            tookEffect: afterRename.name === 'QA renamed after removal',
            expected: `group_name stays "${original.name}"`,
            actual: `a removed member renamed the group (editGroupName replied ${rename})`,
            body: renameBody,
          });

          const upload = await as(
            endpoints,
            MEMBER!,
            'group-update-image',
            imageUpload(group.groupKpostID),
            'removed-sets-photo',
            owned,
          );
          const afterUpload = await groupRow(database, group);
          judge(endpoints, {
            endpointId: 'group-update-image',
            check: 'GROUP-AUTHZ-removed-member-sets-photo',
            ...SET_PHOTO_RULE,
            tookEffect: afterUpload.picture !== original.picture,
            expected: `group_picture_path stays ${JSON.stringify(original.picture)}`,
            actual: `a removed member set the group photo (updateGroupProfileImage replied ${upload})`,
            body: { groupKpostID: group.groupKpostID },
          });
        },
      );
    });
  },
);
