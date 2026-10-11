import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect } from '@playwright/test';

/**
 * Group fixtures for UI specs, through the API — create a known group, tear it down completely.
 *
 * Two live facts shape this (2026-10-10):
 *
 *  1. **Never authenticate the API as the account the browser is signed in as.** KPost keeps one
 *     session per account: minting an API token for it kicks the browser session to `/login`
 *     (12 of 12 Group Info attempts died that way). So the group is created by `personal-3`
 *     (qatest3), with the browser's `personal` account as a second admin when the spec needs the
 *     admin view, and every API call here runs as the creator.
 *  2. **`deleteGroup` is refused while members remain** ("Group Deleted Failed you need to remove all
 *     the members"). Teardown removes every member but the creator first, then deletes. A spec that
 *     only called delete left 12 groups behind.
 */
const K = AUTH_PROFILES.kpost;
export const GROUP_CREATOR: Principal | undefined = K.principals.find(
  (p) => p.key === 'personal-3',
);

export interface QaGroup {
  groupKpostID: string;
  groupID: number;
  /** Every member id, creator included. */
  members: string[];
}

export const groupMember = (kpostID: string, isAdmin = false): Record<string, unknown> => ({
  createdBy: GROUP_CREATOR?.username,
  hasAdminAccess: isAdmin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

export async function asGroupCreator(
  endpoints: EndpointExecutor,
  id: string,
  bodyObj: Record<string, unknown>,
  label: string,
): Promise<{ status: number; bodyText: string; data: Record<string, unknown> }> {
  const ex = await endpoints.sendTo(
    id,
    { body: bodyObj },
    { label: `qa-group:${label}`, auth: { principal: GROUP_CREATOR! }, allowLiveWrite: true },
  );
  const parsed = ex.json();
  const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  return {
    status: ex.status,
    bodyText: ex.bodyText ?? '',
    data: (value.data as Record<string, unknown>) ?? {},
  };
}

/**
 * Create a group owned by `personal-3`. `admins` and `members` are KPost ids to add alongside the
 * creator (admins with admin access). Fails the test if the API does not return a real id.
 */
export async function createQaGroup(
  endpoints: EndpointExecutor,
  label: string,
  options: { admins?: string[]; members?: string[] } = {},
): Promise<QaGroup> {
  const admins = options.admins ?? [];
  const members = options.members ?? [];
  const created = await asGroupCreator(
    endpoints,
    'group-create',
    {
      activeStatus: 'Y',
      createdBy: GROUP_CREATOR!.username,
      groupPicturePath: null,
      groupCreateAccess: true,
      groupKpostName: `QA UI ${label} ${Date.now()}`,
      isPrivateGroup: 'N',
      memberDetails: [
        groupMember(GROUP_CREATOR!.username, true),
        ...admins.map((id) => groupMember(id, true)),
        ...members.map((id) => groupMember(id)),
      ],
    },
    `create-${label}`,
  );
  const groupKpostID = created.data.groupKpostID as string | undefined;
  const groupID = created.data.groupID as number | undefined;
  expect(
    groupKpostID,
    `the group was created with a real groupKpostID (${created.status})`,
  ).toBeTruthy();
  expect(groupID, 'the group was created with a real groupID').toBeTruthy();
  return {
    groupKpostID: groupKpostID!,
    groupID: groupID!,
    members: [GROUP_CREATOR!.username, ...admins, ...members],
  };
}

/** Remove every member but the creator, then delete. Best-effort; never throws. */
export async function deleteQaGroup(
  endpoints: EndpointExecutor,
  group: QaGroup | undefined,
  extraMembers: string[] = [],
): Promise<void> {
  if (!group) return;
  const others = [...new Set([...group.members, ...extraMembers])].filter(
    (id) => id !== GROUP_CREATOR!.username,
  );
  if (others.length) {
    await asGroupCreator(
      endpoints,
      'group-remove-member',
      { memberKpostIdList: others, groupID: group.groupID, groupKpostID: group.groupKpostID },
      'cleanup-remove-members',
    ).catch(() => undefined);
  }
  await asGroupCreator(
    endpoints,
    'group-delete',
    { groupID: group.groupID, groupKpostID: group.groupKpostID },
    'cleanup-delete',
  ).catch(() => undefined);
}
