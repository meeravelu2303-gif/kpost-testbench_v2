import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { body, defineKpostEndpoint, pathParams, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * The KPost **Group** module — `/v2/group/*`. Groups are what Katchup group messaging (FR-K06)
 * needs: `createUserGroup` returns a `groupKpostID`, which is then the receiver for a group send.
 *
 * Verified on live: create → group send → clean up requires **removeGroupMember(all) then
 * deleteGroup** (deleteGroup alone answers 400 "you need to remove all the members"). All writes;
 * none `productionSafe` — a group of our own accounts is still real state, exercised only by the
 * Katchup feature spec with `KATCHUP_LIFECYCLE=true`, which cleans up after itself.
 */
function defineGroupEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['group', ...(config.tags ?? [])],
  });
}

const member = (kpostID: string, admin = false): Record<string, unknown> => ({
  createdBy: testData.kpostId,
  hasAdminAccess: admin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

export const createGroupApi = defineGroupEndpoint({
  id: 'group-create',
  requirements: ['FR-GC-006'],
  method: 'POST',
  path: '/v2/group/createUserGroup/',
  summary: 'Create a group (returns its groupKpostID)',
  tags: ['group-manage', 'needs-recipients'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    activeStatus: 'Y',
    createdBy: testData.kpostId,
    groupPicturePath: null,
    groupCreateAccess: true,
    groupKpostName: 'QA Bench Group',
    isPrivateGroup: 'N',
    memberDetails: [member(testData.victimKpostId), member(testData.kpostId, true)],
  })),
});

export const addUserToGroupApi = defineGroupEndpoint({
  id: 'group-add-user',
  method: 'POST',
  path: '/v2/group/addUserToGroup/',
  summary: 'Add members to a group',
  tags: ['group-manage', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    groupID: 0,
    groupKpostID: testData.kpostIdAbsent,
    memberDetails: [member(testData.personal3KpostId)],
  })),
  note: 'needs a real group id',
});

export const removeGroupMemberApi = defineGroupEndpoint({
  id: 'group-remove-member',
  requirements: ['FR-GC-006'],
  method: 'POST',
  path: '/v2/group/removeGroupMember/',
  summary: 'Remove members from a group',
  tags: ['group-manage', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    memberKpostIdList: [testData.victimKpostId],
    groupID: 0,
    groupKpostID: testData.kpostIdAbsent,
  })),
  note: 'needs a real group id',
});

export const leaveGroupApi = defineGroupEndpoint({
  id: 'group-leave',
  method: 'POST',
  path: '/v2/group/leaveFromGroup/',
  summary: 'Leave a group',
  tags: ['group-manage', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ id: '0', groupID: 0, groupKpostID: testData.kpostIdAbsent })),
  note: 'needs a real group id',
});

export const adminAccessApi = defineGroupEndpoint({
  id: 'group-admin-access',
  method: 'POST',
  path: '/v2/group/addOrRemoveAdminAccess/',
  summary: 'Grant or revoke a member admin access',
  tags: ['group-manage', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    kpostIDs: [testData.victimKpostId],
    ids: [0],
    groupID: 0,
    hasAdminAccess: 'Y',
  })),
  note: 'needs a real group id and membership id',
});

export const editGroupNameApi = defineGroupEndpoint({
  id: 'group-edit-name',
  method: 'POST',
  path: '/v2/group/editGroupName',
  summary: "Change a group's name",
  tags: ['group-manage', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    groupKpostID: testData.kpostIdAbsent,
    groupKpostName: 'QA Bench Renamed',
  })),
  note: 'needs a real groupKpostID',
});

export const deleteGroupApi = defineGroupEndpoint({
  id: 'group-delete',
  method: 'POST',
  path: '/v2/group/deleteGroup',
  summary: 'Delete a group (all members must be removed first)',
  tags: ['group-manage', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ groupID: 0 })),
  note: 'needs a real group id; requires members removed first (verified on live)',
});

export const updateGroupImageApi = defineGroupEndpoint({
  id: 'group-update-image',
  method: 'POST',
  path: '/v2/group/updateGroupProfileImage/',
  summary: "Update a group's profile image",
  tags: ['group-manage', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ groupKpostID: testData.kpostIdAbsent })),
  note: 'needs a real groupKpostID and an image part',
});

export const removeGroupImageApi = defineGroupEndpoint({
  id: 'group-remove-image',
  method: 'POST',
  path: '/v2/group/removeGroupProfileImage',
  summary: "Remove a group's profile image",
  tags: ['group-manage', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ groupKpostID: testData.kpostIdAbsent })),
  note: 'needs a real groupKpostID',
});

export const downloadGroupImageApi = defineGroupEndpoint({
  id: 'group-download-image',
  method: 'GET',
  path: '/v2/group/downloadGroupProfileImage/{groupKpostID}/{kpostID}',
  // The workbook path has a doubled-brace typo; the schema still comes from that row.
  contractPath: '/v2/group/downloadGroupProfileImage/{{groupKpostID}/{kpostID}',
  summary: "Download a group's profile image",
  tags: ['group-image', 'binary', 'needs-message-id'],
  envelope: false,
  contentType: 'image/png',
  request: pathParams(() => ({ groupKpostID: testData.kpostIdAbsent, kpostID: testData.kpostId })),
  note: 'needs a real groupKpostID with an image',
});

export const downloadGroupFullImageApi = defineGroupEndpoint({
  id: 'group-download-full-image',
  method: 'GET',
  path: '/v2/group/downloadGroupFullProfileImage/{groupKpostID}/{kpostID}',
  // Doubled-brace typo AND lower-cased 'kpostid' in the workbook path.
  contractPath: '/v2/group/downloadGroupFullProfileImage/{{groupkpostID}/{kpostID}',
  summary: "Download a group's full profile image",
  tags: ['group-image', 'binary', 'needs-message-id'],
  envelope: false,
  contentType: 'image/png',
  request: pathParams(() => ({ groupKpostID: testData.kpostIdAbsent, kpostID: testData.kpostId })),
  note: 'needs a real groupKpostID with an image',
});

export const groupApis = [
  createGroupApi,
  addUserToGroupApi,
  removeGroupMemberApi,
  leaveGroupApi,
  adminAccessApi,
  editGroupNameApi,
  deleteGroupApi,
  updateGroupImageApi,
  removeGroupImageApi,
  downloadGroupImageApi,
  downloadGroupFullImageApi,
];
