import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Katchup shared/reference reads, driven by one ordinary send: its response already carries a
 * `sharedMessageId`, and the reference reads accept a plain sent msgID.
 * Known defects #612/#613: getSharedMessageInfo and getSharedMessageDetails answer 500.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe(
  'KPost Katchup · shared/reference reads @api @kpost-api @katchup',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
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

    async function cleanup(endpoints: EndpointExecutor, msgID: number | undefined): Promise<void> {
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
          {
            label: 'shared-reference:reference-details',
            auth: { principal: A },
            allowLiveRead: true,
          },
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
          {
            label: 'shared-reference:messages-by-reference',
            auth: { principal: A },
            allowLiveRead: true,
          },
        );
        // A plain sent msgID answers 404 (it may need a genuinely referenced message), so only "no 5xx".
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
  },
);
