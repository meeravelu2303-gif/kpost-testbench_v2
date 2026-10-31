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
   * Run another registered endpoint (with `overrides`), assert its status and return its `data`.
   */
  call<T = Record<string, unknown>>(endpointId: string, overrides?: RequestSpec): Promise<T>;
  /** Tenant (company) that test data is created in. */
  tenantId: string;
}

/** Produces a *valid* request. Called again whenever a probe needs fresh data. */
export type RequestFactory = (helpers: RequestFactoryHelpers) => RequestSpec | Promise<RequestSpec>;

/**
 * What is specific to one endpoint; everything common lives in the central validators. Only `id`,
 * `method`, `path` are required.
 */
export interface EndpointDefinition {
  id: string;
  method: HttpMethod;
  /** OpenAPI-style template, e.g. `/users/{id}`. */
  path: string;
  /**
   * The path the workbook documents, when it differs from the live API (lets coverage reconcile the
   * two).
   */
  contractPath?: string;
  /**
   * The method the workbook documents, when the live API answers a different verb; the schema is
   * read from that row.
   */
  contractMethod?: HttpMethod;
  /** Owning module: picks the base URL and the Bugzilla product/owner. Default `kpost-api`. */
  suite?: SuiteId;
  summary?: string;
  /** One line on why this endpoint cannot be exercised the obvious way. */
  note?: string;
  tags?: readonly string[];
  /** FRD requirement ids this endpoint exercises (FR-S01, BR-K02, ...). */
  requirements?: readonly string[];

  /** Defaults to apiConfig.defaultExpectedStatus[method]. */
  expectedStatus?: readonly number[];
  /**
   * Why the sweep cannot supply valid data for this endpoint. A 2xx or a non-401 4xx is then
   * accepted; a 5xx or 401 is still a defect.
   */
  precondition?: string;
  /** Defaults to apiConfig.defaultContentType. */
  contentType?: string;
  /** Response wrapped in the envelope of `responseContract`. Default: true. */
  envelope?: boolean;
  /**
   * The response contract this endpoint follows (response-contract.ts). Default `standard`; KPost
   * uses `kpost`.
   */
  responseContract?: ResponseContractId;

  authentication?: {
    /** Default: true. */
    required?: boolean;
    /** Role used for the primary request. Default: the auth profile's role (USER) or the first allowed role. */
    role?: Role;
    /** The exact principal (by `key`) for the primary request, when a role alone is ambiguous. */
    principalKey?: string;
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
  /** Where `responseSchema` was read when the workbook has none (a backend controller method). */
  responseSchemaSource?: string;
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

  /** Tuning for the simultaneous-request validators (`src/validators/concurrency`). */
  concurrency?: {
    /** Requests dispatched together. Default: `thresholds.concurrency.defaultRequests`. */
    requests?: number;
    /**
     * Response paths that may differ between identical reads (clock, counter, token); ignored when
     * comparing.
     */
    volatilePaths?: readonly string[];
    /**
     * Response paths holding the caller's own identity; a different value in a burst means a leaked
     * record.
     */
    identityPaths?: readonly string[];
    /**
     * The write must succeed at most once: two simultaneous identical writes give one success, one
     * rejection.
     */
    singleWriteWins?: boolean;
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
   * How far a write reaches: `data` (test-owned records, default), `external` (real SMS/email) or
   * `global` (shared state).
   */
  sideEffect?: SideEffect;
  /**
   * Cleared to run against the live application (default deny). Set only when it writes nothing but
   * our own QA records, sends no SMS/email and changes no shared state; cite the reason next to it.
   */
  productionSafe?: boolean;
  /**
   * Needs a one-time password, so it is skipped where no bypass OTP exists. `sends` delivers a real
   * OTP, `consumes` carries an `otp` field, `requires` needs one validated in an earlier step.
   */
  otpDependent?: 'sends' | 'consumes' | 'requires';
}
