import { testData } from '@config/test-data.config';
import { body } from '../kpost-endpoint';
import { defineProfileEndpoint } from './profile-endpoint';

/**
 * Profile **image writes** — profile picture, cover image, signature, attachments.
 *
 * All `destructive` `data` (they change the caller's own images); downloads live in read.api.ts.
 * A 1x1 PNG is used for uploads — the smallest honest image. `convertBase64ToImage` is a transform
 * that also returns an image, so it runs on live as a read-shaped call (it converts a value we
 * supply and owns nothing), but it is kept `data` because it may persist to storage.
 */
const IMG_TAGS = ['profile-image', 'image'] as const;

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC';

/*
 * A tiny valid JPEG — `updateProfileImage`/`updateSignatureImage` (unlike their siblings) reject
 * the PNG above outright. Live-verified 2026-09-26: the exact same PNG bytes succeed on
 * `uploadCoverImage`/`uploadImageToS3` (200) but `updateProfileImage` answers 400 "File size should
 * be less than 500 KB or Invalid File Format" for both a 1x1 and a 10x10 PNG — so it is a real
 * format restriction on this specific pair of endpoints, not a size problem or a bench fixture
 * problem. JPEG is accepted (200) on `updateProfileImage`. See `feature.spec.ts` for the filed
 * finding (the PNG rejection itself is the tracked defect; this constant exists so the lifecycle
 * can still exercise the rest of the upload→download round trip while it's open).
 */
const JPEG_1X1 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

const imageUpload = (
  path: string,
  id: string,
  summary: string,
  field = 'file',
  image: { name: string; mimeType: string; base64: string } = {
    name: 'qa-bench.png',
    mimeType: 'image/png',
    base64: PNG_1X1,
  },
) =>
  defineProfileEndpoint({
    id,
    method: 'POST',
    path,
    summary,
    tags: [...IMG_TAGS, 'upload'],
    destructive: true,
    sideEffect: 'data',
    request: () => ({
      multipart: {
        [field]: {
          name: image.name,
          mimeType: image.mimeType,
          buffer: Buffer.from(image.base64, 'base64'),
        },
        text: JSON.stringify({ kpostID: testData.kpostId }),
      },
    }),
  });

export const updateProfileImageApi = imageUpload(
  '/v2/profile/updateProfileImage/',
  'profile-update-image',
  "Update the caller's profile image",
  'file',
  { name: 'qa-bench.jpg', mimeType: 'image/jpeg', base64: JPEG_1X1 },
);

export const uploadCoverImageApi = imageUpload(
  '/v2/profile/uploadCoverImage/',
  'profile-upload-cover',
  "Update the caller's cover image",
);

export const uploadAttachmentsApi = imageUpload(
  '/v2/profile/uploadProfileAttachments',
  'profile-upload-attachments',
  "Upload attachments to the caller's profile",
  // Live-verified 2026-09-26: this route's multipart field is `files` (plural), not the `file`
  // every sibling upload uses — sending `file` 400s "Required part 'files' is missing" every time,
  // so this write had never actually succeeded once in this bench's history.
  'files',
);

export const uploadImageToS3Api = imageUpload(
  '/v2/profile/uploadImageToS3',
  'profile-upload-image-s3',
  'Upload an image to S3',
);

export const updateSignatureImageApi = imageUpload(
  '/v2/profile/updateSignatureImage',
  'profile-update-signature',
  "Update the caller's signature image",
  // Live-verified 2026-09-26: this route 500s "API error" regardless of format (PNG or JPEG) —
  // already tracked as #559 [KP-7D1F6B], CRITICAL. Left on the standard PNG fixture since switching
  // format doesn't change the outcome.
);

export const removeProfileImageApi = defineProfileEndpoint({
  id: 'profile-remove-image',
  method: 'GET',
  path: '/v2/profile/removeProfileImage/',
  summary: "Remove the caller's profile image",
  tags: [...IMG_TAGS],
  destructive: true,
  sideEffect: 'data',
});

export const removeCoverImageApi = defineProfileEndpoint({
  id: 'profile-remove-cover',
  method: 'GET',
  path: '/v2/profile/removeCoverImage/',
  summary: "Remove the caller's cover image",
  tags: [...IMG_TAGS],
  destructive: true,
  sideEffect: 'data',
});

export const convertBase64Api = defineProfileEndpoint({
  id: 'profile-convert-base64',
  method: 'POST',
  path: '/v2/profile/convertBase64ToImage',
  summary: 'Convert a base64 string to an image',
  tags: [...IMG_TAGS, 'transform'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    base64String: `data:image/png;base64,${PNG_1X1}`,
    fileName: 'qa-bench.png',
  })),
});

export const profileImageApis = [
  updateProfileImageApi,
  uploadCoverImageApi,
  uploadAttachmentsApi,
  uploadImageToS3Api,
  updateSignatureImageApi,
  removeProfileImageApi,
  removeCoverImageApi,
  convertBase64Api,
];
