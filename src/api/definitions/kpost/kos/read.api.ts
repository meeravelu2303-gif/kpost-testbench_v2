import { testData } from '@config/test-data.config';
import { pathParams } from '../kpost-endpoint';
import { defineKosEndpoint, defineUndocumentedKosEndpoint } from './kos-endpoint';

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
  summary: "The caller's KWord documents (workbook-documented path — confirmed not the real one, see kos-documents-type)",
  tags: [...READ_TAGS, 'kword', 'needs-id'],
  // testingapi answers 404 "No matching endpoint for this request" — the KWord route is not deployed
  // on the test build. CONFIRMED 2026-10-02 via frontend trace: this path has no caller anywhere in
  // the real client at all — GetAllKWordDocs (KOS.js:235-263) calls /kword/documentsType instead
  // (see kos-documents-type below). The 404 may simply be this exact path never having been real.
  note: 'testingapi 404 "No matching endpoint" — AND confirmed zero frontend callers of this exact path; the real list call is kos-documents-type',
});

/**
 * **UNDOCUMENTED IN THE WORKBOOK** — found via the 2026-10-02 frontend-integration trace. This is
 * the function the real client actually uses to list KWord documents (`listDocumentsApi` above,
 * `/kword/documents/`, is the workbook's documented-but-dead path). Real callers:
 * `KOS.js:235-263` (`GetAllKWordDocs(type)`, an OPTIONAL query param — `?type=` only appends when
 * truthy), used at `KWord.js:2375,2747` and in KPresenter, **always called with no argument at all**
 * in both real call sites — so the confirmed-real shape is no query string whatsoever, not a guessed
 * `type` value.
 */
export const documentsTypeApi = defineUndocumentedKosEndpoint({
  id: 'kos-documents-type',
  method: 'GET',
  path: '/kword/documentsType',
  summary: "The caller's KWord documents (the real list call, confirmed no query param)",
  tags: [...READ_TAGS, 'kword'],
  evidence: 'KOS.js:235-263 (GetAllKWordDocs); callers KWord.js:2375,2747 — always called with no args',
  productionSafe: true,
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
  documentsTypeApi,
  aiSessionsApi,
  getDocumentApi,
  presenceApi,
  accessActivityApi,
  revisionsApi,
  aiMessagesApi,
];
