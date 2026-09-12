import type { SideEffect } from '@engine/production-guard';
import type { ValidationToggles } from '@engine/validation-policy';
import type { HttpMethod, RequestSpec } from '../../client/request-builder';
import { workbookContract } from '../../contract/workbook-contract';
import type { EndpointDefinition, RequestFactory } from '../../registry/endpoint-definition';

/**
 * Declares one real KPost endpoint.
 *
 * ## What a definition does and does not say
 *
 * It says only what the workbook cannot: which values to send, whether the call has side effects,
 * which business rules apply. Everything the workbook already states — the request schema, the
 * response schema, the documented example, the HTTP method's provenance — is read from the
 * generated contract, so a new dump of `KPOST API (N).xlsx` updates every endpoint at once and no
 * schema is ever maintained in two places.
 *
 * Nothing here describes HOW to test. Auth, status, content type, schema, headers, error format,
 * injection, XSS, rate limiting, response time, boundary values, null handling and the rest come
 * from the central validators in `src/validators/`, which apply to every endpoint automatically.
 *
 * ## Why payloads are built from test data, never from the workbook example
 *
 * The documented examples contain real people's mobile numbers and email addresses
 * (`karans@kpostindia.com`, `9003044562`). Replaying them would send real SMS and real mail to
 * colleagues and customers on every run. Request factories therefore take identifiers from
 * `testData`, and the example is used only for its shape.
 */
export interface KpostEndpointConfig {
  /** Stable id used in reports, filters and bug fingerprints. */
  id: string;
  method: HttpMethod;
  /** Must match the generated contract exactly — a mismatch throws at import time. */
  path: string;
  summary: string;
  /** Bugzilla component candidates and test filters; `kpost-api` is added automatically. */
  tags?: readonly string[];
  request?: RequestFactory;
  /** Public endpoints need no token. Default for this module: no authentication required. */
  authentication?: EndpointDefinition['authentication'];
  /** Overrides the contract's default status when an endpoint legitimately differs. */
  expectedStatus?: readonly number[];
  /** Non-JSON responses (a logo download) - switches off envelope and JSON-shaped checks. */
  envelope?: boolean;
  contentType?: string;
  /** True when the call writes, sends or changes something. Gates it behind the safety flag. */
  destructive?: boolean;
  /** How far that effect reaches - `external` (SMS/email) and `global` never run by default. */
  sideEffect?: SideEffect;
  validations?: Partial<ValidationToggles>;
  skipValidators?: readonly string[];
  businessRules?: readonly string[];
  security?: EndpointDefinition['security'];
  performance?: EndpointDefinition['performance'];
  /** Reason this endpoint's schema is absent or partial, for the report. */
  note?: string;
}

/**
 * Builds a definition and cross-checks it against the generated contract.
 *
 * The check is the point: `workbookContract` throws when the method and path are not in the
 * contract, so a renamed or retired endpoint fails at import time with a clear message rather
 * than becoming a test that quietly validates nothing.
 */
export function defineKpostEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  const contract = workbookContract('kpost-api', config.method, config.path);

  return {
    id: config.id,
    method: config.method,
    path: config.path,
    suite: 'kpost-api',
    responseContract: 'kpost',
    summary: config.summary,
    tags: ['kpost-api', ...(config.tags ?? [])],
    // The common module is public: these endpoints are called before anyone has a token.
    authentication: config.authentication ?? { required: false },
    expectedStatus: config.expectedStatus,
    envelope: config.envelope,
    contentType: config.contentType,
    request: config.request,
    requestSchema: contract.requestSchema,
    responseSchema: contract.responseSchema,
    destructive: config.destructive,
    sideEffect: config.sideEffect,
    validations: config.validations,
    skipValidators: config.skipValidators,
    businessRules: config.businessRules,
    security: config.security,
    performance: config.performance,
  };
}

/** A request factory for an endpoint that takes a JSON body. */
export const body =
  (payload: () => Record<string, unknown>): RequestFactory =>
  (): RequestSpec => ({
    body: payload(),
  });

/** A request factory for an endpoint whose parameter is in the path. */
export const pathParams =
  (params: () => Record<string, string | number>): RequestFactory =>
  (): RequestSpec => ({ pathParams: params() });
