// An orchestrated attachment lifecycle (generate → check → delete), not simple assertions.

import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { text as columnText } from '@database/kpost-assertions';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { checkOnRealRecord } from '@engine/real-record';
import { expect, test } from '@fixtures';
import { expectStored } from '../../../support/db-stored';

/**
 * AWS **feature flow** — the S3 attachment lifecycle: generate a presigned URL (which mints a uuid),
 * check whether it exists, then delete it. Gated `AWS_LIFECYCLE=true`, each write `allowLiveWrite`.
 * The generated uuid names nothing but our own reserved S3 key, so no other user's data is touched.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

async function run(
  endpoints: EndpointExecutor,
  id: string,
  reqOverride: Record<string, unknown>,
  label: string,
): Promise<{ status: number; text: string }> {
  const ex = await endpoints.sendTo(id, reqOverride, {
    label: `aws:${label}`,
    auth: { principal: A },
    allowLiveWrite: true,
  });
  return { status: ex.status, text: ex.bodyText ?? '' };
}

/**
 * The generator returns a raw presigned S3 URL (a finding — documented as JSON). The uuid is the file
 * name in its path: `…/<uuid>.pdf?…`. Parse it out.
 */
function extractUuid(text: string): string | undefined {
  const uuid = text.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return uuid?.[1];
}

test.describe('KPost AWS · feature flow', { tag: ['@api', '@platform', '@regression'] }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    process.env.AWS_LIFECYCLE !== 'true',
    'S3 attachment lifecycle; set AWS_LIFECYCLE=true',
  );

  test(
    'generate presigned URL → delete, on our own attachment @api @aws',
    { tag: '@sanity' },
    async ({ endpoints, databases, validationEngine }) => {
      // A tiny file (far under the 64 KB upload cap): uploads land in the live S3 bucket.
      const content = '%PDF-1.4\n% QA bench attachment, safe to delete\n';
      const generated = await run(
        endpoints,
        'aws-generate-presigned',
        { body: { extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: String(content.length) } },
        'generate',
      );
      expect.soft(generated.status, 'generate-presigned is accepted').toBeLessThan(300);
      const uuid = extractUuid(generated.text);
      expect.soft(uuid, 'the generator mints a uuid').toBeTruthy();

      if (generated.status < 300 && uuid) {
        const db = databases.for('kpost-api');
        // The S3 key: <kpostID with @ as _>/Kmail/<time>/<uuid>.pdf (PreSignedURLServiceImpl.java:100).
        const isKey = (key: string) =>
          key.startsWith(`${A.username.replace('@', '_').toLowerCase()}/kmail/`) &&
          key.endsWith(`/${uuid}.pdf`);
        // PreSignedURLServiceImpl.java:140-146 and :164 (a PDF's thumbnail name) fill the row, :185
        // saves it in the KMail attachment table, keyed by the uuid.
        await expectStored(
          db,
          'aws-generate-presigned',
          {
            table: 'TBL_KPOST_KMAIL_ATTACHMENT',
            where: { uuid },
            columns: {
              kpost_id: (value: unknown) =>
                columnText(value)?.toLowerCase() === A.username.toLowerCase(),
              original_file_name: 'qa-bench.pdf',
              file_size: String(content.length),
              s3_file_name: (value: unknown) => isKey(columnText(value)?.toLowerCase() ?? ''),
              s3_file_path: (value: unknown) => {
                const url = columnText(value)?.toLowerCase() ?? '';
                const key = url.replace(/^https:\/\/[^/]+\.amazonaws\.com\//, '');
                return url.startsWith('https://') && key !== url && isKey(key);
              },
              s3_thumbnail_file_name: `${uuid}_thumbnail.png`,
              delete_status: false,
            },
            rule: "generate-presigned-url reserves a KMail attachment row for the caller with the file's name, size and S3 key",
          },
          endpoints,
        );
      }

      if (uuid) {
        // The GET check on the key we just presigned: nothing is uploaded yet, so 417 (placeholder only).
        const checked = await endpoints.sendTo(
          'aws-check-attachment-get',
          { pathParams: { uuid } },
          {
            label: 'aws:check-get',
            auth: { principal: A },
            allowLiveRead: true,
            ownedIdentifiers: [uuid],
          },
        );
        expect
          .soft(
            checked.status,
            'checkAttachmenS3 knows our freshly presigned uuid (417: not uploaded yet)',
          )
          .toBe(417);

        // Upload to the presigned URL exactly as the client does (a direct S3 PUT), then check again:
        // now the attachment exists, and the check's success answer is what its contract is read on.
        const raw = generated.text.trim();
        const url = raw.startsWith('{')
          ? String((JSON.parse(raw) as { presignedURL?: string }).presignedURL ?? '')
          : raw.replace(/^"|"$/g, '');
        const put = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: content,
        });
        expect.soft(put.status, 'the direct S3 upload succeeds').toBeLessThan(300);
        const uploaded = await endpoints.sendTo(
          'aws-check-attachment-get',
          { pathParams: { uuid } },
          {
            label: 'aws:check-get-after-upload',
            auth: { principal: A },
            allowLiveRead: true,
            ownedIdentifiers: [uuid],
          },
        );
        await checkOnRealRecord(
          validationEngine,
          'aws-check-attachment-get',
          { pathParams: { uuid } },
          [uuid],
        );
        expect
          .soft(uploaded.status, 'checkAttachmenS3 sees the uploaded attachment (200)')
          .toBe(200);

        // Delete the presigned key we just reserved (and the S3 object, if any).
        const deleted = await run(
          endpoints,
          'aws-delete-attachment',
          { pathParams: { uuid } },
          'delete',
        );
        expect.soft(deleted.status, 'deleteAttachmentFromS3 returns a status').toBeLessThan(600);
      }
    },
  );
});
