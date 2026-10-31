import type { SideEffect } from '@engine/production-guard';
import type { ValidationToggles } from '@engine/validation-policy';
import type { HttpMethod, RequestSpec } from '../../client/request-builder';
import { sourceResponseSchema } from '../../contract/source-contract';
import { workbookContract } from '../../contract/workbook-contract';
import type { ContractSchema } from '../../schema/contract-schema';
import type { EndpointDefinition, RequestFactory } from '../../registry/endpoint-definition';

/**
 * Declares one real KPost endpoint: only what the workbook cannot say (values to send, side
 * effects, rules). Schemas come from the generated contract; payloads use `testData`, never the
 * workbook's real-person examples.
 */
export interface KpostEndpointConfig {
  /** Stable id used in reports, filters and bug fingerprints. */
  id: string;
  method: HttpMethod;
  /** The path the endpoint is actually called on. */
  path: string;
  /**
   * The path the workbook documents, when it is wrong; schemas come from that row, the request goes
   * to `path`. Cite the evidence.
   */
  contractPath?: string;
  /**
   * The method the workbook documents, when the live API answers another verb. Cite the evidence.
   */
  contractMethod?: HttpMethod;
  summary: string;
  /**
   * Overrides the contract's request schema when the real payload is narrower; must match the
   * measured payload.
   */
  requestSchema?: ContractSchema;
  /**
   * Overrides the contract's response schema with a types-only shape captured from a live read,
   * never a guess.
   */
  responseSchema?: ContractSchema;
  /** Schema for path parameters; without it the path-parameter probes skip. */
  pathParamsSchema?: ContractSchema;
  /** Schema for query-string parameters, same rationale as `pathParamsSchema`. */
  querySchema?: ContractSchema;
  /** Bugzilla component candidates and test filters; `kpost-api` is added automatically. */
  tags?: readonly string[];
  /** FRD requirement ids this endpoint exercises, e.g. ['FR-SL-026', 'NFR-SEC01']. */
  requirements?: readonly string[];
  request?: RequestFactory;
  /** Public endpoints need no token. Default for this module: no authentication required. */
  authentication?: EndpointDefinition['authentication'];
  /**
   * Who may call it, and whether its data belongs to one company: turns on the role, permission and
   * cross-tenant checks. Declare `tenantScoped` only when the request NAMES the owner's record (a
   * companyID, a message id): most KPost endpoints take the user from the token, so another user's
   * token rightly reads its own data.
   */
  authorization?: EndpointDefinition['authorization'];
  /** Overrides the contract's default status when an endpoint legitimately differs. */
  expectedStatus?: readonly number[];
  /** Non-JSON responses (a logo download) - switches off envelope and JSON-shaped checks. */
  envelope?: boolean;
  contentType?: string;
  /** True when the call writes, sends or changes something. Gates it behind the safety flag. */
  destructive?: boolean;
  /** How far that effect reaches - `external` (SMS/email) and `global` never run by default. */
  sideEffect?: SideEffect;
  /** Cleared to run against the live application (default deny); state the reason beside it. */
  productionSafe?: boolean;
  /** Needs a real OTP, so it is skipped on live. Reconciled against the contracts by `live-safety.spec.ts`. */
  otpDependent?: EndpointDefinition['otpDependent'];
  validations?: Partial<ValidationToggles>;
  skipValidators?: readonly string[];
  businessRules?: readonly string[];
  /** DB persistence checks (by id), only for what the response itself cannot prove. */
  database?: EndpointDefinition['database'];
  /** Tuning for the simultaneous-request probes (`identityPaths`, `singleWriteWins`, ...). */
  concurrency?: EndpointDefinition['concurrency'];
  security?: EndpointDefinition['security'];
  performance?: EndpointDefinition['performance'];
  /** Reason this endpoint's schema is absent or partial, for the report. */
  note?: string;
}

/**
 * Builds a definition; throws at import time when the method and path are not in the generated
 * contract.
 */
export function defineKpostEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  const contract = workbookContract(
    'kpost-api',
    config.contractMethod ?? config.method,
    config.contractPath ?? config.path,
  );
  // The backend source fills in only where the workbook documents no response.
  const fromSource =
    config.responseSchema || contract.responseSchema
      ? undefined
      : sourceResponseSchema('kpost-api', config.id);

  return {
    id: config.id,
    method: config.method,
    path: config.path,
    contractPath: config.contractPath,
    contractMethod: config.contractMethod,
    suite: 'kpost-api',
    responseContract: 'kpost',
    summary: config.summary,
    // Carried through so coverage invariants can read the written reason.
    note: config.note,
    tags: ['kpost-api', ...(config.tags ?? [])],
    requirements: config.requirements,
    // The common module is public: these endpoints are called before anyone has a token.
    authentication: config.authentication ?? { required: false },
    authorization: config.authorization,
    expectedStatus: config.expectedStatus,
    envelope: config.envelope,
    contentType: config.contentType,
    request: config.request,
    requestSchema: config.requestSchema ?? contract.requestSchema,
    pathParamsSchema: config.pathParamsSchema,
    querySchema: config.querySchema,
    responseSchema: config.responseSchema ?? contract.responseSchema ?? fromSource?.schema,
    responseSchemaSource: fromSource?.source,
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

/**
 * A real KPost endpoint the workbook does not document, confirmed from the frontend call site. The
 * schema comes from `requestSchema` and the audit trail from `evidence`; switch to the workbook
 * once it lists it.
 */
export interface UndocumentedKpostEndpointConfig extends Omit<
  KpostEndpointConfig,
  'requestSchema' | 'contractPath' | 'contractMethod'
> {
  /** The payload's full real shape; omit only when the frontend call sends no body or params. */
  requestSchema?: ContractSchema;
  /** Where this was confirmed in the frontend source, e.g. `"Setting.js:345-371"`. */
  evidence: string;
}

export function defineUndocumentedKpostEndpoint(
  config: UndocumentedKpostEndpointConfig,
): EndpointDefinition {
  const fromSource = config.responseSchema
    ? undefined
    : sourceResponseSchema('kpost-api', config.id);
  return {
    id: config.id,
    method: config.method,
    path: config.path,
    suite: 'kpost-api',
    responseContract: 'kpost',
    summary: config.summary,
    note: `UNDOCUMENTED IN WORKBOOK — confirmed from frontend source (${config.evidence}). ${config.note ?? ''}`.trim(),
    tags: ['kpost-api', 'undocumented-contract', ...(config.tags ?? [])],
    requirements: config.requirements,
    authentication: config.authentication ?? { required: false },
    authorization: config.authorization,
    expectedStatus: config.expectedStatus,
    envelope: config.envelope,
    contentType: config.contentType,
    request: config.request,
    requestSchema: config.requestSchema,
    responseSchema: config.responseSchema ?? fromSource?.schema,
    responseSchemaSource: fromSource?.source,
    pathParamsSchema: config.pathParamsSchema,
    querySchema: config.querySchema,
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

/** A request factory for an endpoint that takes a JSON body: an object, or an array for List<...> controllers. */
export const body =
  (payload: () => Record<string, unknown> | readonly Record<string, unknown>[]): RequestFactory =>
  (): RequestSpec => ({
    body: payload(),
  });

/** A request factory for an endpoint whose parameter is in the path. */
export const pathParams =
  (params: () => Record<string, string | number>): RequestFactory =>
  (): RequestSpec => ({ pathParams: params() });

/** A request factory for an endpoint whose parameter is a query string, not a path segment or body. */
export const queryParams =
  (params: () => Record<string, string | number | boolean>): RequestFactory =>
  (): RequestSpec => ({ query: params() });
