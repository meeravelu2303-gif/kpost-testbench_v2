import type { HttpMethod } from '@api/client/request-builder';
import type { AuthFailureMode, EndpointDefinition } from '@api/registry/endpoint-definition';
import type { ContractSchema } from '@api/schema/contract-schema';
import { apiConfig } from '@config/api.config';
import { authProfileFor } from '@config/auth-profile';
import { authConfig, type Role } from '@config/auth.config';
import { VALIDATION_PROFILES, type ValidationProfile } from '@config/constants';
import { DEFAULT_SUITE, suiteFor, type SuiteOwnership } from '@config/ownership.config';
import { env } from '@config/env';
import { responseContract, type ResponseContract } from '@config/response-contract';
import type { SideEffect } from './production-guard';
import { productionExclusion } from './production-validators';
import { thresholds } from '@config/thresholds.config';
import type { Validator } from './validator';

/** Per-endpoint switches. Each centralized validator belongs to exactly one switch. */
export interface ValidationToggles {
  authentication: boolean;
  authorization: boolean;
  statusCode: boolean;
  request: boolean;
  responseStructure: boolean;
  responseSchema: boolean;
  contentType: boolean;
  headers: boolean;
  errorFormat: boolean;
  pagination: boolean;
  performance: boolean;
  security: boolean;
  commonData: boolean;
  businessRules: boolean;
  database: boolean;
}
export type ValidationToggle = keyof ValidationToggles;

/** Everything is on by default; endpoints only list what they turn off. */
export const DEFAULT_POLICY: Readonly<ValidationToggles> = Object.freeze({
  authentication: true,
  authorization: true,
  statusCode: true,
  request: true,
  responseStructure: true,
  responseSchema: true,
  contentType: true,
  headers: true,
  errorFormat: true,
  pagination: true,
  performance: true,
  security: true,
  commonData: true,
  businessRules: true,
  database: true,
});

/**
 * Profile groups validators use to declare where they run:
 * - SMOKE: cheap checks on the happy-path response (+ missing-token)
 * - REGRESSION: + negative auth/authz/request probes, business rules, DB checks
 * - SECURITY: auth/authz + injection, XSS, JWT, rate limiting, leakage
 * - FULL: everything
 */
export const PROFILE_SETS = {
  ALL: VALIDATION_PROFILES,
  DEEP: ['REGRESSION', 'FULL'],
  SECURITY: ['SECURITY', 'FULL'],
  DEEP_AND_SECURITY: ['REGRESSION', 'SECURITY', 'FULL'],
} as const satisfies Record<string, readonly ValidationProfile[]>;

/** An EndpointDefinition with every central default applied. Validators only read this. */
export interface ResolvedEndpoint {
  /** The response contract this endpoint follows; validators read the envelope from it. */
  contract: ResponseContract;
  definition: EndpointDefinition;
  id: string;
  method: HttpMethod;
  path: string;
  label: string;
  tags: readonly string[];
  /** Owning module: decides base URL, Bugzilla product/component and the responsible developer. */
  suite: SuiteOwnership;
  expectedStatus: readonly number[];
  contentType: string;
  envelope: boolean;
  authentication: {
    required: boolean;
    role: Role;
    failureStatus: Record<AuthFailureMode, readonly number[]>;
  };
  authorization: {
    roles: readonly Role[];
    tenantScoped: boolean;
    deniedStatus: readonly number[];
    privilegeEscalation?: NonNullable<EndpointDefinition['authorization']>['privilegeEscalation'];
  };
  requestSchema?: ContractSchema;
  pathParamsSchema?: ContractSchema;
  querySchema?: ContractSchema;
  invalidRequestStatus: readonly number[];
  responseSchema?: ContractSchema;
  pagination: boolean;
  requiredHeaders: readonly string[];
  sideEffect: SideEffect;
  /** Cleared to run against the live application. Absent means blocked when TEST_ENV=production. */
  productionSafe: boolean;
  /** Cannot complete without a real OTP, so it is skipped on the live application. */
  otpDependent?: 'sends' | 'consumes' | 'requires';
  /** The bench's own fixture: always served by the mock, so the live rules do not apply to it. */
  mockFixture: boolean;
  performance: { maxResponseTimeMs: number; maxPayloadBytes: number; timeoutMs: number };
  security: NonNullable<EndpointDefinition['security']>;
  validations: ValidationToggles;
  skipValidators: readonly string[];
  businessRules: readonly string[];
  databaseValidations: readonly string[];
  destructive: boolean;
}

const MUTATING_METHODS: readonly HttpMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

export function resolveEndpoint(definition: EndpointDefinition): ResolvedEndpoint {
  const contract = responseContract(definition.responseContract);
  const roles = definition.authorization?.roles ?? [];
  /*
   * The default role belongs to the API being tested, not to the bench. KPost has no ADMIN
   * principal - its accounts are USER (personal) and COMPANY_ADMIN (business) - so falling back to
   * the mock's ADMIN default made every authenticated KPost endpoint fail with "no principal
   * configured for role ADMIN": 82 cases reporting a configuration mismatch as an API failure.
   */
  const profileDefaultRole = authProfileFor(definition).defaultRole;
  const primaryRole =
    definition.authentication?.role ??
    (roles.length === 0 || roles.includes(profileDefaultRole) ? profileDefaultRole : roles[0]) ??
    profileDefaultRole;

  return {
    definition,
    id: definition.id,
    method: definition.method,
    path: definition.path,
    label: `${definition.method} ${definition.path}`,
    tags: definition.tags ?? [],
    suite: suiteFor(definition.suite ?? DEFAULT_SUITE),
    contract,
    expectedStatus: definition.expectedStatus ?? contract.expectedStatus[definition.method],
    contentType: definition.contentType ?? apiConfig.defaultContentType,
    envelope: definition.envelope ?? true,
    authentication: {
      required: definition.authentication?.required ?? true,
      role: primaryRole,
      failureStatus: { ...authConfig.failureStatus, ...definition.authentication?.failureStatus },
    },
    authorization: {
      roles,
      tenantScoped: definition.authorization?.tenantScoped ?? false,
      deniedStatus: definition.authorization?.deniedStatus ?? authConfig.deniedStatus,
      privilegeEscalation: definition.authorization?.privilegeEscalation,
    },
    requestSchema: definition.requestSchema,
    pathParamsSchema: definition.pathParamsSchema,
    querySchema: definition.querySchema,
    invalidRequestStatus: definition.invalidRequestStatus ?? apiConfig.invalidRequestStatus,
    responseSchema: definition.responseSchema,
    pagination: definition.pagination ?? false,
    sideEffect: definition.sideEffect ?? 'data',
    /*
     * Default false, deliberately. An endpoint reaches the live application only because somebody
     * wrote the flag and said why - never because a default let it through.
     */
    productionSafe: definition.productionSafe ?? false,
    otpDependent: definition.otpDependent,
    mockFixture: definition.mockFixture ?? false,
    requiredHeaders: [...contract.requiredHeaders, ...(definition.headers?.required ?? [])],
    performance: {
      maxResponseTimeMs:
        definition.performance?.maxResponseTimeMs ??
        thresholds.responseTime.maxMsByMethod[definition.method] ??
        thresholds.responseTime.defaultMaxMs,
      maxPayloadBytes:
        definition.performance?.maxPayloadBytes ?? thresholds.payload.maxResponseBytes,
      timeoutMs: definition.performance?.timeoutMs ?? thresholds.requestTimeoutMs,
    },
    security: definition.security ?? {},
    validations: { ...DEFAULT_POLICY, ...definition.validations },
    skipValidators: definition.skipValidators ?? [],
    businessRules: definition.businessRules ?? [],
    databaseValidations: definition.database?.validations ?? [],
    destructive: definition.destructive ?? MUTATING_METHODS.includes(definition.method),
  };
}

/** Why the endpoint's policy switches this validator off, or undefined when it is enabled. */
export function policyExclusion(
  validator: Pick<Validator, 'name' | 'toggle'>,
  endpoint: ResolvedEndpoint,
): string | undefined {
  /*
   * The live application first: a validator that modifies and re-sends the request is not run
   * there at all, whatever the endpoint's own policy says. Checked before the per-endpoint
   * toggles so that no endpoint configuration can re-enable it. See production-validators.ts.
   */
  if (env.IS_PRODUCTION && !endpoint.mockFixture) {
    const excluded = productionExclusion(validator.name);
    if (excluded) return excluded;
  }
  if (endpoint.skipValidators.includes(validator.name)) {
    return `disabled for this endpoint (skipValidators includes "${validator.name}")`;
  }
  if (!endpoint.validations[validator.toggle]) {
    return `disabled for this endpoint (validations.${validator.toggle} = false)`;
  }
  return undefined;
}
