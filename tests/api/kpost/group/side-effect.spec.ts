import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { checkSideEffect, summariseSideEffects } from '../../../../src/side-effects/index';
import { slotPrincipals, type CleanupCoordinator } from '../../../../src/test-data/index';

/**
 * Group membership as a side effect on the MEMBER's own derived list (master plan §11).
 *
 * ## What this adds over the cross-actor test
 *
 * `cross-actor.spec.ts` proves the member can see the group they were added to. That is presence.
 * This is the COUNT: their group list must grow by exactly one, and shrink by exactly one when they
 * are removed. The two failures are different — a list that gains the right group AND a duplicate
 * row satisfies presence and breaks the count, and a membership that is never withdrawn on removal
 * is invisible to any assertion that only looks for the group while it is supposed to be there.
 *
 * ## Why the removal half matters most
 *
 * Adding is exercised constantly; removing is not — so a membership that is never withdrawn is
 * invisible to every assertion that only looks for the group while it is supposed to be there.
 *
 * ## What the removal half does NOT claim
 *
 * An earlier draft of this file called a stale entry a confidentiality failure, on the reasoning
 * that a member who still lists a group still sees its traffic. `confirmation.spec.ts` measured
 * that independently and it is **not true here**: a message sent to the group AFTER the removal does
 * not reach the removed member's Katchup read. The delivery boundary closes; the list entry is what
 * does not. So this asserts the stale list and says nothing about access — the impact claim was
 * removed rather than softened, because it was measured to be wrong.
 *
 * ## Safety
 *
 * One group, created and destroyed by this test on accounts the bench owns, registered with the
 * ledger before any assertion can fail. Gated behind `GROUP_LIFECYCLE`. `deleteGroup` answers 400
 * while members remain (`BR-GC-DELETE-EMPTY`, observed on live), so the cleanup removes members
 * first — and that removal is also the action this test measures.
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

/**
 * The rows of the caller's own group list, or `undefined` when it could not be read.
 *
 * The rows live under `group_added`, not `data` — measured, and the reason the cross-actor test
 * reads the same key. Guessing `data` would report an empty list and turn every real membership
 * into a false absence.
 *
 * MEASURED about the envelope, because it decides whether a removal could legitimately be invisible
 * here: with a null lastfetchDate the response is the FULL list, and it carries only "group_added"
 * and "group_updated" — there is NO "group_removed" channel. So a group missing from "group_added"
 * is the only way this endpoint can express that a membership ended.
 */
function groupRows(exchange: {
  json(): { ok: boolean; value?: unknown };
}): Record<string, unknown>[] | undefined {
  const parsed = exchange.json();
  if (!parsed.ok) return undefined;
  const rows = (parsed.value as { group_added?: unknown }).group_added;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : undefined;
}

/** How many groups that list holds, or `undefined` when it could not be read. */
function groupCount(exchange: { json(): { ok: boolean; value?: unknown } }): number | undefined {
  return groupRows(exchange)?.length;
}

/** Whether that list still names a given group. */
function listsGroup(
  exchange: { json(): { ok: boolean; value?: unknown } },
  groupID: unknown,
): boolean {
  return (groupRows(exchange) ?? []).some((row) => row.groupID === groupID);
}

test.describe('KPost Group · membership side effects', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.GROUP_LIFECYCLE, 'creates a real group; set GROUP_LIFECYCLE=true');

  test("being added grows the member's own group list by exactly one, and removal shrinks it back (FR-GM-010) @api @group", async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    const name = `QA SideEffect ${Date.now()}`;

    /** The member's own group list length. Read as the MEMBER, never as the admin. */
    const countAsMember = async (label: string): Promise<number | undefined> => {
      const read = await endpoints.sendTo(
        'contacts-my-groups',
        { body: { lastfetchDate: null } },
        { label, auth: { principal: MEMBER } },
      );
      return groupCount(read);
    };

    const before = await countAsMember('group-side-effect:count-before');
    test.skip(
      before === undefined,
      "the member's group list could not be read, so no delta exists to assert — inconclusive, not a failure",
    );

    // ---- the action ----------------------------------------------------------------------------
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
      { label: 'group-side-effect:create', auth: { principal: ADMIN }, allowLiveWrite: true },
    );
    const data = createdGroup(created);
    const groupID = data?.groupID;
    const groupKpostID = data?.groupKpostID;
    expect(
      typeof groupID,
      `the group must be created and issue a groupID (status ${String(created.status)})`,
    ).toBe('number');

    let membersRemoved = false;
    resources.track({
      kind: 'katchup-group',
      id: String(groupID),
      describe: `side-effect group "${name}"`,
      cleanup: async () => {
        // The test removes the member itself to measure the withdrawal; only do it again if it did not.
        const removed = membersRemoved
          ? undefined
          : await endpoints.sendTo(
              'group-remove-member',
              { body: { memberKpostIdList: [MEMBER.username], groupID, groupKpostID } },
              {
                label: 'group-side-effect:cleanup-members',
                auth: { principal: ADMIN },
                allowLiveWrite: true,
                phase: 'cleanup',
              },
            );
        const deleted = await endpoints.sendTo(
          'group-delete',
          { body: { groupID } },
          {
            label: 'group-side-effect:cleanup-delete',
            auth: { principal: ADMIN },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        const removal = removed
          ? `removed members (${String(removed.status)}), `
          : 'members already removed, ';
        return `${removal}deleteGroup (${String(deleted.status)})`;
      },
    });

    const afterAdd = await countAsMember('group-side-effect:count-after-add');

    // ---- the withdrawal ------------------------------------------------------------------------
    const removed = await endpoints.sendTo(
      'group-remove-member',
      { body: { memberKpostIdList: [MEMBER.username], groupID, groupKpostID } },
      { label: 'group-side-effect:remove', auth: { principal: ADMIN }, allowLiveWrite: true },
    );
    membersRemoved = removed.status < 400;
    expect(
      removed.status,
      'the removal must be accepted before its side effect can mean anything',
    ).toBeLessThan(400);

    const afterRemove = await countAsMember('group-side-effect:count-after-remove');

    /*
     * Presence, not just the count. A count that does not move is ambiguous on its own — something
     * else could have changed in the same window. Asking whether THIS group is still in the member's
     * own list removes that doubt, and it is the assertion a reader can act on.
     */
    const listAfterRemove = await endpoints.sendTo(
      'contacts-my-groups',
      { body: { lastfetchDate: null } },
      { label: 'group-side-effect:list-after-remove', auth: { principal: MEMBER } },
    );
    const stillMember = listsGroup(listAfterRemove, groupID);

    // ---- the comparisons -----------------------------------------------------------------------
    const joined = checkSideEffect(
      { name: "member's own group count, on being added", before, after: afterAdd },
      { delta: 1 },
    );
    const left = checkSideEffect(
      { name: "member's own group count, on removal", before: afterAdd, after: afterRemove },
      { delta: -1 },
    );
    await testInfo.attach('side-effects', {
      body: summariseSideEffects([joined, left]).join('\n'),
      contentType: 'text/plain',
    });

    expect(
      joined.outcome,
      `a member added to a group must gain exactly one group in their own list — not zero, and not ` +
        `two. ${joined.reason}`,
    ).not.toBe('NOT_OBSERVED');
    expect(
      stillMember,
      `a removed member must lose the group from their OWN list. groupID ${String(groupID)} is still ` +
        `in the member's list after the admin removal was accepted (status ${String(removed.status)}). ` +
        `This endpoint has no group_removed channel, so remaining in group_added is the only thing ` +
        `it can mean.`,
    ).toBe(false);

    expect(
      left.outcome,
      `a removed member must LOSE the group from their own list; a membership that survives its own ` +
        `removal is state the product cannot later reconcile. Measured separately in ` +
        `confirmation.spec.ts: post-removal group traffic does NOT reach them, so this is a stale ` +
        `list entry and not an access failure. ${left.reason}`,
    ).not.toBe('NOT_OBSERVED');
  });
});
