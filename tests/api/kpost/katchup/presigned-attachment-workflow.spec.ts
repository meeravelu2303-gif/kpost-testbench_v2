import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Katchup attachment upload, the client's real flow: presign an S3 URL, PUT the file, send a message
 * naming the uuid, then exercise the download/streaming reads with that real uuid.
 * Gated behind `KATCHUP_LIFECYCLE` and `AWS_LIFECYCLE`: it uploads to S3 and sends a real message.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe(
  'KPost Katchup · presigned attachment upload @api @kpost-api @katchup',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true' || process.env.AWS_LIFECYCLE !== 'true',
      'uploads a real file to S3 and sends a real message; set KATCHUP_LIFECYCLE=true and AWS_LIFECYCLE=true',
    );

    /** Presign, upload a real file, and send a message that references it. Returns the msgID + uuid. */
    async function uploadAndSend(
      endpoints: EndpointExecutor,
      fileName: string,
      extension: string,
      contentType: string,
      content: string,
    ): Promise<{ msgID?: number; uuid?: string; attachmentUuid: unknown }> {
      const presign = await endpoints.sendTo(
        'aws-katchup-presigned',
        { body: { extension, fileName, fileSize: String(content.length) } },
        { label: 'presigned:generate', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(presign.status, 'generate-presigned-url succeeds').toBeLessThan(300);
      // Either a bare link or a { presignedURL, status } JSON envelope; accept both.
      const raw = presign.bodyText.trim();
      const url = raw.startsWith('{')
        ? String((JSON.parse(raw) as { presignedURL?: string }).presignedURL ?? '')
        : raw.replace(/^"|"$/g, '');
      const uuid = url.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
      )?.[1];
      expect(uuid, 'the presigned URL names a uuid').toBeTruthy();

      // A raw S3 PUT, not a registered KPost endpoint — exactly what the live client does with this URL.
      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: content,
      });
      expect(putRes.status, 'the direct S3 upload succeeds').toBeLessThan(300);

      // `attachmentCaption` stays at its default (null): any value 400s, and the server derives the
      // caption details from the uploaded file.
      const sent = await endpoints.sendTo(
        'katchup-send-message',
        { body: sendShape({ uuid: uuid ? [uuid] : [] }) },
        { label: 'presigned:send', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(sent.status, 'the send succeeds').toBeLessThan(300);
      const body = JSON.parse(sent.bodyText || '{}') as {
        data?: Array<{ msgID?: number; attachmentUuid?: unknown }>;
      };
      const row = Array.isArray(body.data) ? body.data[0] : undefined;
      return { msgID: row?.msgID, uuid, attachmentUuid: row?.attachmentUuid };
    }

    async function cleanup(endpoints: EndpointExecutor, msgID: number | undefined): Promise<void> {
      if (!msgID) return;
      await endpoints
        .sendTo(
          'katchup-delete-message',
          { body: { messageIds: [msgID], groupFlag: false } },
          { label: 'presigned:cleanup', auth: { principal: A }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }

    test('a file uploaded via a presigned S3 URL is actually attached to the sent message', async ({
      endpoints,
    }) => {
      const { msgID, attachmentUuid, uuid } = await uploadAndSend(
        endpoints,
        'qa-bench.txt',
        'txt',
        'text/plain',
        'QA bench presigned attachment content',
      );
      try {
        // Unlike the legacy multipart route, this flow does attach the uuid.
        expect(
          attachmentUuid,
          'the message carries the uploaded uuid as its attachmentUuid',
        ).toEqual([uuid]);
      } finally {
        await cleanup(endpoints, msgID);
      }
    });

    test('katchup-download serves the exact uploaded bytes, but with the wrong Content-Type', async ({
      endpoints,
    }) => {
      const content = 'QA bench presigned attachment content';
      const { msgID, uuid } = await uploadAndSend(
        endpoints,
        'qa-bench.txt',
        'txt',
        'text/plain',
        content,
      );
      try {
        const dl = await endpoints.sendTo(
          'katchup-download',
          { pathParams: { uuid: uuid ?? '' } },
          { label: 'presigned:download', auth: { principal: A }, allowLiveRead: true },
        );
        expect(dl.status, 'download succeeds').toBe(200);
        expect(dl.bodyText, 'the exact uploaded bytes are served back').toBe(content);

        // Known defect #617: Content-Type is always image/jpeg. A 2xx finding, so recorded explicitly.
        const contentType = dl.headers?.['content-type'];
        if (contentType !== 'text/plain') {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-download',
            ruleId: 'REGRESSION-katchup-download-wrong-content-type',
            rule: "download's Content-Type header must reflect the real uploaded file's mime type, not a fixed value.",
            expected: 'Content-Type: text/plain (the uploaded file’s real type)',
            actual: `Content-Type: ${String(contentType)}`,
            request: { pathParams: { uuid: uuid ?? '' } },
          });
        }
        expect
          .soft(contentType, "the Content-Type header matches the uploaded file's real type")
          .toBe('text/plain');
      } finally {
        await cleanup(endpoints, msgID);
      }
    });

    test('katchup-download-attachment: the ASCII filename fallback is hardcoded, not the real file name', async ({
      endpoints,
    }) => {
      const { msgID, uuid } = await uploadAndSend(
        endpoints,
        'another-name.pdf',
        'pdf',
        'application/pdf',
        '%PDF-1.4 fake pdf bytes',
      );
      try {
        const dla = await endpoints.sendTo(
          'katchup-download-attachment',
          { pathParams: { uuid: uuid ?? '' } },
          { label: 'presigned:download-attachment', auth: { principal: A }, allowLiveRead: true },
        );
        expect(dla.status, 'downloadAttachment succeeds').toBe(200);
        const body = JSON.parse(dla.bodyText || '{}') as { fileName?: string; url?: string };
        expect(body.fileName, 'the JSON metadata carries the real file name').toBe(
          'another-name.pdf',
        );

        // Known defect #618: the ASCII `filename=` fallback is always "file.xlsx" (`filename*` is
        // correct), so clients that read only `filename` save the wrong name.
        const disposition = decodeURIComponent(body.url ?? '');
        const asciiFilenameHardcoded = disposition.includes('filename="file.xlsx"');
        if (asciiFilenameHardcoded) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-download-attachment',
            ruleId: 'REGRESSION-katchup-download-attachment-hardcoded-filename',
            rule: "the presigned GET URL's Content-Disposition ASCII filename fallback must be the real uploaded file name, not a fixed placeholder.",
            expected: 'response-content-disposition filename="another-name.pdf"',
            actual: 'response-content-disposition filename="file.xlsx" (hardcoded)',
            request: { pathParams: { uuid: uuid ?? '' } },
          });
        }
        expect
          .soft(
            asciiFilenameHardcoded,
            'the ASCII filename fallback is the real file name, not a placeholder',
          )
          .toBe(false);
      } finally {
        await cleanup(endpoints, msgID);
      }
    });

    test('katchup-download-from-s3 resolves the real uploaded file', async ({ endpoints }) => {
      const { msgID, uuid } = await uploadAndSend(
        endpoints,
        'qa-bench.txt',
        'txt',
        'text/plain',
        'QA bench presigned attachment content',
      );
      try {
        const ex = await endpoints.sendTo(
          'katchup-download-from-s3',
          { pathParams: { uuid: uuid ?? '' } },
          { label: 'presigned:download-from-s3', auth: { principal: A }, allowLiveRead: true },
        );
        expect(ex.status, 'downloadFromS3 succeeds').toBe(200);
        const body = JSON.parse(ex.bodyText || '{}') as { data?: string };
        expect(body.data, 'the URL returned names the same uuid we uploaded').toContain(uuid);
      } finally {
        await cleanup(endpoints, msgID);
      }
    });

    test('katchup-download-thumbnail and katchup-media-streaming answer for a real attachment', async ({
      endpoints,
    }) => {
      const { msgID, uuid } = await uploadAndSend(
        endpoints,
        'qa-bench.txt',
        'txt',
        'text/plain',
        'QA bench presigned attachment content',
      );
      try {
        const thumb = await endpoints.sendTo(
          'katchup-download-thumbnail',
          { pathParams: { uuid: uuid ?? '' } },
          { label: 'presigned:download-thumbnail', auth: { principal: A }, allowLiveRead: true },
        );
        expect
          .soft(thumb.status, 'downloadThumbnail does not crash for a real uuid')
          .toBeLessThan(500);

        const streaming = await endpoints.sendTo(
          'katchup-media-streaming',
          { pathParams: { uuid: uuid ?? '' } },
          { label: 'presigned:media-streaming', auth: { principal: A }, allowLiveRead: true },
        );
        // A non-media file may answer 303 (redirect), so only "no 5xx" is asserted.
        expect
          .soft(streaming.status, 'mediaStreaming does not crash for a real uuid')
          .toBeLessThan(500);
      } finally {
        await cleanup(endpoints, msgID);
      }
    });

    test('katchup-generate-thumbnail succeeds for a real attachment uuid', async ({
      endpoints,
    }) => {
      const { msgID, uuid } = await uploadAndSend(
        endpoints,
        'qa-bench.txt',
        'txt',
        'text/plain',
        'QA bench presigned attachment content',
      );
      try {
        const ex = await endpoints.sendTo(
          'katchup-generate-thumbnail',
          { body: { uuid: [uuid] } },
          { label: 'presigned:generate-thumbnail', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(ex.status, 'generateThumbnailUsingUUID succeeds for a real uuid').toBeLessThan(300);
      } finally {
        await cleanup(endpoints, msgID);
      }
    });
  },
);
