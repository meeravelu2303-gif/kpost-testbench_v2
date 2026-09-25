/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expect, test } from '@fixtures';

/**
 * Katchup's default compose payload — the one Katchup spec that always runs, gate or no gate.
 *
 * ## History: a confirmed regression, root-caused, and fixed 2026-09-25
 *
 * `katchup-send-message`, given `sendShape()`'s pure, zero-override default body — the exact shape
 * every other Katchup feature spec depends on to create the messages it tests — spent 2026-09-24
 * answering a business-level 400 (`{"data":[],"status":"FAILURE"}`, no message), reproduced from two
 * accounts, with and without overrides, after a cooldown, and byte-for-byte against a real working
 * payload a user captured from the live application — ruling out testingapi-vs-devapi2 host
 * differences, rate-limiting, and every field EXCEPT one.
 *
 * **Root cause, developer-flagged and confirmed 2026-09-25**: `groupFlag`'s type. `sendShape()` sent
 * it as the char `'N'`, on the (wrong, now-retracted) theory that KPost's Y/N convention applied
 * here. Neither `'N'`/`'Y'` NOR a real JSON boolean (`true`/`false`) work — both still 400 the exact
 * same way. The value the backend actually wants is the **string** `"false"`/`"true"` (a boolean
 * spelled as a word, not a char code or a real boolean) — confirmed live: a real msgID was issued,
 * and the same convention already existed one file over (`katchup-message-count` in `read.api.ts`
 * has sent `groupFlag: 'false'` successfully all along, while a real boolean `false` 400s IT too).
 * Fixed in `send.api.ts`; this spec should now stay green.
 *
 * This spec stays deliberately UNGATED (not behind `KATCHUP_LIFECYCLE`), same as KMail's own
 * `auth-regression.spec.ts`: it is the one check that always runs, so if this ever regresses again
 * it shows up here immediately rather than silently blocking every other Katchup lifecycle test.
 *
 * It is a 4xx, not a 5xx, so the engine's automatic write-flow filing (`flowFindings`) does not pick
 * it up by design — a 4xx might legitimately be the caller's payload. While the regression was live,
 * that meant a human (or an agent who already did the reproduction) had to say so explicitly via
 * `recordBusinessRuleViolation` for it to reach the developer at all; the code below still does this
 * on any future non-2xx, so a regression here is never silent again. Was filed as **Bug #594
 * [KP-4EB0BB]**, now resolved fixed.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe('KPost Katchup · send regression @api @kpost-api @katchup', () => {
  test('sendMessage accepts its own documented default payload', async ({ endpoints }) => {
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
      // Fixed — clean up the message this run just created so confirming the fix doesn't itself
      // leave litter, then let the assertion below pass normally.
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
      // CONFIRMED regression — file it to the developer, not just a soft assert (see the module
      // docstring's reproduction table above).
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

    // The assertion that fails while the regression is live, and passes the moment it is fixed —
    // same shape as KMail's auth-regression.spec.ts.
    expect(
      exchange.status,
      `sendMessage rejected its own default payload with ${exchange.status} ` +
        `(body: ${exchange.bodyText.slice(0, 200)})`,
    ).toBeLessThan(300);
  });
});
