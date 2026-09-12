import type { Role } from '@config/auth.config';
import type { SuiteId } from '@config/ownership.config';
import type { ResponseContractId } from '@config/response-contract';
import type { SideEffect } from '@engine/production-guard';
import type { ValidationToggles } from '@engine/validation-policy';
import type { HttpMethod, RequestSpec } from '../client/request-builder';
import type { ContractSchema } from '../schema/contract-schema';

export type AuthFailureMode = 'missing' | 'invalid' | 'expired' | 'malformed';

/** Helpers available while building an endpoint's valid request. */
export interface RequestFactoryHelpers {
  /**
   * Execute another registered endpoint (its own request factory merged with `overrides`),
   * assert its expected status and return the response `data`. Lets `GET /users/{id}` reuse
   * `create-user` instead of duplicating its payload.
   */
  call<T = Record<string, unknown>>(endpointId: string, overrides?: RequestSpec): Promise<T>;
  /** Tenant (company) that test data is created in. */
  tenantId: string;
}

/** Produces a *valid* request. Called again whenever a probe needs fresh data. */
export type RequestFactory = (helpers: RequestFactoryHelpers) => RequestSpec | Promise<RequestSpec>;

/**
 * Everything that is specific to one endpoint. Everything that is common to all endpoints
 * (how to test auth, status, schema, headers, security, ...) lives in the central validators.
 * Only `id`, `method` and `path` are required — every other property has a central default.
 */
export interface EndpointDefinition {
  id: string;
  method: HttpMethod;
  /** OpenAPI-style template, e.g. `/users/{id}`. */
  path: string;
  /**
   * The path the workbook documents, when it disagrees with the live API.
   *
   * Kept on the definition (not just consumed when building it) so the coverage self-tests can
   * reconcile "what the sheet documents" with "what we actually call" - otherwise a corrected path
   * looks like an uncovered endpoint and the real one looks undocumented.
   */
  contractPath?: string;
  /**
   * Which KPost module this endpoint belongs to. Decides the base URL it is called on and,
   * when a defect is found, the Bugzilla product, component and owning developer.
   * Default: `kpost-api`. See src/config/ownership.config.ts.
   */
  suite?: SuiteId;
  summary?: string;
  tags?: readonly string[];
  /**
   * Requirement ids from the Full Suite FRD v2.0 that this endpoint exercises (FR-S01, BR-K02,
   * NFR-SEC01, ...). Recorded so coverage can be reported against the 55 FRs and 9 BRs the
   * documents define, rather than against a count of endpoints - which says nothing about whether
   * the product's rules are tested.
   */
  requirements?: readonly string[];

  /** Defaults to apiConfig.defaultExpectedStatus[method]. */
  expectedStatus?: readonly number[];
  /** Defaults to apiConfig.defaultContentType. */
  contentType?: string;
  /** Response wrapped in the envelope of `responseContract`. Default: true. */
  envelope?: boolean;
  /**
   * Which API response contract this endpoint follows - see src/config/response-contract.ts.
   * Default: `standard`. Real KPost endpoints use `kpost`.
   */
  responseContract?: ResponseContractId;

  authentication?: {
    /** Default: true. */
    required?: boolean;
    /** Role used for the primary request. Default: authConfig.defaultRole or the first allowed role. */
    role?: Role;
    failureStatus?: Partial<Record<AuthFailureMode, readonly number[]>>;
  };

  authorization?: {
    /** Roles allowed to call the endpoint. Empty/undefined: any authenticated principal. */
    roles?: readonly Role[];
    /** Resources belong to a tenant; principals of other tenants must be denied. */
    tenantScoped?: boolean;
    deniedStatus?: readonly number[];
    /** An allowed but lower-privileged role tries to grant itself more privileges. */
    privilegeEscalation?: {
      role: Role;
      overrides: RequestSpec;
      expectedStatus?: readonly number[];
    };
  };

  /** Builds a valid request. Omit for endpoints without parameters or body. */
  request?: RequestFactory;
  requestSchema?: ContractSchema;
  pathParamsSchema?: ContractSchema;
  querySchema?: ContractSchema;
  invalidRequestStatus?: readonly number[];

  /** Schema of the response payload (`data` inside the envelope, or the whole body). */
  responseSchema?: ContractSchema;
  pagination?: boolean;
  headers?: { required?: readonly string[] };

  performance?: { maxResponseTimeMs?: number; maxPayloadBytes?: number; timeoutMs?: number };

  security?: {
    /** Response fields that may legitimately contain secrets (e.g. `accessToken` on login). */
    sensitiveFieldAllowlist?: readonly string[];
    /** Path of an issued JWT in the response body (enables JWT claim checks). */
    tokenResponsePath?: string;
    /** Injection payloads must be rejected (4xx), e.g. on login. Default: only no 5xx/leaks. */
    injectionMustBeRejected?: boolean;
    rateLimit?: { maxRequests: number; request: RequestFactory };
  };

  /** Per-endpoint on/off switches merged over the default policy. */
  validations?: Partial<ValidationToggles>;
  /** Disable individual validators by name, e.g. `['security.rate-limit']`. */
  skipValidators?: readonly string[];
  /** Business rule IDs registered in src/business-rules. */
  businessRules?: readonly string[];
  /** DB validation IDs registered in src/database/validations. */
  database?: { validations: readonly string[] };
  /** Mutates or deletes data. Default: true for POST/PUT/PATCH/DELETE. */
  destructive?: boolean;
  /**
   * This endpoint is the BENCH'S OWN fixture, served by `mock-server/`, not part of KPost's API.
   * It is called on the mock's base URL whatever the module hosts are set to - otherwise
   * configuring a real KPOST_API_BASE_URL silently redirects the framework's self-tests at the
   * live API, which is exactly what happened the first time a real host was configured.
   */
  mockFixture?: boolean;
  /**
   * How far the side effect reaches: `data` (test-owned records, the default), `external` (sends
   * a real SMS or email) or `global` (changes shared environment state). See production-guard.ts.
   */
  sideEffect?: SideEffect;
}
