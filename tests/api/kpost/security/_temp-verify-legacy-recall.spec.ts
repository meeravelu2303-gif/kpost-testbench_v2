/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expect, test } from '@fixtures';

const K = AUTH_PROFILES.kpost;
const owner = K.principals.find((p) => p.key === 'personal');
const attacker = K.principals.find((p) => p.key === 'personal-3');

test.describe('TEMP: verify legacy /katchup/recallMessage trusts body sender', () => {
  test.skip(!owner || !attacker, 'needs two distinct KPost principals');
  test.skip(process.env.KATCHUP_LIFECYCLE !== 'true', 'sends a real message; set KATCHUP_LIFECYCLE=true');

  test('attacker asserts owner identity via body.sender on the legacy path', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection to judge by the row');

    const sent = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape() },
      { label: 'temp:legacy-recall-send', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = sent.json();
    const rawData = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
    const data = (Array.isArray(rawData) ? rawData[0] : rawData) as Record<string, unknown> | undefined;
    const msgID = (data?.msgID ?? data?.msgId ?? data?.messageId) as number | string | undefined;
    console.log('SENT msgID:', msgID, 'status:', sent.status);
    test.skip(!msgID, `sendMessage did not return a msgID (status ${sent.status})`);
    if (!msgID) return;

    const before = await database.findOne<{ recall_status: string }>({
      table: 'TBL_KPOST_KATCHUP_GROUPREADSTATUS',
      where: { msg_id: msgID as string },
    });
    console.log('BEFORE recall_status:', before?.recall_status);

    // Attack: attacker's OWN token, but asserts the OWNER's username as `sender` in the body.
    const attack = await endpoints.sendTo(
      'katchup-legacy-recall-message',
      { body: { msgID, sender: owner!.username, groupFlag: false } },
      { label: 'temp:legacy-recall-attack', auth: { principal: attacker! }, allowLiveWrite: true },
    );
    console.log('ATTACK status:', attack.status, 'body:', attack.bodyText.slice(0, 300));

    const after = await database.findOne<{ recall_status: string }>({
      table: 'TBL_KPOST_KATCHUP_GROUPREADSTATUS',
      where: { msg_id: msgID as string },
    });
    console.log('AFTER recall_status:', after?.recall_status);

    // Cleanup regardless of outcome: owner recalls their own message via the safe V2 path.
    await endpoints
      .sendTo(
        'katchup-recall-message',
        { body: { msgID, groupFlag: false } },
        { label: 'temp:legacy-recall-cleanup', auth: { principal: owner! }, allowLiveWrite: true },
      )
      .catch(() => undefined);
  });
});
