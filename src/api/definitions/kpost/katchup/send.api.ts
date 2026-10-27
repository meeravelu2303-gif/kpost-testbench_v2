import { KATCHUP_MESSAGE_TYPE, KATCHUP_STATUS } from '@api/contract/kpost-types';
import { testData } from '@config/test-data.config';
import type { RequestSpec } from '@api/client/request-builder';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup sends, one definition per route; `sendMessage/` shapes per `messageType` live in
 * `sendShape()`. Every send reaches a real inbox, so none is `productionSafe`. Payloads mirror the
 * live web client.
 */
const SEND_TAGS = ['katchup-send'] as const;

const now = (): number => Date.now();

/**
 * The live client's `sendMessage` object for a 1:1 message to our second account; shared by every
 * `messageType` case.
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
    // The string "false"/"true": a JSON boolean or 'N'/'Y' gets 400 "Malformed or missing request
    // body".
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
  // BR-K01 (the Subject is stored as sent) is only provable in the DB: the response just echoes the
  // input.
  database: { validations: ['katchup-message-persisted'] },
  method: 'POST',
  path: '/v2/katchup/sendMessage/',
  summary: 'Send a Katchup message — the primary send path',
  tags: [...SEND_TAGS, 'critical'],
  // The live client's body (the workbook has none); the recall/delete lifecycle cleans it up.
  destructive: true,
  sideEffect: 'data',
  request: sendBody(),
  // Types-only, so injection/XSS reach the free-text fields without inventing required fields.
  requestSchema: typesOnlySchema(sendShape()),
  note: 'payload from the live client (sendMessage temp); workbook has none',
});

export const sendMultipartApi = defineKatchupEndpoint({
  id: 'katchup-send-multipart',
  requirements: ['FR-KU-016'],
  method: 'POST',
  path: '/v2/katchup/sendKatchupMsgMultiPart/',
  summary:
    'Send a message with attachments (multipart) — LEGACY, superseded by presigned S3 upload',
  tags: [...SEND_TAGS, 'attachment', 'legacy'],
  // Legacy upload path; the client now uses a presigned S3 URL
  // (presigned-attachment-workflow.spec.ts). Still swept by the generic validators.
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
  // The bulk variant of the legacy `katchup-send-multipart` path.
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
