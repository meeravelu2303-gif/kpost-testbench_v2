import { randomUUID } from 'node:crypto';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { KATCHUP_MESSAGE_TYPE } from '@api/contract/kpost-types';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { isSqlClient } from '@database/database-client';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { FILES, uniqueName } from '@fixtures/files';
import { expect, test } from '@fixtures';
import { deleteUploaded, uploadFile, type Uploaded } from '../../../support/attachments';
import { retryOrSkip } from '../../../support/live-condition';

/**
 * Katchup cross-user authorization for the message/attachment endpoints the other security specs do
 * not reach. A sends B a real 1:1 message; C, a QA account with no part in it, names its msgID,
 * sharedMessageId or attachment uuid. Every probe keeps an owner control (A's or B's identical call
 * works), and judges by what C got back (bytes, text, a recipient list) or by a read-back, never by
 * status alone. Everything made here is removed in `finally`.
 *
 * Not probed here (by design, see the backend): saveKatchupMessages and getKatchupMessagesSubject are
 * scoped to the caller's own conversation by the JWT; forwardMessageBacktrackByMsgID and
 * patchWorkForGroup are info@kpost.in-only maintenance routes (no owner control is possible);
 * /v2/voice/translate is a paid OpenAI call per request (sideEffect 'external', always blocked).
 */
const principal = (key: string): Principal | undefined =>
  AUTH_PROFILES.kpost.principals.find((p) => p.key === key);
const A = principal('personal'); // sender, owns the message and the attachment
const B = principal('victim'); // the legitimate recipient
const C = principal('personal-3'); // the outsider: never sent or received any of it
const R = principal('personal-4'); // a QA account C forwards to / A copies in

type Row = Record<string, unknown>;

function rowsOf(exchange: ApiResponseWrapper): Row[] {
  const parsed = exchange.json();
  const data = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
  return (Array.isArray(data) ? data : data ? [data] : []) as Row[];
}

const msgIDsOf = (rows: Row[]): number[] =>
  rows.map((r) => Number(r.msgID)).filter((id) => Number.isFinite(id) && id > 0);

/** The served body is exactly the uploaded file. */
const sameBytes = (exchange: ApiResponseWrapper, up: Uploaded): boolean =>
  exchange.status > 0 &&
  exchange.status < 300 &&
  (exchange.bodyDigest?.sha256 === up.sha256 || exchange.bodyText === up.bytes.toString('utf8'));

async function deleteMessages(
  endpoints: EndpointExecutor,
  as: Principal,
  msgIDs: readonly number[],
  label: string,
): Promise<void> {
  for (const msgID of msgIDs)
    await endpoints
      .sendTo(
        'katchup-delete-message',
        { body: { messageIds: [msgID], groupFlag: false } },
        { label, auth: { principal: as }, allowLiveWrite: true, ownedIdentifiers: [msgID] },
      )
      .catch(() => undefined);
}

/** A uploads a small text file (live S3, under the 64 KB cap) and sends it to B. */
async function sendAttachment(
  endpoints: EndpointExecutor,
  tag: string,
): Promise<{ up: Uploaded; msgIDs: number[] }> {
  const up = await uploadFile(endpoints, A!, FILES.txt, {
    route: 'katchup',
    name: uniqueName(FILES.txt, tag),
    label: `xuser-${tag}:presign`,
  });
  const sent = await endpoints.sendTo(
    'katchup-send-message',
    {
      body: sendShape({
        receiver: B!.username,
        subject: 'QA cross-user attachment',
        uuid: [up.uuid],
      }),
    },
    {
      label: `xuser-${tag}:send`,
      auth: { principal: A! },
      allowLiveWrite: true,
      ownedIdentifiers: [up.uuid],
    },
  );
  expect(sent.status, 'A sends B the message carrying the attachment').toBeLessThan(300);
  return { up, msgIDs: msgIDsOf(rowsOf(sent)) };
}

test.describe(
  'KPost Security · Katchup cross-user authorization @api @kpost-api @security @katchup',
  {
    tag: ['@api', '@katchup', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    // Each file read takes ~12 s on the test server (#1364); a test makes several.
    test.describe.configure({ mode: 'default', timeout: 180_000 });
    test.skip(
      !A || !B || !C || !R,
      'needs the personal, victim, personal-3 and personal-4 principals',
    );
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true',
      'sends real messages; set KATCHUP_LIFECYCLE=true',
    );

    test("an outsider cannot download another pair's attachment through oldDownload @api @kpost-api @security", async ({
      endpoints,
    }) => {
      test.skip(process.env.AWS_LIFECYCLE !== 'true', 'uploads to S3; set AWS_LIFECYCLE=true');
      let up: Uploaded | undefined;
      let msgIDs: number[] = [];
      try {
        ({ up, msgIDs } = await sendAttachment(endpoints, 'olddl'));
        const download = (who: Principal, label: string) =>
          endpoints.sendTo(
            'katchup-old-download',
            { pathParams: { uuid: up!.uuid } },
            {
              label,
              auth: { principal: who },
              allowLiveRead: true,
              ownedIdentifiers: [up!.uuid],
              timeoutMs: 60_000,
            },
          );

        // Owner control: the recipient gets the exact bytes, so a refusal below means something.
        const own = await download(B!, 'xuser-olddl:recipient-control');
        expect(own.status, 'control: the recipient downloads the attachment').toBe(200);
        expect(sameBytes(own, up), 'control: with the exact uploaded bytes').toBe(true);

        const attack = await download(C!, 'xuser-olddl:outsider');
        retryOrSkip(attack.status === 0, 'oldDownload did not answer the outsider (timeout)');
        const leaked = sameBytes(attack, up);
        if (leaked)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-old-download',
            ruleId: 'IDOR-katchup-old-download-by-uuid',
            rule: 'oldDownload must serve an attachment only to the sender, receiver or a group member of a message carrying it; an unrelated account must not get the file by its uuid.',
            expected:
              'HTTP 404 "Attachment not found" for the outsider (the recipient got the file)',
            actual: `HTTP ${attack.status}: ${C!.username} received the exact bytes of ${A!.username}'s attachment to ${B!.username} (uuid ${up.uuid})`,
            request: { pathParams: { uuid: up.uuid } },
            correlationId: attack.correlationId,
          });
        expect
          .soft(
            leaked,
            `IDOR: an outsider must not download another pair's attachment (HTTP ${attack.status})`,
          )
          .toBe(false);
      } finally {
        await deleteMessages(endpoints, A!, msgIDs, 'xuser-olddl:cleanup');
        await deleteUploaded(endpoints, A!, up?.uuid, 'xuser-olddl:cleanup-file');
      }
    });

    test("an outsider cannot forward another pair's attachment to unlock it (forwardKatchupMessage) @api @kpost-api @security", async ({
      endpoints,
    }) => {
      // The older forward route builds the new message from the client's `text` JSON and stores its
      // `uuid` list as the attachment, with no check that the caller may see those files
      // (KatchupControllerV2.java:1328-1390, KpostWelcomeMailAndMessage.java:410-412). Being the
      // sender of a message carrying a uuid is what download access is judged by, so the read-back
      // is C's own download after the forward.
      test.skip(process.env.AWS_LIFECYCLE !== 'true', 'uploads to S3; set AWS_LIFECYCLE=true');
      let up: Uploaded | undefined;
      let msgIDs: number[] = [];
      let forwarded: number[] = [];
      try {
        ({ up, msgIDs } = await sendAttachment(endpoints, 'fwd'));
        const download = (who: Principal, label: string) =>
          endpoints.sendTo(
            'katchup-download',
            { pathParams: { uuid: up!.uuid } },
            {
              label,
              auth: { principal: who },
              allowLiveRead: true,
              ownedIdentifiers: [up!.uuid],
              timeoutMs: 60_000,
            },
          );

        const own = await download(B!, 'xuser-fwd:recipient-control');
        expect(own.status, 'control: the recipient downloads the attachment').toBe(200);
        const before = await download(C!, 'xuser-fwd:outsider-before');
        retryOrSkip(before.status === 0, 'download did not answer the outsider (timeout)');
        // If C can already read it, the forward is not what unlocked it (katchup-attachment-idor
        // owns that finding), so there is nothing to judge here.
        if (sameBytes(before, up)) {
          test.info().annotations.push({
            type: 'not-judged',
            description: 'the outsider could already download the uuid before forwarding it',
          });
          return;
        }

        // The workbook's forward shape, as the multipart `text` part the controller reads.
        const text = {
          receiver: '',
          messageType: KATCHUP_MESSAGE_TYPE.forwardMessageReveal,
          subject: 'QA cross-user forward',
          actualMessage: 'QA bench forward (older path).',
          groupFlag: 'false',
          forwardReceiverList: [R!.username],
          groupForwardList: null,
          groupmemberList: [],
          attachmentCaption: '[]',
          status: '0',
          sessionID: 'qa-bench',
          referenceMessage: null,
          sharedMessageDetails: null,
          sharedType: 0,
          temporaryMsgID: 0,
          uuid: [up.uuid],
        };
        const attackSpec = { multipart: { text: JSON.stringify(text) } };
        const forward = await endpoints.sendTo('katchup-forward-message', attackSpec, {
          label: 'xuser-fwd:outsider-forward',
          auth: { principal: C! },
          allowLiveWrite: true,
          ownedIdentifiers: [up.uuid],
        });
        forwarded = msgIDsOf(rowsOf(forward));

        const after = await download(C!, 'xuser-fwd:outsider-after');
        retryOrSkip(after.status === 0, 'download did not answer the outsider (timeout)');
        const leaked = sameBytes(after, up);
        if (leaked)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-forward-message',
            ruleId: 'IDOR-katchup-forward-foreign-uuid',
            rule: 'forwardKatchupMessage must only attach files the caller may already see; naming another pair’s attachment uuid must not make the caller (or the forward’s recipient) able to download it.',
            expected: `the forward is refused, or ${C!.username} still cannot download the uuid afterwards`,
            actual:
              `forward replied HTTP ${forward.status}; ${C!.username} was refused the file before (HTTP ${before.status}) ` +
              `and downloaded its exact bytes after (HTTP ${after.status}) — ${A!.username}'s attachment to ${B!.username}, uuid ${up.uuid}`,
            request: attackSpec,
            correlationId: forward.correlationId,
          });
        expect
          .soft(
            leaked,
            `IDOR: forwarding a foreign uuid must not unlock another pair's attachment (forward HTTP ${forward.status})`,
          )
          .toBe(false);
      } finally {
        await deleteMessages(endpoints, C!, forwarded, 'xuser-fwd:cleanup-forward');
        await deleteMessages(endpoints, A!, msgIDs, 'xuser-fwd:cleanup');
        await deleteUploaded(endpoints, A!, up?.uuid, 'xuser-fwd:cleanup-file');
      }
    });

    test("an outsider cannot run thumbnail generation on another pair's attachment @api @kpost-api @security", async ({
      endpoints,
    }) => {
      // generateThumbnailUsingUUID never reads the caller (KatchupControllerV2.java:2463-2512). A text
      // file gets no thumbnail, so these calls store nothing; what C gets back is the proof: "success"
      // for a real uuid against 400 for an unknown one tells C the file exists and was processed.
      test.skip(process.env.AWS_LIFECYCLE !== 'true', 'uploads to S3; set AWS_LIFECYCLE=true');
      let up: Uploaded | undefined;
      let msgIDs: number[] = [];
      try {
        ({ up, msgIDs } = await sendAttachment(endpoints, 'thumb'));
        const generate = (who: Principal, uuid: string, label: string) =>
          endpoints.sendTo(
            'katchup-generate-thumbnail',
            { body: { uuid: [uuid] } },
            { label, auth: { principal: who }, allowLiveWrite: true, ownedIdentifiers: [uuid] },
          );

        const own = await generate(A!, up.uuid, 'xuser-thumb:owner-control');
        expect(own.status, 'control: the owner runs it on their own attachment').toBe(200);
        const unknown = await generate(C!, randomUUID(), 'xuser-thumb:outsider-unknown');
        expect(unknown.status, 'control: a never-issued uuid is refused (400)').toBe(400);

        const attack = await generate(C!, up.uuid, 'xuser-thumb:outsider');
        retryOrSkip(attack.status === 0, 'generateThumbnailUsingUUID did not answer (timeout)');
        const accepted = attack.status > 0 && attack.status < 300;
        if (accepted)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-generate-thumbnail',
            ruleId: 'IDOR-katchup-generate-thumbnail-foreign-uuid',
            rule: 'generateThumbnailUsingUUID must act only on attachments the caller may see; for anyone else it must answer as for an unknown uuid, so it neither processes the file nor confirms it exists.',
            expected: `a refusal for ${C!.username}, as for an unknown uuid (HTTP ${unknown.status})`,
            actual: `HTTP ${attack.status} "success" for ${C!.username} on ${A!.username}'s attachment to ${B!.username} (uuid ${up.uuid}); an unknown uuid got HTTP ${unknown.status}`,
            request: { body: { uuid: [up.uuid] } },
            correlationId: attack.correlationId,
          });
        expect
          .soft(
            accepted,
            `IDOR: an outsider must not process another pair's attachment (HTTP ${attack.status})`,
          )
          .toBe(false);
      } finally {
        await deleteMessages(endpoints, A!, msgIDs, 'xuser-thumb:cleanup');
        await deleteUploaded(endpoints, A!, up?.uuid, 'xuser-thumb:cleanup-file');
      }
    });

    test("an outsider cannot read a shared message's recipient lists (getSharedMessageInfo) @api @kpost-api @security", async ({
      endpoints,
    }) => {
      // A copies message (type 14, as the client builds it): B is the TO recipient, R a revealed copy.
      let msgIDs: number[] = [];
      try {
        const sent = await endpoints.sendTo(
          'katchup-send-message',
          {
            body: sendShape({
              receiver: B!.username,
              subject: 'QA cross-user copies',
              messageType: KATCHUP_MESSAGE_TYPE.copiesMessage,
              sharedType: KATCHUP_MESSAGE_TYPE.normalMessage,
              actualMessage: 'QA cross-user copies probe',
              forwardReceiverList: [R!.username, B!.username],
              sharedMessageDetails: JSON.stringify({
                revealContactList: [R!.username],
                hiddenContactList: [],
                receiver: B!.username,
                receiverName: 'QA Bench',
                shareType: KATCHUP_MESSAGE_TYPE.normalMessage,
              }),
            }),
          },
          { label: 'xuser-shared-info:send', auth: { principal: A! }, allowLiveWrite: true },
        );
        const rows = rowsOf(sent);
        msgIDs = msgIDsOf(rows);
        const sharedMessageId = rows.map((r) => Number(r.sharedMessageId)).find((n) => n > 0);
        expect(sent.status, 'the copies message is sent').toBeLessThan(300);
        expect(sharedMessageId, 'the send returns a sharedMessageId').toBeTruthy();

        const info = (who: Principal, label: string) =>
          endpoints.sendTo(
            'katchup-shared-message-info',
            { body: { sharedMessageId } },
            {
              label,
              auth: { principal: who },
              allowLiveRead: true,
              ownedIdentifiers: [sharedMessageId!],
            },
          );
        const names = (ex: ApiResponseWrapper) =>
          [B!.username, R!.username].filter((u) =>
            ex.bodyText.toLowerCase().includes(u.toLowerCase()),
          );

        const own = await info(A!, 'xuser-shared-info:owner-control');
        expect(own.status, 'control: the sender reads their own share info').toBe(200);
        expect(names(own).length, 'control: it lists the recipients').toBeGreaterThan(0);

        const attack = await info(C!, 'xuser-shared-info:outsider');
        retryOrSkip(attack.status === 0, 'getSharedMessageInfo did not answer (timeout)');
        const exposed = attack.status < 300 ? names(attack) : [];
        if (exposed.length)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-shared-message-info',
            ruleId: 'IDOR-katchup-shared-message-info',
            rule: 'getSharedMessageInfo must answer only to a sender or receiver of the shared message; an unrelated account must not learn who it went to.',
            expected:
              'HTTP 404 "Shared message not found" for the outsider (the sender got the lists)',
            actual: `HTTP ${attack.status}: ${C!.username} got ${A!.username}'s recipient list naming ${exposed.join(', ')} (sharedMessageId ${sharedMessageId})`,
            request: { body: { sharedMessageId } },
            correlationId: attack.correlationId,
          });
        expect
          .soft(
            exposed.length > 0,
            `IDOR: an outsider must not read another user's share recipients (HTTP ${attack.status})`,
          )
          .toBe(false);
      } finally {
        await deleteMessages(endpoints, A!, msgIDs, 'xuser-shared-info:cleanup');
      }
    });

    test("an outsider cannot read a shared card's details by msgID (getSharedMessageDetails) @api @kpost-api @security", async ({
      endpoints,
      databases,
    }) => {
      // A shares a contact card with B, shaped as DigitalCard.js sends it (messageType 22).
      const marker = `QA xuser card ${Date.now()}`;
      // The card is A's own details (a QA account): declared ours for the QA-identifier guard.
      const card = JSON.stringify({ kpostID: A!.username, firstName: 'QA', lastName: marker });
      let msgIDs: number[] = [];
      try {
        const sent = await endpoints.sendTo(
          'katchup-send-message',
          {
            body: sendShape({
              receiver: '',
              subject: 'QA cross-user card',
              messageType: KATCHUP_MESSAGE_TYPE.shareDigitalCard,
              actualMessage: '<div>QA cross-user card</div>',
              isHtml: true,
              sharedMessageDetails: null,
              contactDetails: card,
              sharedDetailReceiverList: [B!.username],
            }),
          },
          {
            label: 'xuser-shared-details:send',
            auth: { principal: A! },
            allowLiveWrite: true,
            ownedIdentifiers: [card],
          },
        );
        msgIDs = msgIDsOf(rowsOf(sent));
        expect(sent.status, 'the card share is sent').toBeLessThan(300);
        const msgID = msgIDs[0];
        expect(msgID, 'the send returns a msgID').toBeTruthy();

        const details = (who: Principal, label: string) =>
          endpoints.sendTo(
            'katchup-shared-message-details',
            { pathParams: { msgID: msgID! } },
            { label, auth: { principal: who }, allowLiveRead: true, ownedIdentifiers: [msgID!] },
          );

        const own = await details(B!, 'xuser-shared-details:recipient-control');
        expect(own.status, 'control: the recipient reads the shared card').toBe(200);
        expect(own.bodyText, 'control: with the card that was shared').toContain(marker);

        const attack = await details(C!, 'xuser-shared-details:outsider');
        retryOrSkip(attack.status === 0, 'getSharedMessageDetails did not answer (timeout)');
        const leaked = attack.status < 300 && attack.bodyText.includes(marker);
        if (leaked)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-shared-message-details',
            ruleId: 'IDOR-katchup-shared-message-details',
            rule: "getSharedMessageDetails must answer only to the message's sender, receiver or group member; an unrelated account must not read what was shared.",
            expected: 'HTTP 404 "Message not found" for the outsider (the recipient got the card)',
            actual: `HTTP ${attack.status}: ${C!.username} read the card ${A!.username} shared with ${B!.username} (msgID ${msgID})`,
            request: { pathParams: { msgID: msgID! } },
            correlationId: attack.correlationId,
          });
        expect
          .soft(
            leaked,
            `IDOR: an outsider must not read another pair's shared card (HTTP ${attack.status})`,
          )
          .toBe(false);
      } finally {
        await deleteMessages(endpoints, A!, msgIDs, 'xuser-shared-details:cleanup');
        // The share's own row (TBL_KPOST_SHARED_DETAILS) has no API delete; remove it when allowed.
        const db = databases.for('kpost-api');
        if (msgIDs.length && isSqlClient(db) && db.writable)
          await db
            .query('DELETE FROM TBL_KPOST_SHARED_DETAILS WHERE msg_id IN (?)', [msgIDs])
            .catch(() => undefined);
      }
    });

    test('an outsider cannot report a message they never received (reportAbuse) @api @kpost-api @security', async ({
      endpoints,
      databases,
    }) => {
      // reportAbuse only stores a TBL_KPOST_REPORT_DETAILS row: nothing reads it, mails or texts
      // anyone (KatchupDaoImpl.java:830-846; no client calls the route). The row is the read-back.
      const db = databases.for('kpost-api');
      let msgIDs: number[] = [];
      try {
        const sent = await endpoints.sendTo(
          'katchup-send-message',
          { body: sendShape({ receiver: B!.username, subject: 'QA cross-user report' }) },
          { label: 'xuser-report:send', auth: { principal: A! }, allowLiveWrite: true },
        );
        msgIDs = msgIDsOf(rowsOf(sent));
        const msgID = msgIDs[0];
        expect(msgID, 'A sends B a message').toBeTruthy();

        const report = (who: Principal, label: string) => {
          const spec = {
            body: {
              reportingKpostID: who.username,
              msgID,
              reportID: [1],
              reason: 'QA bench cross-user report',
            },
          };
          return endpoints
            .sendTo('katchup-report-abuse', spec, {
              label,
              auth: { principal: who },
              allowLiveWrite: true,
              ownedIdentifiers: [msgID!],
            })
            .then((ex) => ({ ex, spec }));
        };
        const rowsFor = async (who: Principal) =>
          db.enabled
            ? db.count({
                table: 'TBL_KPOST_REPORT_DETAILS',
                where: { kpost_id: who.username, msg_id: msgID! },
              })
            : undefined;

        const own = await report(B!, 'xuser-report:recipient-control');
        // The app's own body (reportID, katchup_report_message_request_model.dart) is what is sent;
        // since the server reads `reportCode` instead, the recipient's report is refused too, and a
        // stranger's refusal then proves nothing (the drift is katchup-feature's finding).
        test.skip(
          own.ex.status !== 200,
          `control: the recipient's own report was refused (HTTP ${own.ex.status} ${own.ex.bodyText.slice(0, 120)}), so the outsider probe proves nothing`,
        );

        const attack = await report(C!, 'xuser-report:outsider');
        retryOrSkip(attack.ex.status === 0, 'reportAbuse did not answer (timeout)');
        const stored = await rowsFor(C!);
        // With the DB, the row decides; without it, the "Reported Successfully" answer does.
        const accepted =
          stored !== undefined ? stored > 0 : attack.ex.status > 0 && attack.ex.status < 300;
        if (accepted)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'katchup-report-abuse',
            ruleId: 'IDOR-katchup-report-foreign-message',
            rule: 'reportAbuse must accept a report only from a receiver of the message; an unrelated account must not file abuse reports against messages it never received.',
            expected: `a refusal for ${C!.username}, and no report row`,
            actual:
              `HTTP ${attack.ex.status}` +
              (stored !== undefined ? `, ${stored} report row(s) stored` : '') +
              ` for ${C!.username} on msgID ${msgID} (${A!.username} → ${B!.username})`,
            request: attack.spec,
            correlationId: attack.ex.correlationId,
          });
        expect
          .soft(
            accepted,
            `IDOR: an outsider must not report a message they never received (HTTP ${attack.ex.status})`,
          )
          .toBe(false);
      } finally {
        await deleteMessages(endpoints, A!, msgIDs, 'xuser-report:cleanup');
        // Report rows have no API delete; remove ours when the QA DB connection is writable.
        if (msgIDs.length && isSqlClient(db) && db.writable)
          await db
            .query(
              'DELETE FROM TBL_KPOST_REPORT_DETAILS WHERE msg_id IN (?) AND kpost_id IN (?, ?)',
              [msgIDs, B!.username, C!.username],
            )
            .catch(() => undefined);
      }
    });
  },
);
