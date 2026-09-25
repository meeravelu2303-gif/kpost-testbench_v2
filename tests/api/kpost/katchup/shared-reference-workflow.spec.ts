import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Katchup **shared/reference reads** — unblocked 2026-09-25 once `katchup-send-message` was fixed
 * (see `send-regression.spec.ts`): these needed a real message id to test with, and nothing could be
 * sent while that regression was live.
 *
 * ## The "no id-minting endpoint" theory was wrong
 *
 * The prior gap notes assumed `sharedMessageId` came from a separate "share a message" action this
 * suite hadn't found. Live-verified 2026-09-25: it doesn't — **every** `sendMessage` response already
 * carries a `sharedMessageId` (equal to `messageTimeAsLong`), and `referenceMessageIDList`/
 * `sourceMsgID` work with a plain sent `msgID` too, no reply/forward required. A single ordinary send
 * is enough to drive all four reads below.
 *
 * ## Two confirmed crashes, two confirmed working
 *
 * - `getBulkMessageInfo` and `getReferenceMSGDetails` — real 200s with real data.
 * - `getSharedMessageInfo` and `getSharedMessageDetails` — both 500, auto-filed via the engine's own
 *   flow-finding pipeline as **#612** and **#613**, both CRITICAL, KPost API.
 * - `getMessagesByReferenceMessageList` fed a plain sent msgID: a clean 404 "No messages found for
 *   the given Data" — reachable, well-formed, not a crash, but not yet confirmed positive (it may
 *   need a message that was genuinely referenced by another, not just any sent message).
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe('KPost Katchup · shared/reference reads @api @kpost-api @katchup', () => {
  test.skip(
    process.env.KATCHUP_LIFECYCLE !== 'true',
    'sends a real message to get an id to test with; set KATCHUP_LIFECYCLE=true',
  );

  async function sendOne(endpoints: EndpointExecutor) {
    const ex = await endpoints.sendTo(
      'katchup-send-message',
      { body: sendShape() },
      { label: 'shared-reference:send', auth: { principal: A }, allowLiveWrite: true },
    );
    expect(ex.status, 'sending the source message succeeds').toBeLessThan(300);
    const body = JSON.parse(ex.bodyText || '{}') as {
      data?: Array<{ msgID?: number; sharedMessageId?: number }>;
    };
    const row = Array.isArray(body.data) ? body.data[0] : undefined;
    return { msgID: row?.msgID, sharedMessageId: row?.sharedMessageId };
  }

  async function cleanup(
    endpoints: EndpointExecutor,
    msgID: number | undefined,
  ): Promise<void> {
    if (!msgID) return;
    await endpoints
      .sendTo(
        'katchup-delete-message',
        { body: { messageIds: [msgID], groupFlag: false } },
        { label: 'shared-reference:cleanup', auth: { principal: A }, allowLiveWrite: true },
      )
      .catch(() => undefined);
  }

  test('getBulkMessageInfo resolves a plain sent message by its sharedMessageId', async ({
    endpoints,
  }) => {
    const { msgID, sharedMessageId } = await sendOne(endpoints);
    try {
      expect(sharedMessageId, 'the sent message carries a sharedMessageId').toBeTruthy();
      const ex = await endpoints.sendTo(
        'katchup-bulk-message-info',
        { body: { sharedMessageId } },
        { label: 'shared-reference:bulk-info', auth: { principal: A }, allowLiveRead: true },
      );
      expect(ex.status, 'getBulkMessageInfo succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as { data?: Array<{ msgID?: number }> };
      expect(
        body.data?.some((r) => r.msgID === msgID),
        'the info returned matches the message we sent',
      ).toBe(true);
    } finally {
      await cleanup(endpoints, msgID);
    }
  });

  test('getReferenceMSGDetails resolves a plain sent message by its own msgID', async ({
    endpoints,
  }) => {
    const { msgID } = await sendOne(endpoints);
    try {
      const ex = await endpoints.sendTo(
        'katchup-reference-details',
        { body: { referenceMessageIDList: [msgID], sourceMsgID: msgID } },
        { label: 'shared-reference:reference-details', auth: { principal: A }, allowLiveRead: true },
      );
      expect(ex.status, 'getReferenceMSGDetails succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as { data?: Array<{ msgID?: number }> };
      expect(
        body.data?.some((r) => r.msgID === msgID),
        'the details returned include the message we referenced',
      ).toBe(true);
    } finally {
      await cleanup(endpoints, msgID);
    }
  });

  test('getMessagesByReferenceMessageList answers cleanly (404) for a plain sent message', async ({
    endpoints,
  }) => {
    const { msgID } = await sendOne(endpoints);
    try {
      const ex = await endpoints.sendTo(
        'katchup-messages-by-reference',
        { body: { referenceMessageIDList: [msgID] } },
        { label: 'shared-reference:messages-by-reference', auth: { principal: A }, allowLiveRead: true },
      );
      // Not yet confirmed positive (see module docstring) — asserted as "reachable, not a crash".
      expect(
        ex.status,
        'getMessagesByReferenceMessageList does not crash for a well-formed reference list',
      ).toBeLessThan(500);
    } finally {
      await cleanup(endpoints, msgID);
    }
  });

  test('getSharedMessageInfo and getSharedMessageDetails both crash on a real id', async ({
    endpoints,
  }) => {
    const { msgID, sharedMessageId } = await sendOne(endpoints);
    try {
      const info = await endpoints.sendTo(
        'katchup-shared-message-info',
        { body: { sharedMessageId } },
        { label: 'shared-reference:shared-info', auth: { principal: A }, allowLiveRead: true },
      );
      expect
        .soft(info.status, 'getSharedMessageInfo does not crash on a real sharedMessageId')
        .toBeLessThan(500);

      const details = await endpoints.sendTo(
        'katchup-shared-message-details',
        { pathParams: { msgID: msgID ?? 0 } },
        { label: 'shared-reference:shared-details', auth: { principal: A }, allowLiveRead: true },
      );
      expect
        .soft(details.status, 'getSharedMessageDetails does not crash on a real msgID')
        .toBeLessThan(500);
    } finally {
      await cleanup(endpoints, msgID);
    }
  });
});
