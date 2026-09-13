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
) =>
  defineKmailEndpoint({
    id,
    method: 'POST',
    path,
    summary,
    tags: [...R, ...tags],
    destructive: false,
    productionSafe: true,
    request: body(() => bodyObj),
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
  ['contacts'],
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
  ['bulk'],
);
export const selectedContactMailsApi = contactRead(
  'kmail-selected-contact-mails',
  '/common/selectedContactMails/',
  'Mail thread with a contact',
  { selectedContact: testData.victimKpostId },
  ['thread'],
);
export const translationApi = contactRead(
  'kmail-translation',
  '/translator/translation/',
  'Translate mail content',
  { langFrom: 'en', langTo: 'hi', msgToTranslate: 'QA bench message' },
  ['translate'],
);
export const referenceMailContentApi = contactRead(
  'kmail-reference-content',
  '/readMail/referenceMailContent/',
  'Reference mail content',
  { referenceMails: [] as number[] },
  ['content'],
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
  body(() => ({ kmailID: 0 })),
  'needs a real kmailID',
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
