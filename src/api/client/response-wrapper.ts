import { maskSensitive } from '@utils/masking';
import type { ApiRequest } from './request-builder';

export type ParsedJson = { ok: true; value: unknown } | { ok: false; reason: string };

export interface TransportError {
  kind: 'timeout' | 'network';
  message: string;
}

/**
 * One request/response pair ("exchange"). Validators only ever read this type, so they never
 * depend on Playwright's APIResponse and never re-read a consumed body.
 */
export class ApiResponseWrapper {
  private parsed?: ParsedJson;

  constructor(
    readonly request: ApiRequest,
    readonly status: number,
    readonly headers: Readonly<Record<string, string>>,
    readonly bodyText: string,
    readonly durationMs: number,
    /** Set when no HTTP response was received. `status` is 0 in that case. */
    readonly transportError?: TransportError,
    /** Which probe produced the exchange, e.g. `primary` or `authentication.missing-token`. */
    readonly label = 'primary',
  ) {}

  get correlationId(): string {
    return this.request.correlationId;
  }

  get isErrorStatus(): boolean {
    return this.status >= 400;
  }

  get hasBody(): boolean {
    return this.bodyText.length > 0;
  }

  get sizeBytes(): number {
    return Buffer.byteLength(this.bodyText, 'utf8');
  }

  get contentType(): string | undefined {
    return this.header('content-type');
  }

  header(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  json(): ParsedJson {
    if (this.parsed) return this.parsed;
    if (!this.hasBody) return (this.parsed = { ok: false, reason: 'response body is empty' });
    try {
      return (this.parsed = { ok: true, value: JSON.parse(this.bodyText) as unknown });
    } catch (error) {
      return (this.parsed = {
        ok: false,
        reason: `response body is not valid JSON (${(error as Error).message})`,
      });
    }
  }

  /** Masked, report-safe description of the exchange. */
  summary(): Record<string, unknown> {
    return maskSensitive({
      label: this.label,
      method: this.request.method,
      url: this.request.url,
      status: this.status,
      durationMs: this.durationMs,
      correlationId: this.correlationId,
      transportError: this.transportError,
    });
  }
}
