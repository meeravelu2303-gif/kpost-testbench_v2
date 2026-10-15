import { createHash } from 'node:crypto';
import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { expect, test } from '@fixtures';

/**
 * KMail **attachment byte integrity** (RTM-CON04, RTM-KMAIL-F02 download half): the file the
 * RECIPIENT downloads from a received mail must be the exact bytes the sender uploaded — same length,
 * same SHA-256.
 *
 * A PDF-typed payload carrying every byte value 0x00–0xFF is used, so any text decode, charset
 * conversion or truncation between S3 and `kmail-download-attachment` changes the digest. The
 * comparison uses the client's `bodyDigest` (raw buffer, before any text decode). The upload goes
 * through the API, as in `attachment-idor.spec.ts`, because the browser upload is broken (#1347).
 *
 * Self-cleaning: the mail (every transaction) and the S3 object are deleted in `finally`.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // sender
const B = K.principals.find((p) => p.key === 'victim')!; // recipient

function binaryPayload(): Buffer {
  const every = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n%QA integrity\n', 'latin1'),
    ...Array.from({ length: 8 }, () => every),
    Buffer.from('\n%%EOF\n', 'latin1'),
  ]);
}

test.describe(
  'KMail · attachment byte integrity',
  {
    tag: ['@api', '@kmail', '@regression'],
    annotation: [
      { type: 'requirement', description: 'RTM-CON04' },
      { type: 'requirement-partial', description: 'RTM-KMAIL-F02' },
    ],
  },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      process.env.KMAIL_LIFECYCLE !== 'true' || process.env.AWS_LIFECYCLE !== 'true',
      'uploads a real file to S3 and sends a real mail; set KMAIL_LIFECYCLE=true and AWS_LIFECYCLE=true',
    );

    test('the recipient downloads exactly the bytes the sender attached (length + SHA-256)', async ({
      endpoints,
    }) => {
      const content = binaryPayload();
      const expected = createHash('sha256').update(content).digest('hex');
      const fileName = `qa-integrity-${Date.now()}.pdf`;
      let uuid: string | undefined;
      let kmailID: number | undefined;
      try {
        const presign = await endpoints.sendTo(
          'aws-generate-presigned',
          { body: { extension: 'pdf', fileName, fileSize: String(content.length) } },
          { label: 'integrity:presign', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(presign.status, 'generate-presigned-url succeeds').toBeLessThan(300);
        const raw = presign.bodyText.trim();
        const url = raw.startsWith('{')
          ? String((JSON.parse(raw) as { presignedURL?: string }).presignedURL ?? '')
          : raw.replace(/^"|"$/g, '');
        uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(url)?.[1];
        expect(uuid, 'the presigned URL names a uuid').toBeTruthy();
        if (!uuid) return;

        const put = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: new Uint8Array(content),
        });
        expect(put.status, 'the direct S3 upload succeeds').toBeLessThan(300);

        const sent = await endpoints.sendTo(
          'kmail-post-mail',
          {
            body: mailShape({
              toAddress: B.username,
              kmailSubject: `QA KMail integrity ${Date.now()}`,
              attachmentFlag: 1,
              attachmentUuid: [uuid],
              attachmentCaption: JSON.stringify([{ fileName, caption: '' }]),
            }),
          },
          { label: 'integrity:send', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(sent.status, `the mail with the attachment is sent: ${sent.bodyText}`).toBe(200);
        const parsed = sent.json();
        const body = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
        const row = (Array.isArray(body.data) ? body.data[0] : body.data) as
          Record<string, unknown> | undefined;
        kmailID = typeof row?.kmailID === 'number' ? row.kmailID : undefined;

        for (const [who, as] of [
          ['the sender (control)', A],
          ['the recipient', B],
        ] as const) {
          const dl = await endpoints.sendTo(
            'kmail-download-attachment',
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
        if (uuid)
          await endpoints
            .sendTo(
              'aws-delete-attachment',
              { pathParams: { uuid } },
              { label: 'integrity:cleanup-file', auth: { principal: A }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        // postMail's reply carries no transaction list, so each side's transaction ids are read from
        // that side's own conversation view, and each side deletes its own copy.
        if (kmailID)
          for (const [as, other] of [
            [A, B.username],
            [B, A.username],
          ] as const) {
            const view = await endpoints
              .sendTo(
                'kmail-selected-contact-mails',
                {
                  body: {
                    selectedContact: other,
                    fetchMailType: 'A',
                    groupFlag: false,
                    lastKmailID: null,
                    firstKmailID: null,
                    count: 30,
                  },
                },
                {
                  label: `integrity:cleanup-view:${as.key}`,
                  auth: { principal: as },
                  allowLiveRead: true,
                },
              )
              .catch(() => undefined);
            const viewJson = view?.json();
            const mails = ((viewJson?.ok ? (viewJson.value as { data?: unknown }).data : []) ??
              []) as Array<{
              kmailID?: number;
              kmailTransactionList?: Array<{ transactionID?: number }>;
            }>;
            const transactionIDs = (
              mails.find((m) => m.kmailID === kmailID)?.kmailTransactionList ?? []
            )
              .map((t) => t.transactionID)
              .filter((v): v is number => typeof v === 'number');
            console.log(
              `INTEGRITY cleanup ${as.key}: deleting ${transactionIDs.length} transaction(s)`,
            );
            if (transactionIDs.length)
              await endpoints
                .sendTo(
                  'kmail-delete',
                  { body: { groupFlag: false, transactionIDs } },
                  {
                    label: `integrity:cleanup-mail:${as.key}`,
                    auth: { principal: as },
                    allowLiveWrite: true,
                  },
                )
                .catch(() => undefined);
          }
      }
    });
  },
);
