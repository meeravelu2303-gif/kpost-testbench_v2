import { env } from '@config/env';

/**
 * Every upload the bench makes ends up in the LIVE AWS S3 bucket, even from the QA backend (owner,
 * 2026-10-31: "we are using the live aws s3 bucket storage so that only we should test limited
 * size files"). So no file larger than `UPLOAD_MAX_BYTES` is ever sent: the API client, the direct
 * presigned PUTs and the browser all check here. A size-limit rule is proven without a big file
 * (stubbed in the browser, or read from the source), never by uploading one.
 */
export function uploadRefusal(bytes: number, where: string): string | undefined {
  return bytes > env.UPLOAD_MAX_BYTES
    ? `upload of ${bytes} bytes to ${where} refused: files sent to live S3 are capped at ` +
        `${env.UPLOAD_MAX_BYTES} bytes (UPLOAD_MAX_BYTES)`
    : undefined;
}

/** Throws (a bench fault, never a product bug) when a file is over the cap. */
export function assertUploadAllowed(bytes: number, where: string): void {
  const refusal = uploadRefusal(bytes, where);
  if (refusal) throw new Error(refusal);
}

/** Total bytes of the file parts of a multipart body (text fields count too: they travel with it). */
export function multipartBytes(
  parts: Record<string, string | { buffer: Buffer }> | undefined,
): number {
  if (!parts) return 0;
  return Object.values(parts).reduce(
    (sum, part) => sum + (typeof part === 'string' ? Buffer.byteLength(part) : part.buffer.length),
    0,
  );
}
