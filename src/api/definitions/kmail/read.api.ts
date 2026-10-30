import { typesOnlySchema } from '@api/schema/sample-schema';
import { testData } from '@config/test-data.config';
import type { ContractSchema } from '../../schema/contract-schema';
import { body, pathParams } from '../kpost/kpost-endpoint';
import { defineKmailEndpoint, defineUndocumentedKmailEndpoint } from './kmail-endpoint';

/**
 * KMail reads. Parameterless GETs and contact-scoped reads (our second account) run on live; reads
 * keyed by a real `kmailID`/`uuid` stay blocked (`needs-id`). POST reads set `destructive: false`.
 */
const R = ['kmail-read'] as const;

/** Parameterless GET reads — all run on live (our own account). */
const getRead = (id: string, path: string, summary: string, tags: string[] = []) =>
  defineKmailEndpoint({
    id,
    method: 'GET',
    path,
    summary,
    tags: [...R, ...tags],
    productionSafe: true,
  });

export const saluationsApi = getRead(
  'kmail-saluations',
  '/common/getSaluations/',
  'Salutations list',
);
export const frequentContactApi = getRead(
  'kmail-frequent-contact',
  '/common/frequentKmailContact/',
  'Frequent KMail contacts',
  ['contacts'],
);
export const unopenedCountApi = getRead(
  'kmail-unopened-count',
  '/common/unOpenedMailCountBySenderID/',
  'Unread mail count',
  ['badge'],
);
export const miscContactsApi = getRead(
  'kmail-misc-contacts',
  '/common/miscellaneousContacts/',
  'Miscellaneous (external) contacts',
  ['contacts'],
);
export const otherDomainMailsApi = getRead(
  'kmail-other-domain-mails',
  '/sentMail/loadOtherDomainMails/',
  'Mails from other domains',
  ['external'],
);
export const allDraftsApi = getRead(
  'kmail-all-drafts',
  '/draft/getAllDraftMails/',
  'All draft mails',
  ['draft'],
);
export const draftContactsApi = getRead(
  'kmail-draft-contacts',
  '/draft/getDraftMailsContacts/',
  'Contacts with drafts',
  ['draft'],
);
export const instantReplyApi = getRead(
  'kmail-instant-reply',
  '/common/getInstantReply/',
  'Instant reply setting',
  ['settings'],
);
export const digitalSignatureApi = getRead(
  'kmail-digital-signature',
  '/kmailSetting/getDigitalSignature',
  'Digital signature',
  ['settings'],
);
export const statusTotalCountApi = getRead(
  'kmail-status-total-count',
  '/common/statusOfKmailsContactsTotalCount/',
  'Total status counts',
  ['status'],
);
export const allLetterHeadApi = getRead(
  'kmail-all-letterhead',
  '/kmailSetting/getAllLetterHead',
  'All letterheads',
  ['settings'],
);
export const letterHeadApi = getRead(
  'kmail-letterhead',
  '/kmailSetting/getLetterHead',
  'Current letterhead',
  ['settings'],
);
export const mailSignatureApi = getRead(
  'kmail-mail-signature',
  '/kmailSetting/getMailSignature',
  'Mail signature',
  ['settings'],
);
export const letterHeadTemplateApi = getRead(
  'kmail-letterhead-template',
  '/kmailSetting/getLetterHeadTemplate',
  'Letterhead template',
  ['settings'],
);
export const mailCountDaysLimitApi = getRead(
  'kmail-count-days-limit',
  '/kmailSetting/getMailCountDaysLimit',
  'Mail count days limit',
  ['settings'],
);

/** Contact-scoped POST reads — asked with our own second account, so they run on live. */
const contactRead = (
  id: string,
  path: string,
  summary: string,
  bodyObj: Record<string, unknown>,
  tags: string[] = [],
  opts: {
    productionSafe?: boolean;
    expectedStatus?: number[];
    note?: string;
    timeoutMs?: number;
    skipValidators?: readonly string[];
  } = {},
) =>
  defineKmailEndpoint({
    id,
    method: 'POST',
    path,
    summary,
    tags: [...R, ...tags],
    destructive: false,
    // A read needing a real runtime id is not run standalone on live; the lifecycle drives it.
    productionSafe: opts.productionSafe ?? true,
    expectedStatus: opts.expectedStatus,
    request: body(() => bodyObj),
    // Used only where the workbook documents no body (defineKmailEndpoint).
    requestSchema: typesOnlySchema(bodyObj),
    note: opts.note,
    performance: opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : undefined,
    skipValidators: opts.skipValidators,
  });

export const dashboardApi = contactRead(
  'kmail-dashboard',
  '/common/getKmailDashboardMsg/',
  'KMail dashboard (recent mails)',
  { kmailID: '' },
  ['dashboard'],
);
// `selectedContact`/`kpostUser` are real identifiers the QA guard refuses to fuzz on live, so these
// probes are skipped.
const SELECTED_CONTACT_SKIP = ['security.xss', 'security.injection', 'request.data-type'] as const;

export const subjectsApi = contactRead(
  'kmail-subjects',
  '/common/mailSubjectSelectedContact/',
  'Mail subjects with a contact',
  { selectedContact: testData.victimKpostId },
  ['subject'],
  { skipValidators: SELECTED_CONTACT_SKIP },
);
export const sentNotOpenedApi = contactRead(
  'kmail-sent-not-opened',
  '/common/sentMailNotOpened/',
  'Sent mails not yet opened',
  { selectedContact: testData.victimKpostId },
  ['status'],
  { skipValidators: SELECTED_CONTACT_SKIP },
);
export const replyNotReceivedApi = contactRead(
  'kmail-reply-not-received',
  '/common/replyNotReceived/',
  'Replies not received',
  { kpostUser: testData.kpostId, selectedContact: testData.victimKpostId },
  ['status'],
  { skipValidators: SELECTED_CONTACT_SKIP },
);
export const replyNotSentApi = contactRead(
  'kmail-reply-not-sent',
  '/common/replyNotSent/',
  'Replies not sent',
  { selectedContact: testData.victimKpostId },
  ['status'],
  { skipValidators: SELECTED_CONTACT_SKIP },
);
export const importantMailsApi = contactRead(
  'kmail-important-mails',
  '/common/getAllImportantMails/',
  'Important mails with a contact',
  { selectedContact: testData.victimKpostId },
  ['important'],
  { skipValidators: SELECTED_CONTACT_SKIP },
);
export const draftsForContactApi = contactRead(
  'kmail-drafts-for-contact',
  '/draft/getDraftMailsForSelectedContact/',
  'Drafts for a contact',
  { toAddress: testData.victimKpostId },
  ['draft'],
  // 204 is valid when the contact has no drafts.
  { expectedStatus: [200, 204] },
);
export const statusWithCountApi = contactRead(
  'kmail-status-with-count',
  '/common/statusOfKmailsContactsWithCount/',
  'Status of contacts with count',
  { kmailStatusFlag: 2 },
  ['status'],
);
export const postBoxContactsApi = contactRead(
  'kmail-postbox-contacts',
  '/common/postBoxContacts/',
  'Post-box contacts',
  { lastFetchTime: Date.now() },
  ['contacts', 'needs-id'],
  {
    productionSafe: false,
    // Dead route: the backend maps only `unusedpostBoxContacts`, which the workbook does not list.
    note: 'dead route (confirmed from source) AND the real route is undocumented in the workbook contract — two separate blockers, not one',
  },
);
export const knownPostBoxContactsApi = contactRead(
  'kmail-known-postbox-contacts',
  '/common/knownPostBoxContacts/',
  'Known post-box contacts',
  { lastFetchTime: String(Date.now()) },
  ['contacts'],
);
export const allMailCountApi = contactRead(
  'kmail-all-mail-count',
  '/common/getAllMailCount',
  'All mail count with a contact',
  { selectedContact: testData.victimKpostId, groupFlag: false },
  ['status'],
  { skipValidators: SELECTED_CONTACT_SKIP },
);
export const bulkDashboardApi = contactRead(
  'kmail-bulk-dashboard',
  '/common/getBulkKmailDashboardMsg',
  'Bulk mail dashboard',
  { kmailID: null },
  ['bulk', 'needs-id'],
  // Needs a real kmailID from a loaded bulk mail, so it is not run standalone on live.
  { productionSafe: false, note: 'needs a real kmailID; empty body 400s' },
);
export const selectedContactMailsApi = contactRead(
  'kmail-selected-contact-mails',
  '/common/selectedContactMails/',
  'Mail thread with a contact',
  // The full live-client body (Kmail.js getKmailChat): pages by count and first/last kmailID.
  {
    selectedContact: testData.victimKpostId,
    fetchMailType: 'A',
    groupFlag: false,
    lastKmailID: null,
    firstKmailID: null,
    count: 50,
  },
  ['thread'],
);
export const translationApi = contactRead(
  'kmail-translation',
  '/translator/translation/',
  'Translate mail content',
  { langFrom: 'en', langTo: 'hi', msgToTranslate: 'QA bench message' },
  ['translate'],
  // Proxies an external translator with unbounded latency; timeouts during the negative-auth probes
  // read as false findings, so those and the disclosure check are skipped. Functional checks still
  // run.
  {
    timeoutMs: 30_000,
    skipValidators: [
      'authentication.missing-token',
      'authentication.malformed-token',
      'authentication.invalid-token',
      'authentication.expired-token',
      'security.information-disclosure',
    ],
    note: 'AUTH-BYPASS to confirm with dev: /translator/translation answers 200 with no/Basic/wrong-scheme token, while every other KMail endpoint enforces 401. Likely a deliberately public utility; confirm before treating as a defect. Negative-auth + disclosure probes skipped here because the external service latency makes them unreliable (timeouts pollute the auth results).',
  },
);
export const referenceMailContentApi = contactRead(
  'kmail-reference-content',
  '/readMail/referenceMailContent/',
  'Reference mail content',
  { referenceMails: [] as number[] },
  ['content', 'needs-id'],
  // Needs real reference-mail ids from a loaded mail (empty → 400).
  { productionSafe: false, note: 'needs real referenceMails ids from a loaded mail' },
);

/** Reads keyed by a real kmailID / uuid — blocked until a lifecycle mail exists (needs-id). */
const idRead = (
  id: string,
  method: 'GET' | 'POST',
  path: string,
  summary: string,
  request: ReturnType<typeof body>,
  note: string,
  tags: string[] = [],
  opts: { authentication?: { required: boolean }; requestSchema?: ContractSchema } = {},
) =>
  defineKmailEndpoint({
    id,
    method,
    path,
    summary,
    tags: [...R, 'needs-id', ...tags],
    request,
    requestSchema: opts.requestSchema,
    note,
    authentication: opts.authentication,
  });

export const copiesInfoApi = idRead(
  'kmail-copies-info',
  'GET',
  '/readMail/getCopiesInfo/{kmailID}',
  'Copies/recipients of a mail',
  pathParams(() => ({ kmailID: 0 })),
  'needs a real kmailID',
  ['content'],
);
export const downloadThumbApi = idRead(
  'kmail-download-thumbnail',
  'GET',
  '/readMail/downloadThumbnail/{uuid}',
  'Attachment thumbnail',
  pathParams(() => ({ uuid: '' })),
  // Ownership of thumbnails is checked by attachment-idor.spec.ts with bench-owned accounts.
  'needs a real attachment uuid; genuinely unauthenticated on live (see note above), not a bench gap',
  ['attachment'],
);
export const mediaStreamApi = idRead(
  'kmail-media-streaming',
  'GET',
  '/readMail/mediaStreaming/{uuid}',
  'Stream a media attachment',
  pathParams(() => ({ uuid: '' })),
  'needs a real attachment uuid',
  ['attachment'],
);
export const downloadAttApi = idRead(
  'kmail-download-attachment',
  'GET',
  '/readMail/download/{uuid}',
  'Download an attachment',
  pathParams(() => ({ uuid: '' })),
  'needs a real attachment uuid',
  ['attachment'],
);
export const bulkStatusApi = idRead(
  'kmail-bulk-status',
  'GET',
  '/sentMail/bulkMail/status/{fromAddress}',
  'Bulk mail send status',
  pathParams(() => ({ fromAddress: testData.kpostId })),
  'needs a real bulk-mail fromAddress',
  ['bulk'],
);
export const replyNotReqSenderApi = idRead(
  'kmail-reply-not-req-sender',
  'POST',
  '/common/replyNotRequiredBySender/',
  'Reply-not-required (by sender)',
  body(() => ({ selectedContact: testData.victimKpostId, kmailID: 0 })),
  'needs a real kmailID',
  ['status'],
);
export const replyNotReqReceiverApi = idRead(
  'kmail-reply-not-req-receiver',
  'POST',
  '/common/replyNotRequiredByReceiver/',
  'Reply-not-required (by receiver)',
  body(() => ({ selectedContact: testData.victimKpostId, kmailID: 0 })),
  'needs a real kmailID',
  ['status'],
);
export const groupReadStatusApi = idRead(
  'kmail-group-read-status',
  'POST',
  '/common/kmailGroupReadStatus/',
  'Per-recipient read status of a group mail',
  body(() => ({ kmailID: 0 })),
  'needs a real group kmailID',
  ['read-receipt'],
);
export const detailsByIdApi = idRead(
  'kmail-details-by-id',
  'POST',
  '/readMail/getKmailDetailsUsingKmailID',
  'Mail details by ids',
  body(() => ({ kmailIDs: [] as number[] })),
  'needs real kmailIDs',
  ['content'],
);
export const draftContentApi = idRead(
  'kmail-draft-content',
  'POST',
  '/readMail/draftMailContent',
  'Draft mail content',
  body(() => ({ draftKmailID: '', kmailSendDate: Date.now(), kmailSubject: '' })),
  'needs a real draftKmailID',
  ['draft'],
);
/** The live client's sentAndInboxMailContent body (a real kmailID comes from the lifecycle). */
const mailContentBody = () => ({
  kmailID: 0,
  kmailNumber: 0,
  kmailType: 'Received',
  selectedContact: testData.victimKpostId,
  groupFlag: false,
});
export const mailContentApi = idRead(
  'kmail-mail-content',
  'POST',
  '/readMail/sentAndInboxMailContent/',
  'Sent/inbox mail content',
  // The full live-client body; the backend dereferences `selectedContact` unguarded, so omitting it
  // 500s.
  body(() => mailContentBody()),
  'needs a real kmailID; full row shape avoids the backend selectedContact NPE',
  ['content'],
  { requestSchema: typesOnlySchema(mailContentBody()) },
);

// Settings > Data Storage — the KMail storage used. Real but not in the workbook contract.
export const kloudUsedDataApi = defineUndocumentedKmailEndpoint({
  id: 'kmail-kloud-used-data',
  method: 'GET',
  path: '/kmailData/getKloudUsedData',
  summary: 'KMail storage used (Settings > Data Storage)',
  tags: [...R],
  productionSafe: true,
  evidence:
    'Services/Setting.js:1005-1017 GetKlouDUsedDataList (GET, no body); caller Settings/DataStorage/DataStorage.js:64',
});

export const kmailReadApis = [
  kloudUsedDataApi,
  saluationsApi,
  frequentContactApi,
  unopenedCountApi,
  miscContactsApi,
  otherDomainMailsApi,
  allDraftsApi,
  draftContactsApi,
  instantReplyApi,
  digitalSignatureApi,
  statusTotalCountApi,
  allLetterHeadApi,
  letterHeadApi,
  mailSignatureApi,
  letterHeadTemplateApi,
  mailCountDaysLimitApi,
  dashboardApi,
  subjectsApi,
  sentNotOpenedApi,
  replyNotReceivedApi,
  replyNotSentApi,
  importantMailsApi,
  draftsForContactApi,
  statusWithCountApi,
  postBoxContactsApi,
  knownPostBoxContactsApi,
  allMailCountApi,
  bulkDashboardApi,
  selectedContactMailsApi,
  translationApi,
  referenceMailContentApi,
  copiesInfoApi,
  downloadThumbApi,
  mediaStreamApi,
  downloadAttApi,
  bulkStatusApi,
  replyNotReqSenderApi,
  replyNotReqReceiverApi,
  groupReadStatusApi,
  detailsByIdApi,
  draftContentApi,
  mailContentApi,
];
