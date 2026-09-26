import { body, pathParams } from '../kpost-endpoint';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup **attachment** endpoints — download, thumbnail, streaming, and thumbnail generation.
 *
 * Every one is keyed by a `uuid` that must belong to a real attachment on a message the caller can
 * see. Unblocked 2026-09-26: the real, current production upload flow (owner-confirmed) is a
 * presigned S3 URL (`aws-katchup-presigned`) + a direct S3 PUT + an ordinary `katchup-send-message`
 * whose `uuid` array names the upload — NOT the legacy `katchup-send-multipart` route. See
 * `presigned-attachment-workflow.spec.ts` for the live tests and two confirmed defects found this
 * way (`katchup-download`'s wrong Content-Type, `katchup-download-attachment`'s hardcoded filename
 * fallback). The downloads return binary, not the JSON envelope, so `envelope: false` keeps the
 * JSON-shaped checks off while status, headers, security and auth still apply.
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
  contentType: 'application/octet-stream',
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  // Live-verified 2026-09-26: serves the exact uploaded bytes, but Content-Type is hardcoded to
  // image/jpeg regardless of the real file type. Filed as #617 [KP-CBBC90], HIGH, KPost API.
  note: 'bytes correct, Content-Type wrong (hardcoded image/jpeg) — see #617',
});

export const downloadAttachmentApi = defineKatchupEndpoint({
  id: 'katchup-download-attachment',
  requirements: ['FR-KU-016'],
  method: 'GET',
  path: '/v2/katchup/downloadAttachment/{uuid}',
  summary: 'Download an attachment (alternate route)',
  tags: [...ATTACH_TAGS],
  envelope: false,
  contentType: 'application/octet-stream',
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  // Live-verified 2026-09-26: the JSON metadata's real fileName is correct, but the presigned GET
  // URL's Content-Disposition ASCII filename fallback is hardcoded to "file.xlsx" for every
  // attachment. Filed as #618 [KP-2CAEB3], HIGH, KPost API.
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
  contentType: 'application/octet-stream',
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  // Live-verified 2026-09-26: confirmed working — resolves to a real S3 URL naming the same uuid.
  note: 'confirmed working live 2026-09-26 with a real attachment uuid',
});

export const downloadThumbnailApi = defineKatchupEndpoint({
  id: 'katchup-download-thumbnail',
  method: 'GET',
  path: '/v2/katchup/downloadThumbnail/{uuid}',
  summary: 'Download an attachment thumbnail',
  tags: [...ATTACH_TAGS],
  envelope: false,
  contentType: 'image/png',
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  // Live-verified 2026-09-26: reachable, does not crash for a real attachment uuid.
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
  request: pathParams(() => ({ uuid: ABSENT_UUID })),
  // Live-verified 2026-09-26: answers 303 (redirect to the real media URL) for a real, non-media
  // attachment uuid — reachable, not a crash.
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
  // Live-verified 2026-09-26: confirmed working (200) for a real attachment uuid.
  note: 'confirmed working live 2026-09-26 with a real attachment uuid',
});

export const katchupAttachmentApis = [
  downloadApi,
  downloadAttachmentApi,
  downloadFromS3Api,
  downloadThumbnailApi,
  mediaStreamingApi,
  generateThumbnailApi,
];
