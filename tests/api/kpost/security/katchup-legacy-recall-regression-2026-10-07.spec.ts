// Regression coverage for the legacy KatchupController.recallMessage (V1, no v2 prefix) finding
// confirmed live 2026-10-07: the endpoint has no HttpServletRequest parameter at all and trusts the
// request body's own `sender` field, unlike its V2 sibling (katchup-recall-message), which correctly
// overrides sender from the JWT. Dead from the real frontend (EndPointURL bakes in /v2, see
// src/api/definitions/kpost/katchup/manage.api.ts's own comment on legacyRecallMessageApi) but still
// deployed and directly callable.
/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expect, test } from '@fixtures';

const K = AUTH_PROFILES.kpost;
const owner = K.principals.find((p) => p.key === 'personal');
const attacker = K.principals.find((p) => p.key === 'personal-3');

test.describe('KPost Security · Katchup legacy recallMessage body-sender trust @api @kpost-api @security @katchup', () => {
  test.skip(!owner || !attacker, 'needs two distinct KPost principals');
  test.skip(process.env.KATCHUP_LIFECYCLE !== 'true', 'sends a real message; set KATCHUP_LIFECYCLE=true');

  test('an attacker can recall the owner\'s message via the legacy path by naming the owner as sender', async ({
    endpoints,
  }) => {
    const sent = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape() },
      { label: 'legacy-recall:send', auth: { principal: owner! }, allowLiveWrite: true },
    );
    const parsed = sent.json();
    const rawData = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
    const data = (Array.isArray(rawData) ? rawData[0] : rawData) as Record<string, unknown> | undefined;
    const msgID = (data?.msgID ?? data?.msgId ?? data?.messageId) as number | string | undefined;
    test.skip(!msgID, `sendMessage did not return a msgID (status ${sent.status})`);
    if (!msgID) return;

    try {
      // Attack: attacker's OWN token, but asserts the OWNER's username as `sender` in the body.
      const attack = await endpoints.sendTo(
        'katchup-legacy-recall-message',
        { body: { msgID, sender: owner!.username, groupFlag: false } },
        { label: 'legacy-recall:attack', auth: { principal: attacker! }, allowLiveWrite: true },
      );

      const succeeded = attack.status < 300;
      if (succeeded) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-legacy-recall-message',
          ruleId: 'KPV2-LEGACYRECALLSENDERSPOOF',
          rule:
            'recallMessage must identify the sender from the authenticated caller\'s token, never ' +
            'from a client-supplied body field — an attacker authenticated as a different account ' +
            'must not be able to recall another user\'s message by naming that user as `sender`.',
          expected: 'the attack is refused (non-2xx) because the token identity does not match the real sender',
          actual: `the attack succeeded (${attack.status}): ${attack.bodyText.slice(0, 300)}`,
          request: { body: { msgID, sender: owner!.username, groupFlag: false } },
        });
      }
      expect(
        succeeded,
        'an attacker must not be able to recall another account\'s message via the legacy path',
      ).toBe(false);
    } finally {
      // Cleanup regardless of outcome: owner recalls their own message via the safe V2 path.
      await endpoints
        .sendTo(
          'katchup-recall-message',
          { body: { msgID, groupFlag: false } },
          { label: 'legacy-recall:cleanup', auth: { principal: owner! }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });
});
