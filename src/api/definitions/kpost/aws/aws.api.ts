import { body, pathParams } from '../kpost-endpoint';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';

/**
 * The KPost **AWS** module — S3 presigned URLs and attachment lifecycle. `/v2/aws/*`.
 *
 * The presigned-URL generators take only harmless file metadata (`extension`/`fileName`/`fileSize`),
 * write nothing persistent and name no one, so they run on live as read-shaped generators. The check
 * and delete are keyed by a real `uuid` the generator mints, so they run through the gated feature
 * flow (`AWS_LIFECYCLE=true`). Payloads from the workbook + live client (`Services/Katchup.js`).
 */
function defineAwsEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['aws', ...(config.tags ?? [])],
  });
}

const fileMeta = () => ({ extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' });

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
});

export const checkAttachmentApi = defineAwsEndpoint({
  id: 'aws-check-attachment',
  method: 'POST',
  path: '/v2/aws/checkAttachmentS3/',
  summary: 'Check whether attachments exist in S3',
  tags: ['attachment'],
  // A read; the default empty `attachmentsUuid` names nothing, so it runs on live harmlessly. (A
  // check against a real uuid would need a write-authorized call, which the guard reserves for
  // destructive endpoints — this endpoint is a read.)
  destructive: false,
  productionSafe: true,
  request: body(() => ({ attachmentsUuid: [] as string[] })),
});

export const deleteAttachmentApi = defineAwsEndpoint({
  id: 'aws-delete-attachment',
  method: 'GET',
  path: '/v2/aws/deleteAttachmentFromS3/{uuid}',
  summary: 'Delete an attachment from S3',
  tags: ['attachment', 'needs-attachment'],
  destructive: true,
  request: pathParams(() => ({ uuid: '' })),
  note: 'a GET that deletes; needs a real owned uuid',
});

export const awsApis = [
  generatePresignedApi,
  katchupPresignedApi,
  checkAttachmentApi,
  deleteAttachmentApi,
];
