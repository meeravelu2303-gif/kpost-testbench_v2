import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { sha256, type SampleFile } from '@fixtures/files';
import { expect } from '@fixtures';

/**
 * The real client's upload flow: get a presigned S3 URL (Katchup or KMail route), PUT the bytes to
 * S3, then name the uuid in `attachmentUuid`. Remove every upload again with `deleteUploaded`.
 */
export type UploadRoute = 'katchup' | 'kmail';

const PRESIGN: Record<UploadRoute, string> = {
  katchup: 'aws-katchup-presigned',
  kmail: 'aws-generate-presigned',
};

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export interface Uploaded {
  uuid: string;
  /** The presigned PUT URL (signed query included — never log it whole). */
  url: string;
  fileName: string;
  bytes: Buffer;
  sha256: string;
  putStatus: number;
}

/** The presigned URL from a presign reply: a `{ presignedURL }` envelope or a bare (quoted) link. */
export function presignedUrlOf(bodyText: string): string {
  const raw = bodyText.trim();
  if (raw.startsWith('{')) {
    const parsed = JSON.parse(raw) as { presignedURL?: unknown };
    return typeof parsed.presignedURL === 'string' ? parsed.presignedURL : '';
  }
  return raw.replace(/^"|"$/g, '');
}

/** The object's URL without its signature — the address a public-read object answers on. */
export const unsignedUrlOf = (url: string): string => url.split('?')[0]!;

export const uuidOf = (url: string): string | undefined => UUID.exec(url)?.[1];

export interface UploadOptions {
  route: UploadRoute;
  /** The file name to declare (default: the sample's own). */
  name?: string;
  /** Declared size, when a test lies about it on purpose (default: the real byte length). */
  declaredSize?: number;
  /** Content-Type for the PUT (default: the sample's MIME type). */
  contentType?: string;
  /** Katchup voice note (`voiceMessage: true` → a `_voice` key). */
  voice?: boolean;
  label?: string;
}

/**
 * Presign → PUT, asserting both steps succeeded. Throws (via `expect`) if the presign is refused — use
 * `presign()` directly when a test expects a refusal.
 */
export async function uploadFile(
  endpoints: EndpointExecutor,
  as: Principal,
  file: SampleFile,
  options: UploadOptions,
): Promise<Uploaded> {
  const bytes = file.bytes();
  const fileName = options.name ?? file.fileName;
  const reply = await presign(endpoints, as, file, options);
  expect(reply.status, `${options.route} presign for ${fileName} succeeds`).toBeLessThan(300);
  const url = presignedUrlOf(reply.bodyText);
  const uuid = uuidOf(url);
  expect(uuid, 'the presigned URL names a uuid').toBeTruthy();
  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': options.contentType ?? file.mimeType },
    body: new Uint8Array(bytes),
  });
  expect(put.status, `the S3 upload of ${fileName} succeeds`).toBeLessThan(300);
  return { uuid: uuid!, url, fileName, bytes, sha256: sha256(bytes), putStatus: put.status };
}

/** Just the presign call — for tests that expect it to be refused (type, size, name rules). */
export async function presign(
  endpoints: EndpointExecutor,
  as: Principal,
  file: SampleFile,
  options: UploadOptions,
): Promise<{ status: number; bodyText: string }> {
  const fileName = options.name ?? file.fileName;
  const ex = await endpoints.sendTo(
    PRESIGN[options.route],
    {
      body: {
        extension: file.extension,
        fileName,
        fileSize: String(options.declaredSize ?? file.bytes().length),
        ...(options.route === 'katchup' && options.voice ? { voiceMessage: true } : {}),
      },
    },
    {
      label: options.label ?? `upload:${options.route}:presign`,
      auth: { principal: as },
      allowLiveWrite: true,
    },
  );
  return { status: ex.status, bodyText: ex.bodyText ?? '' };
}

/** Remove an uploaded object (owner-checked server side); never fails the test. */
export async function deleteUploaded(
  endpoints: EndpointExecutor,
  as: Principal,
  uuid: string | undefined,
  label = 'upload:cleanup',
): Promise<number | undefined> {
  if (!uuid) return undefined;
  const ex = await endpoints
    .sendTo(
      'aws-delete-attachment',
      { pathParams: { uuid } },
      { label, auth: { principal: as }, allowLiveWrite: true },
    )
    .catch(() => undefined);
  return ex?.status;
}
