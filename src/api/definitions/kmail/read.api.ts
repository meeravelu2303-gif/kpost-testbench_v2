import { testData } from '@config/test-data.config';
import { body, pathParams } from '../kpost/kpost-endpoint';
import { defineKmailEndpoint } from './kmail-endpoint';

/**
 * KMail **reads** — dashboards, counts, mail lists, subjects, statuses, drafts, settings and
 * translation. The parameterless GETs and the contact-scoped reads (asked with OUR OWN second
 * account) run on live; the reads keyed by a real `kmailID`/`uuid` stay blocked (`needs-id`) until a
 * lifecycle mail exists. POST reads state `destructive: false` (the grep-drop trap).
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
  } = {},
) =>
  defineKmailEndpoint({
    id,
    method: 'POST',
    path,
    summary,
    tags: [...R, ...tags],
    destructive: false,
    // A read that needs a real runtime id (a kmailID / reference-mail id) is NOT run standalone on
    // live — a placeholder body 400s and reads as a false bug; it is driven by the lifecycle instead.
    productionSafe: opts.productionSafe ?? true,
    expectedStatus: opts.expectedStatus,
    request: body(() => bodyObj),
    note: opts.note,
    performance: opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : undefined,
  });

export const dashboardApi = contactRead(
  'kmail-dashboard',
  '/common/getKmailDashboardMsg/',
  'KMail dashboard (recent mails)',
  { kmailID: '' },
  ['dashboard'],
);
export const subjectsApi = contactRead(
  'kmail-subjects',
  '/common/mailSubjectSelectedContact/',
  'Mail subjects with a contact',
  { selectedContact: testData.victimKpostId },
  ['subject'],
);
export const sentNotOpenedApi = contactRead(
  'kmail-sent-not-opened',
  '/common/sentMailNotOpened/',
  'Sent mails not yet opened',
  { selectedContact: testData.victimKpostId },
  ['status'],
);
export const replyNotReceivedApi = contactRead(
  'kmail-reply-not-received',
  '/common/replyNotReceived/',
  'Replies not received',
  { kpostUser: testData.kpostId, selectedContact: testData.victimKpostId },
  ['status'],
);
export const replyNotSentApi = contactRead(
  'kmail-reply-not-sent',
  '/common/replyNotSent/',
  'Replies not sent',
  { selectedContact: testData.victimKpostId },
  ['status'],
);
export const importantMailsApi = contactRead(
  'kmail-important-mails',
  '/common/getAllImportantMails/',
  'Important mails with a contact',
  { selectedContact: testData.victimKpostId },
  ['important'],
);
export const draftsForContactApi = contactRead(
  'kmail-drafts-for-contact',
  '/draft/getDraftMailsForSelectedContact/',
  'Drafts for a contact',
  { toAddress: testData.victimKpostId },
  ['draft'],
  // 204 (no content) is a valid response when the contact has no drafts — not a defect.
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
    note: 'returns Spring 404 (route not mapped) on the test build — confirm it exists there',
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
);
export const bulkDashboardApi = contactRead(
  'kmail-bulk-dashboard',
  '/common/getBulkKmailDashboardMsg',
  'Bulk mail dashboard',
  { kmailID: null },
  ['bulk', 'needs-id'],
  // The API rejects an empty body ("Request body should not be empty"); it needs a real kmailID the
  // frontend supplies from a loaded bulk mail — a runtime id, so not run standalone on live.
  { productionSafe: false, note: 'needs a real kmailID; empty body 400s' },
);
export const selectedContactMailsApi = contactRead(
  'kmail-selected-contact-mails',
  '/common/selectedContactMails/',
  'Mail thread with a contact',
  // Full live-client body (Kmail.js getKmailChat / KmailMessage.fetchMail): the thread read pages
  // by count and by first/last kmailID. Sending only `selectedContact` under-sends what the app
  // sends; verified against the frontend (2026-09-18), the backend reads all of these.
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
  // Calls an external translation service, so it is legitimately slow — the default 10s timeout was
  // being hit, and the timeouts polluted the auth-probe messages into duplicate tickets. A generous
  // timeout lets it complete so the checks (incl. the auth-bypass finding) report cleanly, once.
  { timeoutMs: 30_000 },
);
export const referenceMailContentApi = contactRead(
  'kmail-reference-content',
  '/readMail/referenceMailContent/',
  'Reference mail content',
  { referenceMails: [] as number[] },
  ['content', 'needs-id'],
  // Empty `referenceMails` → 400 Bad Request; it needs real reference-mail ids from a loaded mail.
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
) =>
  defineKmailEndpoint({
    id,
    method,
    path,
    summary,
    tags: [...R, 'needs-id', ...tags],
    request,
    note,
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
  'needs a real attachment uuid',
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
export const mailContentApi = idRead(
  'kmail-mail-content',
  'POST',
  '/readMail/sentAndInboxMailContent/',
  'Sent/inbox mail content',
  // Full live-client body (MessageContainer MailObj / KmailMessage.showMailMessage). The backend
  // dereferences `selectedContact.toLowerCase()` UNGUARDED (ReadKmailController.java:179): omitting
  // it NPEs a 500, which would look like a product bug — so the bench sends the whole row the app
  // sends (verified against the frontend + backend, 2026-09-18).
  body(() => ({
    kmailID: 0,
    kmailNumber: 0,
    kmailType: 'Received',
    selectedContact: testData.victimKpostId,
    groupFlag: false,
  })),
  'needs a real kmailID; full row shape avoids the backend selectedContact NPE',
  ['content'],
);

export const kmailReadApis = [
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
