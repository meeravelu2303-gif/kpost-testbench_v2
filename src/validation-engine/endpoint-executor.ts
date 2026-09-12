import type { ApiClientPool } from '@api/client/api-client-pool';
import { RequestBuilder, type RequestSpec } from '@api/client/request-builder';
import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { TokenProvider } from '@api/client/token-provider';
import type { ApiRegistry } from '@api/registry/api-registry';
import type { RequestFactoryHelpers } from '@api/registry/endpoint-definition';
import {
  AUTH_PROFILES,
  authProfileFor,
  principalForRole,
  type AuthProfile,
} from '@config/auth-profile';
import { authConfig, type Principal, type Role } from '@config/auth.config';
import { suiteFor } from '@config/ownership.config';
import { env } from '@config/env';
import { deepMerge, getPath } from '@utils/json';
import type { Logger } from '@utils/logger';
import { maskString } from '@utils/masking';
import { destructiveBlockReason, ProductionSafetyError } from './production-guard';
import { resolveEndpoint, type ResolvedEndpoint } from './validation-policy';

/** How a request authenticates: as a role, as a specific principal, or with a raw header. */
export type AuthMode = { role: Role } | { principal: Principal } | { header: string | undefined };

export interface SendOptions {
  /** Identifies the exchange in logs and reports, e.g. `authentication.missing-token`. */
  label: string;
  /** Default: the endpoint's primary role (or no header for public endpoints). */
  auth?: AuthMode;
  timeoutMs?: number;
}

const MAX_ERROR_BODY_CHARS = 300;

/** Executes registered endpoints: builds requests, attaches credentials, enforces prod safety. */
export class EndpointExecutor {
  readonly tokens: TokenProvider;

  constructor(
    private readonly clients: ApiClientPool,
    private readonly apiRegistry: ApiRegistry,
    private readonly log: Logger,
  ) {
    this.tokens = new TokenProvider(
      (principal, profile) => this.login(principal, profile),
      env.API_BASE_URL,
    );
  }

  get helpers(): RequestFactoryHelpers {
    return {
      call: (endpointId, overrides) => this.call(endpointId, overrides),
      get tenantId(): string {
        if (!authConfig.testTenantId) throw new Error('TEST_COMPANY_ID is not configured');
        return authConfig.testTenantId;
      },
    };
  }

  async buildRequest(endpoint: ResolvedEndpoint, overrides?: RequestSpec): Promise<RequestSpec> {
    const base = endpoint.definition.request ? await endpoint.definition.request(this.helpers) : {};
    return overrides ? deepMerge(base, overrides) : base;
  }

  async send(
    endpoint: ResolvedEndpoint,
    spec: RequestSpec,
    options: SendOptions,
  ): Promise<ApiResponseWrapper> {
    const blocked = destructiveBlockReason(endpoint);
    if (blocked) throw new ProductionSafetyError(blocked);

    const request = RequestBuilder.for(endpoint.method, endpoint.path)
      .withSpec(spec)
      .timeoutMs(options.timeoutMs ?? endpoint.performance.timeoutMs)
      .authorization(await this.authorizationFor(endpoint, options.auth))
      .build();
    // Each module has its own host, so the client follows the endpoint's suite - unless the
    // endpoint is one of the bench's own mock fixtures, which always uses the mock's base URL.
    const client = await this.clients.get(
      endpoint.definition.mockFixture
        ? { ...endpoint.suite, id: `${endpoint.suite.id}:mock`, baseUrl: env.API_BASE_URL }
        : endpoint.suite,
    );
    return client.execute(request, options.label);
  }

  /** Sends a literal request to a registered endpoint (no request factory involved). */
  sendTo(endpointId: string, spec: RequestSpec, options: SendOptions): Promise<ApiResponseWrapper> {
    return this.send(resolveEndpoint(this.apiRegistry.get(endpointId)), spec, options);
  }

  /** A principal for `role` from the profile that owns `endpoint`. */
  principal(role: Role, endpoint?: ResolvedEndpoint): Principal {
    const profile = endpoint ? authProfileFor(endpoint.definition) : AUTH_PROFILES.mock;
    const principal = principalForRole(profile, role);
    if (!principal)
      throw new Error(
        `No ${profile.id} principal configured for role ${role} (see src/config/auth-profile.ts)`,
      );
    return principal;
  }

  /** Runs another registered endpoint as test setup and returns its response `data`. */
  async call<T = Record<string, unknown>>(endpointId: string, overrides?: RequestSpec): Promise<T> {
    const endpoint = resolveEndpoint(this.apiRegistry.get(endpointId));
    const exchange = await this.send(endpoint, await this.buildRequest(endpoint, overrides), {
      label: `setup:${endpointId}`,
    });
    if (!endpoint.expectedStatus.includes(exchange.status)) {
      const body = maskString(exchange.bodyText.slice(0, MAX_ERROR_BODY_CHARS));
      throw new Error(
        `Setup call "${endpointId}" returned ${exchange.status}, expected ${endpoint.expectedStatus.join('/')} ` +
          `(correlationId ${exchange.correlationId}): ${body}`,
      );
    }
    const parsed = exchange.json();
    if (!parsed.ok) return undefined as T;
    return (endpoint.envelope ? getPath(parsed.value, 'data') : parsed.value) as T;
  }

  /** A genuinely expired token: from EXPIRED_TOKEN, or minted by the mock API. */
  async expiredToken(): Promise<string | undefined> {
    if (env.EXPIRED_TOKEN) return env.EXPIRED_TOKEN;
    if (!env.MOCK_API) return undefined;
    const client = await this.clients.get(suiteFor());
    const exchange = await client.execute(
      RequestBuilder.for('GET', authConfig.mockExpiredTokenPath).build(),
      'setup:expired-token',
    );
    const parsed = exchange.json();
    const token = parsed.ok ? getPath(parsed.value, 'data.token') : undefined;
    return typeof token === 'string' ? token : undefined;
  }

  private async authorizationFor(
    endpoint: ResolvedEndpoint,
    auth?: AuthMode,
  ): Promise<string | undefined> {
    if (auth && 'header' in auth) return auth.header;
    if (!auth && !endpoint.authentication.required) return undefined;
    const profile = authProfileFor(endpoint.definition);
    const principal =
      auth && 'principal' in auth
        ? auth.principal
        : this.principal(auth?.role ?? endpoint.authentication.role, endpoint);
    return `${profile.scheme} ${await this.tokens.tokenFor(principal, profile)}`;
  }

  /*
   * The profile follows the endpoint being tested, not a global: a token minted by the mock and
   * sent to the live API would be rejected as invalid and read like an API defect.
   */
  private async login(principal: Principal, profile: AuthProfile): Promise<string> {
    const endpoint = resolveEndpoint(this.apiRegistry.get(profile.loginEndpointId));
    const exchange = await this.send(endpoint, profile.loginRequest(principal), {
      label: 'setup:login',
      auth: { header: undefined },
    });
    const parsed = exchange.json();
    const token = parsed.ok ? getPath(parsed.value, profile.tokenPath) : undefined;
    if (!endpoint.expectedStatus.includes(exchange.status) || typeof token !== 'string') {
      throw new Error(
        `Login failed for principal "${principal.key}" (HTTP ${exchange.status}, correlationId ${exchange.correlationId})`,
      );
    }
    this.log.debug(`Authenticated principal "${principal.key}"`);
    return token;
  }
}
