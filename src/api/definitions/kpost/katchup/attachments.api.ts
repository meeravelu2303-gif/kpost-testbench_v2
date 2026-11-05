import { pathParamSchema, typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineUndocumentedKpostEndpoint, pathParams } from '../kpost-endpoint';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup attachment endpoints, keyed by a real attachment `uuid` (live tests in
 * katchup-attachment-upload-e2e.spec.ts). Downloads are binary, so `envelope: false`.
 */
const ATTACH_TAGS = ['katchup-attachment', 'binary', 'needs-attachment'] as const;

/** A uuid that names nothing — the "not found" path, and a value the guard cannot mistake for a resource. */
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

export const downloadApi = defineKatchupEndpoint({
  id: 'katchup-download',
  requirements: ['FR-KU-016'],
  method: 'GET',
  path: '/v2/katchup/download/{uuid}',
  summary: 'Download a message attachment',
  tags: [...ATTACH_TAGS],
  envelope: false,
  // Each file in its own stored type (S3 metadata): text/plain for a .txt, live 2026-11-05.
  contentType: '*/*',
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  pathParamsSchema: pathParamSchema('uuid'),
  note: 'bytes and Content-Type correct (#617, the fixed image/jpeg, is fixed; live 2026-11-05)',
});

export const downloadAttachmentApi = defineKatchupEndpoint({
  id: 'katchup-download-attachment',
  requirements: ['FR-KU-016'],
  method: 'GET',
  path: '/v2/katchup/downloadAttachment/{uuid}',
  summary: 'Download an attachment (alternate route)',
  tags: [...ATTACH_TAGS],
  envelope: false,
  // JSON: the presigned URL, file name and type (source contract, matched live 2026-11-05).
  contentType: 'application/json',
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  pathParamsSchema: pathParamSchema('uuid'),
  note: 'metadata correct, ASCII filename fallback hardcoded to "file.xlsx" — see #618',
});

export const downloadFromS3Api = defineKatchupEndpoint({
  id: 'katchup-download-from-s3',
  requirements: ['FR-KU-016'],
  method: 'GET',
  path: '/v2/katchup/downloadFromS3/{uuid}',
  summary: 'Download an attachment stored in S3',
  tags: [...ATTACH_TAGS],
  envelope: false,
  // JSON: the plain S3 URL under data (source contract, matched live 2026-11-05).
  contentType: 'application/json',
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  pathParamsSchema: pathParamSchema('uuid'),
  note: 'confirmed working live 2026-09-26 with a real attachment uuid',
});

export const downloadThumbnailApi = defineKatchupEndpoint({
  id: 'katchup-download-thumbnail',
  method: 'GET',
  path: '/v2/katchup/downloadThumbnail/{uuid}',
  summary: 'Download an attachment thumbnail',
  tags: [...ATTACH_TAGS],
  envelope: false,
  // Documented JPEG (<uuid>_thn.jpg); the PNG icon served for a non-image file is #13477.
  contentType: 'image/jpeg',
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  pathParamsSchema: pathParamSchema('uuid'),
  note: 'confirmed reachable live 2026-09-26 with a real attachment uuid',
});

export const mediaStreamingApi = defineKatchupEndpoint({
  id: 'katchup-media-streaming',
  method: 'GET',
  path: '/v2/katchup/mediaStreaming/{uuid}',
  summary: 'Stream an audio/video attachment',
  tags: [...ATTACH_TAGS, 'streaming'],
  envelope: false,
  contentType: 'application/octet-stream',
  // Its success is a 303 to a presigned S3 URL (KatchupControllerV2 mediaStreaming; live 2026-11-05).
  expectedStatus: [303],
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  pathParamsSchema: pathParamSchema('uuid'),
  note: 'confirmed reachable live 2026-09-26 with a real attachment uuid (303 redirect)',
});

export const generateThumbnailApi = defineKatchupEndpoint({
  id: 'katchup-generate-thumbnail',
  method: 'POST',
  path: '/v2/katchup/generateThumbnailUsingUUID',
  summary: 'Generate thumbnails for attachment uuids',
  tags: [...ATTACH_TAGS],
  // A write (it generates and stores thumbnails), keyed by real uuids.
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ uuid: [] })),
  note: 'confirmed working live 2026-09-26 with a real attachment uuid',
});

export const oldDownloadApi = defineUndocumentedKpostEndpoint({
  id: 'katchup-old-download',
  authentication: { required: true },
  method: 'GET',
  path: '/v2/katchup/oldDownload/{uuid}',
  summary: 'Download an attachment by uuid (the older inline-download route)',
  tags: ['katchup', ...ATTACH_TAGS],
  envelope: false,
  // Each file in its own stored type, as katchup-download (live 2026-11-05).
  contentType: '*/*',
  // A real uuid comes from katchup-attachment-upload-e2e.spec.ts; standalone it is the not-found path.
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  pathParamsSchema: pathParamSchema('uuid'),
  evidence:
    'KatchupControllerV2.java:1037 downloadFile; KatchupServiceImpl.java:1404-1425 serves it only to ' +
    'the sender, receiver or a group member of a visible message (else 404 "Attachment not found")',
});

export const uploadMultipartFilesApi = defineUndocumentedKpostEndpoint({
  id: 'katchup-upload-multipart-files',
  authentication: { required: true },
  method: 'POST',
  path: '/v2/katchup/uploadMultipartFiles/',
  summary: 'Upload files for a Katchup message (multipart)',
  tags: ['katchup', 'katchup-attachment'],
  // Each call leaves a TBL_KPOST_KATCHUP_ATTACHMENT row nothing can delete (CLAUDE.md §5 rule 8).
  destructive: true,
  sideEffect: 'global',
  evidence: 'KatchupControllerV2.java:851 uploadMultipartFileAWS (files[] multipart)',
  note:
    'never driven: every call leaves an undeletable attachment row, and the S3 upload is commented ' +
    'out, so it reports success without storing the file (KatchupServiceImpl.java:1346-1363) — a ' +
    'defect candidate to verify live; no client calls it',
});

export const voiceTranslateApi = defineUndocumentedKpostEndpoint({
  id: 'katchup-voice-translate',
  authentication: { required: true },
  method: 'POST',
  path: '/v2/voice/translate',
  summary: 'Transcribe a voice-message attachment to text (calls OpenAI Whisper)',
  tags: ['katchup', 'katchup-attachment', 'voice', 'security'],
  // Every call is a paid OpenAI request, so never driven without the owner's go-ahead.
  destructive: true,
  sideEffect: 'external',
  request: body(() => ({ uuid: ABSENT_UUID })),
  requestSchema: typesOnlySchema({ uuid: ABSENT_UUID }),
  evidence:
    'VoiceController.java:34 translateVoice → SpeechServiceImpl.java:23-49 (api.openai.com whisper-1); ' +
    'React VoiceMessagePlayer.js:261 and KatchupMessage.js:3815,5958 (hardcoded to the live devapi2 host)',
  note:
    'blocked: a paid external call per request; also a defect candidate — the handler never checks the ' +
    'caller, so any user can transcribe anyone’s attachment by uuid (verify live with an owner control)',
});

export const katchupAttachmentApis = [
  voiceTranslateApi,
  oldDownloadApi,
  uploadMultipartFilesApi,
  downloadApi,
  downloadAttachmentApi,
  downloadFromS3Api,
  downloadThumbnailApi,
  mediaStreamingApi,
  generateThumbnailApi,
];
