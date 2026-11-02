import { AUTH_PROFILES } from '@config/auth-profile';
import { initiateShape } from '@api/definitions/kpost/kall/direct.api';
import { KALL_STATUS } from '@api/contract/kpost-types';
import { expect, test } from '@fixtures';

/**
 * updateSenderAndReceiverKallStatus takes the call's "sender" from the body and never looks at the
 * caller (KallControllerV3.updateSenderAndReceiverKallStatus → kallServiceV3.updateKallStatus). An
 * outsider who knows a call id must not be able to change the status of a call between two other
 * people. A rings B; C (no part in the call) tries to cancel it as A; A hangs up afterwards.
 */
const P = AUTH_PROFILES.kpost.principals;
const A = P.find((p) => p.key === 'personal')!;
const B = P.find((p) => p.key === 'victim')!;
const C = P.find((p) => p.key === 'personal-3')!;

test.describe(
  'KPost Kall · only a call’s parties can change its status @api @kpost-api @kall @security',
  {
    tag: ['@api', '@kall', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(process.env.KALL_LIFECYCLE !== 'true', 'places a real call; set KALL_LIFECYCLE=true');

    test('an outsider cannot change the status of a call between two other users', async ({
      endpoints,
    }) => {
      let kallID: number | undefined;
      try {
        const placed = await endpoints.sendTo(
          'kall-initiate',
          { body: initiateShape({ receiver: B.username }) },
          { label: 'kall-spoof:ring', auth: { principal: A }, allowLiveWrite: true },
        );
        kallID = Number(
          (JSON.parse(placed.bodyText || '{}') as { data?: { kallID?: number } }).data?.kallID,
        );
        test.skip(!kallID, `the call could not be placed right now (${placed.status})`);

        const spoof = await endpoints.sendTo(
          'kall-update-sender-receiver-status',
          { body: { sender: A.username, kallStatus: KALL_STATUS.cancelled, kallID } },
          {
            label: 'kall-spoof:outsider',
            auth: { principal: C },
            allowLiveWrite: true,
            ownedIdentifiers: [kallID],
          },
        );
        if (spoof.status < 300)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kall-update-sender-receiver-status',
            ruleId: 'IDOR-kall-status-by-non-party',
            rule:
              'Only the caller or a receiver of a call may change its status; the sender must come ' +
              'from the token, not from the request body.',
            expected: 'HTTP 403/404 for a user who is not part of the call',
            actual: `HTTP ${spoof.status}: ${C.username} changed the status of call ${kallID} (${A.username} → ${B.username}) by naming ${A.username} as sender`,
            request: { body: { sender: A.username, kallStatus: KALL_STATUS.cancelled, kallID } },
            correlationId: spoof.correlationId,
          });
        expect
          .soft(spoof.status, 'an outsider is refused when changing another pair’s call status')
          .toBeGreaterThanOrEqual(400);
      } finally {
        if (kallID)
          await endpoints
            .sendTo(
              'kall-end-individual',
              { body: { kallID } },
              { label: 'kall-spoof:hang-up', auth: { principal: A }, allowLiveWrite: true },
            )
            .catch(() => undefined);
      }
    });
  },
);
