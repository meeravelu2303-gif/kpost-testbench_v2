import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { FILES, uniqueName } from '@fixtures/files';
import { expect, test } from '@fixtures';
import { deleteUploaded, uploadFile } from '../../support/attachments';

/**
 * KMail attachment integrity: the recipient downloads exactly the bytes the sender uploaded (length
 * and SHA-256). The file holds every byte value 0x00–0xFF, so any decode or truncation changes the
 * digest. The mail and the S3 object are deleted afterwards.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // sender
const B = K.principals.find((p) => p.key === 'victim')!; // recipient

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
    // Each file read is slow on the test server (#1364); several in a row outlast the default timeout.
    test.describe.configure({ timeout: 180_000 });
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      process.env.KMAIL_LIFECYCLE !== 'true' || process.env.AWS_LIFECYCLE !== 'true',
      'uploads a real file to S3 and sends a real mail; set KMAIL_LIFECYCLE=true and AWS_LIFECYCLE=true',
    );

    test('the recipient downloads exactly the bytes the sender attached (length + SHA-256)', async ({
      endpoints,
    }) => {
      let uuid: string | undefined;
      let kmailID: number | undefined;
      try {
        const up = await uploadFile(endpoints, A, FILES.integrity, {
          route: 'kmail',
          name: uniqueName(FILES.integrity, 'integrity'),
          label: 'integrity:presign',
        });
        uuid = up.uuid;
        const content = up.bytes;
        const expected = up.sha256;

        const sent = await endpoints.sendTo(
          'kmail-post-mail',
          {
            body: mailShape({
              toAddress: B.username,
              kmailSubject: `QA KMail integrity ${Date.now()}`,
              attachmentFlag: 1,
              attachmentUuid: [uuid],
              attachmentCaption: JSON.stringify([{ fileName: up.fileName, caption: '' }]),
            }),
          },
          // A mail with an attachment can take longer than the 10 s default to answer.
          {
            label: 'integrity:send',
            auth: { principal: A },
            allowLiveWrite: true,
            timeoutMs: 60_000,
          },
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
        await deleteUploaded(endpoints, A, uuid, 'integrity:cleanup-file');
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
