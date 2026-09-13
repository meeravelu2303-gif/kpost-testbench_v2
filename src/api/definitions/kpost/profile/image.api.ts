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

const imageUpload = (path: string, id: string, summary: string, field = 'file') =>
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
          name: 'qa-bench.png',
          mimeType: 'image/png',
          buffer: Buffer.from(PNG_1X1, 'base64'),
        },
        text: JSON.stringify({ kpostID: testData.kpostId }),
      },
    }),
  });

export const updateProfileImageApi = imageUpload(
  '/v2/profile/updateProfileImage/',
  'profile-update-image',
  "Update the caller's profile image",
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
