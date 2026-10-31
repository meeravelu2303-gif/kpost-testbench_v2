import { AUTH_PROFILES } from '@config/auth-profile';
import { isSqlClient } from '@database/database-client';
import { expect, test } from '@fixtures';

/**
 * Katchup uploadMultipartFiles (KatchupServiceImpl.fileUploadMultipartFile): the S3 upload is
 * commented out in the source copy, so it may answer success with a fresh uuid while storing no
 * file. A real upload must be downloadable by its uuid. No client calls it. The attachment row it
 * leaves (no API deletes one) is removed from the QA database afterwards.
 */
const UPLOADER = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-5');
const FILE = Buffer.from('QA bench multipart upload — safe to delete.\n', 'utf8');

test.describe(
  'KPost Katchup · uploadMultipartFiles stores what it accepts',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.GLOBAL_LIFECYCLE !== 'true' ||
        process.env.TEST_DB_MODE !== 'true' ||
        process.env.DB_ALLOW_WRITES !== 'true',
      'uploads to the QA server and deletes the row after; set GLOBAL_LIFECYCLE, TEST_DB_MODE and DB_ALLOW_WRITES',
    );
    test.skip(!UPLOADER, 'needs the 5th QA account');

    test('an accepted upload can be downloaded by its uuid', async ({ endpoints, databases }) => {
      const db = databases.for('kpost-api');
      test.skip(!isSqlClient(db), 'needs the KPOST_QA database to remove the attachment row');
      if (!isSqlClient(db)) return;
      let uuid: string | undefined;
      try {
        const upload = await endpoints.sendTo(
          'katchup-upload-multipart-files',
          {
            multipart: {
              files: { name: 'qa-bench.txt', mimeType: 'text/plain', buffer: FILE },
            },
          },
          {
            label: 'multipart:upload',
            auth: { principal: UPLOADER! },
            allowGlobalLifecycle: true,
          },
        );
        expect(upload.status, 'the upload is accepted').toBe(200);
        uuid = (JSON.parse(upload.bodyText || '{}') as { uuid?: string }).uuid;
        expect(uuid, 'and names the stored file by a uuid').toBeTruthy();

        const [row] = await db.query<{ name: string | null; size: number | null }>(
          'SELECT original_file_name name, file_size size FROM TBL_KPOST_KATCHUP_ATTACHMENT WHERE uuid = ?',
          [uuid],
        );
        expect.soft(row?.name, 'the attachment row records the file name').toBe('qa-bench.txt');
        expect.soft(Number(row?.size ?? 0), 'and its size').toBe(FILE.length);

        const download = await endpoints.sendTo(
          'katchup-download-attachment',
          { pathParams: { uuid: uuid! } },
          {
            label: 'multipart:download',
            auth: { principal: UPLOADER! },
            allowLiveRead: true,
            ownedIdentifiers: [uuid!],
          },
        );
        if (download.status !== 200) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-upload-multipart-files',
            ruleId: 'STORAGE-multipart-upload-stores-nothing',
            rule: 'uploadMultipartFiles must store the file it accepts: a 200 with a uuid must lead to a downloadable file with its name and size recorded.',
            expected: 'the uuid downloads the uploaded file (200)',
            actual: `upload 200 with uuid ${uuid}; attachment row name=${String(row?.name)} size=${String(row?.size)}; download ${download.status}`,
            request: {},
          });
        }
        expect.soft(download.status, 'the accepted file can be downloaded by its uuid').toBe(200);
        expect
          .soft(download.bodyText ?? '', 'and the download is the uploaded content')
          .toContain('QA bench multipart upload');
      } finally {
        if (uuid) {
          await db.query('DELETE FROM TBL_KPOST_KATCHUP_ATTACHMENT WHERE uuid = ?', [uuid]);
        }
      }
    });
  },
);
