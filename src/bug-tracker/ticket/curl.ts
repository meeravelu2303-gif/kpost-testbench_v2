import type { RequestSpec } from '@api/client/request-builder';
import { resolvePath } from '@api/client/request-builder';
import { maskSecretsOnly } from '@utils/masking';

/**
 * Builds a runnable `curl` for a ticket: the real path, body and kpostIDs, but the token as a
 * `$KPOST_TOKEN` placeholder and passwords masked, since a ticket is readable by every Bugzilla
 * user.
 */
export interface CurlOptions {
  method: string;
  /** Path template, e.g. `/v2/katchup/download/{uuid}`. */
  path: string;
  baseUrl: string;
  request?: RequestSpec;
  /** True when the endpoint needs a token, so the header is shown. */
  authenticated: boolean;
  contentType?: string;
}

/** Single-quoted for a POSIX shell; an embedded quote is escaped the portable way. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

function queryString(query: RequestSpec['query']): string {
  if (!query || !Object.keys(query).length) return '';
  return `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()}`;
}

export function buildCurl(options: CurlOptions): string {
  const { method, path, baseUrl, request, authenticated, contentType } = options;

  // An unsupplied path parameter stays as `{name}` rather than silently calling the wrong resource.
  let resolved: string;
  try {
    resolved = resolvePath(path, request?.pathParams);
  } catch {
    resolved = path;
  }

  const url = `${baseUrl.replace(/\/+$/, '')}${resolved}${queryString(request?.query)}`;
  const lines = [`curl -i -X ${method.toUpperCase()} ${shellQuote(url)}`];

  const headers: Record<string, string> = {
    'Content-Type': contentType ?? 'application/json',
    ...request?.headers,
  };
  if (authenticated) headers.Authorization = 'Bearer $KPOST_TOKEN';
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }

  const body = request?.rawBody ?? (request?.body === undefined ? undefined : request.body);
  if (body !== undefined) {
    const serialized =
      typeof body === 'string' ? body : JSON.stringify(maskSecretsOnly(body), null, 2);
    lines.push(`  -d ${shellQuote(serialized)}`);
  }

  return lines.join(' \\\n');
}
