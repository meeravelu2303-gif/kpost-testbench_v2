/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expect, test } from '@fixtures';

/**
 * Katchup **attachment upload** — `sendKatchupMsgMultiPart`, unblocked 2026-09-25 by the same
 * `groupFlag` fix as `katchup-send-message` (its `text` field embeds `sendShape()`). It no longer
 * 400s — but confirmed live: it doesn't do what it says either.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe('KPost Katchup · attachment upload @api @kpost-api @katchup', () => {
  test.skip(
    process.env.KATCHUP_LIFECYCLE !== 'true',
    'sends a real multipart message; set KATCHUP_LIFECYCLE=true',
  );

  test('sendKatchupMsgMultiPart accepts a file part but never actually attaches it', async ({
    endpoints,
  }) => {
    const composed = await endpoints.sendTo(
      'katchup-send-multipart',
      {
        multipart: {
          text: JSON.stringify(sendShape()),
          file: {
            name: 'qa-bench.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('QA bench attachment', 'utf8'),
          },
        },
      },
      { label: 'attachment:send-multipart', auth: { principal: A }, allowLiveWrite: true },
    );
    expect(composed.status, 'sendKatchupMsgMultiPart is accepted').toBeLessThan(300);
    const body = JSON.parse(composed.bodyText || '{}') as {
      data?: Array<{ msgID?: number; attachmentUuid?: unknown }>;
    };
    const row = Array.isArray(body.data) ? body.data[0] : undefined;
    const msgID = row?.msgID;
    expect(msgID, 'the multipart send issues a real msgID').toBeTruthy();

    try {
      /*
       * Live-verified 2026-09-25: the immediate response's `attachmentUuid` is already null, and a
       * fresh readback confirms it stays null — the file part was accepted (no 400, no rejection of
       * any kind) but never actually stored as an attachment. This is the finding the engine's own
       * validators cannot see: a 2xx response for a write that silently drops half of what it claims
       * to do. Filed as #614 [KP-90586F], HIGH, KPost API.
       */
      if (row?.attachmentUuid == null) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-send-multipart',
          ruleId: 'REGRESSION-katchup-multipart-no-attachment',
          rule: 'sendKatchupMsgMultiPart must actually attach the uploaded file — a real attachmentUuid must be set on the created message, not null.',
          expected: 'a non-null attachmentUuid on the created message',
          actual: `attachmentUuid=${JSON.stringify(row?.attachmentUuid)}`,
          request: { multipart: { text: '(sendShape JSON)', file: 'qa-bench.txt' } },
        });
      }
      expect
        .soft(
          row?.attachmentUuid,
          'the created message carries a real attachmentUuid, not null — the file was actually attached',
        )
        .not.toBeNull();
    } finally {
      await endpoints
        .sendTo(
          'katchup-delete-message',
          { body: { messageIds: [msgID], groupFlag: false } },
          { label: 'attachment:cleanup', auth: { principal: A }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });
});
