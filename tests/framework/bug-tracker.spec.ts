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
import type { FilingOutcome } from '../../src/bug-tracker/bugzilla-filer';
import { readBugzillaConfig, type BugzillaConfig } from '../../src/config/bugzilla.config';
import { componentFor, suiteFor } from '../../src/config/ownership.config';
import { buildBugReportConsole, buildBugReportMarkdown } from '../../src/reporting/bug-report';
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
  maxFile: 0,
  tagPrefix: 'KPV2',
};

function candidate(overrides: Partial<BugCandidate> = {}): BugCandidate {
  return {
    id: 'KPV2-ABC123',
    source: 'api',
    suiteId: 'kpost-api',
    title: 'POST /users: expected 400/422, got 500',
    narrative: 'The engine sent an invalid payload and the endpoint answered with a server error.',
    severity: 'HIGH',
    category: 'Functional',
    classification: 'request.required-fields',
    product: 'KPost API',
    component: 'User Profile V2',
    version: 'unspecified',
    assignee: 'jagan@kpost.in',
    ownerName: 'Jaganathan Murthy',
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
  product?: string;
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

  test('the ticket teaches the developer: what it means, why it matters, how to fix', () => {
    const headers = buildDescription(candidate({ classification: 'security.security-headers' }));
    expect(headers, 'explains the defect').toContain('What this means:');
    expect(headers, 'and how to fix it').toContain('How to fix:');
    expect(headers, 'with a concrete fix').toContain('Content-Security-Policy');

    const auth = buildDescription(candidate({ classification: 'authentication.missing-token' }));
    expect(auth, 'auth bugs explain the 401 contract').toContain('HTTP 401');

    // The common.* data-shape validators (which dominate KMail's findings) also teach the developer,
    // so a KMail ticket is as self-explanatory as a KPost one.
    for (const validator of ['common.api-error', 'common.id', 'common.date', 'common.boolean']) {
      const desc = buildDescription(candidate({ classification: validator }));
      expect(desc, `${validator} explains itself`).toContain('What this means:');
      expect(desc, `${validator} says how to fix it`).toContain('How to fix:');
    }

    // A validator with no specific guidance simply omits the section — no filler.
    const none = buildDescription(candidate({ classification: 'response.schema' }));
    expect(none).not.toContain('What this means:');
  });

  test('a platform-wide fault on many endpoints is one consolidated ticket listing them', () => {
    // Same systemic id (endpoint excluded), two different endpoints — must merge into one.
    const headers = (endpoint: string): BugCandidate =>
      candidate({
        id: 'KPV2-SYS001',
        systemic: true,
        affectedEndpoints: [endpoint],
        endpoint,
        title: 'Platform-wide — 2/5 security headers failed: content-security-policy (missing)',
        classification: 'security.security-headers',
        component: 'kpost-webservice-application',
      });
    const merged = mergeCandidates([headers('POST /v2/aws/x'), headers('POST /v2/contacts/y')]);

    expect(merged, 'the endpoint is not part of a systemic ticket identity').toHaveLength(1);
    expect(merged[0]?.affectedEndpoints).toEqual(['POST /v2/aws/x', 'POST /v2/contacts/y']);
    expect(merged[0]?.occurrences).toBe(2);

    const description = buildDescription(merged[0]!);
    expect(description, 'the ticket names every endpoint the shared fault hit').toContain(
      'Affects 2 endpoints',
    );
    expect(description).toContain('POST /v2/aws/x');
    expect(description).toContain('POST /v2/contacts/y');
  });

  test('componentFor: the module tag wins, a foreign sub-tag cannot steal the ticket', () => {
    const kpost = suiteFor('kpost-api');
    // Realistic tags: the factory prepends the suite tag `kpost-api`, THEN the module tag.
    expect(componentFor(kpost, ['kpost-api', 'katchup', 'katchup-read', 'badge'])).toBe(
      'Katchup Messaging V2',
    );
    // A Kall endpoint whose read is tagged `contacts` still belongs to Kall, not Contacts.
    expect(componentFor(kpost, ['kpost-api', 'kall', 'kall-read', 'contacts'])).toBe(
      'Kall (Voice/Video) V2 - current',
    );
    // A within-module hyphenated refinement still overrides the module default.
    expect(componentFor(kpost, ['kpost-api', 'common', 'common-company'])).toBe(
      'Company Administration',
    );
    expect(componentFor(kpost, ['kpost-api', 'profile', 'profile-read', 'pii'])).toBe(
      'User Profile V2',
    );
    // An unmapped module falls back to the catch-all rather than misrouting.
    expect(componentFor(kpost, ['kpost-api', 'brandnew', 'brandnew-read'])).toBe(
      'kpost-webservice-application',
    );
  });

  test('componentFor: KMail routes by area, and a sub-area tag beats its area default', () => {
    const kmail = suiteFor('kmail-api');
    const T = (extra: string[]): string[] => ['kmail-api', 'kmail', ...extra];
    // A bare sub-area tag names the component, overriding the per-file area default.
    expect(componentFor(kmail, T(['kmail-read', 'contacts']))).toBe('Contacts & Sync');
    expect(componentFor(kmail, T(['kmail-read', 'content']))).toBe('Read Mail & Attachments');
    expect(componentFor(kmail, T(['kmail-read', 'status']))).toBe('Mailbox, Folders & Follow-up');
    expect(componentFor(kmail, T(['kmail-read', 'translate']))).toBe('Translation');
    // With no sub-area tag, the file's area default applies.
    expect(componentFor(kmail, T(['kmail-read']))).toBe('Read Mail & Attachments');
    expect(componentFor(kmail, T(['kmail-send', 'critical']))).toBe('Sent Mail - Compose & Send');
    expect(componentFor(kmail, T(['kmail-draft']))).toBe('Draft Mail');
    expect(componentFor(kmail, T(['kmail-settings', 'settings']))).toBe(
      'KMail Settings - Signature & Letterhead',
    );
    // An unknown area falls back to the KMail catch-all, never another product.
    expect(componentFor(kmail, T(['kmail-unknownarea']))).toBe('kmail-application');
  });

  test('the in-bench bug report states the run, the filing, and the routing', () => {
    const outcome: FilingOutcome = {
      dryRun: false,
      entries: [
        {
          id: 'KPV2-ABC123',
          decision: 'created',
          bugId: 10,
          summary: '[KPV2-ABC123] POST /users: expected 400/422, got 500',
          product: 'KPost API',
          component: 'User Profile V2',
          assignee: 'jagan@kpost.in',
          severity: 'HIGH',
        },
      ],
      counts: {
        created: 1,
        commented: 0,
        reopened: 0,
        adopted: 0,
        'judged-skip': 0,
        'would-file': 0,
        capped: 0,
        failed: 0,
      },
    };
    const input = {
      environment: 'production',
      runStatus: 'passed',
      testRunId: 'run-1',
      build: 'local',
      generatedAt: '2026-09-14T00:00:00.000Z',
      validationReports: [],
      merged: [candidate()],
      rejected: [
        { candidate: candidate({ id: 'KPV2-NOISE1' }), reason: 'severity LOW below the floor' },
      ],
      outcome,
    };

    const md = buildBugReportMarkdown(input);
    expect(md, 'names the run stats section').toContain('Endpoints tested');
    expect(md, 'routes the ticket to its developer').toContain('Jaganathan Murthy');
    expect(md, 'shows the bug number').toContain('#10');
    expect(md, 'is transparent about what was not filed').toContain('NOT filed');
    expect(buildBugReportConsole(input)).toContain('KPost API → Jaganathan Murthy: 1');

    const notFiled = buildBugReportMarkdown({
      ...input,
      outcome: undefined,
      notFiledReason: 'no host',
    });
    expect(notFiled, 'a blocked run says why nothing filed').toContain('Not filed:');
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

  test('a UI ticket is application-level: no internal repo path or test command', () => {
    const ui = candidateFromUiFailure(
      {
        file: 'tests/e2e/kmail.spec.ts',
        title: 'the KMail screen loads for a signed-in user',
        message: 'expected the compose button to be visible',
        fullMessage: 'expected the compose button to be visible',
        browser: 'chromium',
        environment: 'production',
        baseURL: 'https://account.kpostindia.com',
        build: 'local',
        testRunId: 'run-1',
        observedAt: '2026-09-14T10:00:00.000Z',
      },
      config,
    );
    const desc = buildDescription(ui);

    // The developer has the app, not our test bench — so no internal file path or run command.
    expect(desc, 'no internal test file path').not.toContain('tests/e2e');
    expect(desc, 'no internal test command').not.toContain('npx playwright');
    // Instead: the app URL and the screen (component), so it is reproducible in the product.
    expect(desc).toContain('account.kpostindia.com');
    expect(ui.component, 'routes to the KMail screen component').toBe('KMail');
    expect(desc).toContain('KMail screen');
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

  test('the same tag on a SIBLING product is not matched — the finding files in its own product', async () => {
    // A platform-wide fault files one ticket per product, so the same [KP-] tag can sit on a KPost
    // ticket AND a KMail ticket. A finding for one product must never comment on / reopen the other's.
    const calls = stubBugzilla([
      {
        id: 9,
        summary: '[KPV2-ABC123] Platform-wide — 3/6 security headers failed',
        is_open: true,
        product: 'KPost API',
      },
    ]);
    const outcome = await filer().file([
      candidate({
        product: 'KPost UI',
        component: 'General',
        suiteId: 'kpost-ui',
        assignee: 'ayyappan@kpostindia.com',
        ownerName: 'Ayyappan Ashok',
      }),
    ]);

    expect(outcome.counts.commented, 'must NOT comment on the sibling-product ticket').toBe(0);
    expect(outcome.counts.created, 'files its own ticket in its own product').toBe(1);
    expect(calls.some((c) => c.url.includes('/comment'))).toBe(false);
  });

  test('the same tag in the SAME product still comments (no duplicate)', async () => {
    const calls = stubBugzilla([
      {
        id: 10,
        summary: '[KPV2-ABC123] POST /users: expected 400/422, got 500',
        is_open: true,
        product: 'KPost API',
      },
    ]);
    const outcome = await filer().file([candidate({ product: 'KPost API' })]);

    expect(outcome.counts.commented, 'same product, same tag → comment').toBe(1);
    expect(outcome.counts.created).toBe(0);
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
