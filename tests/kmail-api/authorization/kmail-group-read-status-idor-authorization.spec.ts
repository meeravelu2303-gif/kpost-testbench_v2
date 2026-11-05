import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { expect, test } from '@fixtures';
import {
  createQaGroup,
  deleteQaGroup,
  GROUP_CREATOR,
  type QaGroup,
} from '../../kpost-ui/support/groups';

/**
 * A group mail's per-recipient read status (kmailGroupReadStatus) must be visible to the group's
 * members only: the handler stores the caller in the request but reads the status by kmailID alone
 * (CommonMailServiceImpl.kmailGroupReadStatus). The group creator makes a QA group with the 2nd QA
 * account, mails it, and an account outside the group asks for the read status. The mail and group
 * are deleted afterwards.
 */
const K = AUTH_PROFILES.kpost;
const MEMBER = K.principals.find((p) => p.key === 'victim')!;
const OUTSIDER = K.principals.find((p) => p.key === 'personal-4')!;

test.describe(
  'KMail · a group mail’s read status is for its members @api @kmail-api @kmail @security',
  {
    tag: ['@api', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      process.env.KMAIL_LIFECYCLE !== 'true' || process.env.GROUP_LIFECYCLE !== 'true',
      'makes a group and sends a real mail; set KMAIL_LIFECYCLE=true and GROUP_LIFECYCLE=true',
    );
    test.skip(!GROUP_CREATOR || !OUTSIDER, 'needs the 3rd and 4th QA accounts');

    test('an account outside the group cannot read who opened a group mail', async ({
      endpoints,
    }) => {
      let group: QaGroup | undefined;
      let transactionIDs: number[] = [];
      try {
        group = await createQaGroup(endpoints, 'group-read-status', {
          members: [MEMBER.username],
        });
        const sent = await endpoints.sendTo(
          'kmail-post-mail',
          {
            body: mailShape({
              toAddress: group.groupKpostID,
              groupFlag: true,
              kmailSubject: `QA group read-status proof ${Date.now()}`,
              kmailContent: 'QA bench group mail, deleted right after.',
            }),
          },
          {
            label: 'group-read:send',
            auth: { principal: GROUP_CREATOR! },
            allowLiveWrite: true,
            ownedIdentifiers: [group.groupKpostID, group.groupID],
          },
        );
        const body = (JSON.parse(sent.bodyText || '{}') as { data?: unknown }).data;
        const row = (Array.isArray(body) ? body[0] : body) as
          | { kmailID?: number; kmailTransactionList?: Array<{ transactionID?: number }> }
          | undefined;
        const kmailID = Number(row?.kmailID);
        transactionIDs = (row?.kmailTransactionList ?? [])
          .map((t) => t.transactionID)
          .filter((v): v is number => typeof v === 'number');
        test.skip(!kmailID, `the group mail returned no kmailID right now (${sent.status})`);
        const owned = [kmailID, group.groupKpostID, group.groupID, ...transactionIDs];

        // Control: the sender, a member, reads the status.
        const member = await endpoints.sendTo(
          'kmail-group-read-status',
          { body: { kmailID } },
          {
            label: 'group-read:member',
            auth: { principal: GROUP_CREATOR! },
            allowLiveRead: true,
            ownedIdentifiers: owned,
          },
        );
        expect(member.status, 'the sender reads its group mail’s status (control)').toBe(200);

        const outsider = await endpoints.sendTo(
          'kmail-group-read-status',
          { body: { kmailID } },
          {
            label: 'group-read:outsider',
            auth: { principal: OUTSIDER },
            allowLiveRead: true,
            ownedIdentifiers: owned,
          },
        );
        test.info().annotations.push({
          type: 'observed',
          description: `outsider got HTTP ${outsider.status}: ${outsider.bodyText.slice(0, 300)}`,
        });
        if (outsider.status < 300)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kmail-group-read-status',
            ruleId: 'IDOR-kmail-group-read-status-non-member',
            rule: 'Only a member of the group (or the sender) may read a group mail’s per-recipient read status.',
            expected: 'HTTP 403/404 and no read status for an account outside the group',
            actual: `HTTP ${outsider.status}: ${OUTSIDER.username} (not in group ${group.groupKpostID}) read the status of group mail ${kmailID}: ${outsider.bodyText.slice(0, 200)}`,
            request: { body: { kmailID } },
            correlationId: outsider.correlationId,
          });
        expect
          .soft(outsider.status, 'an account outside the group is refused')
          .toBeGreaterThanOrEqual(400);
      } finally {
        if (transactionIDs.length)
          await endpoints
            .sendTo(
              'kmail-delete',
              { body: { groupFlag: true, transactionIDs } },
              {
                label: 'group-read:cleanup-mail',
                auth: { principal: GROUP_CREATOR! },
                allowLiveWrite: true,
                ownedIdentifiers: transactionIDs,
              },
            )
            .catch(() => undefined);
        await deleteQaGroup(endpoints, group).catch(() => undefined);
      }
    });
  },
);
