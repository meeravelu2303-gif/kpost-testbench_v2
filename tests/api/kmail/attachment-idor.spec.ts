import { AUTH_PROFILES } from '@config/auth-profile';
import type { AuthMode } from '@engine/endpoint-executor';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { expect, test } from '@fixtures';

/**
 * KMail attachment IDOR: A mails B a real uploaded image; C (unrelated) and an anonymous caller try
 * to download, stream and thumbnail it by UUID alone. All accounts are ours; the mail is deleted
 * (the S3 object is not).
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // sender/owner
const B = K.principals.find((p) => p.key === 'victim')!; // legitimate recipient
const C = K.principals.find((p) => p.key === 'personal-3')!; // attacker — no relationship to this mail

test.describe(
  'KMail · attachment IDOR proof (plan item 0a) @api @kmail-api @kmail @security',
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

    test("an unrelated account can fetch another pair's KMail attachment by UUID alone", async ({
      endpoints,
    }) => {
      // A tiny real JPEG, so a thumbnail can exist.
      const content = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
        'base64',
      );
      let transactionIDs: number[] = [];

      try {
        // --- A uploads a real file to S3 and sends it to B -------------------------------------
        const presign = await endpoints.sendTo(
          'aws-generate-presigned',
          {
            body: {
              extension: 'jpg',
              fileName: `qa-idor-${Date.now()}.jpg`,
              fileSize: String(content.length),
            },
          },
          { label: 'idor:presign', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(presign.status, 'generate-presigned-url succeeds').toBeLessThan(300);
        // The answer is a JSON envelope or a bare link; accept both.
        const raw = presign.bodyText.trim();
        const url = raw.startsWith('{')
          ? String((JSON.parse(raw) as { presignedURL?: string }).presignedURL ?? '')
          : raw.replace(/^"|"$/g, '');
        const uuid = url.match(
          /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        )?.[1];
        expect(uuid, 'the presigned URL names a uuid').toBeTruthy();
        if (!uuid) return;

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
              kmailSubject: `QA IDOR proof ${Date.now()}`,
              attachmentFlag: 1,
              attachmentUuid: [uuid],
            }),
          },
          { label: 'idor:send', auth: { principal: A }, allowLiveWrite: true },
        );
        expect(sent.status, 'the mail with its attachment is sent').toBeLessThan(300);
        const sentJson = sent.json();
        const sentBody = (sentJson.ok ? sentJson.value : {}) as Record<string, unknown>;
        const row = Array.isArray(sentBody.data)
          ? (sentBody.data[0] as Record<string, unknown>)
          : sentBody.data;
        const txns = (row as Record<string, unknown> | undefined)?.kmailTransactionList;
        transactionIDs = Array.isArray(txns)
          ? (txns as Array<Record<string, unknown>>)
              .map((t) => t.transactionID)
              .filter((v): v is number => typeof v === 'number')
          : [];

        // --- Controls: the sender and the receiver CAN fetch it with their own login. Without these a
        // refusal below could just mean the file or its thumbnail does not exist yet.
        const fetchAs = (id: string, label: string, auth: AuthMode) =>
          endpoints.sendTo(id, { pathParams: { uuid } }, { label, auth, allowLiveRead: true });
        const ownerDownload = await fetchAs('kmail-download-attachment', 'idor:owner-download', {
          principal: A,
        });
        const receiverDownload = await fetchAs(
          'kmail-download-attachment',
          'idor:receiver-download',
          { principal: B },
        );
        const ownerThumb = await fetchAs('kmail-download-thumbnail', 'idor:owner-thumbnail', {
          principal: A,
        });
        const anonDownload = await fetchAs('kmail-download-attachment', 'idor:anonymous-download', {
          header: undefined,
        });
        const anonStream = await fetchAs('kmail-media-streaming', 'idor:anonymous-stream', {
          header: undefined,
        });

        // --- C, who never sent or received this mail, fetches the attachment by UUID alone -----
        const download = await endpoints.sendTo(
          'kmail-download-attachment',
          { pathParams: { uuid } },
          { label: 'idor:attacker-download', auth: { principal: C }, allowLiveRead: true },
        );
        const stream = await endpoints.sendTo(
          'kmail-media-streaming',
          { pathParams: { uuid } },
          { label: 'idor:attacker-stream', auth: { principal: C }, allowLiveRead: true },
        );
        // The thumbnail route needs no login per source, so it is tried with no principal at all.
        const thumbnail = await endpoints.sendTo(
          'kmail-download-thumbnail',
          { pathParams: { uuid } },
          { label: 'idor:anonymous-thumbnail', auth: { header: undefined }, allowLiveRead: true },
        );

        const observed =
          `uuid=${uuid} | owner download=${ownerDownload.status} receiver download=${receiverDownload.status} ` +
          `owner thumbnail=${ownerThumb.status} (${ownerThumb.bodyText.length} bytes) | outsider download=${download.status} ` +
          `outsider stream=${stream.status} | NO-LOGIN thumbnail=${thumbnail.status} (${thumbnail.bodyText.length} bytes) ` +
          `no-login download=${anonDownload.status} no-login stream=${anonStream.status}`;
        test.info().annotations.push({ type: 'observed', description: observed });
        console.log(`KMAIL-ATT-IDOR ${observed}`);
        expect(ownerDownload.status, 'control: the sender can download their own attachment').toBe(
          200,
        );

        if (download.status < 300 || stream.status < 300 || thumbnail.status < 300) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kmail-download-attachment',
            ruleId: 'IDOR-kmail-attachment-by-uuid',
            rule:
              "A KMail attachment must only be fetchable by the mail's sender or receiver — an " +
              'unrelated account (or an anonymous caller, for the thumbnail) must not be able to ' +
              'download it by UUID alone.',
            expected: 'download/stream/thumbnail all refused to an unrelated or anonymous caller',
            actual:
              `download=${download.status} stream=${stream.status} thumbnail=${thumbnail.status} ` +
              `— at least one succeeded for uuid ${uuid}, which ${A.username} uploaded for a mail to ` +
              `${B.username} that ${C.username} (attacker) and an anonymous caller (thumbnail) have ` +
              'no relationship to',
            request: { body: { uuid } },
          });
        }

        expect
          .soft(
            download.status,
            `IDOR 0a: an unrelated account must not download another pair's attachment (uuid ${uuid})`,
          )
          .toBeGreaterThanOrEqual(400);
        expect
          .soft(
            stream.status,
            `IDOR 0a: an unrelated account must not stream another pair's attachment (uuid ${uuid})`,
          )
          .toBeGreaterThanOrEqual(400);
        expect
          .soft(
            thumbnail.status,
            `IDOR 0a: an anonymous caller must not fetch another pair's attachment thumbnail (uuid ${uuid})`,
          )
          .toBeGreaterThanOrEqual(400);
        expect
          .soft(
            anonDownload.status,
            `no login: the attachment download must be refused (uuid ${uuid})`,
          )
          .toBeGreaterThanOrEqual(400);
        expect
          .soft(anonStream.status, `no login: the attachment stream must be refused (uuid ${uuid})`)
          .toBeGreaterThanOrEqual(400);
      } finally {
        if (transactionIDs.length) {
          await endpoints
            .sendTo(
              'kmail-delete',
              { body: { groupFlag: false, transactionIDs } },
              { label: 'idor:cleanup', auth: { principal: A }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        }
      }
    });
  },
);
