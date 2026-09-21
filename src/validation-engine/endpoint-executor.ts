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
import { captureExchange, withOrigin, type ExchangeEvidence } from '../failure-analysis/index';
import {
  describeCleanupBody,
  type BusinessRuleFinding,
  type CleanupServerError,
  type FlowFinding,
  isServerError,
} from './flow-finding';
import { destructiveBlockReason, ProductionSafetyError } from './production-guard';
import { assertQaOwnedIdentifiers } from './qa-identifier-guard';
import { resolveEndpoint, type ResolvedEndpoint } from './validation-policy';

/** How a request authenticates: as a role, as a specific principal, or with a raw header. */
export type AuthMode = { role: Role } | { principal: Principal } | { header: string | undefined };

/**
 * Which part of the test lifecycle a request belongs to.
 *
 * Phase 3 §12/§14. Before this, every call through the chokepoint looked alike, so a teardown delete
 * that 5xx'd was indistinguishable from the behaviour under test and became a product-defect
 * candidate (`FlowFinding`). The phase is what separates them.
 *
 * **Exactly three, and deliberately no more.** The Phase 3 design sketched five; the other two are
 * not warranted by the architecture as it stands, and an unused phase is a value nobody sets
 * correctly:
 *
 *  - a **probe** already identifies itself through `SendOptions.label`
 *    (`authentication.missing-token`, …) and is engine-internal — the engine never sets
 *    `allowLiveWrite`, so a probe cannot reach the flow-finding branch at all; and
 *  - a **verification** read is indistinguishable from an action for every decision made here: both
 *    are the behaviour under test, and both should report a server error.
 *
 * Add a fourth only when a decision actually needs to tell it apart from these three.
 */
export const EXCHANGE_PHASES = ['precondition', 'action', 'cleanup'] as const;
export type ExchangePhase = (typeof EXCHANGE_PHASES)[number];

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
  /**
   * Which part of the lifecycle this call belongs to. Defaults to `action`, so every existing call
   * site keeps its exact behaviour. An ambient scope opened with `withPhase()` takes precedence,
   * because the framework sets that at a boundary it owns (the cleanup fixture) and a closure running
   * inside it cannot opt back out.
   */
  phase?: ExchangePhase;
}

const MAX_ERROR_BODY_CHARS = 300;

/**
 * Evidence bounds per executor. The engine builds one executor per endpoint run, so this caps a
 * single endpoint's exchanges; a lifecycle spec shares one executor for the whole test, which is the
 * case the cap really exists for.
 */
const MAX_EVIDENCE_RECORDS = 500;
const MAX_EVIDENCE_ERRORS = 5;

/**
 * Whether a request to `endpoint` reaches a real KPost host (live OR a test deployment), rather than
 * the bundled mock. The QA-identifier guard applies to every real host, not only to
 * `TEST_ENV=production`: a disposable test DB is still shared with the developers and the other QA
 * accounts, so naming a record we do not own is wrong there too. A mock fixture, or a suite that
 * falls back to the mock's base URL while the mock is running, reaches nothing real.
 */
export function targetsRealHost(endpoint: ResolvedEndpoint): boolean {
  if (endpoint.definition.mockFixture) return false;
  return !(env.MOCK_API && endpoint.suite.baseUrl === env.API_BASE_URL);
}

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
   * Server errors seen while the framework was CLEANING UP (`phase: 'cleanup'`).
   *
   * Kept apart from `flowFindings` on purpose: these are reported on the cleanup dimension and never
   * become a product-defect candidate. Surfaced by the `resources` fixture on the `cleanup-summary`
   * attachment, so a failing teardown stays visible — see `CleanupServerError`.
   */
  readonly cleanupFindings: CleanupServerError[] = [];

  /** The phase of an open `withPhase()` scope, if any. */
  private ambientPhase: ExchangePhase | undefined;

  /**
   * Evidence for every exchange this executor made (Phase 3.2) — observational only.
   *
   * Bounded by `MAX_EVIDENCE_RECORDS` so a long lifecycle cannot grow without limit; once the cap is
   * reached, capture stops and `evidenceOverflow` counts what was not kept, because a silently
   * truncated record set would be worse than a visibly incomplete one.
   */
  readonly exchangeEvidence: ExchangeEvidence[] = [];

  /** Exchanges not captured because the cap was reached. */
  evidenceOverflow = 0;

  /** Capture failures. Evidence never fails a request, so these are counted and reported instead. */
  readonly evidenceErrors: string[] = [];

  /** The stable test case this executor is running for, when the caller knows it. */
  private testCaseId: string | undefined;

  /** Tells the executor which test case its exchanges belong to, so evidence can carry it. */
  forTestCase(testCaseId: string): this {
    this.testCaseId = testCaseId;
    return this;
  }

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
    /*
     * An ambient scope wins over a per-call value: `withPhase()` is opened by the framework at a
     * boundary it owns (the cleanup fixture), so a closure running inside cleanup cannot opt itself
     * back into `action`. Absent both, everything is an action — which is exactly what every call
     * site did before this field existed.
     */
    const phase: ExchangePhase = this.ambientPhase ?? options.phase ?? 'action';

    const blocked = destructiveBlockReason(endpoint, {
      isProduction: env.IS_PRODUCTION,
      allowDestructive: env.ALLOW_DESTRUCTIVE_TESTS,
      allowLiveWrite: options.allowLiveWrite,
      /*
       * Threads the mock/real-host signal so the SMS/OTP kill-switch blocks OTP senders against a
       * real host in EVERY mode, while still letting them run against the bundled mock.
       *
       * This is `targetsRealHost(endpoint)`, NOT `env.MOCK_API`. The two disagree in a case this
       * repository can actually produce: `MOCK_API=true` only redirects a suite whose base URL
       * FELL BACK to the mock's, and every KPost suite takes its own module host from `.env`. So
       * with `MOCK_API=true` and `KPOST_API_BASE_URL` set — what `bench --profile mock` produces —
       * the flag says "mock" while the request still goes to testingapi. Passing the flag there
       * told the kill-switch a real host was unreachable when it was one URL away.
       *
       * `targetsRealHost` is the signal `assertQaOwnedIdentifiers` below already uses, so both
       * controls now answer the same question the same way.
       */
      mockApi: !targetsRealHost(endpoint),
      // Deep write-fuzz on a disposable test DB (both required); opens only `data` writes.
      writeFuzz: env.WRITE_FUZZ,
      testDbMode: env.TEST_DB_MODE,
      // OTP test-gateway (with TEST_DB_MODE): opens the OTP/signup flows on the disposable test DB.
      otpTestGateway: env.OTP_TEST_GATEWAY,
    });
    if (blocked) throw new ProductionSafetyError(blocked);

    /*
     * Every request passes through here - primary calls, probe mutations and setup chains alike -
     * which is the only place that can see the payload as it will actually be sent. On any real
     * host an identifier we do not own is refused here, because several endpoints act on the id in
     * the payload rather than on the caller (see qa-identifier-guard.ts).
     */
    assertQaOwnedIdentifiers(
      {
        body: spec.body,
        query: spec.query,
        pathParams: spec.pathParams,
        multipart: spec.multipart,
        rawBody: spec.rawBody,
      },
      options.label ?? endpoint.label,
      targetsRealHost(endpoint),
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

    /*
     * Evidence is recorded for EVERY exchange, before anything judges it (Phase 3.2). It is
     * observational: it changes no result, and a failure to capture it must never change one
     * either — hence the try/catch that counts rather than throws.
     */
    this.captureEvidence(exchange, endpoint, phase);

    // A server error while an owner-authorized lifecycle flow drove a real write is a fileable
    // product defect (a server must never 5xx — even bad input warrants a 4xx). Collected here, at
    // the one chokepoint every flow call passes through, and filed by the fixture. A 4xx is NOT
    // collected: it might be our payload, and the feature spec's own assertions surface it.
    //
    // ...unless the framework was CLEANING UP. A teardown delete runs after the assertions, on the
    // cleanup dimension, and its response says nothing about the behaviour under test — so it is
    // recorded as a cleanup server error and reported there, never as a product defect.
    if (
      options.allowLiveWrite &&
      isServerError(exchange.status) &&
      !endpoint.definition.mockFixture
    ) {
      if (phase === 'cleanup') {
        this.cleanupFindings.push({
          endpointId: endpoint.id,
          endpoint: endpoint.label,
          method: options.method ?? endpoint.method,
          status: exchange.status,
          label: options.label,
          correlationId: exchange.correlationId,
          body: describeCleanupBody(exchange.bodyText),
        });
      } else {
        this.flowFindings.push({
          endpoint,
          method: options.method ?? endpoint.method,
          status: exchange.status,
          body: exchange.bodyText,
          request: spec,
          correlationId: exchange.correlationId,
        });
      }
    }
    return exchange;
  }

  /**
   * Records what one exchange looked like, with its origin attributed.
   *
   * Total by construction: every failure path counts and continues. Evidence exists to explain a
   * result, so it must never be able to create one.
   */
  private captureEvidence(
    exchange: ApiResponseWrapper,
    endpoint: ResolvedEndpoint,
    phase: ExchangePhase,
  ): void {
    try {
      if (this.exchangeEvidence.length >= MAX_EVIDENCE_RECORDS) {
        this.evidenceOverflow += 1;
        return;
      }
      this.exchangeEvidence.push(
        withOrigin(
          captureExchange(exchange, {
            runId: env.TEST_RUN_ID,
            phase,
            endpointId: endpoint.id,
            endpoint: endpoint.label,
            suite: endpoint.suite.id,
            ...(this.testCaseId ? { testCaseId: this.testCaseId } : {}),
          }),
        ),
      );
    } catch (error) {
      if (this.evidenceErrors.length < MAX_EVIDENCE_ERRORS) {
        this.evidenceErrors.push(
          `${endpoint.id}/${exchange.label}: ${(error as Error).message}`.slice(0, 200),
        );
      }
    }
  }

  /** The phase every request is attributed to right now, absent a per-call override. */
  get phase(): ExchangePhase {
    return this.ambientPhase ?? 'action';
  }

  /**
   * Runs `fn` with every request inside it attributed to `phase`.
   *
   * This is how the cleanup boundary is marked: the `resources` fixture wraps `cleanupAll()`, so
   * EVERY request a cleanup operation makes is cleanup traffic — including the ones inside helpers
   * that know nothing about phases. Relying on each cleanup closure to pass the flag would work only
   * until somebody writes a new one and forgets, which is precisely how the original defect arose.
   *
   * Restores the previous phase in a `finally`, so a throwing operation cannot leave the executor
   * stuck in cleanup for the rest of the test.
   */
  async withPhase<T>(phase: ExchangePhase, fn: () => Promise<T>): Promise<T> {
    const previous = this.ambientPhase;
    this.ambientPhase = phase;
    try {
      return await fn();
    } finally {
      this.ambientPhase = previous;
    }
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
      auth && 'principal' in auth ? auth.principal : this.principalFor(endpoint, auth?.role);
    return `${profile.scheme} ${await this.tokens.tokenFor(principal, profile)}`;
  }

  /*
   * The profile follows the endpoint being tested, not a global: a token minted by the mock and
   * sent to the live API would be rejected as invalid and read like an API defect.
   */
  private async login(principal: Principal, profile: AuthProfile): Promise<string> {
    // A principal may name its own login endpoint (BUSINESS_M/L → adminUserLogin); else the profile's.
    const endpoint = resolveEndpoint(
      this.apiRegistry.get(principal.loginEndpointId ?? profile.loginEndpointId),
    );
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
