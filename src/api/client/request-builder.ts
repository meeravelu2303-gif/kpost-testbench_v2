import { apiConfig } from '@config/api.config';
import { thresholds } from '@config/thresholds.config';
import { newCorrelationId } from '@utils/correlation';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Endpoint-specific request data. Everything else (URL, auth, correlation) is built centrally. */
export interface RequestSpec {
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  /** Serialized as JSON. */
  body?: unknown;
  /** Sent verbatim (used by malformed-JSON probes). Takes precedence over `body`. */
  rawBody?: string;
  /**
   * Multipart form fields, for file uploads.
   *
   * KPost's logo upload takes two parts: the image as `file`, and its JSON arguments as a form
   * field literally named `text` - `text={"companyID":4}`. That is not something a JSON body can
   * express, so it needs its own channel rather than being smuggled through `body`.
   */
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
}

export interface ApiRequest {
  method: HttpMethod;
  pathTemplate: string;
  /** Resolved path + query string, relative to the API base URL. */
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  multipart?: RequestSpec['multipart'];
  correlationId: string;
  timeoutMs: number;
}

export function resolvePath(template: string, params: RequestSpec['pathParams'] = {}): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${template}`);
    return encodeURIComponent(String(value));
  });
}

function toQueryString(query: RequestSpec['query']): string {
  if (!query || !Object.keys(query).length) return '';
  const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  return `?${params.toString()}`;
}

/** Fluent builder producing the immutable `ApiRequest` the client executes. */
export class RequestBuilder {
  private spec: RequestSpec = {};
  private extraHeaders: Record<string, string> = {};
  private correlation = newCorrelationId();
  private timeout: number = thresholds.requestTimeoutMs;

  private constructor(
    private readonly method: HttpMethod,
    private readonly pathTemplate: string,
  ) {}

  static for(method: HttpMethod, pathTemplate: string): RequestBuilder {
    return new RequestBuilder(method, pathTemplate);
  }

  withSpec(spec: RequestSpec): this {
    this.spec = spec;
    return this;
  }

  header(name: string, value: string): this {
    this.extraHeaders[name.toLowerCase()] = value;
    return this;
  }

  /** Raw Authorization header value — probes use this to send broken credentials. */
  authorization(value: string | undefined): this {
    if (value === undefined) delete this.extraHeaders.authorization;
    else this.extraHeaders.authorization = value;
    return this;
  }

  correlationId(id: string): this {
    this.correlation = id;
    return this;
  }

  timeoutMs(ms: number): this {
    this.timeout = ms;
    return this;
  }

  build(): ApiRequest {
    const hasBody = this.spec.rawBody !== undefined || this.spec.body !== undefined;
    /*
     * A multipart request must NOT carry a content-type we chose: the boundary is generated when
     * the request is sent, and a hand-written `multipart/form-data` header without it makes the
     * server unable to parse the body.
     */
    const isMultipart = this.spec.multipart !== undefined;
    const headers: Record<string, string> = {
      accept: apiConfig.defaultContentType,
      ...(hasBody && !isMultipart ? { 'content-type': apiConfig.defaultContentType } : {}),
      ...lowerCaseKeys(this.spec.headers ?? {}),
      ...this.extraHeaders,
      [apiConfig.correlationHeader]: this.correlation,
    };
    return {
      method: this.method,
      pathTemplate: this.pathTemplate,
      url: resolvePath(this.pathTemplate, this.spec.pathParams) + toQueryString(this.spec.query),
      headers,
      body: this.spec.body,
      rawBody: this.spec.rawBody,
      multipart: this.spec.multipart,
      correlationId: this.correlation,
      timeoutMs: this.timeout,
    };
  }
}

function lowerCaseKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}
