import { body, pathParams } from '../kpost-endpoint';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup **attachment** endpoints — download, thumbnail, streaming, and thumbnail generation.
 *
 * Every one is keyed by a `uuid` that must belong to a real attachment on a message the caller can
 * see. On live we have none until an attachment has been sent, so these are `needs-attachment` and
 * blocked — registered so coverage counts them and they run once the send lifecycle has produced a
 * uuid. The downloads return binary, not the JSON envelope, so `envelope: false` keeps the
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
  note: 'needs a real attachment uuid',
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
  note: 'needs a real attachment uuid',
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
  note: 'needs a real attachment uuid',
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
  note: 'needs a real attachment uuid',
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
  note: 'needs a real media attachment uuid',
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
  note: 'needs real attachment uuids',
});

export const katchupAttachmentApis = [
  downloadApi,
  downloadAttachmentApi,
  downloadFromS3Api,
  downloadThumbnailApi,
  mediaStreamingApi,
  generateThumbnailApi,
];
