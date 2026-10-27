import { testData } from '@config/test-data.config';
import { pathParams } from '../kpost-endpoint';
import { defineKosEndpoint, defineUndocumentedKosEndpoint } from './kos-endpoint';

/**
 * KOS reads: the document list and AI sessions run on live; reads keyed by a real
 * `docId`/`sessionId` are lifecycle-only.
 */
const READ_TAGS = ['kos-read'] as const;

export const listDocumentsApi = defineKosEndpoint({
  id: 'kos-list-documents',
  method: 'GET',
  path: '/kword/documents/',
  summary:
    "The caller's KWord documents (workbook-documented path — confirmed not the real one, see kos-documents-type)",
  tags: [...READ_TAGS, 'kword', 'needs-id'],
  note: 'testingapi 404 "No matching endpoint" — AND confirmed zero frontend callers of this exact path; the real list call is kos-documents-type',
});

/**
 * Not in the workbook: the client's real KWord document list (KOS.js:235-263), always called with
 * no query string.
 */
export const documentsTypeApi = defineUndocumentedKosEndpoint({
  id: 'kos-documents-type',
  method: 'GET',
  path: '/kword/documentsType',
  summary: "The caller's KWord documents (the real list call, confirmed no query param)",
  tags: [...READ_TAGS, 'kword'],
  evidence:
    'KOS.js:235-263 (GetAllKWordDocs); callers KWord.js:2375,2747 — always called with no args',
  productionSafe: true,
});

export const aiSessionsApi = defineKosEndpoint({
  id: 'kos-ai-sessions',
  method: 'GET',
  path: '/ai/sessions',
  summary: "The caller's K-AI session history",
  tags: [...READ_TAGS, 'ai'],
  // Our own AI sessions; a query carries the model so the request matches the workbook's
  // `/ai/sessions` row.
  productionSafe: true,
  request: () => ({ query: { aiType: 'general' } }),
});

export const getDocumentApi = defineKosEndpoint({
  id: 'kos-get-document',
  method: 'GET',
  path: '/kword/documents/{docId}',
  summary: 'A KWord document by id',
  tags: [...READ_TAGS, 'kword', 'needs-doc-id'],
  request: pathParams(() => ({ docId: testData.kpostIdAbsent })),
  note: 'needs a real docId from create',
});

export const presenceApi = defineKosEndpoint({
  id: 'kos-presence',
  method: 'GET',
  path: '/kword/presence/{docId}',
  summary: 'Who is present in a KWord document',
  tags: [...READ_TAGS, 'kword', 'needs-doc-id'],
  request: pathParams(() => ({ docId: testData.kpostIdAbsent })),
  note: 'needs a real docId',
});

export const accessActivityApi = defineKosEndpoint({
  id: 'kos-access-activity',
  method: 'GET',
  path: '/kword/getAccessActivity/{docId}',
  summary: 'Access activity for a KWord document',
  tags: [...READ_TAGS, 'kword', 'needs-doc-id'],
  request: pathParams(() => ({ docId: testData.kpostIdAbsent })),
  note: 'needs a real docId',
});

export const revisionsApi = defineKosEndpoint({
  id: 'kos-revisions',
  method: 'GET',
  path: '/kword/getAllRevision/{docId}',
  summary: 'Revision history for a KWord document',
  tags: [...READ_TAGS, 'kword', 'needs-doc-id'],
  request: pathParams(() => ({ docId: testData.kpostIdAbsent })),
  note: 'needs a real docId',
});

export const aiMessagesApi = defineKosEndpoint({
  id: 'kos-ai-messages',
  method: 'GET',
  path: '/ai/messages/{sessionId}',
  contractPath: '/ai/messages/1',
  summary: 'Messages in a K-AI session',
  tags: [...READ_TAGS, 'ai', 'needs-doc-id'],
  request: pathParams(() => ({ sessionId: '1' })),
  note: 'needs a real AI sessionId',
});

export const kosReadApis = [
  listDocumentsApi,
  documentsTypeApi,
  aiSessionsApi,
  getDocumentApi,
  presenceApi,
  accessActivityApi,
  revisionsApi,
  aiMessagesApi,
];
