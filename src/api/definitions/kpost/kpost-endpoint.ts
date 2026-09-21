import type { SideEffect } from '@engine/production-guard';
import type { ValidationToggles } from '@engine/validation-policy';
import type { HttpMethod, RequestSpec } from '../../client/request-builder';
import { workbookContract } from '../../contract/workbook-contract';
import type { ContractSchema } from '../../schema/contract-schema';
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
  /** The path the endpoint is actually called on. */
  path: string;
  /**
   * The path the **workbook** documents, when the live API disagrees with it.
   *
   * Schemas and examples are still read from the workbook row, but the request goes to `path`.
   * Needed because the sheet is wrong in places: it records the company-logo routes without their
   * `/v2` prefix, and the bench spent a day reporting 404s that were the sheet's error, not the
   * API's. Every use of this must cite the evidence for the correction.
   */
  contractPath?: string;
  /**
   * The method the **workbook** documents, when the live API disagrees. Like `contractPath`, the
   * schema is still read from the documented (method, path) row, while the request uses `method`.
   * Needed where the sheet's derived verb is wrong: `/v2/profile/fetchUserDetails/` is documented
   * POST but the live API answers only GET (405 on POST) — a documentation defect, recorded on the
   * definition. Every use must cite its evidence.
   */
  contractMethod?: HttpMethod;
  summary: string;
  /**
   * Overrides the contract's request schema for THIS endpoint. Use it when the documented/generated
   * schema is broader than what the endpoint actually accepts — e.g. an admin READ whose real payload
   * is `{ companyId }` but whose contract is the shared springdoc DTO (`id`, `rejoiningDate`,
   * `adminKsmaccID`, …). Fuzzing the full DTO on such a read files false "input validation" bugs on
   * fields the endpoint ignores; a tight schema fuzzes only the real fields. An OPEN `z.object({...})`
   * still lets the endpoint receive extra fields without an unknown-field probe (the contract permits
   * them). Every use must reflect the endpoint's MEASURED payload, not a guess.
   */
  requestSchema?: ContractSchema;
  /** Bugzilla component candidates and test filters; `kpost-api` is added automatically. */
  tags?: readonly string[];
  /** FRD requirement ids this endpoint exercises, e.g. ['FR-SL-026', 'NFR-SEC01']. */
  requirements?: readonly string[];
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
  /**
   * Cleared to run against the LIVE application. Default deny: without it, `TEST_ENV=production`
   * blocks the endpoint entirely. State the reason in a comment beside it - see
   * `productionSafe` in src/api/registry/endpoint-definition.ts for what the flag asserts.
   */
  productionSafe?: boolean;
  /** Needs a real OTP, so it is skipped on live. Reconciled against `npm run contract:otp`. */
  otpDependent?: EndpointDefinition['otpDependent'];
  validations?: Partial<ValidationToggles>;
  skipValidators?: readonly string[];
  businessRules?: readonly string[];
  /**
   * Persistence checks against the real KPOST_QA database, by id from
   * `src/database/validations/index.ts`.
   *
   * Only for what the response genuinely cannot prove — a row exists, a soft-delete flag flipped,
   * a logical foreign key resolves. Anything the body already shows belongs to a response
   * validator, or the same defect gets filed twice.
   */
  database?: EndpointDefinition['database'];
  /** Tuning for the simultaneous-request probes (`identityPaths`, `singleWriteWins`, ...). */
  concurrency?: EndpointDefinition['concurrency'];
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
  const contract = workbookContract(
    'kpost-api',
    config.contractMethod ?? config.method,
    config.contractPath ?? config.path,
  );

  return {
    id: config.id,
    method: config.method,
    path: config.path,
    contractPath: config.contractPath,
    contractMethod: config.contractMethod,
    suite: 'kpost-api',
    responseContract: 'kpost',
    summary: config.summary,
    tags: ['kpost-api', ...(config.tags ?? [])],
    requirements: config.requirements,
    // The common module is public: these endpoints are called before anyone has a token.
    authentication: config.authentication ?? { required: false },
    expectedStatus: config.expectedStatus,
    envelope: config.envelope,
    contentType: config.contentType,
    request: config.request,
    requestSchema: config.requestSchema ?? contract.requestSchema,
    responseSchema: contract.responseSchema,
    destructive: config.destructive,
    sideEffect: config.sideEffect,
    productionSafe: config.productionSafe,
    otpDependent: config.otpDependent,
    validations: config.validations,
    skipValidators: config.skipValidators,
    businessRules: config.businessRules,
    database: config.database,
    concurrency: config.concurrency,
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
