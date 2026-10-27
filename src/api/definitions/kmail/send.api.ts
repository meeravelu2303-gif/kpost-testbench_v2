import { KMAIL_PRIORITY, KMAIL_TYPE } from '@api/contract/kpost-types';
import { testData } from '@config/test-data.config';
import { body } from '../kpost/kpost-endpoint';
import { defineKmailEndpoint } from './kmail-endpoint';

/**
 * KMail sends: compose, multipart and bulk. Recipients are `toAddress`, `ccList` and `bccList`
 * (hidden from the others). None is `productionSafe`; the self-cleaning KMAIL_LIFECYCLE flow drives
 * them.
 */
const SEND_TAGS = ['kmail-send'] as const;

/** The live client's `postMail` object — a New mail to our own second account. */
export function mailShape(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    toAddress: testData.victimKpostId,
    kmailSubject: 'QA Bench Mail',
    referenceKmailID: null,
    saluation: 'Hello',
    saluationName: 'QA',
    kmailContent: 'QA bench mail body — safe to ignore.',
    groupFlag: false,
    groupReceiverList: null,
    kmailSendDate: Date.now(),
    senderLatitde: 13.0476875,
    senderLongitude: 80.2655737,
    kmailType: KMAIL_TYPE.new,
    forwardList: null,
    revealSource: false,
    selectedMembers: 'N',
    priority: KMAIL_PRIORITY.medium,
    attachmentFlag: 0,
    originalKmailID: null,
    forwardNote: '',
    forwardRevealDetails: { fromAddress: '', toAddress: '', ccList: [], sendDate: '' },
    forwardAttachmentLists: [],
    ccList: [] as string[],
    bccList: [] as string[],
    attachmentCaption: null,
    // Empty for a text mail; sent so the payload matches the contract in full.
    attachmentUuid: [] as string[],
    ...overrides,
  };
}

export const postMailApi = defineKmailEndpoint({
  id: 'kmail-post-mail',
  requirements: ['FR-KM-018', 'FR-KM-020'],
  method: 'POST',
  path: '/sentMail/postMail/',
  contractPath: '/v2/sentMail/postMail/',
  summary: 'Compose and send a mail — the primary send path',
  tags: [...SEND_TAGS, 'critical'],
  destructive: true,
  // Reports SKIPPED until the KMail DB connection is configured
  // (src/database/validations/kmail.db.ts).
  database: { validations: ['kmail-mail-persisted'] },
  request: body(() => mailShape()),
});

export const postBulkMailApi = defineKmailEndpoint({
  id: 'kmail-post-bulk',
  requirements: ['FR-KM-018'],
  method: 'POST',
  path: '/sentMail/postBulkMail',
  summary: 'Send a bulk mail to many recipients',
  tags: [...SEND_TAGS, 'bulk'],
  // Bulk to our own second account only, so no stranger is mailed.
  destructive: true,
  // A successful bulk send answers 202 Accepted.
  expectedStatus: [202],
  // Its own small contract, not `mailShape()` plus `toAddressList`; the extra fields 400.
  request: body(() => ({
    toAddressList: [testData.victimKpostId],
    kmailSubject: 'QA Bench Bulk Mail',
    kmailContent: 'QA bench bulk mail body — safe to ignore.',
    priority: KMAIL_PRIORITY.low,
    kmailType: KMAIL_TYPE.bulkmail,
    attachmentUuid: [] as string[],
  })),
  note: 'bulk send; recipients confined to our own accounts; own contract, not postMail + toAddressList',
});

export const kmailSendApis = [postMailApi, postBulkMailApi];
