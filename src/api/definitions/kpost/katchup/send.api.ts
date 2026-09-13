import { KATCHUP_MESSAGE_TYPE, KATCHUP_STATUS } from '@api/schemas/kpost-types';
import { testData } from '@config/test-data.config';
import type { RequestSpec } from '@api/client/request-builder';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup **sends** — the endpoints that create a message.
 *
 * One route per endpoint: `sendMessage/` is a **single** endpoint whose behaviour changes with
 * `messageType` (normal, reply, edit, note, secret, group, copies…). Those are payload *shapes* of
 * one endpoint, not separate endpoints — registering them separately would collide on the path — so
 * the shapes live in `sendShape()` below and are exercised by the behaviour spec, while the registry
 * holds one definition per distinct route.
 *
 * All sends are `destructive` and reach a real inbox, so **none is `productionSafe` yet**: sending on
 * the live application waits on the owner's sign-off (`docs/katchup-flow.md` §6 Q4). Off the live
 * host they run against the mock. The payload mirrors the live web client (`docs/katchup-flow.md`
 * §3); codes come from `KATCHUP_MESSAGE_TYPE` / `KATCHUP_STATUS`.
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
    groupFlag: false,
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
  requirements: ['FR-K01', 'FR-K02', 'BR-K01', 'FR-K07'],
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
  requirements: ['FR-K03'],
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
  requirements: ['FR-K06'],
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
  requirements: ['FR-K03', 'FR-K06'],
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
  requirements: ['FR-K15'],
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
