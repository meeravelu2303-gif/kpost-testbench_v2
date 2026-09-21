import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { KATCHUP_STATUS } from '@api/schemas/kpost-types';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { confirm, summariseConfirmations } from '../../../../src/confirmation/index';
import { slotPrincipals, type CleanupCoordinator } from '../../../../src/test-data/index';

/**
 * Independent confirmation of the Phase 9 membership finding (master plan §13).
 *
 * ## What is being confirmed, and why it needs a different path
 *
 * Phase 9 measured that a removed member still holds the group in their own `myGroups` list. That is
 * one endpoint's answer, and one endpoint can be wrong about itself — a stale list is a real defect,
 * but it could equally be a caching quirk with no consequence. Re-reading the same endpoint would
 * only repeat the same question.
 *
 * So this asks a DIFFERENT module, and the sharpest available version of the question:
 *
 *     can a removed member still read traffic sent to the group AFTER their removal?
 *
 * A message sent after the removal is content the member has no claim to under any reading. If their
 * own Katchup conversation returns it, the stale list is not cosmetic — it is a confidentiality
 * boundary that did not close, confirmed through a different endpoint in a different module.
 *
 * ## Why this is a confirmation and not a second detection
 *
 * The independence is structural and recorded: detection was `contacts-my-groups`, confirmation is
 * `katchup-conversation`. The confirmation layer refuses to call anything CONFIRMED down a channel
 * that matches the detection, so the record states which assumption the second observation broke
 * rather than implying it.
 *
 * ## Safety
 *
 * One group and two messages, all on accounts the bench owns, registered with the ledger before any
 * assertion can fail. Gated behind `GROUP_LIFECYCLE`. The confirming observation is a READ made as
 * the member — the bench looks at what the product shows that account, and changes nothing.
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

/** The `data` object a response carries. Module scope: data-shaping, not test flow. */
function dataObject(exchange: {
  json(): { ok: boolean; value?: unknown };
}): Record<string, unknown> | undefined {
  const parsed = exchange.json();
  if (!parsed.ok) return undefined;
  const data = (parsed.value as { data?: unknown }).data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
}

/** The `data` rows of a response. */
function dataRows(exchange: {
  json(): { ok: boolean; value?: unknown };
}): Record<string, unknown>[] | undefined {
  const parsed = exchange.json();
  if (!parsed.ok) return undefined;
  const rows = (parsed.value as { data?: unknown }).data;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : undefined;
}

/**
 * Whether a conversation read holds a given message, or `undefined` when the read could not be
 * parsed.
 *
 * `undefined` rather than `false` on purpose: "the member cannot see it" and "we could not tell"
 * are different facts, and the confirmation layer treats only the second as INDETERMINATE. Collapsing
 * them would turn an unreadable response into a clean bill of health.
 */
function holdsMessage(
  exchange: { json(): { ok: boolean; value?: unknown } },
  msgID: unknown,
): boolean | undefined {
  const rows = dataRows(exchange);
  return rows?.some((row) => row.msgID === msgID);
}

test.describe('KPost Group · independent confirmation', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.GROUP_LIFECYCLE, 'creates a real group; set GROUP_LIFECYCLE=true');

  test('a removed member must not be able to read group traffic sent after their removal (FR-GM-013) @api @group', async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    const name = `QA Confirm ${Date.now()}`;
    const afterSubject = `QA after-removal ${Date.now()}`;

    // ---- the group, with the member in it ------------------------------------------------------
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
      { label: 'group-confirm:create', auth: { principal: ADMIN }, allowLiveWrite: true },
    );
    const group = dataObject(created);
    const groupID = group?.groupID;
    const groupKpostID = group?.groupKpostID;
    expect(
      typeof groupID,
      `the group must be created and issue a groupID (status ${String(created.status)})`,
    ).toBe('number');

    let membersRemoved = false;
    resources.track({
      kind: 'katchup-group',
      id: String(groupID),
      describe: `confirmation group "${name}"`,
      cleanup: async () => {
        const removed = membersRemoved
          ? undefined
          : await endpoints.sendTo(
              'group-remove-member',
              { body: { memberKpostIdList: [MEMBER.username], groupID, groupKpostID } },
              {
                label: 'group-confirm:cleanup-members',
                auth: { principal: ADMIN },
                allowLiveWrite: true,
                phase: 'cleanup',
              },
            );
        const deleted = await endpoints.sendTo(
          'group-delete',
          { body: { groupID } },
          {
            label: 'group-confirm:cleanup-delete',
            auth: { principal: ADMIN },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        const removal = removed
          ? `removed members (${String(removed.status)}), `
          : 'already removed, ';
        return `${removal}deleteGroup (${String(deleted.status)})`;
      },
    });

    // ---- remove the member ---------------------------------------------------------------------
    const removal = await endpoints.sendTo(
      'group-remove-member',
      { body: { memberKpostIdList: [MEMBER.username], groupID, groupKpostID } },
      { label: 'group-confirm:remove', auth: { principal: ADMIN }, allowLiveWrite: true },
    );
    membersRemoved = removal.status < 400;
    expect(
      removal.status,
      'the removal must be accepted, or there is nothing to confirm',
    ).toBeLessThan(400);

    // ---- traffic the member has no claim to, sent AFTER the removal ----------------------------
    const after = await endpoints.sendTo(
      'katchup-send-message',
      {
        body: sendShape({
          receiver: groupKpostID,
          subject: afterSubject,
          actualMessage: 'QA bench post-removal probe — safe to ignore.',
          status: KATCHUP_STATUS.group,
          groupFlag: true,
          /*
           * The REMAINING membership only. Naming the removed member here would address the message
           * to them, and "a message sent to you is readable by you" is not the question — the
           * question is whether group traffic they are no longer part of still reaches them.
           */
          groupmemberList: [ADMIN.username],
        }),
      },
      { label: 'group-confirm:send-after', auth: { principal: ADMIN }, allowLiveWrite: true },
    );
    const afterMsgId = dataRows(after)?.[0]?.msgID;
    await testInfo.attach('post-removal-send', {
      body: `status ${String(after.status)} · msgID ${String(afterMsgId)}`,
      contentType: 'text/plain',
    });
    test.skip(
      typeof afterMsgId !== 'number',
      `the post-removal group message could not be sent (status ${String(after.status)}), so there ` +
        'is nothing to confirm against — inconclusive, not a pass',
    );
    resources.track({
      kind: 'katchup-message',
      id: String(afterMsgId),
      describe: `post-removal group message "${afterSubject}"`,
      cleanup: async () => {
        const deleted = await endpoints.sendTo(
          'katchup-delete-message',
          { body: { messageIds: [afterMsgId], groupFlag: true } },
          {
            label: 'group-confirm:cleanup-message',
            auth: { principal: ADMIN },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        return `deleted (${String(deleted.status)})`;
      },
    });

    // ---- the INDEPENDENT observation: a different module, read as the removed member -----------
    const memberView = await endpoints.sendTo(
      'katchup-conversation',
      {
        body: {
          groupFlag: true,
          firstMsgID: null,
          lastMsgID: null,
          receiver: groupKpostID,
        },
      },
      { label: 'group-confirm:member-reads-group', auth: { principal: MEMBER } },
    );
    const seesPostRemovalTraffic = holdsMessage(memberView, afterMsgId);

    const record = confirm({
      resourceKind: 'katchup-group',
      resourceId: String(groupID),
      // Phase 9 detected the stale membership here …
      detectedVia: { surface: 'API', actorKey: 'member', via: 'contacts-my-groups' },
      // … and this asks a different module the consequential version of the question.
      confirming: {
        channel: { surface: 'API', actorKey: 'member', via: 'katchup-conversation' },
        showsSameBehaviour: seesPostRemovalTraffic,
        evidence:
          `the removed member's own Katchup read of the group, looking for msgID ` +
          `${String(afterMsgId)} which was sent after the removal was accepted`,
      },
    });
    await testInfo.attach('confirmation', {
      body: summariseConfirmations([record]).join('\n'),
      contentType: 'text/plain',
    });

    expect(
      record.outcome,
      `a removed member must not be able to read group traffic sent after their removal. ` +
        `${record.reason}`,
    ).not.toBe('CONFIRMED');
  });
});
