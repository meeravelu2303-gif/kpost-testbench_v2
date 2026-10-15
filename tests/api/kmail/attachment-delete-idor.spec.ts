import { AUTH_PROFILES } from '@config/auth-profile';
import type { AuthMode } from '@engine/endpoint-executor';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { expect, test } from '@fixtures';

/**
 * Attachment DELETE IDOR — can an unrelated account delete another pair's attachment from S3 by UUID?
 *
 * The companion `attachment-idor.spec.ts` covers the READ side (download/thumbnail/stream by uuid) and
 * deliberately leaves the delete path out. `GET /v2/aws/deleteAttachmentFromS3/{uuid}` is the
 * destructive counterpart: `PreSignedURLServiceImpl.deleteAttachmentFromS3(uuid, kpostID, bucket)`
 * resolves the S3 path with `kmailAttachmentRepo.getAttachmentPath(uuid, kpostID)` (and the katchup
 * repo) — keyed by BOTH the uuid AND the caller's kpostID — so a stranger's uuid should resolve to
 * null ("Invalid_uuid") and nothing should be deleted. This proves that holds on the live server: if
 * the read side was the standing finding, the delete being wrong would be worse (anyone could wipe
 * anyone's attachments by walking uuids). A owns the file; C is unrelated and must not be able to
 * delete it.
 *
 * Safe to run: a harmless bench JPEG, uploaded by A, referenced in an A→B mail between bench accounts;
 * C is a bench account. A deletes its own attachment and mail in `finally`.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // owner
const B = K.principals.find((p) => p.key === 'victim')!; // recipient
const C = K.principals.find((p) => p.key === 'personal-3')!; // attacker — no relationship to this mail

test.describe(
  'KMail · attachment DELETE IDOR (deleteAttachmentFromS3) @api @kmail-api @kmail @security',
  {
    tag: ['@api', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      process.env.KMAIL_LIFECYCLE !== 'true' || process.env.AWS_LIFECYCLE !== 'true',
      'uploads a real file to S3 and sends a real mail; set KMAIL_LIFECYCLE=true and AWS_LIFECYCLE=true',
    );

    test("an unrelated account cannot delete another pair's KMail attachment by UUID", async ({
      endpoints,
    }) => {
      const content = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
        'base64',
      );
      let transactionIDs: number[] = [];
      let uuid: string | undefined;

      try {
        // --- A uploads a real file and attaches it to a mail to B ------------------------------
        const presign = await endpoints.sendTo(
          'aws-generate-presigned',
          {
            body: {
              extension: 'jpg',
              fileName: `qa-del-idor-${Date.now()}.jpg`,
              fileSize: String(content.length),
            },
          },
          { label: 'del-idor:presign', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(presign.status, 'generate-presigned-url succeeds').toBeLessThan(300);
        const raw = presign.bodyText.trim();
        const url = raw.startsWith('{')
          ? String((JSON.parse(raw) as { presignedURL?: string }).presignedURL ?? '')
          : raw.replace(/^"|"$/g, '');
        uuid = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
        expect(uuid, 'the presigned URL names a uuid').toBeTruthy();
        if (!uuid) return;
        const fileUuid: string = uuid;

        const putRes = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: content,
        });
        expect(putRes.status, 'the direct S3 upload succeeds').toBeLessThan(300);

        const sent = await endpoints.sendTo(
          'kmail-post-mail',
          {
            body: mailShape({
              toAddress: B.username,
              kmailSubject: `QA attach-delete IDOR ${Date.now()}`,
              attachmentFlag: 1,
              attachmentUuid: [uuid],
            }),
          },
          { label: 'del-idor:send', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(sent.status, 'the mail with its attachment is sent').toBeLessThan(300);
        const sentJson = sent.json();
        const sentBody = (sentJson.ok ? sentJson.value : {}) as Record<string, unknown>;
        const row = Array.isArray(sentBody.data)
          ? (sentBody.data[0] as Record<string, unknown>)
          : (sentBody.data as Record<string, unknown> | undefined);
        const txns = row?.kmailTransactionList;
        transactionIDs = Array.isArray(txns)
          ? (txns as Array<Record<string, unknown>>)
              .map((t) => t.transactionID)
              .filter((v): v is number => typeof v === 'number')
          : [];

        const downloadAs = (auth: AuthMode, label: string) =>
          endpoints.sendTo(
            'kmail-download-attachment',
            { pathParams: { uuid: fileUuid } },
            { label, auth, allowLiveRead: true },
          );

        // --- Control: the file exists and the owner can download it before the attack ----------
        const before = await downloadAs({ principal: A }, 'del-idor:owner-before');
        expect(
          before.status,
          'control: the owner can download the attachment before the attack',
        ).toBe(200);

        // --- Attack: C (unrelated) calls the delete-by-uuid endpoint ---------------------------
        const attack = await endpoints.sendTo(
          'aws-delete-attachment',
          { pathParams: { uuid: fileUuid } },
          { label: 'del-idor:attack', auth: { principal: C }, allowLiveWrite: true },
        );

        // --- Verify: the owner can STILL download it (C's delete must not have removed it) -----
        const after = await downloadAs({ principal: A }, 'del-idor:owner-after');
        const deletedByStranger = before.status === 200 && after.status !== 200;

        test.info().annotations.push({
          type: 'observed',
          description: `uuid=${fileUuid} | owner before=${before.status} | C delete=${attack.status} "${attack.bodyText.slice(0, 120)}" | owner after=${after.status}`,
        });

        if (deletedByStranger) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'aws-delete-attachment',
            ruleId: 'IDOR-aws-delete-attachment-by-uuid',
            rule: "An attachment may only be deleted by the mail's owner — an unrelated account must not delete it by uuid.",
            expected:
              "the stranger's delete changes nothing; the owner can still download the file",
            actual: `after C (${C.username}) called deleteAttachmentFromS3 for uuid ${fileUuid}, the owner's download fell from 200 to ${after.status} — C deleted A's attachment`,
            request: { pathParams: { uuid: fileUuid } },
          });
        }

        expect
          .soft(
            deletedByStranger,
            `BOLA: an outsider must not delete another pair's attachment (C delete=${attack.status}, owner before=${before.status}, after=${after.status})`,
          )
          .toBe(false);
      } finally {
        // A removes its own attachment and the mail.
        if (uuid) {
          await endpoints
            .sendTo(
              'aws-delete-attachment',
              { pathParams: { uuid } },
              { label: 'del-idor:cleanup-file', auth: { principal: A }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        }
        if (transactionIDs.length) {
          await endpoints
            .sendTo(
              'kmail-delete',
              { body: { groupFlag: false, transactionIDs } },
              { label: 'del-idor:cleanup-mail', auth: { principal: A }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        }
      }
    });
  },
);
