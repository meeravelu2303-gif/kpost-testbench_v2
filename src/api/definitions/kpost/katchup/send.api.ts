import { KATCHUP_MESSAGE_TYPE, KATCHUP_STATUS } from '@api/schemas/kpost-types';
import { testData } from '@config/test-data.config';
import type { RequestSpec } from '@api/client/request-builder';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup **sends** — the endpoints that create a message. One definition per distinct route;
 * `sendMessage/` is a single endpoint whose `messageType` selects the shape (normal, secret,
 * group…), so those shapes live in `sendShape()` and are driven by the lifecycle spec rather than
 * registered separately (which would collide on the path).
 *
 * Every send is destructive and reaches a real inbox, so **none is `productionSafe`** until the
 * owner signs off (`docs/katchup-flow.md` §6 Q4). Payload mirrors the live web client (flow doc §3).
 */
const SEND_TAGS = ['katchup-send'] as const;

const now = (): number => Date.now();

/**
 * The live client's `sendMessage` object for a 1:1 message to our own second account.
 *
 * Exported so the behaviour spec can build every `messageType` shape from one source rather than
 * hand-copying the 20-field payload per case — which is how a field drifts out of sync.
 */
export function sendShape(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    receiver: testData.victimKpostId,
    messageType: KATCHUP_MESSAGE_TYPE.normalMessage,
    subject: 'QA Bench',
    actualMessage: 'QA bench message — safe to ignore.',
    attachmentCaption: null,
    messageTime: now(),
    serverTime: now(),
    status: KATCHUP_STATUS.sent,
    sessionID: 'Web-Reactjs',
    /*
     * The STRING "false"/"true" (a JSON string spelling of a boolean) — corrected 2026-09-25,
     * developer-flagged that the previous 'N'/'Y' char convention was wrong. Live-verified: neither a
     * real JSON boolean (`true`/`false`) NOR the old `'N'`/`'Y'` chars work — both still 400
     * "Malformed or missing request body" — but the literal string `"false"` sends successfully
     * (confirmed live: real msgID issued, cleaned up). This is not a one-off: `katchup-message-count`
     * (`read.api.ts`) already sends `groupFlag: 'false'` the same way and works, while a real boolean
     * `false` 400s IT too — the backend binds `groupFlag` to a String field on both routes, just
     * spelled as the word "false", not a char code. Bug #594 is resolved by this correction; see
     * `send-regression.spec.ts`.
     */
    groupFlag: 'false',
    forwardReceiverList: null,
    groupForwardList: null,
    groupmemberList: [],
    selectedMembers: 'N',
    secretMessageExpireTime: null,
    isVanished: false,
    sharedType: KATCHUP_MESSAGE_TYPE.normalMessage,
    temporaryMsgID: 0,
    uuid: [],
    isHtml: false,
    isVoiceMessage: false,
    referenceMessageIDList: null,
    referenceMessageList: null,
    ...overrides,
  };
}

const sendBody =
  (overrides: Record<string, unknown> = {}): (() => RequestSpec) =>
  () => ({ body: sendShape(overrides) });

export const sendMessageApi = defineKatchupEndpoint({
  id: 'katchup-send-message',
  requirements: ['FR-KU-003', 'FR-KU-003', 'FR-KU-003', 'FR-K07'],
  /*
   * BR-K01 (a message's Subject, when given, is carried as sent — Subject itself is optional per the
   * FR-K02 amendment 2026-09-25, see docs/katchup-flow.md §2.3) is only genuinely verifiable in the
   * database: the send response echoes back the subject it was handed, whatever it actually stored.
   * The column is a BLOB, so the validation decodes it before comparing — see kpost-assertions.text().
   */
  database: { validations: ['katchup-message-persisted'] },
  method: 'POST',
  path: '/v2/katchup/sendMessage/',
  summary: 'Send a Katchup message — the primary send path',
  tags: [...SEND_TAGS, 'critical'],
  /*
   * The workbook documents no body; this is the live client's. A 1:1 message to our own second
   * account, cleaned up by the recall/delete lifecycle test. `data` and destructive, not cleared
   * for live until the owner signs off (flow doc Q4).
   */
  destructive: true,
  sideEffect: 'data',
  request: sendBody(),
  note: 'payload from the live client (sendMessage temp); workbook has none',
});

export const sendMultipartApi = defineKatchupEndpoint({
  id: 'katchup-send-multipart',
  requirements: ['FR-KU-016'],
  method: 'POST',
  path: '/v2/katchup/sendKatchupMsgMultiPart/',
  summary: 'Send a message with attachments (multipart) — LEGACY, superseded by presigned S3 upload',
  tags: [...SEND_TAGS, 'attachment', 'legacy'],
  /*
   * Confirmed by the owner 2026-09-26: this direct-multipart-upload path is the OLD attachment flow
   * and is not what the current client uses. The live client now generates a presigned S3 URL
   * (`aws-katchup-presigned`, `POST /v2/aws/katchup/generate-presigned-url`), uploads the file
   * directly to S3 with it, then sends an ordinary `katchup-send-message` whose `uuid` array names
   * the uploaded attachment. `attachmentUuid: null` on a message sent through THIS route (previously
   * filed as #614) is not chased further — the route itself is legacy, not currently reachable from
   * the product, so its own storage behaviour is no longer product-relevant. Still registered (the
   * generic validator sweep still runs against it) but no live business-rule test asserts on its
   * attachment-storage behaviour; see `attachment-workflow.spec.ts` and
   * `presigned-attachment-workflow.spec.ts` for the current, real upload path.
   */
  destructive: true,
  sideEffect: 'data',
  request: () => ({
    multipart: {
      text: JSON.stringify(sendShape()),
      file: {
        name: 'qa-bench.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('QA bench attachment', 'utf8'),
      },
    },
  }),
});

export const bulkMessageApi = defineKatchupEndpoint({
  id: 'katchup-send-bulk',
  requirements: ['FR-GMSG-005'],
  method: 'POST',
  path: '/v2/katchup/sendBulkKatchupMsg',
  summary: 'Send one message to many recipients (bulk)',
  tags: [...SEND_TAGS, 'bulk', 'needs-recipients'],
  destructive: true,
  sideEffect: 'data',
  request: () => ({
    body: {
      receiverList: [testData.victimKpostId],
      messageType: KATCHUP_MESSAGE_TYPE.bulkMessage,
      subject: 'QA Bench',
      actualMessage: 'QA bench bulk message.',
      messageTime: now(),
      serverTime: now(),
      status: KATCHUP_STATUS.sent,
      sessionID: 'Web-Reactjs',
      temporaryMsgID: 1,
      attachmentCaption: null,
      uuid: [],
    },
  }),
  note: 'needs several recipients to be a real bulk send',
});

export const bulkMultipartApi = defineKatchupEndpoint({
  id: 'katchup-send-bulk-multipart',
  requirements: ['FR-KU-016', 'FR-GMSG-005'],
  method: 'POST',
  path: '/v2/katchup/sendBulkKatchupMsgMultiPart/',
  summary: 'Bulk send with attachments (multipart) — LEGACY, superseded by presigned S3 upload',
  tags: [...SEND_TAGS, 'bulk', 'attachment', 'needs-recipients', 'legacy'],
  // Same legacy direct-upload path as `katchup-send-multipart` (see its comment) — the bulk variant
  // of the same superseded flow.
  destructive: true,
  sideEffect: 'data',
  request: () => ({
    multipart: {
      text: JSON.stringify({
        receiverList: [testData.victimKpostId],
        messageType: KATCHUP_MESSAGE_TYPE.bulkMessage,
        subject: 'QA Bench',
        actualMessage: 'QA bench bulk message.',
        status: KATCHUP_STATUS.sent,
        sessionID: 'Web-Reactjs',
      }),
      file: {
        name: 'qa-bench.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('QA bench attachment', 'utf8'),
      },
    },
  }),
  note: 'needs several recipients',
});

export const forwardSelectedAttachmentApi = defineKatchupEndpoint({
  id: 'katchup-send-forward-selected-attachment',
  requirements: ['FR-KU-035'],
  method: 'POST',
  path: '/v2/katchup/sendMessageForForwardSelectedAttachment',
  summary: 'Forward selected attachments from a message',
  tags: [...SEND_TAGS, 'forward', 'attachment', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: () => ({
    body: {
      receiver: testData.victimKpostId,
      sender: testData.kpostId,
      messageType: KATCHUP_MESSAGE_TYPE.forwardSelectedAttachment,
      subject: 'QA Bench',
      status: KATCHUP_STATUS.sent,
      sessionID: 'Web-Reactjs',
    },
  }),
  note: 'needs a real message with an attachment to forward',
});

export const katchupSendApis = [
  sendMessageApi,
  sendMultipartApi,
  bulkMessageApi,
  bulkMultipartApi,
  forwardSelectedAttachmentApi,
];
