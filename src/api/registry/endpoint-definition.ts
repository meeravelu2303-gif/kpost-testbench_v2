import type { Role } from '@config/auth.config';
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
  summary?: string;
  tags?: readonly string[];

  /** Defaults to apiConfig.defaultExpectedStatus[method]. */
  expectedStatus?: readonly number[];
  /** Defaults to apiConfig.defaultContentType. */
  contentType?: string;
  /** Response wrapped in the standard success/error envelope. Default: true. */
  envelope?: boolean;

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
}
