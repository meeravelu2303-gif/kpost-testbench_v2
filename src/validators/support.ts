import type { ApiResponseWrapper, ParsedJson } from '@api/client/response-wrapper';
import type { ValidationContext } from '@engine/validation-context';
import { getPath } from '@utils/json';

/** Shared read-only helpers for validators (no validation logic lives here). */

export function hasNoContent(exchange: ApiResponseWrapper): boolean {
  return exchange.status === 204 || !exchange.hasBody;
}

/** Response payload of the primary exchange: `data` for enveloped endpoints, else the body. */
export function responseData(context: ValidationContext): ParsedJson {
  const parsed = context.primary.json();
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: context.endpoint.envelope ? getPath(parsed.value, 'data') : parsed.value,
  };
}

/** Every exchange with an HTTP error status collected so far (primary + probes). */
export function errorExchanges(context: ValidationContext): ApiResponseWrapper[] {
  return context.exchanges.filter((exchange) => exchange.status >= 400);
}

export function mediaType(contentType: string | undefined): string | undefined {
  return contentType?.split(';')[0]?.trim().toLowerCase();
}

export function isJsonResponse(exchange: ApiResponseWrapper): boolean {
  const type = mediaType(exchange.contentType);
  return type === 'application/json' || (type?.endsWith('+json') ?? false);
}
