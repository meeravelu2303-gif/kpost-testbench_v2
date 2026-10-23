import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { FILES, uniqueName } from '@fixtures/files';
import { expect, test } from '@fixtures';
import { deleteUploaded, uploadFile } from '../../support/attachments';

/**
 * Katchup **attachment byte integrity** (RTM-CON04): the file the RECIPIENT downloads must be the
 * exact bytes the sender uploaded — same length, same SHA-256.
 *
 * Why a binary, non-image file: the UI integrity check (`katchup-content-correctness`) can only prove
 * an image comes back as a valid JPEG, because the app re-encodes images. A PDF-typed payload is
 * stored as-is, and filling it with every byte value 0x00–0xFF means any text decode, charset
 * conversion or truncation on the way through S3 → download changes the digest. The comparison uses
 * the client's `bodyDigest` (taken from the raw buffer before any text decode), not `bodyText`.
 *
 * Flow (the real client flow, see `presigned-attachment-workflow.spec.ts`): A presigns, PUTs the
 * bytes to S3, sends a message to B naming the uuid; B — and A as the control — download it.
 * Self-cleaning: the message is deleted and the S3 object removed in `finally`.
 */
const K = AUTH_PROFILES.kpost;
const principal = (key: string): Principal => {
  const found = K.principals.find((p) => p.key === key);
  if (!found) throw new Error(`principal "${key}" is not configured`);
  return found;
};
const A = principal('personal'); // sender
const B = principal('victim'); // recipient (sendShape's default receiver)

test.describe(
  'KPost Katchup · attachment byte integrity',
  {
    tag: ['@api', '@katchup', '@regression'],
    annotation: [{ type: 'requirement', description: 'RTM-CON04' }],
  },
  () => {
    // Each file read takes ~12 s on the test server (#1364); several in a row outlast the 60 s default.
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true' || process.env.AWS_LIFECYCLE !== 'true',
      'uploads a real file to S3 and sends a real message; set KATCHUP_LIFECYCLE=true and AWS_LIFECYCLE=true',
    );

    test('the recipient downloads exactly the bytes the sender uploaded (length + SHA-256)', async ({
      endpoints,
    }) => {
      let uuid: string | undefined;
      let msgID: number | undefined;
      try {
        const up = await uploadFile(endpoints, A, FILES.integrity, {
          route: 'katchup',
          name: uniqueName(FILES.integrity, 'integrity'),
          label: 'integrity:presign',
        });
        uuid = up.uuid;
        const content = up.bytes;
        const expected = up.sha256;

        const sent = await endpoints.sendTo(
          'katchup-send-message',
          { body: sendShape({ subject: `QA integrity ${Date.now()}`, uuid: [uuid] }) },
          { label: 'integrity:send', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(sent.status, 'the message with the attachment is sent').toBeLessThan(300);
        const row = (JSON.parse(sent.bodyText || '{}') as { data?: Array<{ msgID?: number }> })
          .data?.[0];
        msgID = row?.msgID;

        for (const [who, as] of [
          ['the sender (control)', A],
          ['the recipient', B],
        ] as const) {
          const dl = await endpoints.sendTo(
            'katchup-download',
            { pathParams: { uuid } },
            {
              label: `integrity:download:${as.key}`,
              auth: { principal: as },
              allowLiveRead: true,
              // Integrity, not speed: the download is measured (below), not failed on the 10 s default.
              timeoutMs: 60_000,
            },
          );
          const observed = `${who}: HTTP ${dl.status} in ${dl.durationMs} ms, ${dl.bodyDigest?.bytes} bytes, sha256 ${dl.bodyDigest?.sha256} (uploaded ${content.length} bytes, sha256 ${expected})`;
          test.info().annotations.push({ type: 'observed', description: observed });
          console.log(`INTEGRITY ${observed}`);
          expect(dl.status, `${who} can download the attachment`).toBe(200);
          expect(dl.bodyDigest?.bytes, `${who} gets the same number of bytes`).toBe(content.length);
          expect(dl.bodyDigest?.sha256, `${who} gets byte-identical content (SHA-256)`).toBe(
            expected,
          );
        }
      } finally {
        if (msgID)
          await endpoints
            .sendTo(
              'katchup-delete-message',
              { body: { messageIds: [msgID], groupFlag: false } },
              { label: 'integrity:cleanup-message', auth: { principal: A }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        await deleteUploaded(endpoints, A, uuid, 'integrity:cleanup-file');
      }
    });
  },
);
