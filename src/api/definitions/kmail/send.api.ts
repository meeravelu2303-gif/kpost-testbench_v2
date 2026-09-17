import { KMAIL_PRIORITY, KMAIL_TYPE } from '@api/schemas/kpost-types';
import { testData } from '@config/test-data.config';
import { body } from '../kpost/kpost-endpoint';
import { defineKmailEndpoint } from './kmail-endpoint';

/**
 * KMail **sends** — compose (`postMail`), multipart compose, and bulk send.
 *
 * The recipient model is `toAddress` (TO) + `ccList` (COPY) + **`bccList` (CONFIDENTIAL — hidden from
 * the others**, KMail's NFR-SEC02). `kmailType` selects the action (New/Reply/Forward/…) and
 * `priority` the KMAIL_PRIORITY. Every send reaches a real inbox, so **none is `productionSafe`**;
 * they run through the gated feature flow (`KMAIL_LIFECYCLE=true`) with `allowLiveWrite`, to our own
 * accounts, self-cleaning. Payload from the live client (`WriteMailBox.js`) + the workbook.
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
    // Documented field — empty for a text mail (no attachment). Included so the payload matches the
    // contract in full and the API does not flag a missing field.
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
  request: body(() => ({
    ...mailShape({ kmailType: KMAIL_TYPE.bulkmail }),
    toAddressList: [testData.victimKpostId],
  })),
  note: 'bulk send; recipients confined to our own accounts',
});

export const kmailSendApis = [postMailApi, postBulkMailApi];
