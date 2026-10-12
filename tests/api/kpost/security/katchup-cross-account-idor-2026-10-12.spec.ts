// Cross-account IDOR regression guards for Katchup (V2). The V2 controllers override sender/identity
// from the JWT and scope delete/read to the caller (verified live 2026-10-12), so these attacks are
// EXPECTED to be refused. They are pinned here as regression guards: if a future backend change ever
// re-trusts a body-supplied identity (the way the legacy V1 recall path does — see
// katchup-legacy-recall-regression), these tests fail and surface the hole.
//
// Sends a real message, so KATCHUP_LIFECYCLE=true + three distinct KPost principals are required.

import { AUTH_PROFILES } from '@config/auth-profile';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expect, test } from '@fixtures';

const K = AUTH_PROFILES.kpost;
const owner = K.principals.find((p) => p.key === 'personal');
const recipient = K.principals.find((p) => p.key === 'victim');
const attacker = K.principals.find((p) => p.key === 'personal-3');

type MsgData = { msgID?: number | string; msgId?: number | string; messageId?: number | string };

function extractMsgID(bodyText: string): number | string | undefined {
  const parsed = JSON.parse(bodyText || '{}') as { data?: MsgData | MsgData[] };
  const d = Array.isArray(parsed.data) ? parsed.data[0] : parsed.data;
  return d?.msgID ?? d?.msgId ?? d?.messageId;
}

function threadMsgIDs(bodyText: string): Array<number | string> {
  const parsed = JSON.parse(bodyText || '{}') as { data?: Array<{ msgID?: number | string }> };
  return Array.isArray(parsed.data) ? parsed.data.map((m) => m?.msgID).filter((x) => x != null) : [];
}

test.describe('KPost Security · Katchup cross-account IDOR guards @api @kpost-api @security @katchup', () => {
  test.skip(!owner || !recipient || !attacker, 'needs three distinct KPost principals');
  test.skip(process.env.KATCHUP_LIFECYCLE !== 'true', 'sends a real message; set KATCHUP_LIFECYCLE=true');

  test("an attacker cannot DELETE a message from a conversation they are not part of", async ({
    endpoints,
  }) => {
    // owner -> recipient (attacker is neither party)
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape({ receiver: recipient!.username }) },
      { label: 'xacct-delete:send', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const msgID = extractMsgID(sent.bodyText);
    test.skip(!msgID, `sendMessage did not return a msgID (status ${sent.status})`);
    if (!msgID) return;

    try {
      const attack = await endpoints.sendTo(
        'katchup-delete-message',
        { body: { messageIds: [msgID], groupFlag: false } },
        { label: 'xacct-delete:attack', auth: { principal: attacker! }, allowLiveWrite: true },
      );

      // Ground truth: the owner re-reads the thread; the message must still be there.
      const after = await endpoints.sendTo(
        'katchup-conversation',
        { body: { firstMsgID: null, groupFlag: false, lastMsgID: null, receiver: recipient!.username } },
        { label: 'xacct-delete:verify', auth: { principal: owner! } },
      );
      const stillPresent = threadMsgIDs(after.bodyText).map(String).includes(String(msgID));

      if (!stillPresent) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-delete-message',
          ruleId: 'KPV2-XACCT-DELETE',
          rule:
            'deleteKatchUpMessage must only delete rows where the authenticated caller is the sender ' +
            'or receiver; a third account must never be able to delete a message between two other users.',
          expected: 'the attacker delete changes nothing and the owner still sees the message',
          actual: `the message (msgID ${msgID}) was gone from the owner's thread after the attacker's delete (attack status ${attack.status})`,
          request: { body: { messageIds: [msgID], groupFlag: false } },
        });
      }
      expect(
        stillPresent,
        "a third account must not be able to delete a message between two other users",
      ).toBe(true);
    } finally {
      await endpoints
        .sendTo(
          'katchup-delete-message',
          { body: { messageIds: [msgID], groupFlag: false } },
          { label: 'xacct-delete:cleanup', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });

  test("an attacker cannot READ another account's conversation via the thread fetch", async ({
    endpoints,
  }) => {
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape({ receiver: recipient!.username }) },
      { label: 'xacct-read:send', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const msgID = extractMsgID(sent.bodyText);
    test.skip(!msgID, `sendMessage did not return a msgID (status ${sent.status})`);
    if (!msgID) return;

    try {
      // Attacker asks for the thread with `receiver = owner`. The server forces sender = attacker's
      // JWT, so it can only ever return the attacker<->owner thread — never the owner<->recipient one.
      const attack = await endpoints.sendTo(
        'katchup-conversation',
        { body: { firstMsgID: null, groupFlag: false, lastMsgID: null, receiver: owner!.username } },
        { label: 'xacct-read:attack', auth: { principal: attacker! } },
      );
      const leaked = threadMsgIDs(attack.bodyText).map(String).includes(String(msgID));

      if (leaked) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-conversation',
          ruleId: 'KPV2-XACCT-READ',
          rule:
            'katchupMessagesForSelectedContactID must scope the thread to the authenticated caller ' +
            '(sender from JWT); it must never return a message belonging to a conversation the caller ' +
            'is not a party to.',
          expected: "the attacker's fetch does not contain the owner<->recipient message",
          actual: `the owner<->recipient message (msgID ${msgID}) leaked into the attacker's thread fetch`,
          request: { body: { receiver: owner!.username } },
        });
      }
      expect(
        leaked,
        "another account's private message must not leak into a non-participant's thread fetch",
      ).toBe(false);
    } finally {
      await endpoints
        .sendTo(
          'katchup-delete-message',
          { body: { messageIds: [msgID], groupFlag: false } },
          { label: 'xacct-read:cleanup', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });
});
