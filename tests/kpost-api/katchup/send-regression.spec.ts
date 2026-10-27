import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expect, test } from '@fixtures';

/**
 * sendMessage must accept `sendShape()`'s default body, which every Katchup feature spec relies on.
 * Deliberately UNGATED (no `KATCHUP_LIFECYCLE`) so a regression shows up on every run. A 4xx is not
 * auto-filed, so a non-2xx is recorded explicitly as a business-rule violation.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe(
  'KPost Katchup · send regression @api @kpost-api @katchup',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test(
      'sendMessage accepts its own documented default payload',
      { tag: ['@bug-594'] },
      async ({ endpoints }) => {
        const shape = sendShape();
        const exchange = await endpoints.sendTo(
          'katchup-send-message',
          { body: shape },
          {
            label: 'katchup-send-regression:default-payload',
            auth: { principal: A },
            allowLiveWrite: true,
          },
        );

        if (exchange.status >= 200 && exchange.status < 300) {
          // Accepted: delete the message this run created.
          const parsed = exchange.json();
          const value = (parsed.ok ? parsed.value : {}) as { data?: unknown };
          const row = Array.isArray(value.data)
            ? (value.data[0] as Record<string, unknown>)
            : undefined;
          const msgID = typeof row?.msgID === 'number' ? row.msgID : undefined;
          if (msgID) {
            await endpoints
              .sendTo(
                'katchup-delete-message',
                { body: { messageIds: [msgID], groupFlag: false } },
                {
                  label: 'katchup-send-regression:cleanup',
                  auth: { principal: A },
                  allowLiveWrite: true,
                },
              )
              .catch(() => undefined);
          }
        } else {
          // Rejected: record it so it reaches the developer.
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-send-message',
            ruleId: 'REGRESSION-katchup-send-default-payload',
            rule:
              'sendMessage must accept its own documented default request shape (sendShape() with no ' +
              'overrides) — the same shape every other Katchup feature spec depends on to create the ' +
              'messages it tests.',
            expected: '2xx (message accepted, a msgID issued)',
            actual: `${exchange.status} ${exchange.bodyText.slice(0, 300)}`,
            request: { body: shape },
          });
        }

        expect(
          exchange.status,
          `sendMessage rejected its own default payload with ${exchange.status} ` +
            `(body: ${exchange.bodyText.slice(0, 200)})`,
        ).toBeLessThan(300);
      },
    );
  },
);
