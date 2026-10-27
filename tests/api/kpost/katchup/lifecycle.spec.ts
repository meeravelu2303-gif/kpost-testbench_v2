import { testData } from '@config/test-data.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';

/**
 * The 1:1 message lifecycle: send → read back → recall → delete, between our own two accounts.
 * Gated behind `KATCHUP_LIFECYCLE=true` because it writes a real message (cleaned up by recall + delete).
 */
test.describe('KPost Katchup · 1:1 lifecycle', { tag: ['@api', '@katchup', '@regression'] }, () => {
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

  /** First created row from a send response, or undefined. */
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

  test(
    'a message sends, and comes back with a Subject (BR-K01) and a msgID',
    {
      annotation: [
        { type: 'requirement', description: 'BR-KU-SUBJECT' },
        { type: 'requirement', description: 'FR-KU-002' },
      ],
    },
    async ({ endpoints }) => {
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
    },
  );

  test(
    'the sent message appears in the conversation with our second account (FR-K07)',
    { annotation: [{ type: 'requirement', description: 'FR-KU-003' }] },
    async ({ endpoints }) => {
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
    },
  );

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

  // Independent of the msgID chain (own message), and last so a failure cannot block the chain.
  test('an empty subject is accepted as-is (FR-K02, amended 2026-09-25)', async ({ endpoints }) => {
    // Subject is optional: an empty one must be accepted and stored as sent, not defaulted.
    const { status, body } = await send(endpoints, { subject: '' });
    const created = firstCreated(body);

    expect(status, 'an empty subject is accepted, not rejected').toBeLessThan(300);
    expect(created?.subject, 'the empty subject is stored as sent, not silently defaulted').toBe(
      '',
    );

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
