import { testData } from '@config/test-data.config';
import { body, pathParams } from '../kpost-endpoint';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup **reads** — everything that fetches without writing a message.
 *
 * The counts and the subject list need nothing but our own account, so they run on live. The
 * conversation reads are asked with `QA_VICTIM_KPOST_ID` — our own second account — so no identifier
 * naming a stranger is ever sent. The id-keyed share/reference reads need a real message id we do not
 * have on live yet; they stay registered (and blocked) so they run once a lifecycle test has created
 * one. See `docs/katchup-flow.md` §5.
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
  requirements: ['FR-K01'],
  method: 'GET',
  path: '/v2/katchup/getKatchupMessagesSubject',
  summary: "Subjects of the caller's Katchup conversations",
  tags: [...READ_TAGS, 'subject'],
  // Our own subjects; the Subject field is the module's differentiator (BR-K01).
  productionSafe: true,
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
  requirements: ['FR-K07'],
  method: 'POST',
  path: '/v2/katchup/katchupMessagesForSelectedContactID/',
  summary: 'The message history with one contact',
  tags: [...READ_TAGS, 'conversation'],
  /*
   * The receiver is our own second account, so this reads a conversation we are a party to. `null`
   * first/last message ids mean "the latest page", exactly as the client sends on first open.
   */
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
  method: 'POST',
  path: '/v2/katchup/messageCountBetweenSenderAndReceiver/',
  summary: 'How many messages exist between the caller and a contact',
  tags: [...READ_TAGS, 'conversation'],
  productionSafe: true,
  request: body(() => ({ receiver: testData.victimKpostId, groupFlag: 'false' })),
});

export const searchMessageApi = defineKatchupEndpoint({
  id: 'katchup-search-message',
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
  method: 'POST',
  path: '/v2/katchup/searchKatchUpMessageSubject',
  summary: "Search the caller's messages with one contact by subject",
  tags: [...READ_TAGS, 'search'],
  productionSafe: true,
  request: body(() => ({ selectedContact: testData.victimKpostId, searchMessage: 'qa' })),
});

export const filterMessageApi = defineKatchupEndpoint({
  id: 'katchup-filter-message',
  method: 'POST',
  path: '/v2/katchup/filterKatchUpMessage/',
  summary: 'Filter the caller messages (attachments, important, …)',
  tags: [...READ_TAGS, 'search'],
  /*
   * The workbook documents no payload, so the central empty-body and null probes carry the load.
   * A filter over our own messages owns nothing, so it is cleared for live.
   */
  productionSafe: true,
  note: 'workbook documents no request body',
});

export const allReportMsgApi = defineKatchupEndpoint({
  id: 'katchup-all-report-msg',
  requirements: ['FR-K24'],
  method: 'GET',
  path: '/v2/katchup/getAllReportMsg',
  summary: 'Messages the caller has reported',
  tags: [...READ_TAGS, 'report'],
  // A GET that reads our own reports. Named a write by its verb, but it fetches — safe.
  productionSafe: true,
});

/*
 * ## Reads keyed by a message id — blocked on live until a lifecycle test creates one
 *
 * These need a real `msgID`/`sharedMessageId` that exists and is ours. On live we have no such id
 * until the send lifecycle has run, and a fabricated id would either 404 (useless) or, worse, name
 * somebody else's message (the guard refuses it). They stay registered so coverage counts them and
 * they run the moment a real id is available. `needs-message-id` marks them.
 */
export const readStatusGroupApi = defineKatchupEndpoint({
  id: 'katchup-read-status-group',
  requirements: ['FR-K07'],
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
  request: body(() => ({ sharedMessageId: 0 })),
  note: 'needs a real sharedMessageId',
});

export const bulkMessageInfoApi = defineKatchupEndpoint({
  id: 'katchup-bulk-message-info',
  method: 'POST',
  path: '/v2/katchup/getBulkMessageInfo/',
  summary: 'Details of a bulk/broadcast message',
  tags: [...READ_TAGS, 'share', 'needs-message-id'],
  request: body(() => ({ sharedMessageId: 0 })),
  note: 'needs a real bulk message id',
});

export const sharedMessageDetailsApi = defineKatchupEndpoint({
  id: 'katchup-shared-message-details',
  method: 'GET',
  path: '/v2/katchup/getSharedMessageDetails/{msgID}',
  summary: 'A shared message by id',
  tags: [...READ_TAGS, 'share', 'needs-message-id'],
  request: pathParams(() => ({ msgID: 0 })),
  note: 'needs a real msgID',
});

export const referenceDetailsApi = defineKatchupEndpoint({
  id: 'katchup-reference-details',
  method: 'POST',
  path: '/v2/katchup/getReferenceMSGDetails/',
  summary: 'Details of the messages a thread references',
  tags: [...READ_TAGS, 'thread', 'needs-message-id'],
  request: body(() => ({ referenceMessageIDList: [], sourceMsgID: 0 })),
  note: 'needs real reference message ids',
});

export const messagesByReferenceApi = defineKatchupEndpoint({
  id: 'katchup-messages-by-reference',
  method: 'POST',
  path: '/v2/katchup/getMessagesByReferenceMessageList',
  summary: 'Messages named by a reference list',
  tags: [...READ_TAGS, 'thread', 'needs-message-id'],
  request: body(() => ({ referenceMessageList: '[]' })),
  note: 'needs a real reference message list',
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
  messagesByReferenceApi,
];
