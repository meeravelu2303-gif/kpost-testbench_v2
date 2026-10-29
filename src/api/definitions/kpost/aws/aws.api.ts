import { pathParamSchema, typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineUndocumentedKpostEndpoint, pathParams } from '../kpost-endpoint';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';

/**
 * AWS (`/v2/aws/*`): presigned-URL generators take only file metadata and run on live; check and
 * delete need a real `uuid`, so the gated AWS_LIFECYCLE flow drives them.
 */
function defineAwsEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['aws', ...(config.tags ?? [])],
  });
}

const fileMeta = () => ({ extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' });

// Types-only, from a captured live body (the workbook documents no response).
const presignedResponse = () =>
  typesOnlySchema({ presignedURL: '', urlPath: '', status: 'SUCCESS', statusCode: 200 });

export const generatePresignedApi = defineAwsEndpoint({
  id: 'aws-generate-presigned',
  method: 'POST',
  path: '/v2/aws/generate-presigned-url',
  summary: 'Generate an S3 presigned upload URL',
  tags: ['presign'],
  // Generates a signed URL from file metadata — no persistent write, no identifier. Runs on live.
  destructive: false,
  productionSafe: true,
  request: body(fileMeta),
  responseSchema: presignedResponse(),
});

export const katchupPresignedApi = defineAwsEndpoint({
  id: 'aws-katchup-presigned',
  method: 'POST',
  path: '/v2/aws/katchup/generate-presigned-url',
  summary: 'Generate an S3 presigned upload URL for a Katchup attachment',
  tags: ['presign', 'katchup'],
  destructive: false,
  productionSafe: true,
  request: body(fileMeta),
  responseSchema: presignedResponse(),
});

export const checkAttachmentApi = defineAwsEndpoint({
  id: 'aws-check-attachment',
  method: 'POST',
  path: '/v2/aws/checkAttachmentS3/',
  summary: 'Check whether attachments exist in S3',
  tags: ['attachment'],
  // A read. An empty array 400s, so it sends one known-absent uuid, which answers "does not exist".
  destructive: false,
  productionSafe: true,
  request: body(() => ({ attachmentsUuid: ['qa-nonexistent-attachment-0000'] })),
});

export const deleteAttachmentApi = defineAwsEndpoint({
  id: 'aws-delete-attachment',
  method: 'GET',
  path: '/v2/aws/deleteAttachmentFromS3/{uuid}',
  summary: 'Delete an attachment from S3',
  tags: ['attachment', 'needs-attachment'],
  destructive: true,
  request: pathParams(() => ({ uuid: '' })),
  pathParamsSchema: pathParamSchema('uuid'),
  note: 'a GET that deletes; needs a real owned uuid',
});

export const checkAttachmentGetApi = defineUndocumentedKpostEndpoint({
  id: 'aws-check-attachment-get',
  authentication: { required: true },
  method: 'GET',
  path: '/v2/aws/checkAttachmenS3/{uuid}',
  summary:
    'Whether an uploaded KMail attachment reached S3 (GET form; the path is spelt "Attachmen")',
  tags: ['aws', 'needs-attachment'],
  // Needs a uuid the caller presigned: the AWS lifecycle asks it right after its own presign.
  request: pathParams(() => ({ uuid: '00000000-0000-4000-8000-000000000000' })),
  pathParamsSchema: pathParamSchema('uuid'),
  // 417 = presigned but nothing uploaded yet (the 0-byte placeholder): the honest answer straight after a presign.
  expectedStatus: [200, 417],
  evidence:
    'PresignedURLController.java:197-235 (200 uploaded, 406 not the caller’s uuid, 417 placeholder only, ' +
    '404 no object); the POST form is aws-check-attachment',
  note: 'no response carries statusCode, and the catch-all 500 has an empty {} body — verify before filing',
});

export const awsApis = [
  generatePresignedApi,
  katchupPresignedApi,
  checkAttachmentApi,
  deleteAttachmentApi,
  checkAttachmentGetApi,
];
