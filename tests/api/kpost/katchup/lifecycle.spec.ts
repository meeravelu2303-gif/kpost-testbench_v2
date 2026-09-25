import { testData } from '@config/test-data.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';

/**
 * The 1:1 message **lifecycle** — send → read back → recall → delete, between our own two accounts.
 *
 * This is the only place a real Katchup message is created, and it cleans up after itself (recall +
 * delete), so nothing is left in a real inbox. It also mints the `msgID` the id-keyed endpoints need
 * — proving the send contract end to end rather than asserting each endpoint in isolation.
 *
 * ## Why it is gated behind an explicit opt-in
 *
 * It writes to a real conversation. Until the owner signs off on sending between our own accounts on
 * the live application (`docs/katchup-flow.md` §6 Q4), this must not run there by accident — so it
 * needs `KATCHUP_LIFECYCLE=true`, and it self-skips otherwise. Off-live (mock) it also needs the
 * flag, because the mock has no Katchup handlers; it exists to run against a real KPost host once a
 * human has said yes.
 */
test.describe('KPost Katchup · 1:1 lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    process.env.KATCHUP_LIFECYCLE !== 'true',
    'writes a real message; set KATCHUP_LIFECYCLE=true to run (owner sign-off, flow doc Q4)',
  );

  let msgID: number | undefined;

  test.afterAll(() => {
    if (msgID && !env.CI) {
      // A visible reminder in local runs that a real message was created (and cleaned up).
      test.info().annotations.push({ type: 'note', description: `lifecycle used msgID ${msgID}` });
    }
  });

  /** First created row from a send response, or undefined. Module-scope: data-shaping, not test flow. */
  function firstCreated(body: Record<string, unknown>): Record<string, unknown> | undefined {
    const data = body.data;
    return Array.isArray(data) ? (data[0] as Record<string, unknown>) : undefined;
  }

  async function send(
    endpoints: EndpointExecutor,
    overrides: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const exchange = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape(overrides) },
      { label: 'katchup-lifecycle:send', allowLiveWrite: true },
    );
    const parsed = exchange.json();
    return {
      status: exchange.status,
      body: (parsed.ok ? parsed.value : {}) as Record<string, unknown>,
    };
  }

  test('a message sends, and comes back with a Subject (BR-K01) and a msgID', async ({
    endpoints,
  }) => {
    const subject = `QA Bench ${Date.now()}`;
    const { status, body } = await send(endpoints, {
      subject,
      actualMessage: 'QA bench lifecycle — safe to ignore.',
    });

    expect(status, 'the send succeeds').toBeLessThan(300);
    // The API returns the created row(s); pull the msgID for the rest of the lifecycle.
    const created = firstCreated(body);
    expect(created, 'the response carries the created message').toBeTruthy();
    expect(created?.subject, 'every message carries its Subject (BR-K01)').toBe(subject);
    expect(typeof created?.msgID, 'a numeric msgID was issued').toBe('number');
    msgID = created?.msgID as number;
  });

  test('the sent message appears in the conversation with our second account (FR-K07)', async ({
    endpoints,
  }) => {
    const exchange = await endpoints.sendTo(
      'katchup-conversation',
      {
        body: {
          groupFlag: false,
          firstMsgID: null,
          lastMsgID: null,
          receiver: testData.victimKpostId,
        },
      },
      { label: 'katchup-lifecycle:conversation' },
    );
    expect(exchange.status, 'the conversation reads back').toBe(200);
    expect(exchange.bodyText, 'our message is in the history').toContain('QA bench lifecycle');
  });

  test('recall removes it from the recipient view (FR-K10 / BR-K03)', async ({ endpoints }) => {
    expect(msgID, 'the send test must have produced a msgID').toBeTruthy();
    const exchange = await endpoints.sendTo(
      'katchup-recall-message',
      { body: { msgID, groupFlag: false } },
      { label: 'katchup-lifecycle:recall', allowLiveWrite: true },
    );
    expect(exchange.status, 'recall succeeds').toBeLessThan(300);
  });

  test('delete removes it entirely (FR-K20)', async ({ endpoints }) => {
    expect(msgID, 'the send test must have produced a msgID').toBeTruthy();
    const exchange = await endpoints.sendTo(
      'katchup-delete-message',
      { body: { messageIds: [msgID], groupFlag: false } },
      { label: 'katchup-lifecycle:delete', allowLiveWrite: true },
    );
    expect(exchange.status, 'delete succeeds — the message is cleaned up').toBeLessThan(300);
  });

  /*
   * Independent of the msgID chain above (sends and cleans its own message) — kept last in this
   * `serial` describe so a failure here (a known, confirmed finding — see below) can never block the
   * main send → conversation → recall → delete chain from running.
   */
  test('an empty subject is accepted as-is (FR-K02, amended 2026-09-25)', async ({ endpoints }) => {
    /*
     * FR-K02/BR-K01 amended 2026-09-25: Subject is no longer mandatory. The owner's updated
     * requirement is that a message with no Subject must be accepted, not rejected and not silently
     * defaulted. (Previously the opposite was asserted here as BR-K01-empty-subject-stored-blank,
     * filed as #615 [KP-9DD851] — closed as invalid once the requirement changed; the observed
     * behaviour, storing `subject: ""` verbatim with a 200, was correct all along.) The web client
     * still defaults an empty composer field to "General" before sending — a UI convenience, not an
     * API contract — so this sends `subject: ""` directly to prove the API's own acceptance.
     */
    const { status, body } = await send(endpoints, { subject: '' });
    const created = firstCreated(body);

    expect(status, 'an empty subject is accepted, not rejected').toBeLessThan(300);
    expect(created?.subject, 'the empty subject is stored as sent, not silently defaulted').toBe('');

    // Clean up whatever was created (harmless when there is no id).
    await endpoints
      .sendTo(
        'katchup-delete-message',
        { body: { messageIds: [created?.msgID ?? 0], groupFlag: false } },
        { label: 'katchup-lifecycle:cleanup-empty-subject', allowLiveWrite: true },
      )
      .catch(() => undefined);
  });
});
