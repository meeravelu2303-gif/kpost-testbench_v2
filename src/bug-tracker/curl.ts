import type { RequestSpec } from '@api/client/request-builder';
import { resolvePath } from '@api/client/request-builder';
import { maskSecretsOnly } from '@utils/masking';

/**
 * Builds the `curl` a developer can paste into a terminal to see the defect themselves.
 *
 * ## Why a ticket needs this
 *
 * The house style already carries Expected/Actual. What it lacked was a command: the reader had to
 * reconstruct the call from prose, and the first thing anyone does with a bug report is try to
 * reproduce it. A wrong or missing repro is the most common reason a real defect gets closed as
 * "cannot reproduce".
 *
 * ## What it will and will not print
 *
 * - The **real** path (path parameters substituted) and the **real** body, so the command actually
 *   reproduces the failure rather than describing it.
 * - `Authorization: Bearer $KPOST_TOKEN` as a placeholder, never a live token. Tokens are
 *   credentials; a ticket is readable by anyone with a Bugzilla account, and a JWT pasted into one
 *   is a credential leak that outlives the bug.
 * - **Real identifiers.** `kpostID` values are printed as-is, because in KPost a kpostID IS an
 *   e-mail and the general e-mail mask turned the one value a developer needs into `***` — which
 *   left an unrunnable command. Credentials are still masked: a password in a login payload appears
 *   as `***`, so that command needs one edit before it runs. That is the right trade — a
 *   reproducible password in a ticket is worse than a one-word edit.
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

  /*
   * A path parameter the request never supplied stays as `{name}`: better an obviously
   * unsubstituted placeholder than a command that silently calls the wrong resource.
   */
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
