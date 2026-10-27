import { z } from 'zod';
import { testData } from '@config/test-data.config';
import { body, pathParams } from '../kpost-endpoint';
import { defineKosEndpoint, defineUndocumentedKosEndpoint } from './kos-endpoint';

/**
 * KOS writes: KWord document CRUD and K-AI generation, on the caller's own documents. None is
 * `productionSafe`; the gated flow drives them. The two AI endpoints call a metered service.
 */
const WRITE_TAGS = ['kos-write'] as const;

export const createDocApi = defineKosEndpoint({
  id: 'kos-create-doc',
  method: 'POST',
  path: '/kword/create',
  summary: 'Create a KWord document (returns its docId)',
  tags: [...WRITE_TAGS, 'critical', 'kword'],
  destructive: true,
  request: body(() => ({
    titleOfDocument: 'QA Bench Doc',
    subject: 'QA bench',
    documentType: 'word',
    convertToKad: false,
    initiatedBy: testData.kpostId,
  })),
  note: 'payload from the live client (KWord.js); docId returned at data.id',
});

export const saveContentApi = defineKosEndpoint({
  id: 'kos-save-content',
  method: 'POST',
  path: '/kword/saveContent',
  summary: "Save a KWord document's content",
  tags: [...WRITE_TAGS, 'kword'],
  destructive: true,
  request: body(() => ({ docTitle: 'QA Bench Doc', compose: 'QA bench content', docId: 0 })),
  note: 'needs a real docId from create; exercised by the lifecycle',
});

export const updateDocApi = defineKosEndpoint({
  id: 'kos-update-doc',
  method: 'POST',
  path: '/kword/update',
  summary: "Update a KWord document's headings",
  tags: [...WRITE_TAGS, 'kword'],
  destructive: true,
  request: body(() => ({
    docId: 0,
    heading: [{ topic: 'Introduction', children: [] }],
  })),
  note: 'needs a real docId; exercised by the lifecycle',
});

export const deleteHeadingApi = defineKosEndpoint({
  id: 'kos-delete-heading',
  method: 'POST',
  path: '/kword/deleteHeading',
  summary: 'Delete a heading from a KWord document',
  tags: [...WRITE_TAGS, 'kword'],
  destructive: true,
  request: body(() => ({ docId: 0, headingId: 1 })),
  note: 'needs a real docId + headingId',
});

export const shareDocApi = defineKosEndpoint({
  id: 'kos-share-doc',
  method: 'POST',
  path: '/kword/share',
  summary: 'Share a KWord document with a contact',
  tags: [...WRITE_TAGS, 'kword', 'share'],
  // Shares with our own second account (kpostId checked by the guard). Needs a real docId.
  destructive: true,
  request: body(() => ({
    docId: 0,
    kWordDocshares: [
      { kpostId: testData.victimKpostId, role: 'editor', validUpto: Date.now() + 86_400_000 },
    ],
  })),
  note: 'needs a real docId; shared with our own account',
});

export const joinDocApi = defineKosEndpoint({
  id: 'kos-join-doc',
  method: 'POST',
  path: '/kword/joinDocument',
  summary: 'Join a KWord document (collaborative editing)',
  tags: [...WRITE_TAGS, 'kword'],
  destructive: true,
  request: body(() => ({
    docId: 0,
    kpostId: testData.kpostId,
    deviceInfo: { browser: 'Chrome', os: 'Windows', deviceType: 'desktop' },
  })),
  note: 'needs a real docId',
});

export const convertToKadApi = defineKosEndpoint({
  id: 'kos-convert-to-kad',
  method: 'POST',
  path: '/kword/isConvertToKad',
  summary: 'Mark a KWord document for conversion to KAD',
  tags: [...WRITE_TAGS, 'kword'],
  destructive: true,
  request: body(() => ({ docId: 0, convertToKad: true })),
  note: 'needs a real docId',
});

export const exitDocApi = defineKosEndpoint({
  id: 'kos-exit-doc',
  method: 'GET',
  path: '/kword/exitDocument/{docId}',
  summary: 'Exit a KWord document (leave the collaborative session)',
  tags: [...WRITE_TAGS, 'kword'],
  destructive: true,
  request: pathParams(() => ({ docId: testData.kpostIdAbsent })),
  note: 'needs a real docId; a GET that changes presence state',
});

export const deleteDocApi = defineKosEndpoint({
  id: 'kos-delete-doc',
  method: 'GET',
  path: '/kword/delete',
  contractPath: '/kword/delete?docId={docId}',
  summary: 'Delete a KWord document',
  tags: [...WRITE_TAGS, 'critical', 'kword'],
  destructive: true,
  request: () => ({ query: { docId: '' } }),
  // The real client sends POST /kword/delete with a JSON {docId}; this GET+query form is the
  // workbook's. Which one the backend honours is not yet verified live.
  note: 'a GET with a docId query param; needs a real docId — see docs/generated/blocked-endpoints.md for a GET-vs-POST discrepancy found 2026-10-02, not yet resolved',
});

/** Not in the workbook: changes a collaborator's role on a shared document (KADDocument.js:710). */
export const changeDocumentAccessApi = defineUndocumentedKosEndpoint({
  id: 'kos-change-document-access',
  method: 'POST',
  path: '/kword/changeDocumentAccess',
  summary: "Change a collaborator's access role on a KWord document",
  tags: [...WRITE_TAGS, 'kword', 'share'],
  evidence: 'KOS.js:325-356 (ChangeDocumentAccess); caller KADDocument.js:710',
  destructive: true,
  requestSchema: z.object({ docId: z.number(), kpostId: z.string(), role: z.string() }),
  request: body(() => ({ docId: 0, kpostId: testData.victimKpostId, role: 'editor' })),
  note: 'needs a real docId; exercised by the lifecycle, shared with our own second account',
});

/**
 * Not in the workbook: links a converted PDF's job id to a KWord document (KWord.js:3404, cleared
 * at :3444).
 */
export const updateJobIdApi = defineUndocumentedKosEndpoint({
  id: 'kos-update-job-id',
  method: 'POST',
  path: '/kword/updateJobId',
  summary: 'Link (or clear) a Docling conversion job id on a KWord document',
  tags: [...WRITE_TAGS, 'kword'],
  evidence:
    'KOS.js:207-233 (UpdateKWordJobId); callers KWord.js:3404 (set), :3444 (clear, jobId:null)',
  destructive: true,
  requestSchema: z.object({ docId: z.number(), jobId: z.string().nullable() }),
  request: body(() => ({ docId: 0, jobId: null })),
  note: 'needs a real docId; exercised by the lifecycle',
});

export const aiChatApi = defineKosEndpoint({
  id: 'kos-ai-chat',
  method: 'POST',
  path: '/ai/chatResponse',
  summary: 'Generate a K-AI chat response',
  tags: [...WRITE_TAGS, 'ai', 'metered'],
  // Calls a metered AI service, so only the `KOS_AI_LIVE`-gated test drives it. Payload from
  // KAI.js.
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ prompt: 'Hello from the QA bench.', aiType: 'general' })),
  note: 'metered AI call — gated behind KOS_AI_LIVE',
});

export const aiMessageAssistApi = defineKosEndpoint({
  id: 'kos-ai-assist',
  method: 'POST',
  path: '/ai/messageAssist',
  summary: 'K-AI message assist',
  tags: [...WRITE_TAGS, 'ai', 'metered'],
  destructive: true,
  sideEffect: 'data',
  // The live client's shape (AI_Common.js); `{prompt, aiType}` is chatResponse's, not this one's.
  request: body(() => ({
    message: 'QA bench conversation context.',
    prompt: 'Reply politely.',
    requestType: 'REPLY',
  })),
  note: 'live-client payload {message, prompt, requestType}; metered AI — gated behind KOS_AI_LIVE',
});

export const kosWriteApis = [
  createDocApi,
  saveContentApi,
  updateDocApi,
  deleteHeadingApi,
  shareDocApi,
  joinDocApi,
  convertToKadApi,
  exitDocApi,
  deleteDocApi,
  changeDocumentAccessApi,
  updateJobIdApi,
  aiChatApi,
  aiMessageAssistApi,
];
