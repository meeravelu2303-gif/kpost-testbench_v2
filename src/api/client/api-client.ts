import { createHash } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import type { z } from 'zod';
import { assertUploadAllowed, multipartBytes } from '@engine/upload-guard';
import type { Logger } from '@utils/logger';
import type { ApiRequest, HttpMethod } from './request-builder';
import { ApiResponseWrapper } from './response-wrapper';

export type RequestOptions = Omit<NonNullable<Parameters<APIRequestContext['fetch']>[1]>, 'method'>;

/**
 * Thin wrapper over Playwright's request context.
 * - `execute()` is used by the validation engine: never throws on HTTP status or transport
 *   errors, measures duration and returns an `ApiResponseWrapper`.
 * - `get()/post()/.../json()` stay available for ad-hoc and integration tests.
 */
export class ApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly log: Logger,
  ) {}

  async execute(apiRequest: ApiRequest, label?: string): Promise<ApiResponseWrapper> {
    const started = performance.now();
    // `rawBody` goes as a Buffer: Playwright re-encodes a non-JSON string body as a quoted JSON
    // string.
    const data =
      apiRequest.rawBody !== undefined
        ? Buffer.from(apiRequest.rawBody, 'utf8')
        : apiRequest.body === undefined
          ? undefined
          : JSON.stringify(apiRequest.body);
    // A raw body replaces any multipart parts, or a malformed-body probe would send the valid
    // upload.
    const sendMultipart = apiRequest.multipart !== undefined && apiRequest.rawBody === undefined;
    // Uploads land in the live S3 bucket: only small files are ever sent.
    if (sendMultipart)
      assertUploadAllowed(
        multipartBytes(apiRequest.multipart),
        `${apiRequest.method} ${apiRequest.url}`,
      );
    const headers =
      apiRequest.multipart !== undefined && !sendMultipart
        ? { 'Content-Type': 'application/json', ...apiRequest.headers }
        : apiRequest.headers;
    try {
      const response = await this.request.fetch(apiRequest.url, {
        method: apiRequest.method,
        headers,
        // Playwright builds the boundary and encodes the parts; `data` and `multipart` are
        // mutually exclusive, so only one is ever set.
        ...(sendMultipart ? { multipart: apiRequest.multipart } : { data }),
        timeout: apiRequest.timeoutMs,
        failOnStatusCode: false,
        maxRedirects: 0,
      });
      // Read the body once as a Buffer: binary checks need the magic bytes a UTF-8 decode would
      // lose.
      const buffer = await response.body();
      const bodyText = buffer.toString('utf8');
      const bodyPrefixHex = buffer.subarray(0, 16).toString('hex');
      const bodyDigest = {
        sha256: createHash('sha256').update(buffer).digest('hex'),
        bytes: buffer.length,
      };
      const durationMs = Math.round(performance.now() - started);
      this.log.debug(`${apiRequest.method} ${apiRequest.url} -> ${response.status()}`, {
        label,
        durationMs,
        correlationId: apiRequest.correlationId,
      });
      return new ApiResponseWrapper(
        apiRequest,
        response.status(),
        response.headers(),
        bodyText,
        durationMs,
        undefined,
        label,
        bodyPrefixHex,
        bodyDigest,
      );
    } catch (error) {
      const message = (error as Error).message;
      const kind = /timeout/i.test(message) ? 'timeout' : 'network';
      this.log.warn(`${apiRequest.method} ${apiRequest.url} failed (${kind})`, {
        correlationId: apiRequest.correlationId,
        message,
      });
      const durationMs = Math.round(performance.now() - started);
      return new ApiResponseWrapper(apiRequest, 0, {}, '', durationMs, { kind, message }, label);
    }
  }

  get(url: string, options?: RequestOptions): Promise<APIResponse> {
    return this.send('GET', url, options);
  }

  post(url: string, options?: RequestOptions): Promise<APIResponse> {
    return this.send('POST', url, options);
  }

  put(url: string, options?: RequestOptions): Promise<APIResponse> {
    return this.send('PUT', url, options);
  }

  patch(url: string, options?: RequestOptions): Promise<APIResponse> {
    return this.send('PATCH', url, options);
  }

  delete(url: string, options?: RequestOptions): Promise<APIResponse> {
    return this.send('DELETE', url, options);
  }

  /** Send a request, assert a 2xx status, and return the body parsed by `schema`. */
  async json<T extends z.ZodType>(
    schema: T,
    method: HttpMethod,
    url: string,
    options?: RequestOptions,
  ): Promise<z.output<T>> {
    const response = await this.send(method, url, options);
    await expect(response, `${method} ${url}`).toBeOK();
    return schema.parse(await response.json());
  }

  private async send(
    method: HttpMethod,
    url: string,
    options: RequestOptions = {},
  ): Promise<APIResponse> {
    const started = Date.now();
    const response = await this.request.fetch(url, { ...options, method });
    this.log.debug(`${method} ${url} -> ${response.status()} (${Date.now() - started}ms)`);
    return response;
  }
}
