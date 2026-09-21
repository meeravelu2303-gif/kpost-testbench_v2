import type { RequestSpec } from '@api/client/request-builder';
import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import type { RequestFactoryHelpers } from '@api/registry/endpoint-definition';
import { authProfileFor, principalForRole } from '@config/auth-profile';
import { type Principal, type Role } from '@config/auth.config';
import type { ValidationProfile } from '@config/constants';
import { deepMerge } from '@utils/json';
import type { Logger } from '@utils/logger';
import type { EndpointExecutor, SendOptions } from './endpoint-executor';
import type { ResolvedEndpoint } from './validation-policy';
import type { ValidationResult } from './validation-result';

export interface RunInfo {
  environment: string;
  build: string;
  testRunId: string;
}

/**
 * Everything a validator may read or do. Validators never touch Playwright, config files or
 * credentials directly — they go through this context.
 */
export interface ValidationContext {
  readonly endpoint: ResolvedEndpoint;
  readonly profile: ValidationProfile;
  readonly run: RunInfo;
  /** Correlation ID of the primary exchange. */
  readonly correlationId: string;
  /** The valid request used for the primary exchange. */
  readonly request: RequestSpec;
  /** Happy-path exchange, sent once with valid credentials before any validator runs. */
  readonly primary: ApiResponseWrapper;
  /** Primary exchange plus every probe sent so far. */
  readonly exchanges: readonly ApiResponseWrapper[];
  readonly log: Logger;

  resultOf(validatorName: string): ValidationResult | undefined;
  /**
   * A valid request for a probe. GET reuses the primary request; mutating endpoints get fresh
   * data from the endpoint's request factory so probes never collide (duplicates, deleted IDs).
   */
  nextRequest(overrides?: RequestSpec): Promise<RequestSpec>;
  /** Sends a request to this endpoint and records the exchange. */
  send(spec: RequestSpec, options: SendOptions): Promise<ApiResponseWrapper>;
  call: RequestFactoryHelpers['call'];
  /** Helpers for invoking request factories from validators (e.g. rate-limit probes). */
  readonly helpers: RequestFactoryHelpers;
  principal(role: Role, options?: { foreignTenantOf?: string }): Principal | undefined;
  /**
   * Every configured principal for a role, in declaration order.
   *
   * `principal()` returns the first match, which is all a single-caller probe needs. Proving that
   * two sessions stay isolated needs two real accounts in flight at once, and the count matters to
   * the verdict: with one principal configured the probe must report SKIPPED, never PASSED — "no
   * second caller was available" and "two callers did not interfere" are different facts, and
   * reporting the first as the second is how a bench claims coverage it does not have.
   */
  principals(role: Role): readonly Principal[];
  tokenFor(principal: Principal): Promise<string>;
  expiredToken(): Promise<string | undefined>;
}

interface ContextDeps {
  endpoint: ResolvedEndpoint;
  profile: ValidationProfile;
  run: RunInfo;
  request: RequestSpec;
  primary: ApiResponseWrapper;
  log: Logger;
  executor: EndpointExecutor;
  results: readonly ValidationResult[];
}

export class EngineValidationContext implements ValidationContext {
  private readonly recorded: ApiResponseWrapper[];

  constructor(private readonly deps: ContextDeps) {
    this.recorded = [deps.primary];
  }

  get endpoint(): ResolvedEndpoint {
    return this.deps.endpoint;
  }
  get profile(): ValidationProfile {
    return this.deps.profile;
  }
  get run(): RunInfo {
    return this.deps.run;
  }
  get correlationId(): string {
    return this.deps.primary.correlationId;
  }
  get request(): RequestSpec {
    return this.deps.request;
  }
  get primary(): ApiResponseWrapper {
    return this.deps.primary;
  }
  get exchanges(): readonly ApiResponseWrapper[] {
    return this.recorded;
  }
  get log(): Logger {
    return this.deps.log;
  }

  resultOf(validatorName: string): ValidationResult | undefined {
    return this.deps.results.find((r) => r.validatorName === validatorName);
  }

  nextRequest(overrides?: RequestSpec): Promise<RequestSpec> {
    if (this.endpoint.method === 'GET') return Promise.resolve(deepMerge(this.request, overrides));
    return this.deps.executor.buildRequest(this.endpoint, overrides);
  }

  async send(spec: RequestSpec, options: SendOptions): Promise<ApiResponseWrapper> {
    const exchange = await this.deps.executor.send(this.endpoint, spec, options);
    this.recorded.push(exchange);
    return exchange;
  }

  call: RequestFactoryHelpers['call'] = (endpointId, overrides) =>
    this.deps.executor.call(endpointId, overrides);

  get helpers(): RequestFactoryHelpers {
    return this.deps.executor.helpers;
  }

  principal(role: Role, options?: { foreignTenantOf?: string }): Principal | undefined {
    return principalForRole(authProfileFor(this.endpoint.definition), role, options);
  }

  principals(role: Role): readonly Principal[] {
    return authProfileFor(this.endpoint.definition).principals.filter((p) => p.role === role);
  }

  tokenFor(principal: Principal): Promise<string> {
    // The endpoint under validation decides which API issues the token.
    return this.deps.executor.tokens.tokenFor(principal, authProfileFor(this.endpoint.definition));
  }

  expiredToken(): Promise<string | undefined> {
    return this.deps.executor.expiredToken();
  }
}
