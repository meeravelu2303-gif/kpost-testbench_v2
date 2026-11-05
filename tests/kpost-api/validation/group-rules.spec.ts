import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Group input and state rules the engine's per-field cases do not reach, read from
 * GroupControllerV2 / GroupServiceImpl: a group needs a name, a name is unique (createUserGroup
 * answers 409 for a taken one), a member is listed once, only a member can be removed, admin access
 * is "Y" or "N", a group with members cannot be deleted, and only real KPost IDs can join. Each test
 * makes its own group as qatest1 with qatest2 as the member and deletes it afterwards, whatever
 * happened. Gated behind `GROUP_LIFECYCLE=true` like the feature flow.
 */

const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // owner
const C = K.principals.find((p) => p.key === 'personal-3')!;
const B = testData.victimKpostId; // the member every group starts with

const member = (kpostID: string, isAdmin = false): Record<string, unknown> => ({
  createdBy: A.username,
  hasAdminAccess: isAdmin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

const createBody = (groupKpostName: string): Record<string, unknown> => ({
  activeStatus: 'Y',
  createdBy: A.username,
  groupPicturePath: null,
  groupCreateAccess: true,
  groupKpostName,
  isPrivateGroup: 'N',
  memberDetails: [member(B), member(A.username, true)],
});

const uniqueName = (what: string) => `QA Group ${what} ${Date.now()}`;

interface Reply {
  status: number;
  data: Record<string, unknown>;
  body: Record<string, unknown>;
}

async function as(
  endpoints: EndpointExecutor,
  who: Principal,
  id: string,
  body: Record<string, unknown>,
  label: string,
  ownedIdentifiers: string[] = [],
): Promise<Reply> {
  const ex = await endpoints.sendTo(
    id,
    { body },
    {
      label: `group-rules:${label}`,
      auth: { principal: who },
      allowLiveWrite: true,
      ownedIdentifiers,
    },
  );
  const parsed = ex.json();
  const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  return { status: ex.status, data: (value.data as Record<string, unknown>) ?? {}, body: value };
}

interface Group {
  groupID: number;
  groupKpostID: string;
  name: string;
}

async function details(
  endpoints: EndpointExecutor,
  groupKpostID: string,
): Promise<Record<string, unknown>> {
  const ex = await endpoints.sendTo(
    'group-details-by-id',
    { pathParams: { groupKpostID } },
    { label: 'group-rules:details', auth: { principal: A }, allowLiveRead: true },
  );
  const parsed = ex.json();
  const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  // The group sits under `known_group`, not the usual `data` key.
  return (value.known_group as Record<string, unknown> | undefined) ?? {};
}

/** Active members: removed or departed members stay listed with `removedFlag: true`. */
async function activeMembers(endpoints: EndpointExecutor, groupKpostID: string): Promise<string[]> {
  const rows = ((await details(endpoints, groupKpostID)).memberDetails ?? []) as Array<{
    kpostID: string;
    removedFlag?: boolean;
  }>;
  return rows.filter((m) => m.removedFlag !== true).map((m) => m.kpostID.toLowerCase());
}

async function create(endpoints: EndpointExecutor, name: string, label: string) {
  const created = await as(endpoints, A, 'group-create', createBody(name), label);
  const groupID = created.data.groupID as number | undefined;
  const groupKpostID = created.data.groupKpostID as string | undefined;
  const group: Group | undefined =
    groupID && groupKpostID ? { groupID, groupKpostID, name } : undefined;
  return { created, group };
}

/** Removes every active member but the owner, then deletes the group; soft-checks it went. */
async function destroy(endpoints: EndpointExecutor, group: Group | undefined): Promise<void> {
  if (!group) return;
  const others = (await activeMembers(endpoints, group.groupKpostID)).filter(
    (k) => k !== A.username.toLowerCase(),
  );
  if (others.length) {
    await as(
      endpoints,
      A,
      'group-remove-member',
      { memberKpostIdList: others, groupKpostID: group.groupKpostID, groupID: group.groupID },
      'cleanup-remove',
    ).catch(() => undefined);
  }
  const deleted = await as(
    endpoints,
    A,
    'group-delete',
    { groupID: group.groupID },
    'cleanup-delete',
  ).catch(() => ({ status: 0, data: {}, body: {} }));
  expect.soft(deleted.status, `the test group ${group.name} is deleted afterwards`).toBe(200);
}

test.describe(
  'KPost Group · input and state rules @database',
  { tag: ['@api', '@group', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default' });
    test.skip(
      process.env.GROUP_LIFECYCLE !== 'true',
      'creates real groups; set GROUP_LIFECYCLE=true',
    );

    test('a group with a blank name is refused and nothing is created @api @group', async ({
      endpoints,
    }) => {
      const { created, group } = await create(endpoints, '   ', 'create-blank');
      try {
        if (created.status < 400) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'group-create',
            ruleId: 'GROUP-name-required',
            rule: 'createUserGroup must refuse a blank (whitespace-only) group name with 400 "groupKpostName is required".',
            expected: '400 groupKpostName is required, no group created',
            actual: `createUserGroup answered ${created.status} and created group ${group?.groupKpostID ?? '?'}`,
            request: { body: createBody('   ') },
          });
        }
        expect.soft(created.status, 'a whitespace-only name is refused').toBe(400);
        expect.soft(group, 'no group is created for a blank name').toBeUndefined();
      } finally {
        await destroy(endpoints, group);
      }
    });

    test('a second group with a name already in use is refused with 409 @api @group', async ({
      endpoints,
    }) => {
      const name = uniqueName('dup');
      const first = await create(endpoints, name, 'create-first');
      const second = await create(endpoints, name, 'create-duplicate');
      try {
        expect(first.group, 'the first group is created').toBeDefined();
        if (second.created.status !== 409) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'group-create',
            ruleId: 'GROUP-name-unique',
            rule: 'createUserGroup must refuse a group name already in use with 409 "Group name is already exist".',
            expected: '409, no second group',
            actual: `createUserGroup answered ${second.created.status} for a taken name`,
            request: { body: createBody(name) },
          });
        }
        expect.soft(second.created.status, 'the same name a second time is a 409').toBe(409);
        expect.soft(second.group, 'no second group with the same name exists').toBeUndefined();
      } finally {
        await destroy(endpoints, second.group);
        await destroy(endpoints, first.group);
      }
    });

    test('renaming a group to a blank name is refused and the name stays @api @group', async ({
      endpoints,
    }) => {
      const { group } = await create(endpoints, uniqueName('rename-blank'), 'create');
      try {
        expect(group, 'the test group is created').toBeDefined();
        const renamed = await as(
          endpoints,
          A,
          'group-edit-name',
          { groupKpostID: group!.groupKpostID, groupKpostName: '   ' },
          'rename-blank',
        );
        const stored = (await details(endpoints, group!.groupKpostID)).groupKpostName;
        const nameNow = typeof stored === 'string' ? stored : '';
        if (renamed.status < 400 || nameNow.trim() === '') {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'group-edit-name',
            ruleId: 'GROUP-rename-name-required',
            rule: 'editGroupName must refuse a blank name, as createUserGroup does ("groupKpostName is required"); GroupServiceImpl.editGroupName saves any value.',
            expected: 'a 4xx, the group keeps its name',
            actual: `editGroupName answered ${renamed.status}; the group's name is now "${nameNow}"`,
            request: { body: { groupKpostID: group!.groupKpostID, groupKpostName: '   ' } },
          });
        }
        expect.soft(renamed.status, 'a blank new name is refused').toBeGreaterThanOrEqual(400);
        expect.soft(nameNow, 'the group keeps its name').toBe(group!.name);
      } finally {
        await destroy(endpoints, group);
      }
    });

    test('renaming a group to a name already in use is refused, as create refuses it @api @group', async ({
      endpoints,
    }) => {
      const first = await create(endpoints, uniqueName('taken'), 'create-first');
      const second = await create(endpoints, uniqueName('renamed'), 'create-second');
      try {
        expect(first.group && second.group, 'both test groups are created').toBeTruthy();
        const renamed = await as(
          endpoints,
          A,
          'group-edit-name',
          { groupKpostID: second.group!.groupKpostID, groupKpostName: first.group!.name },
          'rename-to-taken',
        );
        if (renamed.status < 400) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'group-edit-name',
            ruleId: 'GROUP-rename-name-unique',
            rule: 'editGroupName must refuse a name another group already has (createUserGroup answers 409 for it); renaming around the check gives two groups one name.',
            expected: '409 (or another 4xx), the group keeps its name',
            actual: `editGroupName answered ${renamed.status} and renamed it to a name in use`,
            request: {
              body: { groupKpostID: second.group!.groupKpostID, groupKpostName: first.group!.name },
            },
          });
        }
        expect
          .soft(renamed.status, 'a name in use is refused on rename')
          .toBeGreaterThanOrEqual(400);
      } finally {
        await destroy(endpoints, second.group);
        await destroy(endpoints, first.group);
      }
    });

    test('adding someone who is already a member does not list them twice @api @group', async ({
      endpoints,
    }) => {
      const { group } = await create(endpoints, uniqueName('re-add'), 'create');
      try {
        expect(group, 'the test group is created').toBeDefined();
        const body = {
          groupID: group!.groupID,
          groupKpostID: group!.groupKpostID,
          memberDetails: [member(B)],
        };
        const added = await as(endpoints, A, 'group-add-user', body, 'add-existing');
        const listed = (await activeMembers(endpoints, group!.groupKpostID)).filter(
          (k) => k === B.toLowerCase(),
        ).length;
        if (listed > 1) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'group-add-user',
            ruleId: 'GROUP-member-once',
            rule: 'addUserToGroup must not add an active member a second time.',
            expected: 'the member is listed once (a 4xx or a no-op 200)',
            actual: `addUserToGroup answered ${added.status}; ${B} is now an active member ${listed} times`,
            request: { body },
          });
        }
        expect.soft(listed, 'the member is listed once').toBe(1);
      } finally {
        await destroy(endpoints, group);
      }
    });

    test('removing someone who is not a member is refused @api @group', async ({ endpoints }) => {
      const { group } = await create(endpoints, uniqueName('remove-stranger'), 'create');
      try {
        expect(group, 'the test group is created').toBeDefined();
        const body = {
          memberKpostIdList: [C.username],
          groupKpostID: group!.groupKpostID,
          groupID: group!.groupID,
        };
        const removed = await as(endpoints, A, 'group-remove-member', body, 'remove-non-member');
        if (removed.status < 400) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'group-remove-member',
            ruleId: 'GROUP-remove-only-members',
            rule: 'removeGroupMember must refuse a KPost ID that is not a member of the group instead of answering "Removed from the group successfully".',
            expected: 'a 4xx naming the member',
            actual: `removeGroupMember answered ${removed.status} for a non-member`,
            request: { body },
          });
        }
        expect.soft(removed.status, 'a non-member cannot be removed').toBeGreaterThanOrEqual(400);
      } finally {
        await destroy(endpoints, group);
      }
    });

    test('admin access takes only "Y" or "N", and matching kpostIDs and ids @api @group', async ({
      endpoints,
    }) => {
      const { group } = await create(endpoints, uniqueName('admin-input'), 'create');
      try {
        expect(group, 'the test group is created').toBeDefined();
        const cases: Array<[string, Record<string, unknown>]> = [
          [
            'hasAdminAccess "X"',
            { kpostIDs: [B], ids: [0], groupID: group!.groupID, hasAdminAccess: 'X' },
          ],
          [
            'two kpostIDs, one id',
            { kpostIDs: [B, C.username], ids: [0], groupID: group!.groupID, hasAdminAccess: 'Y' },
          ],
        ];
        for (const [label, body] of cases) {
          const reply = await as(endpoints, A, 'group-admin-access', body, `admin-${label}`);
          expect.soft(reply.status, `${label} is refused with 400`).toBe(400);
        }
        const members = await activeMembers(endpoints, group!.groupKpostID);
        expect
          .soft(members, 'no one was added by the refused calls')
          .not.toContain(C.username.toLowerCase());
      } finally {
        await destroy(endpoints, group);
      }
    });

    test('a group that still has members cannot be deleted @api @group', async ({ endpoints }) => {
      const { group } = await create(endpoints, uniqueName('delete-full'), 'create');
      let gone = false;
      try {
        expect(group, 'the test group is created').toBeDefined();
        const deleted = await as(
          endpoints,
          A,
          'group-delete',
          { groupID: group!.groupID },
          'delete-with-members',
        );
        gone = deleted.status < 400;
        if (gone) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'group-delete',
            ruleId: 'GROUP-delete-needs-empty',
            rule: 'deleteGroup must refuse a group that still has members (all members are removed first).',
            expected: 'a 4xx, the group and its members stay',
            actual: `deleteGroup answered ${deleted.status} with ${B} still a member`,
            request: { body: { groupID: group!.groupID } },
          });
        }
        expect
          .soft(deleted.status, 'a group with members is not deleted')
          .toBeGreaterThanOrEqual(400);
      } finally {
        if (!gone) await destroy(endpoints, group);
      }
    });

    test('a KPost ID that does not exist cannot be added to a group @api @group', async ({
      endpoints,
    }) => {
      const { group } = await create(endpoints, uniqueName('ghost'), 'create');
      const ghost = `qaghost${Date.now()}@kpostindia.com`;
      try {
        expect(group, 'the test group is created').toBeDefined();
        const body = {
          groupID: group!.groupID,
          groupKpostID: group!.groupKpostID,
          memberDetails: [member(ghost)],
        };
        // A made-up address on our own domain: the QA guard is told it is ours to name.
        const added = await as(endpoints, A, 'group-add-user', body, 'add-ghost', [ghost]);
        const members = await activeMembers(endpoints, group!.groupKpostID);
        if (members.includes(ghost)) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'group-add-user',
            ruleId: 'GROUP-member-must-exist',
            rule: 'addUserToGroup must refuse a KPost ID that is not a registered user.',
            expected: 'a 4xx, nobody added',
            actual: `addUserToGroup answered ${added.status} and listed ${ghost} as a member`,
            request: { body },
          });
        }
        expect.soft(members, 'the unknown KPost ID is not a member').not.toContain(ghost);
        expect.soft(added.status, 'the unknown KPost ID is refused').toBeGreaterThanOrEqual(400);
      } finally {
        await destroy(endpoints, group);
      }
    });
  },
);
