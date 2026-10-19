import type { ApiRequest, RequestSpec } from '@api/client/request-builder';
import { ApiResponseWrapper, type TransportError } from '@api/client/response-wrapper';
import type { EndpointDefinition, RequestFactoryHelpers } from '@api/registry/endpoint-definition';
import type { SendOptions } from '@engine/endpoint-executor';
import type { ValidationContext } from '@engine/validation-context';
import { resolveEndpoint, type ResolvedEndpoint } from '@engine/validation-policy';
import { buildResult, type Validator } from '@engine/validator';
import { outcome, type ValidationResult } from '@engine/validation-result';
import type { Logger } from '@utils/logger';

/**
 * Offline harness for unit-testing a validator's VERDICT: no Playwright request context, no host,
 * no token. A validator only ever reads a `ValidationContext`, so a context whose `send()` answers
 * from a scripted fake server exercises exactly the code that runs live, minus the network.
 *
 * Scenarios are named after what the server does ("rejects every probe", "crashes", "throttles"),
 * so each spec reads as "given a server that does X, the validator says Y".
 */

/** One canned HTTP answer. `transportError` means no response arrived (status 0, empty body). */
export interface FakeResponse {
  status: number;
  body?: unknown;
  /** Lower-case names, as the real wrapper stores them. */
  headers?: Record<string, string>;
  transportError?: TransportError;
}

/** What the fake server sees for each probe, so a test can assert the payload that was sent. */
export interface SentProbe {
  spec: RequestSpec;
  options: SendOptions;
}

export type FakeServer = (spec: RequestSpec, options: SendOptions) => FakeResponse;

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

let sequence = 0;

/** A recorded exchange, exactly as the engine hands it to validators. */
export function exchange(
  response: FakeResponse,
  spec: RequestSpec = {},
  label = 'primary',
  method: ApiRequest['method'] = 'POST',
): ApiResponseWrapper {
  sequence += 1;
  const request: ApiRequest = {
    method,
    pathTemplate: '/v2/fixture/echo',
    url: '/v2/fixture/echo',
    headers: {},
    body: spec.body,
    rawBody: spec.rawBody,
    correlationId: `fixture-${sequence}`,
    timeoutMs: 30_000,
  };
  if (response.transportError) {
    return new ApiResponseWrapper(request, 0, {}, '', 0, response.transportError, label);
  }
  const bodyText =
    response.body === undefined
      ? ''
      : typeof response.body === 'string'
        ? response.body
        : JSON.stringify(response.body);
  const headers =
    response.headers ?? (typeof response.body === 'string' ? {} : { ...JSON_HEADERS });
  return new ApiResponseWrapper(request, response.status, headers, bodyText, 42, undefined, label);
}

/** A resolved endpoint built from a minimal definition, with every central default applied. */
export function fixtureEndpoint(overrides: Partial<EndpointDefinition> = {}): ResolvedEndpoint {
  return resolveEndpoint({
    id: 'fixture-echo',
    method: 'POST',
    path: '/v2/fixture/echo',
    expectedStatus: [200],
    // The whole body is the payload, so schema checks never depend on a contract's envelope key.
    envelope: false,
    ...overrides,
  });
}

export interface FakeContextOptions {
  endpoint?: ResolvedEndpoint;
  /** The valid request the primary exchange sent; probes are cloned from it. */
  request?: RequestSpec;
  primary?: FakeResponse;
  /** Answers every probe. Default: a server that never expected to be called. */
  server?: FakeServer;
  /** Results of validators that already ran (for `resultOf`). */
  results?: readonly ValidationResult[];
}

export interface FakeContext extends ValidationContext {
  /** Every probe the validator sent, in order. */
  readonly sent: readonly SentProbe[];
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const offline = (what: string) => (): never => {
  throw new Error(`${what} is not available in the offline validator harness`);
};

const unexpectedProbe: FakeServer = (_spec, options) => {
  throw new Error(`unexpected probe "${options.label}" — this scenario scripted no server`);
};

export function fakeContext(options: FakeContextOptions = {}): FakeContext {
  const endpoint = options.endpoint ?? fixtureEndpoint();
  const request = options.request ?? {};
  const primary = exchange(
    options.primary ?? { status: 200, body: {} },
    request,
    'primary',
    endpoint.method,
  );
  const server = options.server ?? unexpectedProbe;
  const results = options.results ?? [];
  const recorded: ApiResponseWrapper[] = [primary];
  const sent: SentProbe[] = [];

  const helpers: RequestFactoryHelpers = {
    call: offline('helpers.call'),
    tenantId: 'fixture-tenant',
  };

  return {
    endpoint,
    profile: 'FULL',
    run: { environment: 'offline', build: 'fixture', testRunId: 'validator-unit' },
    get correlationId() {
      return primary.correlationId;
    },
    request,
    primary,
    get exchanges() {
      return recorded;
    },
    sent,
    log: silentLogger,
    resultOf: (name) => results.find((r) => r.validatorName === name),
    // A fresh, independent copy per probe: a validator must never be able to mutate the base.
    nextRequest: (overrides) => Promise.resolve(structuredClone({ ...request, ...overrides })),
    send: (spec, sendOptions) => {
      sent.push({ spec, options: sendOptions });
      const answer = exchange(server(spec, sendOptions), spec, sendOptions.label, endpoint.method);
      recorded.push(answer);
      return Promise.resolve(answer);
    },
    call: offline('call'),
    helpers,
    principal: offline('principal'),
    principals: offline('principals'),
    tokenFor: offline('tokenFor'),
    expiredToken: offline('expiredToken'),
  };
}

/**
 * The verdict the engine would record: a validator that does not apply is SKIPPED with its reason
 * (`ValidationEngine.execute`), otherwise its own `validate()` result. Policy toggles, prerequisite
 * gating and the reproduction retry are engine concerns with their own self-tests, not modelled here.
 */
export async function verdict(
  validator: Validator,
  context: ValidationContext,
): Promise<ValidationResult> {
  const reason = validator.notApplicable(context);
  return reason
    ? buildResult(validator, context, outcome.skipped(reason), 0)
    : validator.validate(context);
}

// ---------------------------------------------------------------- canned server behaviours

/** Answers every probe the same way. */
export const always =
  (response: FakeResponse): FakeServer =>
  () =>
    response;

/** A correct API: every invalid probe is refused with a clean 400 error envelope. */
export const rejectsEverything = always({
  status: 400,
  body: { status: 'FAILURE', statusCode: 400, message: 'Invalid request' },
});

/** A lax API: every probe is accepted as if it were valid. */
export const acceptsEverything = always({
  status: 200,
  body: { status: 'SUCCESS', statusCode: 200, data: {} },
});

/** A fragile API: every probe crashes it. */
export const crashesOnEverything = always({
  status: 500,
  body: { status: 'FAILURE', statusCode: 500, message: 'Internal Server Error' },
});

/** The bench tripped a rate limit: every probe is throttled. */
export const throttlesEverything = always({ status: 429, body: { message: 'Too Many Requests' } });

/** No response ever arrives (timeout / connection reset). */
export const unreachable = always({
  status: 0,
  transportError: { kind: 'timeout', message: 'Timeout 30000ms exceeded.' },
});

/** Rejects every probe except those `accepts` picks out, which it answers with 200. */
export const rejectsExcept =
  (accepts: (spec: RequestSpec) => boolean): FakeServer =>
  (spec, options) =>
    accepts(spec) ? acceptsEverything(spec, options) : rejectsEverything(spec, options);

/** Echoes the request body back inside a success envelope, with the given response headers. */
export const echoesBody =
  (headers: Record<string, string>): FakeServer =>
  (spec) => ({
    status: 200,
    headers,
    body: typeof spec.body === 'string' ? spec.body : JSON.stringify({ data: spec.body }),
  });

/** The body of the n-th probe, typed loosely for field assertions. */
export function probeBody(context: FakeContext, index: number): Record<string, unknown> {
  return context.sent[index]?.spec.body as Record<string, unknown>;
}
