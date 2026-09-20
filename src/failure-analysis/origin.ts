import type { ExchangeEvidence, ResponseMarkers, ResponseOrigin } from './evidence';

/**
 * WHO produced a response — attributed from observable markers only, never from its status code.
 *
 * ## The rule that shapes everything here
 *
 * A status code says nothing about provenance. `502` is the status a gateway usually returns, but
 * an application can return one too (a service proxying a downstream dependency), and a gateway can
 * return `200` from a cache. So **no rule below reads `status`.** Attribution is by marker, or it is
 * `UNKNOWN`. That is what stops this layer from manufacturing the very false negatives it exists to
 * prevent — in both directions.
 *
 * ## What the repository can actually witness today
 *
 * ### APPLICATION — well evidenced, measured
 *
 * Every KPost/KMail/Admin envelope is documented in `src/config/response-contract.ts`, and each
 * profile there records how it was established:
 *
 *  - `urlPath` — the application naming its own route back to the caller. 104/119 documented KPost
 *    samples, 26/26 KMail, and every Admin controller (`ApiResponseEnvelope.java`).
 *  - `traceId` — an application-minted id, observed on live KPost error responses.
 *  - `status` (`SUCCESS`/`FAILURE`) with `statusCode` — the envelope itself.
 *
 * None of these is something an intermediary could plausibly synthesise: a gateway does not know the
 * KPost route name and does not mint a KPost trace id. They are therefore treated as POSITIVE
 * witnesses, and they are checked FIRST — so a response that carries both an app envelope and a
 * proxy header is correctly attributed to the application that produced it.
 *
 * ### EDGE — only what the HTTP standard itself defines
 *
 * The repository contains **no captured gateway response**: no recorded 502 body, no recorded
 * gateway header value, no fixture. Searching for `nginx`, `cloudfront`, `x-amzn`, `cf-ray`,
 * `envoy` or `haproxy` across the source, contracts, mock server and docs returns nothing.
 *
 * Inventing a vendor signature would be exactly the guesswork this phase forbids, so the only edge
 * indicators used are ones defined by specification rather than by a vendor:
 *
 *  - **`Via`** — RFC 9110 §7.6.3: set by each intermediary that forwards a message. Its presence
 *    *means* an intermediary handled the exchange; that is the header's definition, not a heuristic.
 *  - **cache markers** (`x-cache`, `x-proxy-cache`, `x-served-by`) — the conventional CDN/proxy
 *    response markers, and meaningful only when present.
 *
 * Both are **absence-safe**: if this deployment sets neither, nothing is misattributed — the answer
 * is `UNKNOWN`, which is the honest one. The `Server` header is deliberately NOT used: CLAUDE.md
 * records a platform-wide finding that a versioned `Server` header is present on *every* response,
 * app-backed or not, so on this platform it cannot discriminate. It is still recorded as evidence,
 * so a future pass can revisit it once real gateway captures exist.
 *
 * ### What stays UNKNOWN
 *
 * A response with no application marker and no intermediary marker — including a bare 502 with an
 * empty or HTML body. That is a deliberate, documented gap: see `docs/PHASE-3-DESIGN.md` §30 Q1/Q3
 * for the environment evidence needed to close it. Phase 3.2's own evidence capture is what will
 * produce that evidence.
 */

/**
 * The envelope `status` values the response contract defines (`src/config/response-contract.ts`).
 *
 * `error` appears in that file's KPost/Admin error envelope regex but was **not observed** in the
 * live verification, so it is deliberately absent here: this rule admits only what the contract
 * documents AND the environment has shown. Adding it is a one-line change once a real `error`
 * response is captured — and it must not be added on the strength of the schema alone.
 */
const CONTRACT_ENVELOPE_STATUS = /^(success|failure)$/i;

/** One attribution rule, in priority order. The first whose `when` holds decides. */
export interface OriginRule {
  id: string;
  origin: ResponseOrigin;
  /** Why this rule attributes what it does — recorded on the evidence, so a decision is auditable. */
  explain: (markers: ResponseMarkers) => string;
  when: (evidence: ExchangeEvidence) => boolean;
}

/** Application witnesses, strongest first. Each is a field no intermediary could produce. */
const APPLICATION_RULES: readonly OriginRule[] = [
  {
    id: 'app:traceId',
    origin: 'APPLICATION',
    when: (e) => Boolean(e.response.markers.traceId),
    explain: (m) => `the body carries an application trace id (traceId=${m.traceId ?? ''})`,
  },
  {
    id: 'app:urlPath',
    origin: 'APPLICATION',
    when: (e) => Boolean(e.response.markers.urlPath),
    explain: (m) => `the body names the application's own route (urlPath=${m.urlPath ?? ''})`,
  },
  {
    id: 'app:envelope',
    origin: 'APPLICATION',
    /*
     * The DOCUMENTED envelope, not merely a `status` field. Both halves are required:
     *
     *  - `status` must be one the contract defines (`SUCCESS` / `FAILURE`), and
     *  - it must be accompanied by `urlPath` or `statusCode`.
     *
     * The live verification is why. Every 401 on testingapi answers
     * `{"status":"UNAUTHORIZED","timestamp":null,"message":null,"debugMessage":"…"}` — no `urlPath`,
     * no `statusCode`, a `status` value outside the contract's vocabulary, a `debugMessage` field
     * that appears nowhere else, and `charset=ISO-8859-1` where every other response is plain
     * `application/json`. That is a different producer: an authentication filter in front of the
     * controllers, which this bench already treats as a shared-gateway concern. Attributing it to
     * APPLICATION would hand a later classifier exactly the false witness it must not have.
     *
     * Those responses are now UNKNOWN — **not** EDGE. No intermediary signature was observed, and
     * inventing one would be the opposite error.
     */
    when: (e) =>
      CONTRACT_ENVELOPE_STATUS.test(e.response.markers.envelopeStatus ?? '') &&
      (Boolean(e.response.markers.urlPath) ||
        typeof e.response.markers.envelopeStatusCode === 'number'),
    explain: (m) =>
      `the body carries the documented application envelope (status=${m.envelopeStatus ?? '?'}` +
      `, statusCode=${m.envelopeStatusCode ?? '?'})`,
  },
];

/** Intermediary witnesses. Standards-defined only — no vendor signature is guessed. */
const EDGE_RULES: readonly OriginRule[] = [
  {
    id: 'edge:via',
    origin: 'EDGE',
    when: (e) => Boolean(e.response.markers.via),
    explain: (m) => `an intermediary declared itself in the Via header (${m.via ?? ''})`,
  },
  {
    id: 'edge:cache',
    origin: 'EDGE',
    when: (e) => Boolean(e.response.markers.cacheHeader),
    explain: (m) => `a proxy/CDN cache marker is present (${m.cacheHeader ?? ''})`,
  },
];

export interface OriginAttribution {
  origin: ResponseOrigin;
  rule: string;
  reason: string;
}

/**
 * Attributes one exchange. Deterministic and total: every input yields an attribution, and the
 * fallback is `UNKNOWN` rather than a guess.
 *
 * Order is the whole design: transport first (nothing answered at all), then the positive
 * application witnesses, then the intermediary ones, then `UNKNOWN`. Application before edge means a
 * proxied application response is attributed to the application that produced it.
 */
export function attributeOrigin(evidence: ExchangeEvidence): OriginAttribution {
  if (evidence.transport) {
    return {
      origin: 'NO_RESPONSE',
      rule: 'transport',
      reason: `no HTTP response was received (${evidence.transport.kind})`,
    };
  }

  for (const rule of [...APPLICATION_RULES, ...EDGE_RULES]) {
    if (rule.when(evidence)) {
      return {
        origin: rule.origin,
        rule: rule.id,
        reason: rule.explain(evidence.response.markers),
      };
    }
  }

  return {
    origin: 'UNKNOWN',
    rule: 'no-marker',
    reason:
      'the response carries neither an application marker (traceId / urlPath / envelope) nor a ' +
      'standards-defined intermediary marker (Via / cache), so its origin cannot be witnessed',
  };
}

/** Attribution applied, returning a new record. Evidence is immutable once captured. */
export function withOrigin(evidence: ExchangeEvidence): ExchangeEvidence {
  const { origin, rule, reason } = attributeOrigin(evidence);
  return { ...evidence, origin, originRule: rule, originReason: reason };
}

/** The rule ids this build supports, for the report and for a coverage guard. */
export const ORIGIN_RULE_IDS: readonly string[] = [
  'transport',
  ...APPLICATION_RULES.map((r) => r.id),
  ...EDGE_RULES.map((r) => r.id),
  'no-marker',
];
