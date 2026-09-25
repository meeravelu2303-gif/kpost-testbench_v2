/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expect, test } from '@fixtures';

/**
 * Katchup rejects its own default compose payload — the one Katchup spec that still runs.
 *
 * ## Why this exists while it isn't a formal numbered rule
 *
 * `katchup-send-message`, given `sendShape()`'s pure, zero-override default body — the exact shape
 * every other Katchup feature spec already depends on to create the messages it tests — now answers
 * a business-level 400 (`{"data":[],"status":"FAILURE"}`, no message), live-verified 2026-09-24,
 * from two different accounts, both with and without body overrides.
 *
 * It is a 4xx, not a 5xx, so the engine's automatic write-flow filing (`flowFindings`) does not pick
 * it up by design — a 4xx might legitimately be the caller's payload, and auto-filing those would
 * risk reporting our own test mistakes as product bugs. That design is correct in general; it just
 * means a confirmed regression in a previously-working DEFAULT payload needs a human (or an agent
 * who already did the reproduction) to say so explicitly, via `recordBusinessRuleViolation`, so it
 * still reaches the developer instead of silently blocking every other Katchup lifecycle test.
 *
 * ## What was ruled out before calling it a product regression
 *
 * | Control | Result |
 * | --- | --- |
 * | `sendShape()` with zero overrides (the endpoint's own documented default) | 400 |
 * | Same call from a second, unrelated account | 400 |
 * | Retried after a 15s cooldown (rules out a momentary rate-limit blip) | 400 |
 * | The same shape has been the working default for every prior Katchup feature spec | (by definition) |
 *
 * This spec is deliberately NOT gated behind `KATCHUP_LIFECYCLE`: like KMail's own
 * `auth-regression.spec.ts`, it is the one check that must keep running so the moment this is fixed
 * upstream shows up here as a green result, telling the whole KATCHUP_LIFECYCLE-gated suite it is
 * safe to trust its sends again.
 *
 * ## Confidence downgraded 2026-09-24 — confirmed on testingapi only, not devapi2/production
 *
 * A user-captured payload sent to the LIVE application (`devapi2.kpostindia.com`) succeeded (200,
 * message persisted) with an equivalent shape. This bench targets `testingapi.kpostindia.com` — a
 * separate, disposable test-DB environment — for every send, precisely so nothing here reaches a
 * real inbox. Re-ran the exact devapi2-captured shape (including `groupFlag` as a boolean and
 * `actualMessage` as the Quill-Delta JSON string the live client sends, neither of which
 * `sendShape()` uses) against testingapi: still 400. Also tried a different receiver and sending to
 * the caller's own account; both QA accounts resolve normally via other read endpoints on
 * testingapi. So this 400 is confirmed on testingapi's `sendMessage` route specifically — it has NOT
 * been reproduced on devapi2/production, where a structurally equivalent payload is known to work.
 * Bug #594 was amended with this finding rather than left to mislead the developer into chasing a
 * production issue. The test below still asserts the endpoint should accept its own default
 * payload — that remains true regardless of environment — but treat a red result here as a
 * testingapi-environment finding until shown otherwise, not a confirmed production regression.
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
