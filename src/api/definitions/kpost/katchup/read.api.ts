import { testData } from '@config/test-data.config';
import { pathParamSchema, typesOnlySchema } from '@api/schema/sample-schema';
import { body, pathParams, defineUndocumentedKpostEndpoint } from '../kpost-endpoint';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup reads. Conversation reads use our second account, so they run on live; reads keyed by a
 * message id stay blocked on live until a lifecycle test supplies one.
 */
const READ_TAGS = ['katchup-read'] as const;

export const unopenedCountApi = defineKatchupEndpoint({
  id: 'katchup-unopened-count',
  requirements: ['FR-K07'],
  method: 'GET',
  path: '/v2/katchup/getUnopenedMessagesCount/',
  summary: 'Unread Katchup message count for the caller',
  tags: [...READ_TAGS, 'badge'],
  // Reads only our own account's badge count. No identifier in the request.
  productionSafe: true,
});

export const unopenedTotalCountApi = defineKatchupEndpoint({
  id: 'katchup-unopened-total-count',
  requirements: ['FR-K07'],
  method: 'GET',
  path: '/v2/katchup/getUnopenedMessagesAndKmailsTotalCount/',
  summary: 'Combined unread Katchup + KMail count for the caller',
  tags: [...READ_TAGS, 'badge'],
  productionSafe: true,
});

export const messagesSubjectApi = defineKatchupEndpoint({
  id: 'katchup-messages-subject',
  requirements: ['FR-KU-003'],
  method: 'GET',
  path: '/v2/katchup/getKatchupMessagesSubject/{id}',
  // The workbook documents the bare path; the live client always appends an id.
  contractPath: '/v2/katchup/getKatchupMessagesSubject',
  summary: 'Subject suggestions for a conversation with a given contact or group',
  tags: [...READ_TAGS, 'subject', 'needs-id'],
  destructive: false,
  // The id is the contact id, or the groupKpostID for a group (Katchup.js:1703); this sends the
  // contact shape.
  request: pathParams(() => ({ id: testData.victimKpostId })),
  pathParamsSchema: pathParamSchema('id'),
  note: 'needs a real contact or group id — see the live-client evidence above',
});

export const frequentContactsApi = defineKatchupEndpoint({
  id: 'katchup-frequent-contacts',
  method: 'GET',
  path: '/v2/katchup/frequentlyAccessContacts',
  summary: 'Contacts the caller messages most often',
  tags: [...READ_TAGS, 'contacts'],
  productionSafe: true,
});

export const conversationApi = defineKatchupEndpoint({
  id: 'katchup-conversation',
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  requirements: ['FR-K07'],
  method: 'POST',
  path: '/v2/katchup/katchupMessagesForSelectedContactID/',
  summary: 'The message history with one contact',
  tags: [...READ_TAGS, 'conversation'],
  // A conversation with our second account; `null` message ids mean "the latest page".
  productionSafe: true,
  request: body(() => ({
    groupFlag: false,
    firstMsgID: null,
    lastMsgID: null,
    receiver: testData.victimKpostId,
  })),
});

export const messageCountApi = defineKatchupEndpoint({
  id: 'katchup-message-count',
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/katchup/messageCountBetweenSenderAndReceiver/',
  summary: 'How many messages exist between the caller and a contact',
  tags: [...READ_TAGS, 'conversation'],
  productionSafe: true,
  request: body(() => ({ receiver: testData.victimKpostId, groupFlag: 'false' })),
  // Types-only, from a captured live body.
  responseSchema: typesOnlySchema({
    messageCount: 0,
    urlPath: '',
    status: 'SUCCESS',
    statusCode: 200,
  }),
});

export const searchMessageApi = defineKatchupEndpoint({
  id: 'katchup-search-message',
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/katchup/searchKatchUpMessage/',
  summary: "Full-text search across the caller's messages",
  tags: [...READ_TAGS, 'search'],
  // Searches our own messages for a harmless term. No recipient id at all.
  productionSafe: true,
  request: body(() => ({ searchMessage: 'qa bench' })),
});

export const searchSubjectApi = defineKatchupEndpoint({
  id: 'katchup-search-subject',
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/katchup/searchKatchUpMessageSubject',
  summary: "Search the caller's messages with one contact by subject",
  tags: [...READ_TAGS, 'search'],
  productionSafe: true,
  request: body(() => ({ selectedContact: testData.victimKpostId, searchMessage: 'qa' })),
});

export const filterMessageApi = defineKatchupEndpoint({
  id: 'katchup-filter-message',
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/katchup/filterKatchUpMessage/',
  summary: 'Filter the caller messages (attachments, important, …)',
  tags: [...READ_TAGS, 'search'],
  // Needs a filter context and `messageBy` (an enum the QA guard exempts via `NOT_A_RESOURCE`).
  productionSafe: true,
  request: body(() => ({
    selectedContact: testData.victimKpostId,
    groupFlag: false,
    messageBy: 'All',
  })),
  requestSchema: typesOnlySchema({
    selectedContact: testData.victimKpostId,
    groupFlag: false,
    messageBy: 'All',
  }),
  note: 'needs a filter body: selectedContact, groupFlag AND messageBy (All/sent/received)',
});

export const allReportMsgApi = defineKatchupEndpoint({
  id: 'katchup-all-report-msg',
  requirements: ['FR-KU-047'],
  method: 'GET',
  path: '/v2/katchup/getAllReportMsg',
  summary: 'Messages the caller has reported',
  tags: [...READ_TAGS, 'report'],
  // A GET that reads our own reports. Named a write by its verb, but it fetches — safe.
  productionSafe: true,
});

// Reads keyed by a real message id we own; blocked on live until a lifecycle test creates one.
export const readStatusGroupApi = defineKatchupEndpoint({
  id: 'katchup-read-status-group',
  requirements: ['FR-K07'],
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/katchup/getReadStatusGroupMessage/',
  summary: 'Per-recipient read receipts for a group message',
  tags: [...READ_TAGS, 'read-receipt', 'needs-message-id', 'needs-group'],
  request: body(() => ({ msgID: 0 })),
  note: 'needs a real group message id; group needs ≥3 accounts',
});

export const sharedMessageInfoApi = defineKatchupEndpoint({
  id: 'katchup-shared-message-info',
  method: 'POST',
  path: '/v2/katchup/getSharedMessageInfo/',
  summary: 'Details of a shared message',
  tags: [...READ_TAGS, 'share', 'needs-message-id'],
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  request: body(() => ({ sharedMessageId: 0 })),
  // Every sendMessage response carries a `sharedMessageId`; see shared-reference-workflow.spec.ts.
  note: 'needs a real sharedMessageId (every sent message has one — see the endpoint comment); 500s when given a real one',
});

export const bulkMessageInfoApi = defineKatchupEndpoint({
  id: 'katchup-bulk-message-info',
  method: 'POST',
  path: '/v2/katchup/getBulkMessageInfo/',
  summary: 'Details of a bulk/broadcast message',
  tags: [...READ_TAGS, 'share', 'needs-message-id'],
  destructive: false,
  request: body(() => ({ sharedMessageId: 0 })),
  // Same sharedMessageId as above; see shared-reference-workflow.spec.ts.
  note: 'needs a real sharedMessageId (every sent message has one); confirmed working live 2026-09-25',
});

export const sharedMessageDetailsApi = defineKatchupEndpoint({
  id: 'katchup-shared-message-details',
  method: 'GET',
  path: '/v2/katchup/getSharedMessageDetails/{msgID}',
  summary: 'A shared message by id',
  tags: [...READ_TAGS, 'share', 'needs-message-id'],
  destructive: false,
  request: pathParams(() => ({ msgID: 0 })),
  pathParamsSchema: pathParamSchema('msgID'),
  // Takes a msgID from a plain send; see shared-reference-workflow.spec.ts.
  note: 'needs a real msgID; 500s when given a real one',
});

export const referenceDetailsApi = defineKatchupEndpoint({
  id: 'katchup-reference-details',
  method: 'POST',
  path: '/v2/katchup/getReferenceMSGDetails/',
  summary: 'Details of the messages a thread references',
  tags: [...READ_TAGS, 'thread', 'needs-message-id'],
  destructive: false,
  request: body(() => ({ referenceMessageIDList: [], sourceMsgID: 0 })),
  // A plain send's msgID works here (no reply or forward needed); see
  // shared-reference-workflow.spec.ts.
  note: 'needs real reference message ids; confirmed working live 2026-09-25 fed a plain sent msgID',
});

export const referenceMessagesDetailsApi = defineUndocumentedKpostEndpoint({
  id: 'katchup-reference-messages-details',
  authentication: { required: true },
  method: 'POST',
  path: '/v2/katchup/getReferenceMessagesDetails',
  summary:
    'Details of referenced messages (forward-hidden/reveal family sibling of getReferenceMSGDetails)',
  tags: ['katchup', ...READ_TAGS, 'thread', 'needs-message-id', 'security'],
  destructive: false,
  request: body(() => ({ referenceMessageIDList: [] })),
  requestSchema: typesOnlySchema({ referenceMessageIDList: [] }),
  evidence:
    'KatchupControllerV2.java:1486-1526 (@PostMapping("getReferenceMessagesDetails")) -> ' +
    'KatchupServiceImpl.getReferenceMessagesDetails:2093-2099, which calls ' +
    'katchupRepo.findAllById(referenceMessageIDList) with no participant filter — unlike its sibling ' +
    'getReferenceMSGDetails, which has one (tagged KPV2-REFDETAILSIDOR).',
  note: 'security-relevant: no participant filter in source — see priority finding #6',
});

export const messagesByReferenceApi = defineKatchupEndpoint({
  id: 'katchup-messages-by-reference',
  method: 'POST',
  path: '/v2/katchup/getMessagesByReferenceMessageList',
  summary: 'Messages named by a reference list',
  tags: [...READ_TAGS, 'thread', 'needs-message-id'],
  destructive: false,
  request: body(() => ({ referenceMessageList: '[]' })),
  // Fed a plain send's msgID as `referenceMessageIDList`; a positive result needs a genuinely
  // referenced message.
  note: 'needs a real reference message list; a plain sent msgID gets a clean 404, not yet confirmed positive',
});

export const globalSearchApi = defineUndocumentedKpostEndpoint({
  id: 'katchup-global-search',
  authentication: { required: true },
  method: 'POST',
  path: '/v2/katchup/katchupSearch',
  summary: "Header search over the caller's own messages and attachment names",
  tags: ['katchup', ...READ_TAGS, 'search'],
  destructive: false,
  // Searches only our own messages (sender or receiver = caller) for a harmless term.
  productionSafe: true,
  // 404 "No Data Found" is the empty answer: no message of ours matched in the last three months.
  expectedStatus: [200, 404],
  request: body(() => ({ keyWord: 'qa bench' })),
  requestSchema: typesOnlySchema({ keyWord: 'qa bench' }),
  evidence:
    'Header.js:2745-2773 (sends {keyWord} once the trimmed text has 2+ characters); ' +
    'KatchupControllerV2.java:1987 searchMessages reads only keyWord (blank → 400)',
  note:
    'the web app posts it to a hardcoded http://192.168.0.38:8989 (Header.js:240-241); fromDate/toDate ' +
    'are ignored and toDate is midnight today, so a message sent today may not be found ' +
    '(KatchupServiceImpl.java:2724-2727) — verify live before filing either',
});

export const reportReasonsApi = defineUndocumentedKpostEndpoint({
  id: 'katchup-report-reasons',
  authentication: { required: true },
  method: 'GET',
  path: '/v2/katchup/fetchReportMsgs',
  summary: 'The list of reasons a message can be reported for',
  tags: ['katchup', ...READ_TAGS, 'report'],
  destructive: false,
  // Reference data (TBL_KPOST_REPORT_REASON); names nobody.
  productionSafe: true,
  evidence:
    'KatchupControllerV2.java:2175 fetchReportMsgs → KatchupDaoImpl.java:990-993 (select all ReportReason)',
});

export const deletedMessageIdsApi = defineUndocumentedKpostEndpoint({
  id: 'katchup-deleted-message-ids',
  authentication: { required: true },
  method: 'GET',
  path: '/v2/katchup/getDeletedKatchupMsgIds/{lastMsgID}',
  summary:
    'Whether a message the caller sent or received was deleted by them (answers [id] or 404)',
  tags: ['katchup', ...READ_TAGS, 'needs-message-id'],
  destructive: false,
  // Keyed by a real message id: the Katchup lifecycle asks it right after deleting its own message.
  request: pathParams(() => ({ lastMsgID: 0 })),
  pathParamsSchema: pathParamSchema('lastMsgID'),
  evidence:
    'KatchupControllerV2.java:2056-2083; KatchupRepository.java:81-83 returns the id only when that ' +
    'exact message was deleted by the caller (not "every deletion since")',
});

export const katchupReadApis = [
  unopenedCountApi,
  unopenedTotalCountApi,
  messagesSubjectApi,
  frequentContactsApi,
  conversationApi,
  messageCountApi,
  searchMessageApi,
  searchSubjectApi,
  filterMessageApi,
  allReportMsgApi,
  readStatusGroupApi,
  sharedMessageInfoApi,
  bulkMessageInfoApi,
  sharedMessageDetailsApi,
  referenceDetailsApi,
  referenceMessagesDetailsApi,
  messagesByReferenceApi,
  globalSearchApi,
  reportReasonsApi,
  deletedMessageIdsApi,
];
