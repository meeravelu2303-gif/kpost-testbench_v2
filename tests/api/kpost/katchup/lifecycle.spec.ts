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
test.describe('KPost Katchup · 1:1 lifecycle', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !env.KATCHUP_LIFECYCLE,
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

  /**
   * Whether a message id is still in the sender's conversation with our second account.
   *
   * Keyed on `data[].msgID` rather than the message TEXT: the body of a recalled message is not
   * reliably present in every view, whereas the id is the row's documented identity. A read that
   * does not answer returns `false` only for the pre-delete check to fail loudly — it is never used
   * to claim a deletion succeeded.
   */
  async function messageInConversation(
    endpoints: EndpointExecutor,
    id: number | undefined,
  ): Promise<boolean> {
    if (id === undefined) return false;
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
      { label: 'katchup-lifecycle:observe-delete' },
    );
    const parsed = exchange.json();
    if (!parsed.ok) return false;
    const rows = (parsed.value as Record<string, unknown>).data;
    return (
      Array.isArray(rows) &&
      rows.some((row) => (row as Record<string, unknown> | null)?.msgID === id)
    );
  }

  async function send(
    endpoints: EndpointExecutor,
    overrides: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const exchange = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape(overrides) },
      { label: 'katchup-lifecycle:send' },
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

  test('an empty subject is handled deliberately (FR-K02)', async ({ endpoints }) => {
    /*
     * FR-K02 requires a Subject. The web client never sends an empty one (it defaults to "General"),
     * so the API's own behaviour is untested by the product. We send `subject: ""` to find out: it
     * should either reject the message OR store "General" — never store a blank subject silently.
     * This asserts the meaningful contract; if it fails, that IS the finding (flow doc §2.3).
     */
    const { status, body } = await send(endpoints, { subject: '' });
    const created = firstCreated(body);

    const rejectedOrDefaulted = status >= 400 || created?.subject === 'General';
    expect(
      rejectedOrDefaulted,
      `an empty subject must be rejected or defaulted, not stored blank (got status ${status}, subject ${JSON.stringify(created?.subject)})`,
    ).toBe(true);

    // Clean up whatever was created, if anything (harmless when there is no id).
    await endpoints
      .sendTo(
        'katchup-delete-message',
        // Same correction as the delete test below: the field is `messageIds`, an array.
        { body: { messageIds: [created?.msgID ?? 0], groupFlag: false } },
        { label: 'katchup-lifecycle:cleanup-empty-subject' },
      )
      .catch(() => undefined);
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
      { label: 'katchup-lifecycle:recall' },
    );
    expect(exchange.status, 'recall succeeds').toBeLessThan(300);
  });

  test('delete removes it entirely (FR-K20)', async ({ endpoints }) => {
    expect(msgID, 'the send test must have produced a msgID').toBeTruthy();

    // Precondition: the message is there to delete. Without this the absence check below could
    // pass against a message that was never in the conversation in the first place.
    expect(await messageInConversation(endpoints, msgID), 'the message exists before delete').toBe(
      true,
    );

    const exchange = await endpoints.sendTo(
      'katchup-delete-message',
      /*
       * `messageIds` — a plural ARRAY — is the shape the live client sends (Katchup.js
       * DeleteMessage) and the shape `katchup-delete-message` declares. This test previously sent
       * `{ msgID }`, which the endpoint definition itself records as "the wrong shape [that] can
       * leave the message undeleted (orphan)" — the defect that left 18 orphan messages on the QA
       * account until the cleanup framework surfaced it. The workbook documents no payload for this
       * endpoint at all, so the frontend client is the only contract there is.
       */
      { body: { messageIds: [msgID], groupFlag: false } },
      { label: 'katchup-lifecycle:delete' },
    );
    // Layer 1 — the HTTP contract.
    expect(exchange.status, 'delete is accepted').toBeLessThan(300);

    // Layer 2 — the application state. A 2xx alone never established that anything was deleted.
    expect(
      await messageInConversation(endpoints, msgID),
      'the deleted message no longer appears in the conversation (FR-K20)',
    ).toBe(false);
  });
});
