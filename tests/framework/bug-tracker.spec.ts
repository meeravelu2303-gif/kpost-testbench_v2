import {
  buildDescription,
  buildSummary,
  buildWhiteboard,
  sameFault,
} from '../../src/bug-tracker/bug-builder';
import {
  candidateFromUiFailure,
  mergeCandidates,
  type BugCandidate,
} from '../../src/bug-tracker/bug-candidate';
import { apiFingerprint, normalizeForFingerprint } from '../../src/bug-tracker/bug-fingerprint';
import { BugzillaClient } from '../../src/bug-tracker/bugzilla-client';
import { BugzillaFiler } from '../../src/bug-tracker/bugzilla-filer';
import {
  applyValidityGate,
  assessRunValidity,
  candidateRejection,
} from '../../src/bug-tracker/validity-gate';
import { readBugzillaConfig, type BugzillaConfig } from '../../src/config/bugzilla.config';
import { createLogger } from '../../src/utils/logger';
import { expect, test } from '@fixtures';

/**
 * Offline cover for bug filing: no network, no live Bugzilla. `fetch` is stubbed, so these
 * pin the decision tree (create / comment / reopen / judged-skip / never-create-after-a-failed-
 * search) and the gates that decide what may become a ticket at all.
 */

const config: BugzillaConfig = {
  ...readBugzillaConfig(),
  enabled: true,
  url: 'http://bugzilla.test/rest',
  apiKey: 'test-key',
  dryRun: false,
  apiProduct: 'KPost API',
  uiProduct: 'KPost UI',
  version: 'unspecified',
  apiFallbackComponent: 'kpost-webservice-application',
  uiFallbackComponent: 'General',
  maxFile: 0,
  tagPrefix: 'KPV2',
};

function candidate(overrides: Partial<BugCandidate> = {}): BugCandidate {
  return {
    id: 'KPV2-ABC123',
    source: 'api',
    title: 'POST /users: expected 400/422, got 500',
    narrative: 'The engine sent an invalid payload and the endpoint answered with a server error.',
    severity: 'HIGH',
    category: 'Functional',
    classification: 'request.required-fields',
    product: 'KPost API',
    component: 'User Profile V2',
    endpoint: 'POST /users',
    expected: '[400,422]',
    actual: 'HTTP 500',
    occurrences: 1,
    environment: 'dev',
    baseURL: 'http://kpost.test',
    build: 'local',
    testRunId: 'run-1',
    observedAt: '2026-09-12T10:00:00.000Z',
    evidence: {},
    ...overrides,
  };
}

interface StubBug {
  id: number;
  summary: string;
  is_open: boolean;
  resolution?: string;
  whiteboard?: string;
}

/** A Bugzilla whose search returns `bugs`, recording every request made to it. */
function stubBugzilla(bugs: StubBug[], options: { searchFails?: boolean } = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = ((input: string | URL, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });

    const json = (payload: unknown): Response =>
      ({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(payload)),
      }) as unknown as Response;

    if (url.includes('/product?')) {
      return Promise.resolve(
        json({
          products: [
            {
              name: 'KPost API',
              components: [{ name: 'User Profile V2' }, { name: 'kpost-webservice-application' }],
              versions: [{ name: 'unspecified' }],
            },
            {
              name: 'KPost UI',
              components: [{ name: 'General' }],
              versions: [{ name: 'unspecified' }],
            },
          ],
        }),
      );
    }
    if (method === 'GET' && url.includes('/bug?')) {
      if (options.searchFails)
        return Promise.resolve(json({ error: true, message: 'search exploded' }));
      return Promise.resolve(json({ bugs }));
    }
    if (method === 'POST' && /\/bug\?/.test(url)) return Promise.resolve(json({ id: 4242 }));
    return Promise.resolve(json({ id: 1 }));
  }) as unknown as typeof fetch;
  return calls;
}

function filer(): BugzillaFiler {
  return new BugzillaFiler(
    new BugzillaClient(config, createLogger('test')),
    config,
    createLogger('test'),
  );
}

test.describe('Bug filing', { tag: '@framework' }, () => {
  const realFetch = globalThis.fetch;

  test.afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('a defect keeps the same id across runs despite run-specific values', () => {
    const first = apiFingerprint({
      prefix: 'KPV2',
      endpointId: 'create-user',
      validatorName: 'response.status-code',
      message: 'expected 201, got 500 for qa.user+ab12cd@kpost.test (tb-1111-2222) in 431ms',
    });
    const second = apiFingerprint({
      prefix: 'KPV2',
      endpointId: 'create-user',
      validatorName: 'response.status-code',
      message: 'expected 201, got 500 for qa.user+zz99yy@kpost.test (tb-3333-4444) in 87ms',
    });
    const otherEndpoint = apiFingerprint({
      prefix: 'KPV2',
      endpointId: 'get-user',
      validatorName: 'response.status-code',
      message: 'expected 201, got 500',
    });

    expect(first, 'volatile values must not change identity').toBe(second);
    expect(otherEndpoint, 'the same fault on another endpoint is another ticket').not.toBe(first);
    expect(normalizeForFingerprint('took 1234 ms at 10.0.0.1:8080')).not.toContain('10.0.0.1');
  });

  test('the run gate refuses to publish a collapsed run', () => {
    expect(assessRunValidity({ executed: 0, collected: 30, loadErrors: 0 }).valid).toBe(false);
    expect(assessRunValidity({ executed: 5, collected: 30, loadErrors: 0 }).valid).toBe(false);
    expect(assessRunValidity({ executed: 30, collected: 30, loadErrors: 2 }).valid).toBe(false);
    expect(
      assessRunValidity({ executed: 30, collected: 30, loadErrors: 0, status: 'interrupted' })
        .valid,
    ).toBe(false);
    expect(
      assessRunValidity({ executed: 28, collected: 30, loadErrors: 0, status: 'failed' }).valid,
    ).toBe(true);
  });

  test('the candidate gate drops noise but keeps real defects', () => {
    expect(
      candidateRejection(candidate()),
      'a 500 on an invalid payload is a real defect',
    ).toBeUndefined();
    expect(candidateRejection(candidate({ severity: 'LOW' }))).toContain('below the filing floor');
    expect(
      candidateRejection(candidate({ actual: 'connect ECONNREFUSED 10.0.0.5:8080' })),
    ).toContain('infrastructure');
    expect(candidateRejection(candidate({ actual: 'HTTP 429 Too many requests' }))).toContain(
      'throttled',
    );
    expect(
      candidateRejection(
        candidate({ title: "another user's data was exposed", actual: 'HTTP 401 unauthorized' }),
      ),
      'a refused request cannot evidence exposure',
    ).toContain('refused');
    expect(candidateRejection(candidate({ expected: '(none)', actual: '(none)' }))).toContain(
      'evidence',
    );
    expect(
      candidateRejection(
        candidate({ classification: 'security.rate-limit', actual: 'no 429 after 11 requests' }),
      ),
      'a missing rate limit is the finding, not throttling of our run',
    ).toBeUndefined();
  });

  test('the ticket matches the conventions Bugzilla and the Bug Tracker UI expect', () => {
    const long = candidate({ title: 'x'.repeat(400) });
    const summary = buildSummary(long);
    expect(summary.length, 'Bugzilla refuses summaries over 255 characters').toBeLessThanOrEqual(
      255,
    );
    expect(summary.startsWith('[KPV2-ABC123]'), 'the dedupe tag must survive truncation').toBe(
      true,
    );

    const ui = candidate({ source: 'ui', category: 'Security', browsers: ['chromium', 'webkit'] });
    expect(buildWhiteboard(ui)).toBe('[cat:Security][browser:chromium,webkit]');

    const description = buildDescription(candidate({ correlationId: 'tb-9' }));
    for (const anchor of [
      'Classification:',
      'Category:',
      'Representative endpoint:',
      'Module:',
      'Expected:',
      'Actual:',
      'Environment:',
      'Run date:',
    ]) {
      expect(description, `the UI parses on the "${anchor}" anchor`).toContain(anchor);
    }
    expect(description).toContain('tb-9');
  });

  test('one fault seen on three browsers is one ticket listing them', () => {
    const failures = ['chromium', 'firefox', 'webkit'].map((browser) =>
      candidateFromUiFailure(
        {
          file: 'tests/e2e/home.spec.ts',
          title: 'loads with the hero heading',
          message: 'expected heading to be visible',
          fullMessage: 'expected heading to be visible',
          browser,
          environment: 'dev',
          baseURL: 'http://kpost.test',
          build: 'local',
          testRunId: 'run-1',
          observedAt: '2026-09-12T10:00:00.000Z',
        },
        config,
      ),
    );
    const merged = mergeCandidates(failures);

    expect(merged, 'the browser must not be part of the identity').toHaveLength(1);
    expect(merged[0]?.browsers).toEqual(['chromium', 'firefox', 'webkit']);
    expect(merged[0]?.occurrences).toBe(3);
  });

  test('a new defect is filed once, with evidence attached', async () => {
    const calls = stubBugzilla([]);
    const outcome = await filer().file([candidate()]);

    expect(outcome.counts.created).toBe(1);
    expect(outcome.entries[0]?.bugId).toBe(4242);
    expect(
      calls.filter((c) => c.method === 'POST' && /\/bug\?/.test(c.url)),
      'exactly one create',
    ).toHaveLength(1);
    expect(
      calls.some((c) => c.url.includes('/attachment')),
      'the evidence file is attached',
    ).toBe(true);
  });

  test('re-running comments on the open ticket instead of duplicating it', async () => {
    const calls = stubBugzilla([
      { id: 7, summary: '[KPV2-ABC123] POST /users: expected 400/422, got 500', is_open: true },
    ]);
    const outcome = await filer().file([candidate()]);

    expect(outcome.counts.commented).toBe(1);
    expect(outcome.counts.created, 'a second run must never create a duplicate').toBe(0);
    expect(calls.some((c) => c.url.includes('/comment'))).toBe(true);
  });

  test('a ticket a human closed as INVALID is never re-filed', async () => {
    const calls = stubBugzilla([
      {
        id: 8,
        summary: '[KPV2-ABC123] POST /users: expected 400/422, got 500',
        is_open: false,
        resolution: 'INVALID',
      },
    ]);
    const outcome = await filer().file([candidate()]);

    expect(outcome.counts['judged-skip']).toBe(1);
    expect(outcome.entries[0]?.reason).toContain('INVALID');
    expect(
      calls.some((c) => c.method === 'POST' && /\/bug\?/.test(c.url)),
      'nothing may be created',
    ).toBe(false);
  });

  test('a defect that comes back after a fix reopens the original ticket', async () => {
    stubBugzilla([
      {
        id: 9,
        summary: '[KPV2-ABC123] POST /users: expected 400/422, got 500',
        is_open: false,
        resolution: 'FIXED',
      },
    ]);
    const reopened = await filer().file([candidate()]);

    expect(reopened.counts.reopened).toBe(1);
    expect(reopened.counts.created).toBe(0);
  });

  test('a failed dedupe search files nothing, so a transient error cannot duplicate', async () => {
    const calls = stubBugzilla([], { searchFails: true });
    const outcome = await filer().file([candidate()]);

    expect(outcome.counts.failed).toBe(1);
    expect(outcome.entries[0]?.reason).toContain('dedupe search failed');
    expect(calls.some((c) => c.method === 'POST' && /\/bug\?/.test(c.url))).toBe(false);
  });

  test('dry run reports what it would file and writes nothing', async () => {
    const calls = stubBugzilla([]);
    const dryFiler = new BugzillaFiler(
      new BugzillaClient({ ...config, dryRun: true }, createLogger('test')),
      { ...config, dryRun: true },
      createLogger('test'),
    );
    const outcome = await dryFiler.file([candidate()]);

    expect(outcome.counts['would-file']).toBe(1);
    expect(
      calls.some((c) => c.method !== 'GET'),
      'a dry run must not write',
    ).toBe(false);
  });

  test('an unknown component falls back instead of losing the ticket', async () => {
    stubBugzilla([]);
    const outcome = await filer().file([candidate({ component: 'Not A Real Component' })]);

    expect(outcome.counts.created).toBe(1);
    expect(outcome.entries[0]?.component).toBe('kpost-webservice-application');
  });

  test('the validity gate and filer agree on what reaches Bugzilla', async () => {
    stubBugzilla([]);
    const gate = applyValidityGate([
      candidate(),
      candidate({ id: 'KPV2-NOISE1', actual: 'ECONNREFUSED' }),
    ]);
    const outcome = await filer().file(gate.filed);

    expect(gate.rejected).toHaveLength(1);
    expect(outcome.counts.created).toBe(1);
  });

  test('summaries of the same fault match even when values differ', () => {
    expect(
      sameFault(
        '[KPV2-ABC123] POST /users: expected 201, got 500 in 12ms',
        '[BUG-API-9] POST /users: expected 201, got 500 in 980ms',
      ),
    ).toBe(true);
    expect(sameFault('POST /users: got 500', 'GET /users: got 500')).toBe(false);
  });
});
