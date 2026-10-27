import type { ApiClientPool } from '@api/client/api-client-pool';
import type { HttpMethod } from '@api/client/request-builder';
import { RequestBuilder, type RequestSpec } from '@api/client/request-builder';
import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { TokenProvider } from '@api/client/token-provider';
import { browserSessionToken } from '@api/client/browser-session-token';
import type { ApiRegistry } from '@api/registry/api-registry';
import type { RequestFactoryHelpers } from '@api/registry/endpoint-definition';
import { authProfileFor, principalForRole, type AuthProfile } from '@config/auth-profile';
import { authConfig, type Principal, type Role } from '@config/auth.config';
import { env } from '@config/env';
import { newCorrelationId } from '@utils/correlation';
import { deepMerge, getPath } from '@utils/json';
import type { Logger } from '@utils/logger';
import { maskString } from '@utils/masking';
import { type BusinessRuleFinding, type FlowFinding, isServerError } from './flow-finding';
import { destructiveBlockReason, ProductionSafetyError } from './production-guard';
import { assertQaOwnedIdentifiers } from './qa-identifier-guard';
import { resolveEndpoint, type ResolvedEndpoint } from './validation-policy';
import { oldestExpiredToken, recordToken } from './token-history';

/** How a request authenticates: as a role, as a specific principal, or with a raw header. */
export type AuthMode = { role: Role } | { principal: Principal } | { header: string | undefined };

export interface SendOptions {
  /** Identifies the exchange in logs and reports, e.g. `authentication.missing-token`. */
  label: string;
  /** Default: the endpoint's primary role (or no header for public endpoints). */
  auth?: AuthMode;
  timeoutMs?: number;
  /** Override the HTTP method (the method-not-allowed probe only). */
  method?: HttpMethod;
  /** Override the Content-Type, for the unsupported-media-type probe. */
  contentType?: string;
  /** Authorize this `data` write on live (see SafetyFlags); set per call, never by the engine. */
  allowLiveWrite?: boolean;
  /**
   * Authorize this "needs-id" read on live, for an id the same flow just minted (see SafetyFlags).
   */
  allowLiveRead?: boolean;
  /** The request names a non-existent account/mobile, so an SMS sender texts nobody. */
  noSmsRecipient?: boolean;
  /**
   * Exact identifier values this call's own flow just minted, trusted by the QA-identifier guard
   * for this request only. Set by a lifecycle spec from its own write's response, never by the
   * engine.
   */
  ownedIdentifiers?: readonly (string | number)[];
}

const MAX_ERROR_BODY_CHARS = 300;

/** Executes registered endpoints: builds requests, attaches credentials, enforces prod safety. */
export class EndpointExecutor {
  readonly tokens: TokenProvider;

  /** 5xx responses from gated lifecycle flows, filed by the `endpoints` fixture (4xx are not). */
  readonly flowFindings: FlowFinding[] = [];

  /**
   * Business-rule violations a feature flow confirmed on live, filed by the `endpoints` fixture.
   */
  readonly businessRuleFindings: BusinessRuleFinding[] = [];

  /** Records a business-rule violation; only when the response or state proves the rule broken. */
  recordBusinessRuleViolation(input: {
    endpointId: string;
    ruleId: string;
    rule: string;
    expected: unknown;
    actual: unknown;
    request?: RequestSpec;
    correlationId?: string;
  }): void {
    this.businessRuleFindings.push({
      endpoint: resolveEndpoint(this.apiRegistry.get(input.endpointId)),
      ruleId: input.ruleId,
      rule: input.rule,
      expected: input.expected,
      actual: input.actual,
      request: input.request ?? {},
      correlationId: input.correlationId ?? newCorrelationId('br'),
    });
  }

  private readonly ownedIdentifiers: readonly (string | number)[];

  constructor(
    private readonly clients: ApiClientPool,
    private readonly apiRegistry: ApiRegistry,
    private readonly log: Logger,
    /** `shareBrowserSessions`: reuse the browser's token (an API login would sign it out). */
    options: {
      shareBrowserSessions?: boolean;
      /** Values this executor's flow minted, trusted by the QA-identifier guard on its requests. */
      ownedIdentifiers?: readonly (string | number)[];
    } = {},
  ) {
    this.ownedIdentifiers = options.ownedIdentifiers ?? [];
    this.tokens = new TokenProvider(
      (principal, profile) => this.login(principal, profile),
      env.API_BASE_URL,
      options.shareBrowserSessions ? (p) => browserSessionToken(p.username) : undefined,
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
    const blocked = destructiveBlockReason(endpoint, {
      isProduction: env.IS_PRODUCTION,
      allowDestructive: env.ALLOW_DESTRUCTIVE_TESTS,
      allowLiveWrite: options.allowLiveWrite,
      allowLiveRead: options.allowLiveRead,
      noSmsRecipient: options.noSmsRecipient,
      // Deep write-fuzz on a disposable test DB (both required); opens only `data` writes.
      writeFuzz: env.WRITE_FUZZ,
      testDbMode: env.TEST_DB_MODE,
      // OTP test-gateway (with TEST_DB_MODE): opens the OTP/signup flows on the disposable test DB.
      otpTestGateway: env.OTP_TEST_GATEWAY,
    });
    if (blocked) throw new ProductionSafetyError(blocked);

    // Every request passes here, the one place that sees the payload as sent, so ids are checked.
    assertQaOwnedIdentifiers(
      { body: spec.body, query: spec.query, pathParams: spec.pathParams },
      options.label ?? endpoint.label,
      env.IS_PRODUCTION,
      [...this.ownedIdentifiers, ...(options.ownedIdentifiers ?? [])],
    );

    const request = RequestBuilder.for(options.method ?? endpoint.method, endpoint.path)
      .withSpec(
        options.contentType
          ? { ...spec, headers: { ...spec.headers, 'content-type': options.contentType } }
          : spec,
      )
      .timeoutMs(options.timeoutMs ?? endpoint.performance.timeoutMs)
      .authorization(await this.authorizationFor(endpoint, options.auth))
      .build();
    // Each module has its own host, so the client follows the endpoint's suite.
    const client = await this.clients.get(endpoint.suite);
    const exchange = await client.execute(request, options.label);

    // A 5xx during an authorized lifecycle call is a fileable defect; a 4xx may be our payload.
    if ((options.allowLiveWrite || options.allowLiveRead) && isServerError(exchange.status)) {
      this.flowFindings.push({
        endpoint,
        method: options.method ?? endpoint.method,
        status: exchange.status,
        body: exchange.bodyText,
        request: spec,
        correlationId: exchange.correlationId,
      });
    }
    return exchange;
  }

  /** Sends a literal request to a registered endpoint (no request factory involved). */
  sendTo(endpointId: string, spec: RequestSpec, options: SendOptions): Promise<ApiResponseWrapper> {
    return this.send(resolveEndpoint(this.apiRegistry.get(endpointId)), spec, options);
  }

  /** A principal for `role` from the auth profile. */
  principal(role: Role): Principal {
    const profile = authProfileFor();
    const principal = principalForRole(profile, role);
    if (!principal)
      throw new Error(
        `No ${profile.id} principal configured for role ${role} (see src/config/auth-profile.ts)`,
      );
    return principal;
  }

  /** The principal for `endpoint`: the one it names by key (several share a role), else by role. */
  private principalFor(endpoint: ResolvedEndpoint, roleOverride?: Role): Principal {
    const key = endpoint.authentication.principalKey;
    if (key) {
      const profile = authProfileFor();
      const principal = profile.principals.find((p) => p.key === key);
      if (!principal)
        throw new Error(
          `No ${profile.id} principal with key "${key}" (set its QA_* account in .env; see ` +
            'src/config/auth-profile.ts)',
        );
      return principal;
    }
    return this.principal(roleOverride ?? endpoint.authentication.role);
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

  /** An expired token: EXPIRED_TOKEN if set, else an aged one from an earlier run. */
  expiredToken(): Promise<string | undefined> {
    return Promise.resolve(env.EXPIRED_TOKEN ?? oldestExpiredToken());
  }

  private async authorizationFor(
    endpoint: ResolvedEndpoint,
    auth?: AuthMode,
  ): Promise<string | undefined> {
    if (auth && 'header' in auth) return auth.header;
    if (!auth && !endpoint.authentication.required) return undefined;
    const profile = authProfileFor();
    const principal =
      auth && 'principal' in auth ? auth.principal : this.principalFor(endpoint, auth?.role);
    const token = await this.tokens.tokenFor(principal, profile);
    // Recorded so a later run's expired-token check has an aged token.
    recordToken(token);
    return `${profile.scheme} ${token}`;
  }

  /**
   * Logs in and returns a token the resource endpoints accept. Known defect: some logins mint a
   * token every endpoint 401s, so each token is canaried and the login retried.
   */
  private async login(principal: Principal, profile: AuthProfile): Promise<string> {
    // A principal may name its own login endpoint (BUSINESS_M/L → adminUserLogin); else the profile's.
    const endpoint = resolveEndpoint(
      this.apiRegistry.get(principal.loginEndpointId ?? profile.loginEndpointId),
    );
    const MAX_LOGIN_ATTEMPTS = 8;
    let lastReason = 'unknown';
    for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
      const exchange = await this.send(endpoint, profile.loginRequest(principal), {
        label: 'setup:login',
        auth: { header: undefined },
      });
      const parsed = exchange.json();
      const token = parsed.ok ? getPath(parsed.value, profile.tokenPath) : undefined;
      if (!endpoint.expectedStatus.includes(exchange.status) || typeof token !== 'string') {
        lastReason = `login endpoint answered HTTP ${exchange.status} (correlationId ${exchange.correlationId})`;
        continue;
      }
      if (await this.tokenIsAccepted(profile, principal, token)) {
        if (attempt > 1) {
          this.log.warn(
            `principal "${principal.key}": discarded ${attempt - 1} unusable token(s) before a working one — KPost intermittent-auth defect (login mints a token the API 401s)`,
          );
        }
        this.log.debug(`Authenticated principal "${principal.key}"`);
        return token;
      }
      lastReason = 'the minted token was rejected (401) by the verification endpoint';
      this.log.debug(
        `principal "${principal.key}": token rejected on attempt ${attempt}/${MAX_LOGIN_ATTEMPTS}, re-logging in`,
      );
    }
    throw new Error(
      `Login failed for principal "${principal.key}" after ${MAX_LOGIN_ATTEMPTS} attempts: ${lastReason}. ` +
        `This is the KPost intermittent-auth defect if the reason is a rejected token.`,
    );
  }

  /**
   * Whether a token-required endpoint accepts this token: only 401/403 is a rejection; a transport
   * error counts as accepted.
   */
  private async tokenIsAccepted(
    profile: AuthProfile,
    principal: Principal,
    token: string,
  ): Promise<boolean> {
    try {
      // The canary must require a token: myContacts does; fetchUserDetails is public.
      const canary = resolveEndpoint(this.apiRegistry.get('contacts-my-contacts'));
      const res = await this.send(
        canary,
        { body: { lastfetchDate: null } },
        { label: 'setup:verify-token', auth: { header: `${profile.scheme} ${token}` } },
      );
      return res.status !== 401 && res.status !== 403;
    } catch {
      return true;
    }
  }
}
