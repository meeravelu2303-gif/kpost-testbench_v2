/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { expect, test } from '@fixtures';

/**
 * Katchup attachment IDOR — can an outsider fetch another pair's attachment by its S3 uuid alone?
 * Same question already proven exploitable for KMail's attachment routes (#944) and the same
 * bare-uuid shape Katchup's `download`/`downloadAttachment`/`downloadFromS3`/`downloadThumbnail`/
 * `mediaStreaming`/`generateThumbnailUsingUUID` all share — none had an IDOR test before this
 * (2026-10-03 ground-truth re-audit: 0/6).
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // sender/owner
const B = K.principals.find((p) => p.key === 'victim')!; // legitimate recipient
const C = K.principals.find((p) => p.key === 'personal-3')!; // attacker — no relationship to this mail

test.describe('KPost Security · Katchup attachment IDOR @api @kpost-api @security @katchup', () => {
  test.skip(
    process.env.KATCHUP_LIFECYCLE !== 'true' || process.env.AWS_LIFECYCLE !== 'true',
    'uploads a real file to S3 and sends a real message; set KATCHUP_LIFECYCLE=true and AWS_LIFECYCLE=true',
  );

  test('an unrelated account cannot fetch another pair\'s Katchup attachment by uuid alone', async ({
    endpoints,
  }) => {
    const content = 'QA bench attachment — safe to ignore, not a real document.';
    let msgID: number | undefined;

    try {
      // --- A uploads a real file to S3 and sends it to B -------------------------------------
      const presign = await endpoints.sendTo(
        'aws-katchup-presigned',
        { body: { extension: 'txt', fileName: `qa-idor-${Date.now()}.txt`, fileSize: String(content.length) } },
        { label: 'katchup-idor:presign', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(presign.status, 'generate-presigned-url succeeds').toBeLessThan(300);
      const url = presign.bodyText.trim().replace(/^"|"$/, '');
      const uuid = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
      expect(uuid, 'the presigned URL names a uuid').toBeTruthy();
      if (!uuid) return;

      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: content,
      });
      expect(putRes.status, 'the direct S3 upload succeeds').toBeLessThan(300);

      const sent = await endpoints.sendTo(
        'katchup-send-message',
        { body: sendShape({ receiver: B.username, uuid: [uuid] }) },
        { label: 'katchup-idor:send', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(sent.status, 'the message with its attachment is sent').toBeLessThan(300);
      const sentBody = JSON.parse(sent.bodyText || '{}') as { data?: Array<{ msgID?: number }> };
      msgID = Array.isArray(sentBody.data) ? sentBody.data[0]?.msgID : undefined;

      // --- C, who never sent or received this message, fetches the attachment by uuid alone ---
      const download = await endpoints.sendTo(
        'katchup-download',
        { pathParams: { uuid } },
        { label: 'katchup-idor:attacker-download', auth: { principal: C }, allowLiveRead: true },
      );
      const downloadAttachment = await endpoints.sendTo(
        'katchup-download-attachment',
        { pathParams: { uuid } },
        { label: 'katchup-idor:attacker-download-attachment', auth: { principal: C }, allowLiveRead: true },
      );
      const downloadFromS3 = await endpoints.sendTo(
        'katchup-download-from-s3',
        { pathParams: { uuid } },
        { label: 'katchup-idor:attacker-download-s3', auth: { principal: C }, allowLiveRead: true },
      );
      const thumbnail = await endpoints.sendTo(
        'katchup-download-thumbnail',
        { pathParams: { uuid } },
        { label: 'katchup-idor:attacker-thumbnail', auth: { principal: C }, allowLiveRead: true },
      );
      const stream = await endpoints.sendTo(
        'katchup-media-streaming',
        { pathParams: { uuid } },
        { label: 'katchup-idor:attacker-stream', auth: { principal: C }, allowLiveRead: true },
      );

      const results: Array<[string, number]> = [
        ['download', download.status],
        ['downloadAttachment', downloadAttachment.status],
        ['downloadFromS3', downloadFromS3.status],
        ['downloadThumbnail', thumbnail.status],
        ['mediaStreaming', stream.status],
      ];
      const leaked = results.filter(([, status]) => status < 300);

      if (leaked.length > 0) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'katchup-download',
          ruleId: 'IDOR-katchup-attachment-by-uuid',
          rule:
            "A Katchup attachment must only be fetchable by the message's sender or receiver — an " +
            'unrelated account must not be able to download it by uuid alone.',
          expected: 'every route refuses an unrelated caller',
          actual: `${leaked.map(([name, status]) => `${name}=${status}`).join(', ')} — at least one ` +
            `succeeded for uuid ${uuid}, which ${A.username} uploaded for a message to ${B.username} ` +
            `that ${C.username} (attacker) has no relationship to`,
          request: { pathParams: { uuid } },
        });
      }

      for (const [name, status] of results) {
        expect
          .soft(status, `IDOR: an unrelated account must not fetch another pair's attachment via ${name} (uuid ${uuid})`)
          .toBeGreaterThanOrEqual(400);
      }
    } finally {
      if (msgID) {
        await endpoints
          .sendTo(
            'katchup-delete-message',
            { body: { messageIds: [msgID], groupFlag: false } },
            { label: 'katchup-idor:cleanup', auth: { principal: A }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    }
  });
});
