import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import type { z } from 'zod';
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
    /*
     * `rawBody` must reach the server byte for byte, so it goes as a Buffer. A STRING under a JSON
     * content-type is not sent verbatim: Playwright keeps it only when it parses as JSON and otherwise
     * wraps it in quotes (JSON.stringify), turning `{"field": ` into the valid JSON string
     * `"{\"field\": "` and an empty body into `""`. Every malformed-JSON and empty-body probe was
     * silently sending valid JSON, so a server that correctly checks its input still answered 200
     * and was reported as a defect.
     */
    const data =
      apiRequest.rawBody !== undefined
        ? Buffer.from(apiRequest.rawBody, 'utf8')
        : apiRequest.body === undefined
          ? undefined
          : JSON.stringify(apiRequest.body);
    /*
     * A raw body REPLACES any multipart parts. The malformed-JSON and empty-body probes copy the valid
     * request and set `rawBody`; when that request was multipart, sending the parts instead silently
     * delivered the VALID upload, so every multipart endpoint "accepted malformed JSON" (a false
     * defect) and each probe really sent a message or image.
     */
    const sendMultipart = apiRequest.multipart !== undefined && apiRequest.rawBody === undefined;
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
      /*
       * Read the body ONCE as a Buffer, then derive the text from it. Playwright lets a body be
       * consumed only once, and the raw leading bytes are what a binary check needs: a lossy UTF-8
       * decode drops the very magic-number bytes (0x89 for PNG, 0xFF for JPEG) that identify the
       * real format, so `bodyText` alone cannot tell a mislabelled image from a correct one.
       */
      const buffer = await response.body();
      const bodyText = buffer.toString('utf8');
      const bodyPrefixHex = buffer.subarray(0, 16).toString('hex');
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
