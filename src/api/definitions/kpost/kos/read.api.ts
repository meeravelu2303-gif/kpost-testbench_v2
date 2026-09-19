import { testData } from '@config/test-data.config';
import { pathParams } from '../kpost-endpoint';
import { defineKosEndpoint } from './kos-endpoint';

/**
 * KOS **reads** — the caller's KWord document list and K-AI sessions run on live; the reads keyed by
 * a real `docId` / `sessionId` (document detail, presence, access activity, revisions, AI messages)
 * need an id only a create/session produces, so they stay blocked (`needs-doc-id`) and are exercised
 * by the lifecycle.
 */
const READ_TAGS = ['kos-read'] as const;

export const listDocumentsApi = defineKosEndpoint({
  id: 'kos-list-documents',
  method: 'GET',
  path: '/kword/documents/',
  summary: "The caller's KWord documents",
  tags: [...READ_TAGS, 'kword', 'needs-id'],
  // testingapi answers 404 "No matching endpoint for this request" — the KWord route is not deployed
  // on the test build. Not run standalone (a 404 reads as a false CRITICAL); confirm with the dev.
  note: 'testingapi 404 "No matching endpoint" — KWord route not deployed on the test build',
});

export const aiSessionsApi = defineKosEndpoint({
  id: 'kos-ai-sessions',
  method: 'GET',
  path: '/ai/sessions',
  summary: "The caller's K-AI session history",
  tags: [...READ_TAGS, 'ai'],
  // Reads our own AI session list. The client passes the model as `/ai/sessions/{aiType}`; the
  // workbook documents `/ai/sessions`, so a query carries the model without changing the contract row.
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
  aiSessionsApi,
  getDocumentApi,
  presenceApi,
  accessActivityApi,
  revisionsApi,
  aiMessagesApi,
];
