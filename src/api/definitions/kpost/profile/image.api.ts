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

/**
 * A JPEG padded to `targetBytes` using a standard JPEG COM (comment, marker `0xFFFE`) segment right
 * after the SOI — every decoder skips COM segments, so the image itself is still the same valid 1x1
 * pixel, but the FILE size genuinely grows by the padding, unlike appending bytes after the JPEG's
 * own EOI marker (which some servers strip or reject as trailing garbage).
 *
 * Exists because `updateSignatureImage` answers 400 "Signature must be between 10KB and 50KB in
 * size" for the plain `JPEG_1X1` above — confirmed live 2026-09-30 this was a bench fixture problem
 * (a tiny fixture failing a real size floor), not a product defect: it produced a false CRITICAL
 * "expected 200, got 400" candidate before this fix.
 */
function paddedJpeg(targetBytes: number): string {
  const tiny = Buffer.from(JPEG_1X1, 'base64');
  const padLength = targetBytes - tiny.length - 4; // -4 for the COM marker + its 2-byte length field
  const comPayload = Buffer.alloc(padLength, 0x20);
  const comLengthField = comPayload.length + 2; // includes itself, excludes the 2-byte marker
  const comHeader = Buffer.from([0xff, 0xfe, (comLengthField >> 8) & 0xff, comLengthField & 0xff]);
  return Buffer.concat([tiny.subarray(0, 2), comHeader, comPayload, tiny.subarray(2)]).toString(
    'base64',
  );
}

/** ~25KB — comfortably inside the confirmed 10KB-50KB floor for `updateSignatureImage`. */
const JPEG_25KB = paddedJpeg(25 * 1024);

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
  'file',
  // Live-verified 2026-09-26: this route 500'd "API error" regardless of format (PNG or JPEG) —
  // tracked as #559 [KP-7D1F6B], CRITICAL. Re-verified 2026-09-30 (post-deployment): the 500 is
  // GONE — the tiny 1x1 fixture now gets a proper 400 "Signature must be between 10KB and 50KB in
  // size" instead, i.e. real, correct size validation. That suggests #559 may already be fixed;
  // switched to a properly-sized (~25KB) fixture here to find out whether a genuinely valid upload
  // now succeeds, rather than leaving this on a fixture that can never pass the real size floor.
  { name: 'qa-bench-signature.jpg', mimeType: 'image/jpeg', base64: JPEG_25KB },
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
