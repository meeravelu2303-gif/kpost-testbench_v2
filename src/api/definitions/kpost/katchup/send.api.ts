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
     * A STRING, not a boolean — measured 2026-09-21, and the fix for a 400 that blocked every send.
     *
     * The DTO binds `groupFlag` as a char/String ('N' / 'Y'), matching KPost's 'Y'/'N' convention
     * elsewhere (KMail's read/star/delete flags are all chars). Sending `false` or `0` makes Jackson
     * reject the WHOLE body with 400 "Malformed or missing request body" — which names no field, so
     * it reads as a malformed request rather than as one wrong type. Every other boolean in this
     * payload (`isVanished`, `isHtml`, `isVoiceMessage`) binds correctly AS a boolean; this one
     * field is the exception, verified by adding each field individually to a known-good body.
     */
    groupFlag: 'N',
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
   * BR-K01 (every message carries a Subject) is only genuinely verifiable in the database: the
   * send response echoes back the subject it was handed, whatever it actually stored. The column
   * is a BLOB, so the validation decodes it before comparing — see kpost-assertions.text().
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
  summary: 'Send a message with attachments (multipart)',
  tags: [...SEND_TAGS, 'attachment'],
  /*
   * Commented out in the current web build (`SendMessage` runs instead), but the route exists and is
   * the documented way to attach files: a `text` field carrying the JSON message plus the file part.
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
  summary: 'Bulk send with attachments (multipart)',
  tags: [...SEND_TAGS, 'bulk', 'attachment', 'needs-recipients'],
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
