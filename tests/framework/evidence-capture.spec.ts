import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiClientPool } from '@api/client/api-client-pool';
import type { ApiRequest } from '@api/client/request-builder';
import { ApiResponseWrapper } from '@api/client/response-wrapper';
import { apiRegistry } from '@api/definitions/index';
import { readBugzillaConfig } from '@config/bugzilla.config';
import { suiteFor } from '@config/ownership.config';
import { flowFindingReports } from '@engine/flow-finding';
import { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { createLogger } from '@utils/logger';
import { maskString } from '@utils/masking';
import { apiTestCaseId } from '@reporting/test-case-id';
import { candidatesFromReport } from '../../src/bug-tracker/bug-candidate';
import {
  attributeOrigin,
  captureExchange,
  reachabilityOf,
  serialiseEvidence,
  withOrigin,
  EVIDENCE_LIMITS,
  FileEvidenceJournal,
  MemoryEvidenceJournal,
  type CaptureContext,
  type ExchangeEvidence,
} from '../../src/failure-analysis/index';

/**
 * Guards for Phase 3.2 — evidence capture, origin attribution and the reachability witness.
 *
 * These are observational guards: nothing here asserts a verdict about a defect, because this phase
 * produces none. What they pin is that the evidence a later classifier will depend on is
 * **complete enough, bounded, redacted and honest** — in particular that an origin it cannot
 * witness is recorded as `UNKNOWN` rather than guessed.
 *
 * ## A note on the redaction tests
 *
 * They never assert on a string that could contain the secret, because a failing `toContain` prints
 * the received value — which would put the secret in the CI log the test exists to keep it out of.
 * Every one computes a boolean first and asserts on that, so a failure prints `true`/`false`.
 */

/** Values that must never survive into evidence. Distinctive, so a substring test is exact. */
const SECRETS = {
  password: 'Sup3rSecret-PhraseZZ',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.QUJDREVGRw.c2lnbmF0dXJlLXZhbHVl',
  cookie: 'JSESSIONID=ZZTOPSECRETCOOKIEVALUE',
  apiKey: 'ak_live_ZZ9f2a77ccdd',
  refresh: 'rt_ZZ0099aabbccddee',
} as const;

const CONTEXT: CaptureContext = {
  runId: 'run-evidence-1',
  phase: 'action',
  endpointId: 'katchup-delete-message',
  endpoint: 'POST /v2/katchup/deleteKatchUpMessage/',
  suite: 'kpost-api',
};

function request(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'POST',
    pathTemplate: '/v2/katchup/deleteKatchUpMessage/',
    url: 'https://testingapi.kpostindia.com/v2/katchup/deleteKatchUpMessage/',
    headers: { 'content-type': 'application/json' },
    correlationId: 'tb-evidence-0001',
    timeoutMs: 10_000,
    ...overrides,
  };
}

function exchange(options: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  transport?: { kind: 'timeout' | 'network'; message: string };
  label?: string;
  request?: ApiRequest;
  durationMs?: number;
}): ApiResponseWrapper {
  return new ApiResponseWrapper(
    options.request ?? request(),
    options.status ?? 200,
    options.headers ?? { 'content-type': 'application/json' },
    options.body ?? '{}',
    options.durationMs ?? 42,
    options.transport,
    options.label ?? 'primary',
  );
}

/** Captures and attributes in one step, as the executor does. */
function evidenceFor(options: Parameters<typeof exchange>[0], ctx = CONTEXT): ExchangeEvidence {
  return withOrigin(captureExchange(exchange(options), ctx));
}

/** True when `needle` survives anywhere in the serialised record. Never returns the text itself. */
function survives(evidence: ExchangeEvidence, needle: string): boolean {
  return serialiseEvidence(evidence).includes(needle);
}

/** An executor whose every exchange resolves to `status`/`body`, without touching the network. */
function executorReturning(status: number, body: string): EndpointExecutor {
  const client = {
    execute: (req: ApiRequest, label?: string): Promise<ApiResponseWrapper> =>
      Promise.resolve(
        new ApiResponseWrapper(
          req,
          status,
          { 'content-type': 'application/json' },
          body,
          9,
          undefined,
          label ?? 'primary',
        ),
      ),
  };
  const pool = { get: () => Promise.resolve(client) } as unknown as ApiClientPool;
  return new EndpointExecutor(pool, apiRegistry, createLogger('evidence-exec'));
}

test.describe('evidence · what an exchange looked like', () => {
  test.describe.configure({ mode: 'default' });

  test('a successful response is captured with its metadata @framework', () => {
    const e = evidenceFor({
      status: 200,
      body: '{"status":"SUCCESS","urlPath":"deleteKatchUpMessage"}',
      durationMs: 137,
    });

    expect(e.response.received).toBe(true);
    expect(e.response.status).toBe(200);
    expect(e.response.isJson).toBe(true);
    expect(e.response.contentType).toBe('application/json');
    expect(e.response.bytes).toBeGreaterThan(0);
    expect(e.durationMs, 'timing is captured').toBe(137);
    expect(e.correlationId, 'correlation is captured').toBe('tb-evidence-0001');
    expect(e.phase, 'phase is captured').toBe('action');
    expect(e.endpointId).toBe('katchup-delete-message');
    expect(e.suite).toBe('kpost-api');
    expect(e.runId).toBe('run-evidence-1');
    expect(e.primary, 'the primary exchange is marked as such').toBe(true);
    expect(e.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('a 4xx response is captured @framework', () => {
    const e = evidenceFor({ status: 404, body: '{"status":"FAILURE","statusCode":404}' });
    expect(e.response.status).toBe(404);
    expect(e.response.received).toBe(true);
  });

  test('a 5xx response is captured @framework', () => {
    const e = evidenceFor({ status: 500, body: '{"status":"FAILURE","statusCode":500}' });
    expect(e.response.status).toBe(500);
    expect(e.response.received).toBe(true);
  });

  test('a transport failure is captured as no response @framework', () => {
    const e = evidenceFor({
      status: 0,
      headers: {},
      body: '',
      transport: { kind: 'network', message: 'connect ECONNREFUSED 10.0.0.1:443' },
    });

    expect(e.response.received, 'nothing answered').toBe(false);
    expect(e.response.status).toBe(0);
    expect(e.transport?.kind).toBe('network');
    expect(e.transport?.message).toContain('ECONNREFUSED');
  });

  test('request metadata is captured as SHAPE, never as values @framework', () => {
    const e = evidenceFor({
      request: request({
        url: 'https://testingapi.kpostindia.com/v2/katchup/x?token=SHOULD_NOT_APPEAR&page=2',
        body: { messageIds: [811999], groupFlag: false },
      }),
    });

    expect(e.request.method).toBe('POST');
    expect(e.request.path, 'the path TEMPLATE, not the substituted url').toBe(
      '/v2/katchup/deleteKatchUpMessage/',
    );
    expect(e.request.origin).toBe('https://testingapi.kpostindia.com');
    expect(e.request.queryKeys.slice().sort(), 'query KEYS only').toEqual(['page', 'token']);
    expect(e.request.body?.keys, 'body KEY NAMES only').toEqual(['messageIds', 'groupFlag']);
    expect(e.request.body?.bytes).toBeGreaterThan(0);
    expect(survives(e, 'SHOULD_NOT_APPEAR'), 'a query VALUE is never recorded').toBe(false);
    expect(survives(e, '811999'), 'a body VALUE is never recorded').toBe(false);
  });

  test('response metadata is captured, with headers allowlisted @framework', () => {
    const e = evidenceFor({
      headers: {
        'content-type': 'application/json',
        server: 'nginx/1.18.0',
        via: '1.1 vegur',
        'set-cookie': SECRETS.cookie,
        authorization: `Bearer ${SECRETS.jwt}`,
        'x-request-id': 'req-123',
        'x-internal-note': 'not on the allowlist',
      },
    });

    expect(e.response.headers.server).toBe('nginx/1.18.0');
    expect(e.response.headers.via).toBe('1.1 vegur');
    expect(e.response.headers['x-request-id']).toBe('req-123');
    expect(
      Object.keys(e.response.headers),
      'nothing outside the allowlist is copied',
    ).not.toContain('x-internal-note');
    expect(survives(e, SECRETS.cookie), 'set-cookie is never copied').toBe(false);
  });

  test('a RELATIVE request path is parsed, not written off as unparseable @framework', () => {
    // The request builder emits a path when the client resolves it against its own base URL — the
    // normal case for the bench's mock fixtures. It must yield the same evidence as an absolute URL.
    const e = evidenceFor({
      request: request({ url: '/dictionary/terms?page=1&pageSize=20', method: 'GET' }),
    });

    expect(e.request.origin, 'no host is known, and none is invented').toBe('');
    expect(e.request.queryKeys.slice().sort()).toEqual(['page', 'pageSize']);
    expect(e.request.path).toBe('/v2/katchup/deleteKatchUpMessage/');
    expect(survives(e, 'relative.invalid'), 'the sentinel base is never recorded').toBe(false);
  });

  test('testCaseId is captured when the caller knows it, omitted when it does not @framework', () => {
    const withId = evidenceFor({}, { ...CONTEXT, testCaseId: 'TC-API-kpost-api-x-y' });
    expect(withId.testCaseId).toBe('TC-API-kpost-api-x-y');
    expect(evidenceFor({}).testCaseId, 'absent rather than invented').toBeUndefined();
  });
});

test.describe('evidence · redaction', () => {
  test.describe.configure({ mode: 'default' });

  test('no credential from the REQUEST survives into evidence @framework', () => {
    const e = evidenceFor({
      request: request({
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${SECRETS.jwt}`,
          Cookie: SECRETS.cookie,
        },
        body: { password: SECRETS.password, apiKey: SECRETS.apiKey },
      }),
    });

    expect(e.request.auth.present, 'that a token was sent IS evidence').toBe(true);
    expect(e.request.auth.scheme, 'the scheme is kept; the credential is not').toBe('Bearer');
    for (const [name, secret] of Object.entries(SECRETS)) {
      expect(survives(e, secret), `${name} must not survive from the request`).toBe(false);
    }
  });

  test('no credential from the RESPONSE body survives into evidence @framework', () => {
    const body = JSON.stringify({
      status: 'SUCCESS',
      password: SECRETS.password,
      accessToken: SECRETS.jwt,
      refreshToken: SECRETS.refresh,
      apiKey: SECRETS.apiKey,
    });
    const e = evidenceFor({ body });

    expect(
      e.response.snippet,
      'the response IS excerpted, so redaction must do the work',
    ).toBeDefined();
    for (const [name, secret] of Object.entries(SECRETS)) {
      expect(survives(e, secret), `${name} must not survive from the response`).toBe(false);
    }
  });

  test('a credential in a transport error message does not survive @framework', () => {
    const e = evidenceFor({
      status: 0,
      headers: {},
      body: '',
      transport: {
        kind: 'network',
        message: `connect failed for https://u:${SECRETS.password}@testingapi.kpostindia.com/x`,
      },
    });
    expect(survives(e, SECRETS.password), 'a connection string is masked').toBe(false);
  });
});

test.describe('evidence · bounds', () => {
  test.describe.configure({ mode: 'default' });

  test('a large body is excerpted and flagged truncated @framework', () => {
    const big = `{"pad":"${'x'.repeat(50_000)}"}`;
    const e = evidenceFor({ body: big });

    expect(e.response.snippet?.length).toBeLessThanOrEqual(EVIDENCE_LIMITS.bodyChars);
    expect(e.response.truncated).toBe(true);
    expect(e.response.bytes, 'the REAL size is still recorded').toBeGreaterThan(50_000);
  });

  test('a large header value is bounded @framework', () => {
    const e = evidenceFor({
      headers: { 'content-type': 'application/json', server: 'n'.repeat(5_000) },
    });
    expect(e.response.headers.server?.length).toBeLessThanOrEqual(EVIDENCE_LIMITS.headerValueChars);
  });

  test('excessive request body keys are bounded @framework', () => {
    const body = Object.fromEntries(
      Array.from({ length: EVIDENCE_LIMITS.bodyKeys + 25 }, (_, i) => [`field${i}`, i]),
    );
    const e = evidenceFor({ request: request({ body }) });

    expect(e.request.body?.keys.length).toBe(EVIDENCE_LIMITS.bodyKeys);
    expect(e.request.body?.truncatedKeys, 'and the truncation is declared').toBe(true);
  });

  test('a binary response is described, never dumped @framework', () => {
    const e = evidenceFor({
      headers: { 'content-type': 'image/png' },
      body: 'PNG\r\n\n binary bytes here',
    });

    expect(e.response.binary).toBe(true);
    expect(e.response.snippet, 'no excerpt is taken from binary').toBeUndefined();
    expect(e.response.bytes, 'but its size is still evidence').toBeGreaterThan(0);
  });

  test('an oversized record drops its excerpt rather than writing an unusable line @framework', () => {
    const e = evidenceFor({ body: `{"pad":"${'y'.repeat(2_000)}"}` });
    const huge: ExchangeEvidence = {
      ...e,
      request: { ...e.request, queryKeys: Array.from({ length: 4_000 }, (_, i) => `q${i}`) },
    };

    const line = serialiseEvidence(huge);
    expect(JSON.parse(line), 'the line is still valid JSON').toBeTruthy();
    expect((JSON.parse(line) as ExchangeEvidence).response.snippet).toBeUndefined();
  });
});

test.describe('origin attribution · witnessed, never guessed', () => {
  test.describe.configure({ mode: 'default' });

  test('no response → NO_RESPONSE @framework', () => {
    const e = evidenceFor({
      status: 0,
      headers: {},
      body: '',
      transport: { kind: 'timeout', message: 'Timeout 10000ms exceeded' },
    });
    expect(e.origin).toBe('NO_RESPONSE');
    expect(e.originRule).toBe('transport');
  });

  test('an application trace id → APPLICATION @framework', () => {
    const e = evidenceFor({
      status: 500,
      body: '{"status":"FAILURE","statusCode":500,"message":"boom","traceId":"038788be-aa"}',
    });
    expect(e.origin, 'a 5xx is NOT assumed to be anything — the marker decides').toBe(
      'APPLICATION',
    );
    expect(e.originRule).toBe('app:traceId');
  });

  test('the application naming its own route → APPLICATION @framework', () => {
    const e = evidenceFor({ status: 200, body: '{"urlPath":"/v2/common/languages"}' });
    expect(e.origin).toBe('APPLICATION');
    expect(e.originRule).toBe('app:urlPath');
  });

  test('the response envelope → APPLICATION @framework', () => {
    const e = evidenceFor({ status: 409, body: '{"status":"FAILURE","statusCode":409}' });
    expect(e.origin).toBe('APPLICATION');
    expect(e.originRule).toBe('app:envelope');
  });

  test('a standards-defined intermediary header → EDGE @framework', () => {
    const e = evidenceFor({
      status: 502,
      headers: { 'content-type': 'text/html', via: '1.1 google' },
      body: '<html><body>502</body></html>',
    });
    expect(e.origin).toBe('EDGE');
    expect(e.originRule).toBe('edge:via');
  });

  test('a bare 502 with no marker → UNKNOWN, not EDGE @framework', () => {
    /*
     * THE rule of this phase. The repository has no captured gateway signature, so calling this
     * EDGE would be a guess — and a guess in the other direction is how false negatives are made.
     */
    const e = evidenceFor({
      status: 502,
      headers: { 'content-type': 'text/html' },
      body: '<html><head><title>502 Bad Gateway</title></head></html>',
    });
    expect(e.origin).toBe('UNKNOWN');
    expect(e.originRule).toBe('no-marker');
    expect(e.originReason).toContain('cannot be witnessed');
  });

  test('an application marker BEATS an intermediary header @framework', () => {
    // A proxied application response belongs to the application that produced it.
    const e = evidenceFor({
      status: 500,
      headers: { 'content-type': 'application/json', via: '1.1 vegur' },
      body: '{"status":"FAILURE","statusCode":500,"traceId":"abc"}',
    });
    expect(e.origin).toBe('APPLICATION');
  });

  test('no rule reads the status code @framework', () => {
    // Same markerless body at four very different statuses — all UNKNOWN.
    for (const status of [200, 404, 500, 503]) {
      const e = evidenceFor({ status, headers: { 'content-type': 'text/plain' }, body: 'ok' });
      expect(attributeOrigin(e).origin, `status ${status} must not decide origin`).toBe('UNKNOWN');
    }
  });
});

test.describe('reachability witness', () => {
  test.describe.configure({ mode: 'default' });

  const appExchange = (label: string): ExchangeEvidence =>
    withOrigin(
      captureExchange(exchange({ label, body: '{"status":"SUCCESS","urlPath":"x"}' }), CONTEXT),
    );
  const edgeExchange = (label: string): ExchangeEvidence =>
    withOrigin(
      captureExchange(
        exchange({
          label,
          status: 502,
          headers: { 'content-type': 'text/html', via: '1.1 proxy' },
          body: '<html>502</html>',
        }),
        CONTEXT,
      ),
    );
  const unknownExchange = (label: string): ExchangeEvidence =>
    withOrigin(
      captureExchange(
        exchange({ label, status: 502, headers: { 'content-type': 'text/html' }, body: '<html/>' }),
        CONTEXT,
      ),
    );

  test('an application witness → PRESENT, with its correlation ids @framework', () => {
    const witness = reachabilityOf([appExchange('primary'), edgeExchange('auth:probe')]);
    expect(witness.state).toBe('PRESENT');
    expect(witness.witnesses).toHaveLength(1);
    expect(witness.considered).toBe(2);
  });

  test('no application witness, everything attributed away → ABSENT @framework', () => {
    const witness = reachabilityOf([edgeExchange('primary'), edgeExchange('probe')]);
    expect(witness.state).toBe('ABSENT');
    expect(witness.witnesses).toEqual([]);
  });

  test('an unattributed exchange keeps the witness UNKNOWN @framework', () => {
    // An UNKNOWN response might have been the application's, so ABSENT would overclaim.
    const witness = reachabilityOf([edgeExchange('primary'), unknownExchange('probe')]);
    expect(witness.state).toBe('UNKNOWN');
  });

  test('no exchanges → UNKNOWN @framework', () => {
    expect(reachabilityOf([]).state).toBe('UNKNOWN');
  });

  test('PRIMARY application + PROBE gateway is correlatable without parsing prose @framework', () => {
    /*
     * The shape the reported defect takes: the endpoint answers, one negative probe does not reach
     * it. Phase 3.2 only has to make that STRUCTURALLY visible — the judgement is Phase 3.3's.
     */
    const primary = appExchange('primary');
    const probe = edgeExchange('authentication.missing-token:missing token');
    const witness = reachabilityOf([primary, probe]);

    expect(witness.state, 'the application demonstrably answered here').toBe('PRESENT');
    expect(witness.witnesses, 'and the witness is identified by correlation id').toEqual([
      primary.correlationId,
    ]);
    expect(probe.origin, 'while the probe is attributed away from the application').toBe('EDGE');
    expect(probe.primary).toBe(false);
    expect(primary.primary).toBe(true);
  });
});

test.describe('evidence · failure safety and persistence', () => {
  test.describe.configure({ mode: 'default' });

  test('a journal that cannot write counts the failure instead of throwing @framework', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kpost-evidence-'));
    try {
      // A FILE where a directory must be, so mkdir/append cannot succeed.
      const blocker = path.join(dir, 'blocked');
      writeFileSync(blocker, 'not a directory', 'utf8');
      const journal = new FileEvidenceJournal(path.join(blocker, 'nested', 'evidence.jsonl'));

      expect(() => journal.append(evidenceFor({}))).not.toThrow();
      expect(journal.failed, 'the failure is counted').toBe(1);
      expect(journal.written).toBe(0);
      expect(journal.errors[0], 'and it is observable').toContain('katchup-delete-message');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a capture failure never changes the exchange result @framework', async () => {
    const client = {
      execute: (req: ApiRequest, label?: string): Promise<ApiResponseWrapper> =>
        Promise.resolve(
          new ApiResponseWrapper(req, 200, {}, '{"status":"SUCCESS"}', 3, undefined, label),
        ),
    };
    const pool = { get: () => Promise.resolve(client) } as unknown as ApiClientPool;
    const executor = new EndpointExecutor(pool, apiRegistry, createLogger('evidence-test'));

    // Force every capture to throw, the way a serialisation fault would.
    Object.defineProperty(executor, 'exchangeEvidence', {
      get() {
        throw new Error('evidence storage exploded');
      },
    });

    const result = await executor.sendTo(
      'katchup-delete-message',
      { body: {} },
      { label: 'feature:action', auth: { header: undefined }, allowLiveWrite: true },
    );

    expect(result.status, 'the exchange is returned unharmed').toBe(200);
    expect(executor.flowFindings, 'and a 200 is still not a finding').toEqual([]);
  });

  test('every captured record is valid, parseable JSONL @framework', () => {
    const journal = new MemoryEvidenceJournal();
    journal.append(evidenceFor({ status: 200 }));
    journal.append(evidenceFor({ status: 502, headers: {}, body: '' }));

    for (const record of journal.records) {
      expect(() => JSON.parse(serialiseEvidence(record)) as unknown).not.toThrow();
    }
    expect(journal.written).toBe(2);
  });
});

test.describe('evidence · the executor records it', () => {
  test.describe.configure({ mode: 'default' });

  test('an exchange through the chokepoint is captured, attributed and phase-tagged @framework', async () => {
    const executor = executorReturning(200, '{"status":"SUCCESS","urlPath":"x"}');
    executor.forTestCase('TC-API-kpost-api-katchup-delete-message-flow');

    await executor.sendTo(
      'katchup-delete-message',
      { body: {} },
      { label: 'feature:action', auth: { header: undefined }, allowLiveWrite: true },
    );

    const [record] = executor.exchangeEvidence;
    expect(record, 'every exchange is captured').toBeDefined();
    expect(record?.phase).toBe('action');
    expect(record?.testCaseId).toBe('TC-API-kpost-api-katchup-delete-message-flow');
    expect(record?.origin).toBe('APPLICATION');
    expect(record?.endpointId).toBe('katchup-delete-message');
  });

  test('a cleanup-phase exchange is captured with that phase @framework', async () => {
    const executor = executorReturning(500, '{"status":"FAILURE","statusCode":500}');
    await executor.withPhase('cleanup', () =>
      executor.sendTo(
        'katchup-delete-message',
        { body: {} },
        { label: 'feature:cleanup', auth: { header: undefined }, allowLiveWrite: true },
      ),
    );

    expect(executor.exchangeEvidence[0]?.phase).toBe('cleanup');
    expect(executor.exchangeEvidence[0]?.origin).toBe('APPLICATION');
    // Phase 3.1 is unchanged by evidence capture.
    expect(executor.flowFindings, 'still isolated from the defect pipeline').toEqual([]);
    expect(executor.cleanupFindings).toHaveLength(1);
  });
});

/**
 * Corrections driven by the controlled live verification against testingapi.
 *
 * Each block pins a behaviour that real responses proved wrong or missing, so the evidence a later
 * classifier depends on cannot regress to the state the live run found.
 */
test.describe('corrections · email masking', () => {
  test.describe.configure({ mode: 'default' });

  /** Asserts on a boolean, never on text that could carry the address into a CI log. */
  const leaks = (text: string, local: string): boolean => maskString(text).includes(local);

  test('an email followed by DIGITS is masked — the live leak @framework', () => {
    // `kallSession` on a real 200 is the account id concatenated with an epoch, and the old
    // trailing \b could not terminate between `com` and `1`.
    expect(leaks('{"kallSession":"someone@example.com1789895625915"}', 'someone@example.com')).toBe(
      false,
    );
  });

  test('a normal email is still masked to its first character @framework', () => {
    expect(maskString('someone@example.com')).toBe('s***@example.com');
  });

  test('an email followed by punctuation, whitespace or JSON quoting is masked @framework', () => {
    for (const text of [
      'contact someone@example.com.',
      'contact someone@example.com, please',
      'contact someone@example.com ',
      '{"otherEmail":"someone@example.com"}',
      '<someone@example.com>',
    ]) {
      expect(leaks(text, 'someone@example.com'), text.slice(0, 24)).toBe(false);
    }
  });

  test('multiple emails in one string are all masked @framework', () => {
    const masked = maskString('a: first@example.com b: second@other.co.uk1234');
    expect(masked.includes('first@example.com')).toBe(false);
    expect(masked.includes('second@other.co.uk')).toBe(false);
  });

  test('a multi-label domain is masked in full @framework', () => {
    expect(maskString('someone@mail.example.co.uk')).toBe('s***@mail.example.co.uk');
  });

  test('existing key=value masking is unchanged @framework', () => {
    expect(maskString('password=hunter2')).toBe('password=***');
    expect(maskString('{"apiKey":"ak_live_1"}')).toBe('{"apiKey":"***"}');
    expect(maskString('Authorization: Bearer abc.def')).toContain('Bearer ***');
  });

  test('text with nothing sensitive is untouched @framework', () => {
    expect(maskString('a plain sentence with no secrets')).toBe('a plain sentence with no secrets');
  });
});

test.describe('corrections · envelope attribution requires the documented envelope', () => {
  test.describe.configure({ mode: 'default' });

  test('the LIVE 401 auth-filter shape is UNKNOWN, not APPLICATION @framework', () => {
    // Verbatim shape from testingapi: no urlPath, no statusCode, a status outside the contract's
    // vocabulary, a debugMessage found nowhere else, and an ISO-8859-1 charset.
    const e = evidenceFor({
      status: 401,
      headers: { 'content-type': 'application/json;charset=ISO-8859-1' },
      body: '{"status":"UNAUTHORIZED","timestamp":null,"message":null,"debugMessage":"Authentication required"}',
    });

    expect(e.origin).toBe('UNKNOWN');
    expect(e.originRule).toBe('no-marker');
  });

  test('the live 401 is NOT attributed to EDGE either @framework', () => {
    const e = evidenceFor({
      status: 401,
      headers: { 'content-type': 'application/json;charset=ISO-8859-1', server: 'nginx/1.24.0' },
      body: '{"status":"UNAUTHORIZED","debugMessage":"Invalid or malformed token"}',
    });
    // No intermediary signature was observed, and `server` is present on every response.
    expect(e.origin).toBe('UNKNOWN');
  });

  test('a status field ALONE no longer establishes APPLICATION @framework', () => {
    const e = evidenceFor({ status: 200, body: '{"status":"SUCCESS"}' });
    expect(e.origin, 'SUCCESS without urlPath or statusCode is not enough').toBe('UNKNOWN');
  });

  test('the four live application shapes still attribute APPLICATION @framework', () => {
    const cases: [number, string][] = [
      [200, '{"status":"SUCCESS","urlPath":"homeDashboardMsgs","statusCode":200}'],
      [400, '{"status":"FAILURE","urlPath":"/testing/v2/x/","statusCode":400}'],
      [405, '{"status":"FAILURE","urlPath":"/testing/v2/x/","statusCode":405}'],
      [415, '{"status":"FAILURE","urlPath":"/testing/v2/x/","statusCode":415}'],
    ];
    for (const [status, body] of cases) {
      expect(evidenceFor({ status, body }).origin, `status ${status}`).toBe('APPLICATION');
    }
  });

  test('status + statusCode without urlPath is still the documented envelope @framework', () => {
    const e = evidenceFor({ status: 500, body: '{"status":"FAILURE","statusCode":500}' });
    expect(e.origin).toBe('APPLICATION');
    expect(e.originRule).toBe('app:envelope');
  });

  test('an nginx Server header never makes a response EDGE @framework', () => {
    const e = evidenceFor({
      status: 200,
      headers: { 'content-type': 'application/json', server: 'nginx/1.24.0 (Ubuntu)' },
      body: '{"status":"SUCCESS","urlPath":"x"}',
    });
    expect(e.origin, 'Server is on EVERY response here, so it discriminates nothing').toBe(
      'APPLICATION',
    );
  });
});

test.describe('corrections · testCaseId through the real execution path', () => {
  test.describe.configure({ mode: 'default' });

  const send = (executor: EndpointExecutor, label: string): Promise<unknown> =>
    executor.sendTo(
      'katchup-delete-message',
      { body: {} },
      { label, auth: { header: undefined }, allowLiveWrite: true },
    );

  test('every exchange of one test carries the SAME stable id @framework', async () => {
    const executor = executorReturning(200, '{"status":"SUCCESS","urlPath":"x"}');
    executor.forTestCase('TC-API-kpost-api-katchup-delete-message-flow');
    await send(executor, 'primary');
    await send(executor, 'authentication.missing-token:no header');

    const ids = executor.exchangeEvidence.map((e) => e.testCaseId);
    expect(ids, 'primary and probe alike').toHaveLength(2);
    expect(new Set(ids).size, 'one test, one identity').toBe(1);
    expect(ids[0]).toBe('TC-API-kpost-api-katchup-delete-message-flow');
  });

  test('the id is the Phase 2.2 derivation, not an invention @framework', () => {
    // The engine attributes a validator's exchanges with exactly this call.
    const id = apiTestCaseId({
      suiteId: 'kpost-api',
      endpointId: 'katchup-delete-message',
      validatorName: 'authentication.missing-token',
    });
    expect(id.startsWith('TC-API-')).toBe(true);
    expect(id).toContain('authentication.missing-token');
  });

  test('different tests do not collide, and the id is not the correlation id @framework', async () => {
    const a = executorReturning(200, '{"status":"SUCCESS","urlPath":"x"}');
    a.forTestCase(
      apiTestCaseId({
        suiteId: 'kpost-api',
        endpointId: 'katchup-delete-message',
        validatorName: 'response.status-code',
      }),
    );
    await send(a, 'primary');

    const b = executorReturning(200, '{"status":"SUCCESS","urlPath":"x"}');
    b.forTestCase(
      apiTestCaseId({
        suiteId: 'kpost-api',
        endpointId: 'katchup-delete-message',
        validatorName: 'response.schema',
      }),
    );
    await send(b, 'primary');

    const idA = a.exchangeEvidence[0]?.testCaseId;
    const idB = b.exchangeEvidence[0]?.testCaseId;
    expect(idA).not.toBe(idB);
    expect(idA, 'a test-case id is not an execution id').not.toBe(
      a.exchangeEvidence[0]?.correlationId,
    );
    expect(a.exchangeEvidence[0]?.correlationId).not.toBe(b.exchangeEvidence[0]?.correlationId);
  });

  test('traffic with no owning test case stays unassociated, never faked @framework', async () => {
    const executor = executorReturning(200, '{"status":"SUCCESS","urlPath":"x"}');
    await send(executor, 'primary');
    expect(executor.exchangeEvidence[0]?.testCaseId).toBeUndefined();
  });
});

test.describe('corrections · cleanup-phase evidence is durable', () => {
  test.describe.configure({ mode: 'default' });

  const cleanupSend = (executor: EndpointExecutor): Promise<unknown> =>
    executor.withPhase('cleanup', () =>
      executor.sendTo(
        'katchup-delete-message',
        { body: {} },
        { label: 'feature:cleanup', auth: { header: undefined }, allowLiveWrite: true },
      ),
    );

  test('a cleanup exchange produces evidence marked with its phase @framework', async () => {
    const executor = executorReturning(200, '{"status":"SUCCESS","urlPath":"x","statusCode":200}');
    await cleanupSend(executor);

    const [record] = executor.exchangeEvidence;
    expect(record?.phase, 'the phase is explicit in the persisted record').toBe('cleanup');
    expect(record?.correlationId).toBeTruthy();
    expect(record?.origin).toBe('APPLICATION');
  });

  test('a cleanup 4xx and 5xx are both retained as evidence @framework', async () => {
    for (const status of [404, 500]) {
      const executor = executorReturning(
        status,
        `{"status":"FAILURE","statusCode":${status},"urlPath":"/x/"}`,
      );
      await cleanupSend(executor);
      expect(executor.exchangeEvidence, `status ${status}`).toHaveLength(1);
      expect(executor.exchangeEvidence[0]?.phase).toBe('cleanup');
      expect(executor.exchangeEvidence[0]?.response.status).toBe(status);
    }
  });

  test('a cleanup TRANSPORT failure is retained as evidence @framework', async () => {
    const client = {
      execute: (req: ApiRequest, label?: string): Promise<ApiResponseWrapper> =>
        Promise.resolve(
          new ApiResponseWrapper(
            req,
            0,
            {},
            '',
            5,
            { kind: 'network', message: 'ECONNREFUSED' },
            label ?? 'primary',
          ),
        ),
    };
    const pool = { get: () => Promise.resolve(client) } as unknown as ApiClientPool;
    const executor = new EndpointExecutor(pool, apiRegistry, createLogger('cleanup-transport'));

    await cleanupSend(executor);

    expect(executor.exchangeEvidence).toHaveLength(1);
    expect(executor.exchangeEvidence[0]?.origin).toBe('NO_RESPONSE');
    expect(executor.exchangeEvidence[0]?.phase).toBe('cleanup');
  });

  test('cleanup evidence never becomes a FlowFinding or a Bugzilla candidate @framework', async () => {
    const executor = executorReturning(
      500,
      '{"status":"FAILURE","statusCode":500,"urlPath":"/x/"}',
    );
    await cleanupSend(executor);

    expect(executor.exchangeEvidence, 'evidence exists').toHaveLength(1);
    expect(executor.flowFindings, 'and is still not a product defect').toEqual([]);
    expect(executor.cleanupFindings, 'it stays on the cleanup dimension').toHaveLength(1);

    const reports = flowFindingReports(executor.flowFindings);
    expect(reports).toEqual([]);
    expect(
      reports.flatMap((r) =>
        candidatesFromReport(r, { baseURL: suiteFor(r.suite).baseUrl }, readBugzillaConfig()),
      ),
    ).toEqual([]);
  });
});
