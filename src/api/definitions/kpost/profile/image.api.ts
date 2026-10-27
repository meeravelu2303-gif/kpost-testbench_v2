import { testData } from '@config/test-data.config';
import { body } from '../kpost-endpoint';
import { defineProfileEndpoint } from './profile-endpoint';

/**
 * Profile image writes (picture, cover, signature, attachments): all `data`, on the caller's own
 * images. Downloads live in read.api.ts.
 */
const IMG_TAGS = ['profile-image', 'image'] as const;

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC';

// A tiny valid JPEG: `updateProfileImage`/`updateSignatureImage` accept JPEG only, by design.
export const JPEG_1X1 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

/**
 * A JPEG padded to `targetBytes` with a COM segment after the SOI (decoders skip it, so it stays a
 * valid 1x1 image). The signature upload requires 10KB-50KB.
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
  // This route's multipart field is `files` (plural), unlike its siblings.
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
  // A ~25KB JPEG, inside the route's 10KB-50KB size rule.
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
