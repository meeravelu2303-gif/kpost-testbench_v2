import { testData } from '@config/test-data.config';
import { body, pathParams } from '../kpost-endpoint';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup **reads** — fetch without writing a message.
 *
 * Counts and subjects need only our own account; conversation reads use `QA_VICTIM_KPOST_ID` (our
 * second account), so no stranger's id is ever sent — these run on live. Id-keyed share/reference
 * reads need a real message id we lack on live, so they stay registered and blocked until a
 * lifecycle test creates one (`docs/katchup-flow.md` §5).
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
  path: '/v2/katchup/getKatchupMessagesSubject',
  summary: "Subjects of the caller's Katchup conversations",
  tags: [...READ_TAGS, 'subject', 'needs-id'],
  // On testingapi this route answers 404 "No matching endpoint for this request" — the gateway does
  // not route it on this build. Not run standalone (a 404 would read as a false CRITICAL); confirm
  // with the dev whether it is deployed on the test env. The Subject differentiator (BR-K01) is
  // otherwise proven by the Katchup feature flow.
  destructive: false,
  note: 'testingapi answers 404 "No matching endpoint" — confirm the route is deployed on the test build',
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
  // A POST read: destructive defaults true for POST, which would grep-drop it on live.
  destructive: false,
  method: 'POST',
  path: '/v2/katchup/messageCountBetweenSenderAndReceiver/',
  summary: 'How many messages exist between the caller and a contact',
  tags: [...READ_TAGS, 'conversation'],
  productionSafe: true,
  request: body(() => ({ receiver: testData.victimKpostId, groupFlag: 'false' })),
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
  /*
   * The API rejects an empty body with 400 "Malformed or missing request body" — it needs a filter
   * context. Sends the same {selectedContact, groupFlag} shape the conversation reads use (our own
   * second account), so it filters our own messages and owns nothing.
   */
  productionSafe: true,
  request: body(() => ({ selectedContact: testData.victimKpostId, groupFlag: false })),
  note: 'needs a filter body (empty body 400s "Malformed or missing request body")',
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

/*
 * Reads keyed by a real `msgID`/`sharedMessageId` we own. Blocked on live until a lifecycle test
 * creates one — a fabricated id would 404 or name a stranger's message. Tagged `needs-message-id`.
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
