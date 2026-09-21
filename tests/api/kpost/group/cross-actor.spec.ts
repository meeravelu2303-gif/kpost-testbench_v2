import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { describeViews, observeAs, rowsOf } from '../../support/cross-actor';
import { slotPrincipals, type CleanupCoordinator } from '../../../../src/test-data/index';

/**
 * Group admin → group member, observed through each actor's own session (master plan §10,
 * requirement 3).
 *
 * ## What the existing group lifecycle cannot say
 *
 * `feature.spec.ts` drives create → add → admin → rename → image → leave → remove → delete, entirely
 * as the ADMIN, and asserts each step returned a status below 600. Nothing in it establishes that
 * the member can see the group they were added to — which is the only thing "adding a member"
 * actually means to a user.
 *
 * This asserts the membership from the MEMBER's own session: after the admin adds them, the member's
 * own `myGroups` read must contain the group, by `groupID` rather than by name.
 *
 * ## Cleanup is verified, not claimed
 *
 * `deleteGroup` answers 400 "you need to remove all the members" while members remain (observed on
 * live, recorded as `BR-GC-DELETE-EMPTY`), so the cleanup removes members first. The resource ledger
 * records the outcome either way, and the group is registered the moment its identity is known —
 * the smallest window the ledger allows.
 */

const [ADMIN, MEMBER] = slotPrincipals(2) as [Principal, Principal];

const memberEntry = (kpostID: string, isAdmin = false): Record<string, unknown> => ({
  createdBy: ADMIN.username,
  hasAdminAccess: isAdmin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

/** The `data` object a create response carries. Module scope: data-shaping, not test flow. */
function createdGroup(exchange: {
  json(): { ok: boolean; value?: unknown };
}): Record<string, unknown> | undefined {
  const parsed = exchange.json();
  if (!parsed.ok) return undefined;
  const data = (parsed.value as { data?: unknown }).data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
}

test.describe('KPost Group · cross-actor membership', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.GROUP_LIFECYCLE, 'creates a real group; set GROUP_LIFECYCLE=true');

  test('a member added by the admin sees the group in their OWN groups list (FR-GM-010) @api @group', async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    const name = `QA XActor ${Date.now()}`;

    const created = await endpoints.sendTo(
      'group-create',
      {
        body: {
          activeStatus: 'Y',
          createdBy: ADMIN.username,
          groupPicturePath: null,
          groupCreateAccess: true,
          groupKpostName: name,
          isPrivateGroup: 'N',
          memberDetails: [memberEntry(MEMBER.username), memberEntry(ADMIN.username, true)],
        },
      },
      { label: 'group-xactor:create', auth: { principal: ADMIN }, allowLiveWrite: true },
    );
    const data = createdGroup(created);
    const groupID = data?.groupID;
    const groupKpostID = data?.groupKpostID;

    expect(
      typeof groupID,
      `the group must be created and issue a groupID (status ${String(created.status)})`,
    ).toBe('number');

    // Registered the statement after its identity exists — before any assertion can fail.
    resources.track({
      kind: 'katchup-group',
      id: String(groupID),
      describe: `cross-actor group "${name}"`,
      cleanup: async () => {
        const removed = await endpoints.sendTo(
          'group-remove-member',
          { body: { memberKpostIdList: [MEMBER.username], groupID, groupKpostID } },
          {
            label: 'group-xactor:cleanup-members',
            auth: { principal: ADMIN },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        const deleted = await endpoints.sendTo(
          'group-delete',
          { body: { groupID } },
          {
            label: 'group-xactor:cleanup-delete',
            auth: { principal: ADMIN },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        return `removed members (${String(removed.status)}), deleteGroup (${String(deleted.status)})`;
      },
    });

    // ---- each actor reads their OWN groups list ------------------------------------------------
    const adminView = await observeAs(endpoints, {
      role: 'group-admin',
      as: ADMIN,
      endpointId: 'contacts-my-groups',
      body: { lastfetchDate: null },
      label: 'group-xactor:admin-groups',
    });
    const memberView = await observeAs(endpoints, {
      role: 'group-member',
      as: MEMBER,
      endpointId: 'contacts-my-groups',
      body: { lastfetchDate: null },
      label: 'group-xactor:member-groups',
    });
    await testInfo.attach('actor-views', {
      body: describeViews([adminView, memberView]).join('\n'),
      contentType: 'text/plain',
    });

    const holdsGroup = (view: typeof adminView): boolean =>
      rowsOf(view.body, 'group_added').some((row) => row.groupID === groupID);

    expect(
      holdsGroup(adminView),
      `the admin must see the group they created (groupID ${String(groupID)})`,
    ).toBe(true);
    expect(
      holdsGroup(memberView),
      `the MEMBER must see the group they were added to, in their own session (groupID ` +
        `${String(groupID)}). The admin's view saying the add succeeded is not the same fact.`,
    ).toBe(true);
  });
});
