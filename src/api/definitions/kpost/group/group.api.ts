import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import {
  body,
  defineKpostEndpoint,
  defineUndocumentedKpostEndpoint,
  pathParams,
  type KpostEndpointConfig,
  type UndocumentedKpostEndpointConfig,
} from '../kpost-endpoint';

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

/** Same as `defineGroupEndpoint`, for a real endpoint the workbook does not document. */
function defineUndocumentedGroupEndpoint(
  config: UndocumentedKpostEndpointConfig,
): EndpointDefinition {
  return defineUndocumentedKpostEndpoint({
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
    groupKpostName: `QA Bench Group ${Date.now()}`,
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

/**
 * **V1 legacy** route — `GroupController.java` (base `group`, no `v2` prefix), still live alongside
 * the hardened V2 route above. Source-confirmed (`GroupServiceDaoImpl.deleteUserFromGroup`, a raw
 * `DELETE ... WHERE group_id = :groupId AND kpost_id IN (:kpostID)`) to perform **zero ownership or
 * membership check**: the controller only requires *some* valid authenticated caller, then deletes
 * whatever `groupID` + `memberKpostIdList` the request names — it never checks that the caller is an
 * admin, or even a member, of that group. Tracked as its own endpoint (not reusing `group-remove-
 * member`, the V2 id) because the two routes have materially different authorization behaviour.
 */
export const removeGroupMemberV1LegacyApi = defineUndocumentedGroupEndpoint({
  id: 'group-remove-member-v1-legacy',
  method: 'POST',
  path: '/group/removeGroupMember/',
  summary: 'V1 legacy remove-member route — source-confirmed zero ownership/membership check',
  tags: ['group-manage', 'legacy', 'security'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    memberKpostIdList: [testData.victimKpostId],
    groupID: 0,
    groupKpostID: testData.kpostIdAbsent,
  })),
  evidence:
    'GroupController.java:72-86 (@RequestMapping("group"), @PostMapping("removeGroupMember")) -> ' +
    'GroupServiceImpl.deleteUserFromGroup -> GroupServiceDaoImpl.deleteUserFromGroup:102-109, a raw ' +
    '"DELETE FROM TBL_KPOST_USERGROUP_MEMBERDETAILS WHERE group_id=:groupId AND kpost_id IN (:kpostID)" ' +
    'with no ownership/membership check on the caller.',
  note: 'needs a real group id; source-confirmed BOLA, see katchup-ground-truth-coverage-2026-10-03.md priority finding #4',
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
  /*
   * Live-verified 2026-09-26: this route is `multipart/form-data`, not JSON — the previous plain-JSON
   * body always 400d "Request must be multipart/form-data with the required file parts", so this
   * write had never once succeeded in this bench's history (hidden by a `status < 600` check in
   * feature.spec.ts). The file part is `file` (confirmed against `image`/`groupImage`/`profileImage`/
   * `files`, all rejected as "Required part 'file' is missing"). It also rejects PNG — same class of
   * format restriction as `profile-update-image` — with "Invalid File Format"; JPEG is accepted.
   */
  request: () => ({
    multipart: {
      file: {
        name: 'qa-bench.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(
          '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
          'base64',
        ),
      },
      text: JSON.stringify({ groupKpostID: testData.kpostIdAbsent }),
    },
  }),
  note: 'needs a real groupKpostID; multipart JPEG (PNG is rejected)',
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

/**
 * **UNDOCUMENTED IN THE WORKBOOK** — found via the 2026-10-02 frontend-integration trace. Heavily
 * used: 7 real call sites across `App.js`, Home's `RecentMessage.js`/`MainHomePage.js`, all 3
 * Katchup UI variants, and Kmail's `MessageContainer.js`. Real shape: `Contacts.js:93-98`
 * (`FetchGroupDetailsByGroupID(groupKpostID)`), a GET with the id in the path, no body.
 */
export const groupDetailsByIdApi = defineUndocumentedGroupEndpoint({
  id: 'group-details-by-id',
  method: 'GET',
  path: '/v2/group/getGroupDetailsUsingGroupKpostID/{groupKpostID}',
  summary: "Fetch a group's details by its groupKpostID",
  tags: ['group-read', 'needs-group'],
  evidence:
    'Contacts.js:93-98 (FetchGroupDetailsByGroupID); callers App.js, RecentMessage.js, ' +
    'MainHomePage.js, 3 Katchup UI variants, Kmail MessageContainer.js',
  productionSafe: false,
  request: pathParams(() => ({ groupKpostID: testData.kpostIdAbsent })),
  note:
    'needs a real groupKpostID from a group this account belongs to. Confirmed live 2026-10-02: ' +
    'the group record comes back under a `known_group` key, not the usual `data` envelope key — ' +
    'unknown until now since no workbook sample existed to check against (undocumented endpoint).',
});

export const groupApis = [
  createGroupApi,
  addUserToGroupApi,
  removeGroupMemberApi,
  removeGroupMemberV1LegacyApi,
  leaveGroupApi,
  adminAccessApi,
  editGroupNameApi,
  deleteGroupApi,
  updateGroupImageApi,
  removeGroupImageApi,
  downloadGroupImageApi,
  downloadGroupFullImageApi,
  groupDetailsByIdApi,
];
