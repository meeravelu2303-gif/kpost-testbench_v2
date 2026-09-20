import type { HttpMethod } from '@api/client/request-builder';
import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import type { SuiteId } from '@config/ownership.config';
import type { ExchangePhase } from '@engine/endpoint-executor';
import { maskString } from '@utils/masking';

/**
 * What one request/response exchange LOOKED LIKE, preserved so a later phase can reason about it.
 *
 * ## Why this exists
 *
 * Today a probe keeps only `{name, status, expected, actual, message, correlationId}`
 * (`runProbes`), and only the PRIMARY response body survives into the report. So by the time
 * anything asks "did the application answer this, or did something in front of it?", the
 * information needed to answer has been thrown away — and the only remaining option is to pattern-
 * match prose that was assembled for humans. That is the root cause the Phase 3 design identified.
 *
 * ## What this is NOT
 *
 * It decides nothing. There is no verdict here, no severity, no defect. Evidence is observational:
 * it records what was seen, with a bounded, redacted, deterministic shape, and stops. Classification
 * is Phase 3.3 and reads this; nothing in the Bugzilla pipeline reads it at all.
 *
 * ## Safety
 *
 * Evidence is written to `reports/evidence.jsonl` and attached to reports, so it must be safe to
 * read by anyone who can read a report. Two rules make that structural rather than careful:
 *
 *  - **request headers and bodies are never stored verbatim** — only their shape (which header was
 *    present, the auth SCHEME, the body's size and its top-level KEY NAMES). A value that was never
 *    copied cannot leak, whatever a future masking rule misses; and
 *  - **response headers are allowlisted**, not masked-by-default, so `set-cookie` and
 *    `authorization` cannot arrive through a gap in a pattern.
 *
 * Everything that IS kept then passes through the repository's existing `maskString`.
 */

/**
 * Bounds, so one enormous response cannot bloat a report or a run's memory.
 *
 * `bodyChars` matches the 2 KB the report already keeps for a primary body
 * (`validation-engine.ts`), so evidence is never coarser than what reports already carry.
 */
export const EVIDENCE_LIMITS = {
  /** Characters of a response body kept as a readable excerpt. */
  bodyChars: 2_048,
  /** Characters of any single header value. */
  headerValueChars: 256,
  /** Response headers kept, after the allowlist. */
  headers: 24,
  /** Top-level request-body key names kept (names only — never values). */
  bodyKeys: 40,
  /** Characters of a serialised record, beyond which the excerpt is dropped. */
  recordChars: 16_384,
} as const;

/**
 * Response headers worth keeping, and the only ones ever copied.
 *
 * Two groups, both chosen for what they can WITNESS rather than for being interesting:
 *  - transport/shape (`content-type`, `content-length`, `date`, `retry-after`, `allow`), and
 *  - provenance: `server`, `via`, the CDN/proxy cache markers, and any request/trace id echoed back.
 *
 * `set-cookie`, `authorization` and everything else are absent by construction.
 */
export const EVIDENCE_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'date',
  'retry-after',
  'allow',
  'connection',
  'server',
  'via',
  'x-cache',
  'x-served-by',
  'x-proxy-cache',
  'cf-ray',
  'x-amz-cf-id',
  'x-amzn-requestid',
  'x-amzn-trace-id',
  'x-request-id',
  'x-correlation-id',
  'x-trace-id',
] as const;

export type EvidenceHeader = (typeof EVIDENCE_RESPONSE_HEADERS)[number];

/** Content types whose body is text we can safely excerpt. Anything else is treated as binary. */
const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|\+json)/i;

/** Where a response came from, as far as the evidence can WITNESS it. Never inferred from status. */
export type ResponseOrigin = 'APPLICATION' | 'EDGE' | 'NO_RESPONSE' | 'UNKNOWN';

/** How the bench authenticated, without recording what with. */
export interface RequestAuthEvidence {
  present: boolean;
  /** `Bearer`, `Basic`, … — the scheme token only, never the credential. */
  scheme?: string;
}

export interface RequestEvidence {
  method: HttpMethod;
  /** The path TEMPLATE (`/v2/katchup/deleteKatchUpMessage/`), so no substituted id is recorded. */
  path: string;
  /** Scheme + host of the module that was called. Identifies which deployment answered. */
  origin: string;
  /** Query parameter NAMES only. A value is never evidence worth the risk of copying one. */
  queryKeys: readonly string[];
  auth: RequestAuthEvidence;
  contentType?: string;
  /** Size and top-level key NAMES of the body — never its values. */
  body?: { bytes: number; keys: readonly string[]; truncatedKeys: boolean };
}

/** Markers found in a response that say something about WHO produced it. Values, not verdicts. */
export interface ResponseMarkers {
  /** An application-minted trace id (the KPost error envelope carries one). */
  traceId?: string;
  /** The application naming its own route back to us (`urlPath` in every KPost/KMail envelope). */
  urlPath?: string;
  /** The envelope's own `status` string (`SUCCESS` / `FAILURE`). */
  envelopeStatus?: string;
  /** The envelope's own numeric status. */
  envelopeStatusCode?: number;
  /** A request/trace id echoed in a header. */
  requestIdHeader?: string;
  /** RFC 9110 `Via` — set by an intermediary, by definition. */
  via?: string;
  /** A CDN/proxy cache marker. */
  cacheHeader?: string;
  /** The `Server` header verbatim (bounded). Recorded, but NOT used to attribute origin — see origin.ts. */
  server?: string;
}

export interface ResponseEvidence {
  /** False only when nothing answered — a transport failure. */
  received: boolean;
  /** 0 when nothing answered. */
  status: number;
  headers: Readonly<Partial<Record<EvidenceHeader, string>>>;
  bytes: number;
  contentType?: string;
  isJson: boolean;
  /** True when the body is not textual, so no excerpt was taken. */
  binary: boolean;
  /** Bounded, masked excerpt. Absent for a binary or empty body. */
  snippet?: string;
  truncated: boolean;
  markers: ResponseMarkers;
}

export interface TransportEvidence {
  kind: 'timeout' | 'network';
  /** Masked — a connection error can echo a URL that carries a token. */
  message: string;
}

/** One exchange, preserved. Immutable, bounded, redacted, and safe to persist. */
export interface ExchangeEvidence {
  /** The run that produced it (`TEST_RUN_ID`). */
  runId: string;
  /** Stable test-case identity, when the caller knows it. Absent for engine-internal exchanges. */
  testCaseId?: string;
  /** THE correlation key: links this evidence to the ValidationResult/CheckDetail that judged it. */
  correlationId: string;
  /** `primary`, or the probe label (`authentication.missing-token:missing token`). */
  label: string;
  /** Whether this exchange was the primary call — the reachability witness candidate. */
  primary: boolean;
  phase: ExchangePhase;
  endpointId: string;
  /** `METHOD /path`. */
  endpoint: string;
  suite: SuiteId;
  observedAt: string;
  durationMs: number;
  request: RequestEvidence;
  response: ResponseEvidence;
  transport?: TransportEvidence;
  /** Attributed by `attributeOrigin`; recorded with the rule that decided it. */
  origin: ResponseOrigin;
  originRule: string;
  originReason: string;
}

function boundedHeaderValue(value: string): string {
  return maskString(value.slice(0, EVIDENCE_LIMITS.headerValueChars));
}

/** The allowlisted response headers, masked and bounded. Nothing outside the list is ever copied. */
export function captureResponseHeaders(
  headers: Readonly<Record<string, string>>,
): Partial<Record<EvidenceHeader, string>> {
  const kept: Partial<Record<EvidenceHeader, string>> = {};
  let count = 0;
  for (const name of EVIDENCE_RESPONSE_HEADERS) {
    if (count >= EVIDENCE_LIMITS.headers) break;
    const value = headers[name];
    if (value === undefined) continue;
    kept[name] = boundedHeaderValue(value);
    count += 1;
  }
  return kept;
}

/** The scheme of an Authorization header, never its credential. */
function authEvidence(headers: Record<string, string> | undefined): RequestAuthEvidence {
  const raw = headers?.Authorization ?? headers?.authorization;
  if (!raw) return { present: false };
  const scheme = raw.trim().split(/\s+/)[0];
  // A scheme is a short token (`Bearer`); anything longer is a bare credential, so it is dropped.
  return { present: true, ...(scheme && scheme.length <= 16 ? { scheme } : {}) };
}

/** Top-level key NAMES of a request body. Names describe the shape; values would leak it. */
function bodyKeys(body: unknown): { keys: string[]; truncatedKeys: boolean } {
  if (!body || typeof body !== 'object') return { keys: [], truncatedKeys: false };
  const all = Array.isArray(body) ? ['[array]'] : Object.keys(body);
  return {
    keys: all.slice(0, EVIDENCE_LIMITS.bodyKeys),
    truncatedKeys: all.length > EVIDENCE_LIMITS.bodyKeys,
  };
}

/**
 * A request URL may be absolute (a module host) or RELATIVE — the request builder emits a path when
 * the client resolves it against its own base URL, which is the normal case for the bench's mock
 * fixtures. Both must yield the same evidence, so a relative value is parsed against a sentinel base
 * and reported with an empty origin rather than being written off as unparseable.
 *
 * `new URL` throws on a genuinely malformed value, and evidence capture must never throw.
 */
function parseUrl(url: string): { url: URL; origin: string } | undefined {
  try {
    const absolute = new URL(url);
    return { url: absolute, origin: absolute.origin };
  } catch {
    // Not absolute. Try it as a path; the base is a sentinel and is never recorded.
    try {
      return { url: new URL(url, RELATIVE_BASE), origin: '' };
    } catch {
      return undefined;
    }
  }
}

/** Never recorded — only used so a relative request path can be parsed for its query keys. */
const RELATIVE_BASE = 'http://relative.invalid';

function requestEvidence(exchange: ApiResponseWrapper): RequestEvidence {
  const { request } = exchange;
  // A malformed URL is itself worth recording, but it must not stop evidence being captured.
  const parsed = parseUrl(request.url);
  const origin = parsed?.origin ?? 'unparseable';
  const path = parsed
    ? request.pathTemplate
    : maskString(request.url.slice(0, EVIDENCE_LIMITS.headerValueChars));
  const queryKeys = parsed ? [...new Set(parsed.url.searchParams.keys())] : [];

  const rawBody = request.rawBody ?? request.body;
  const serialised =
    request.rawBody ?? (request.body === undefined ? undefined : JSON.stringify(request.body));
  const { keys, truncatedKeys } = bodyKeys(request.rawBody ? undefined : request.body);

  return {
    method: request.method,
    path,
    origin,
    queryKeys,
    auth: authEvidence(request.headers),
    ...(request.headers?.['content-type'] ? { contentType: request.headers['content-type'] } : {}),
    ...(rawBody === undefined
      ? {}
      : { body: { bytes: Buffer.byteLength(serialised ?? '', 'utf8'), keys, truncatedKeys } }),
  };
}

/** Reads the markers a response carries. Reading only — attribution happens in `origin.ts`. */
export function captureMarkers(
  headers: Partial<Record<EvidenceHeader, string>>,
  body: unknown,
): ResponseMarkers {
  const markers: ResponseMarkers = {};

  const requestId = headers['x-request-id'] ?? headers['x-correlation-id'] ?? headers['x-trace-id'];
  if (requestId) markers.requestIdHeader = requestId;
  if (headers.via) markers.via = headers.via;
  const cache = headers['x-cache'] ?? headers['x-proxy-cache'] ?? headers['x-served-by'];
  if (cache) markers.cacheHeader = cache;
  if (headers.server) markers.server = headers.server;

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const envelope = body as Record<string, unknown>;
    if (typeof envelope.traceId === 'string') markers.traceId = envelope.traceId.slice(0, 64);
    if (typeof envelope.urlPath === 'string') {
      markers.urlPath = maskString(envelope.urlPath.slice(0, EVIDENCE_LIMITS.headerValueChars));
    }
    if (typeof envelope.status === 'string') markers.envelopeStatus = envelope.status.slice(0, 32);
    if (typeof envelope.statusCode === 'number') markers.envelopeStatusCode = envelope.statusCode;
  }
  return markers;
}

function responseEvidence(exchange: ApiResponseWrapper): ResponseEvidence {
  const headers = captureResponseHeaders(exchange.headers);
  const contentType = exchange.contentType;
  const binary = Boolean(contentType) && !TEXTUAL.test(contentType ?? '');
  const parsed = exchange.json();
  const body = parsed.ok ? parsed.value : undefined;
  const text = exchange.bodyText;

  return {
    received: exchange.transportError === undefined,
    status: exchange.status,
    headers,
    bytes: exchange.sizeBytes,
    ...(contentType ? { contentType } : {}),
    isJson: parsed.ok,
    binary,
    ...(binary || text.length === 0
      ? {}
      : { snippet: maskString(text.slice(0, EVIDENCE_LIMITS.bodyChars)) }),
    truncated: !binary && text.length > EVIDENCE_LIMITS.bodyChars,
    markers: captureMarkers(headers, body),
  };
}

export interface CaptureContext {
  runId: string;
  phase: ExchangePhase;
  endpointId: string;
  endpoint: string;
  suite: SuiteId;
  testCaseId?: string;
}

/**
 * Builds the evidence for one exchange. Pure, total and bounded: it reads an already-completed
 * `ApiResponseWrapper` and never performs I/O, so it cannot fail a request or slow one down.
 *
 * `origin` is left `UNKNOWN` here on purpose — capturing and attributing are separate steps, so the
 * attribution rules can change without touching what is recorded.
 */
export function captureExchange(
  exchange: ApiResponseWrapper,
  context: CaptureContext,
): ExchangeEvidence {
  return {
    runId: context.runId,
    ...(context.testCaseId ? { testCaseId: context.testCaseId } : {}),
    correlationId: exchange.correlationId,
    label: exchange.label,
    primary: exchange.label === 'primary',
    phase: context.phase,
    endpointId: context.endpointId,
    endpoint: context.endpoint,
    suite: context.suite,
    observedAt: new Date().toISOString(),
    durationMs: exchange.durationMs,
    request: requestEvidence(exchange),
    response: responseEvidence(exchange),
    ...(exchange.transportError
      ? {
          transport: {
            kind: exchange.transportError.kind,
            message: maskString(
              exchange.transportError.message.slice(0, EVIDENCE_LIMITS.headerValueChars),
            ),
          },
        }
      : {}),
    origin: 'UNKNOWN',
    originRule: 'not-attributed',
    originReason: 'origin attribution has not run for this record',
  };
}

/**
 * Serialises a record for the journal, dropping the response excerpt if the whole record would
 * exceed the size bound. The excerpt is the only unbounded-ish part, and losing it is far better
 * than writing a line nothing will read.
 */
export function serialiseEvidence(evidence: ExchangeEvidence): string {
  const line = JSON.stringify(evidence);
  if (line.length <= EVIDENCE_LIMITS.recordChars) return line;
  const trimmed: ExchangeEvidence = {
    ...evidence,
    response: { ...evidence.response, snippet: undefined, truncated: true },
  };
  return JSON.stringify(trimmed);
}
