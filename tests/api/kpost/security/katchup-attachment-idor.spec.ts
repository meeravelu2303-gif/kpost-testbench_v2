import { AUTH_PROFILES } from '@config/auth-profile';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { FILES, uniqueName } from '@fixtures/files';
import { expect, test } from '@fixtures';
import { deleteUploaded, uploadFile } from '../../support/attachments';

/**
 * Katchup attachment IDOR — can an outsider fetch another pair's attachment by its S3 uuid alone?
 * Same question already proven exploitable for KMail's attachment routes (#944) and the same
 * bare-uuid shape Katchup's `download`/`downloadAttachment`/`downloadFromS3`/`downloadThumbnail`/
 * `mediaStreaming`/`generateThumbnailUsingUUID` all share — none had an IDOR test before this
 * (2026-10-03 ground-truth re-audit: 0/6).
 *
 * 2026-10-23: the upload now goes through `tests/api/support/attachments.ts`. Before, this spec never
 * unwrapped the presign reply's `{ presignedURL }` envelope (#942), so its S3 PUT went to a non-URL and
 * the verdicts since then were not about Katchup at all. It also gained the owner control (B's own
 * download must succeed, or C's refusal proves nothing) and removes the S3 object afterwards.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // sender/owner
const B = K.principals.find((p) => p.key === 'victim')!; // legitimate recipient
const C = K.principals.find((p) => p.key === 'personal-3')!; // attacker — no relationship to this mail

test.describe(
  'KPost Security · Katchup attachment IDOR @api @kpost-api @security @katchup',
  {
    tag: ['@api', '@katchup', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    // Each file read takes ~12 s on the test server (#1364); several in a row outlast the 60 s default.
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true' || process.env.AWS_LIFECYCLE !== 'true',
      'uploads a real file to S3 and sends a real message; set KATCHUP_LIFECYCLE=true and AWS_LIFECYCLE=true',
    );

    test("an unrelated account cannot fetch another pair's Katchup attachment by uuid alone", async ({
      endpoints,
    }) => {
      let msgID: number | undefined;
      let uuid: string | undefined;

      try {
        // --- A uploads a real file to S3 and sends it to B -------------------------------------
        const up = await uploadFile(endpoints, A, FILES.txt, {
          route: 'katchup',
          name: uniqueName(FILES.txt, 'idor'),
          label: 'katchup-idor:presign',
        });
        uuid = up.uuid;

        const sent = await endpoints.sendTo(
          'katchup-send-message',
          { body: sendShape({ receiver: B.username, uuid: [uuid] }) },
          { label: 'katchup-idor:send', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(sent.status, 'the message with its attachment is sent').toBeLessThan(300);
        const sentBody = JSON.parse(sent.bodyText || '{}') as { data?: Array<{ msgID?: number }> };
        msgID = Array.isArray(sentBody.data) ? sentBody.data[0]?.msgID : undefined;

        // --- control: the legitimate recipient CAN fetch it (else a refusal below proves nothing) --
        const own = await endpoints.sendTo(
          'katchup-download',
          { pathParams: { uuid } },
          {
            label: 'katchup-idor:recipient-control',
            auth: { principal: B },
            allowLiveRead: true,
            timeoutMs: 60_000,
          },
        );
        expect(own.status, 'control: the recipient downloads their own attachment').toBe(200);

        // --- C, who never sent or received this message, fetches the attachment by uuid alone ---
        const download = await endpoints.sendTo(
          'katchup-download',
          { pathParams: { uuid } },
          {
            label: 'katchup-idor:attacker-download',
            auth: { principal: C },
            allowLiveRead: true,
            timeoutMs: 60_000,
          },
        );
        const downloadAttachment = await endpoints.sendTo(
          'katchup-download-attachment',
          { pathParams: { uuid } },
          {
            label: 'katchup-idor:attacker-download-attachment',
            auth: { principal: C },
            allowLiveRead: true,
            timeoutMs: 60_000,
          },
        );
        const downloadFromS3 = await endpoints.sendTo(
          'katchup-download-from-s3',
          { pathParams: { uuid } },
          {
            label: 'katchup-idor:attacker-download-s3',
            auth: { principal: C },
            allowLiveRead: true,
            timeoutMs: 60_000,
          },
        );
        const thumbnail = await endpoints.sendTo(
          'katchup-download-thumbnail',
          { pathParams: { uuid } },
          {
            label: 'katchup-idor:attacker-thumbnail',
            auth: { principal: C },
            allowLiveRead: true,
            timeoutMs: 60_000,
          },
        );
        const stream = await endpoints.sendTo(
          'katchup-media-streaming',
          { pathParams: { uuid } },
          {
            label: 'katchup-idor:attacker-stream',
            auth: { principal: C },
            allowLiveRead: true,
            timeoutMs: 60_000,
          },
        );

        const results: Array<[string, number]> = [
          ['download', download.status],
          ['downloadAttachment', downloadAttachment.status],
          ['downloadFromS3', downloadFromS3.status],
          ['downloadThumbnail', thumbnail.status],
          ['mediaStreaming', stream.status],
        ];
        // No answer (timeout / dropped connection, status 0) is "not checked", never a verdict.
        const unanswered = results.filter(([, status]) => status === 0).map(([name]) => name);
        if (unanswered.length)
          test.info().annotations.push({
            type: 'not-rechecked',
            description: `no answer from ${unanswered.join(', ')} — those routes were not judged`,
          });
        test.skip(
          unanswered.length === results.length,
          'no route answered the outsider (timeouts) — the IDOR question was not checked this run',
        );
        const leaked = results.filter(([, status]) => status > 0 && status < 300);

        if (leaked.length > 0) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-download',
            ruleId: 'IDOR-katchup-attachment-by-uuid',
            rule:
              "A Katchup attachment must only be fetchable by the message's sender or receiver — an " +
              'unrelated account must not be able to download it by uuid alone.',
            expected: 'every route refuses an unrelated caller',
            actual:
              `${leaked.map(([name, status]) => `${name}=${status}`).join(', ')} — at least one ` +
              `succeeded for uuid ${uuid}, which ${A.username} uploaded for a message to ${B.username} ` +
              `that ${C.username} (attacker) has no relationship to`,
            request: { pathParams: { uuid } },
          });
        }

        for (const [name, status] of results.filter(([, st]) => st !== 0)) {
          expect
            .soft(
              status,
              `IDOR: an unrelated account must not fetch another pair's attachment via ${name} (uuid ${uuid})`,
            )
            .toBeGreaterThanOrEqual(400);
        }
      } finally {
        await deleteUploaded(endpoints, A, uuid, 'katchup-idor:cleanup-file');
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
  },
);
