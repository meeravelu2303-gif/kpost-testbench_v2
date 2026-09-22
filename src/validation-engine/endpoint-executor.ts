import type { ApiClientPool } from '@api/client/api-client-pool';
import type { HttpMethod } from '@api/client/request-builder';
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
  /**
   * Override the HTTP method. Used only by the method-not-allowed probe, which deliberately calls
   * an endpoint with a verb it does not implement.
   */
  method?: HttpMethod;
  /** Override the Content-Type, for the unsupported-media-type probe. */
  contentType?: string;
  /**
   * Explicitly authorize a `data` write to run on the live application (see SafetyFlags). Only an
   * owner-approved feature spec sets this, per call; the engine never does, so its probes stay
   * blocked. The QA-identifier guard still confines the payload to accounts we own.
   */
  allowLiveWrite?: boolean;
}

const MAX_ERROR_BODY_CHARS = 300;

/** Executes registered endpoints: builds requests, attaches credentials, enforces prod safety. */
export class EndpointExecutor {
  readonly tokens: TokenProvider;

  /**
   * Server errors (5xx) seen while a gated lifecycle flow drove a real write (`allowLiveWrite`).
   * Drained by the `endpoints` fixture at test end and filed to Bugzilla — a lifecycle crash the
   * developer would otherwise never see. Only 5xx: a 4xx might be our payload, so it is never filed.
   */
  readonly flowFindings: FlowFinding[] = [];

  /**
   * Documented BUSINESS-RULE violations a gated feature flow CONFIRMED on live (reschedule created a
   * new id, a recalled message stayed visible, …). A spec calls `recordBusinessRuleViolation` only for
   * a real rule violation — never a bench/selector failure — and the `endpoints` fixture files them.
   */
  readonly businessRuleFindings: BusinessRuleFinding[] = [];

  /**
   * Record a confirmed business-rule violation for filing. Call this ONLY when the response/state
   * proves the rule is broken (e.g. `rescheduledId !== kallID` for BR-C01), not on a bench failure.
   */
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
    const blocked = destructiveBlockReason(endpoint, {
      isProduction: env.IS_PRODUCTION,
      allowDestructive: env.ALLOW_DESTRUCTIVE_TESTS,
      allowLiveWrite: options.allowLiveWrite,
      // Threads the mock/real-host signal so the SMS/OTP kill-switch blocks OTP senders against a
      // real host in EVERY mode, while still letting them run against the bundled mock.
      mockApi: env.MOCK_API,
      // Deep write-fuzz on a disposable test DB (both required); opens only `data` writes.
      writeFuzz: env.WRITE_FUZZ,
      testDbMode: env.TEST_DB_MODE,
      // OTP test-gateway (with TEST_DB_MODE): opens the OTP/signup flows on the disposable test DB.
      otpTestGateway: env.OTP_TEST_GATEWAY,
    });
    if (blocked) throw new ProductionSafetyError(blocked);

    /*
     * Every request passes through here - primary calls, probe mutations and setup chains alike -
     * which is the only place that can see the payload as it will actually be sent. On the live
     * application an identifier we do not own is refused here, because several endpoints act on
     * the id in the payload rather than on the caller (see qa-identifier-guard.ts).
     */
    assertQaOwnedIdentifiers(
      { body: spec.body, query: spec.query, pathParams: spec.pathParams },
      options.label ?? endpoint.label,
      // A mock fixture goes to the bundled mock server, so its ids name nothing real.
      env.IS_PRODUCTION && !endpoint.definition.mockFixture,
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
    // Each module has its own host, so the client follows the endpoint's suite - unless the
    // endpoint is one of the bench's own mock fixtures, which always uses the mock's base URL.
    const client = await this.clients.get(
      endpoint.definition.mockFixture
        ? { ...endpoint.suite, id: `${endpoint.suite.id}:mock`, baseUrl: env.API_BASE_URL }
        : endpoint.suite,
    );
    const exchange = await client.execute(request, options.label);

    // A server error while an owner-authorized lifecycle flow drove a real write is a fileable
    // product defect (a server must never 5xx — even bad input warrants a 4xx). Collected here, at
    // the one chokepoint every flow call passes through, and filed by the fixture. A 4xx is NOT
    // collected: it might be our payload, and the feature spec's own assertions surface it.
    if (
      options.allowLiveWrite &&
      isServerError(exchange.status) &&
      !endpoint.definition.mockFixture
    ) {
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

  /**
   * The principal to run `endpoint`'s primary request as: the exact one it names by key when it does
   * (the Admin module names `business-m`, since several principals share COMPANY_ADMIN), else a
   * principal for the role.
   */
  private principalFor(endpoint: ResolvedEndpoint, roleOverride?: Role): Principal {
    const key = endpoint.authentication.principalKey;
    if (key) {
      const profile = authProfileFor(endpoint.definition);
      const principal = profile.principals.find((p) => p.key === key);
      if (!principal)
        throw new Error(
          `No ${profile.id} principal with key "${key}" (set its QA_* account in .env; see ` +
            'src/config/auth-profile.ts)',
        );
      return principal;
    }
    return this.principal(roleOverride ?? endpoint.authentication.role, endpoint);
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

  /**
   * A genuinely expired token, in order of preference:
   *   1. EXPIRED_TOKEN, when someone set it explicitly (a manual override always wins);
   *   2. the newest token from an EARLIER run that has since aged past its exp (the automatic path —
   *      see token-history.ts, this is what stops the check skipping without any manual step);
   *   3. one minted on demand by the mock API, when running against the mock.
   * Undefined only on a brand-new checkout that has not yet run long enough for a token to mature.
   */
  async expiredToken(): Promise<string | undefined> {
    if (env.EXPIRED_TOKEN) return env.EXPIRED_TOKEN;
    const aged = oldestExpiredToken();
    if (aged) return aged;
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
      auth && 'principal' in auth ? auth.principal : this.principalFor(endpoint, auth?.role);
    const token = await this.tokens.tokenFor(principal, profile);
    /*
     * Record every real KPost token as it is minted, so a later run's expired-token check has an
     * aged one to use and never has to skip. Gated on the live KPost auth: the mock's tokens are not
     * worth aging, and only KPost issues the ones the check is about.
     */
    if (!env.MOCK_API && profile.id === 'kpost') recordToken(token);
    return `${profile.scheme} ${token}`;
  }

  /*
   * The profile follows the endpoint being tested, not a global: a token minted by the mock and
   * sent to the live API would be rejected as invalid and read like an API defect.
   */
  /**
   * Log in and return a token the resource endpoints will actually ACCEPT.
   *
   * KPost's auth is non-deterministic (as of the 2026-09 deploy): roughly half of all logins return
   * HTTP 200 with a well-formed, unexpired token that every authenticated endpoint then rejects with
   * 401 "UNAUTHORIZED USER" — the login session is not shared across backend instances (filed as its
   * own defect). A single such token 401s every call in the run and floods the report with hundreds
   * of false defects. So this canaries the minted token against a lightweight authed endpoint and
   * re-logs-in until it holds one the API accepts, or gives up after MAX_LOGIN_ATTEMPTS.
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
   * Does a resource endpoint actually accept this token? Canaries it against a lightweight, read-only
   * authed endpoint (fetchUserDetails on the caller's own account). 401/403 means the token was NOT
   * accepted (the intermittent-auth defect); anything else (200, 404, even 500) means auth passed and
   * only the resource result differs. Only the real KPost auth is affected, so the mock is exempt. A
   * transport error is not a verdict — treat as accepted rather than loop on a network blip.
   */
  private async tokenIsAccepted(
    profile: AuthProfile,
    principal: Principal,
    token: string,
  ): Promise<boolean> {
    if (env.MOCK_API || profile.id !== 'kpost') return true;
    try {
      const canary = resolveEndpoint(this.apiRegistry.get('signup-login-fetch-user-details'));
      const res = await this.send(
        canary,
        { body: { kpostID: principal.username } },
        { label: 'setup:verify-token', auth: { header: `${profile.scheme} ${token}` } },
      );
      return res.status !== 401 && res.status !== 403;
    } catch {
      return true;
    }
  }
}
