import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildDescription,
  buildSummary,
  buildWhiteboard,
  sameFault,
} from '../../src/bug-tracker/bug-builder';
import {
  candidateFromUiFailure,
  collapseCountVariants,
  holdAggregatesForReview,
  mergeCandidates,
  type BugCandidate,
} from '../../src/bug-tracker/bug-candidate';
import { apiFingerprint, normalizeForFingerprint } from '../../src/bug-tracker/bug-fingerprint';
import { deriveFailureSignals } from '../../src/ui/failure-diagnostics';
import { setupStep } from '../../src/ui/setup-step';
import { BugzillaClient } from '../../src/bug-tracker/bugzilla-client';
import { BugzillaFiler, partialFixKey } from '../../src/bug-tracker/bugzilla-filer';
import {
  applyValidityGate,
  assessRunValidity,
  candidateRejection,
} from '../../src/bug-tracker/validity-gate';
import type { FilingOutcome } from '../../src/bug-tracker/bugzilla-filer';
import {
  projectForBrowser,
  readBugzillaConfig,
  type BugzillaConfig,
} from '../../src/config/bugzilla.config';
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
function stubBugzilla(
  bugs: StubBug[],
  options: { searchFails?: boolean; existingAttachments?: string[] } = {},
) {
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
    const attachGet = url.match(/\/bug\/(\d+)\/attachment/);
    if (method === 'GET' && attachGet) {
      const names = (options.existingAttachments ?? []).map((file_name) => ({ file_name }));
      return Promise.resolve(json({ bugs: { [attachGet[1]!]: names } }));
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

  test('a browser network error (server unreachable) is never filed as a UI bug', () => {
    for (const actual of [
      'Error: page.goto: NS_ERROR_NET_TIMEOUT',
      'Error: page.goto: net::ERR_CONNECTION_TIMED_OUT at https://test.kpostindia.com/home',
      'Test timeout of 600000ms exceeded.',
      'Error: page.goto: Timeout was reached',
      'Error: page.goto: Could not resolve hostname',
      // A navigation race / redirect-in-flight is a test-harness artifact, not a product crash —
      // on a throttled server a whole run of these must never become new bugs (run-2f18b0d8).
      'Error: page.goto: Navigation to "https://test.kpostindia.com/home" is interrupted by another navigation to "https://test.kpostindia.com/login"',
      'Error: Execution context was destroyed, most likely because of a navigation',
    ]) {
      const ui = candidate({ source: 'ui', actual, title: `Home screen — health @ui: ${actual}` });
      expect(candidateRejection(ui), actual).toContain('transient');
    }
    // A real crash on the same screen still files.
    const crash = candidate({
      source: 'ui',
      actual: 'Error: Kall broke while crawling its controls — JS error: Minified React error #327',
      title:
        'Kall — crawl @ui: Error: Kall broke while crawling its controls — JS error: Minified React error #327',
    });
    expect(candidateRejection(crash)).toBeUndefined();
  });

  test('a UI test that stopped at a marked setup step is never filed (run-7e6bfb6d)', () => {
    const actual = `Error: ${setupStep('the conversation with q***@kpostindia.com is found through the list search')}`;
    const stopped = candidate({
      source: 'ui',
      actual,
      title: `a delete that the server REJECTS (FAILURE envelope) must tell the user @ui: ${actual}`,
    });
    expect(candidateRejection(stopped)).toContain('setup step failed');
    // The same check failing at its own assertion still files.
    const real = candidate({
      source: 'ui',
      actual: 'Error: a delete the server rejects must surface an error',
      title: 'a delete that the server REJECTS (FAILURE envelope) must tell the user @ui',
    });
    expect(candidateRejection(real)).toBeUndefined();
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

    // A gateway 5xx (502/503/504) or a no-response/timeout is a transient upstream failure — dropped.
    expect(
      candidateRejection(
        candidate({ title: 'GET /x: expected [401], got 502', actual: 'HTTP 502' }),
      ),
      'a 502 means the gateway could not reach the app — not an auth defect',
    ).toContain('transient upstream');
    expect(
      candidateRejection(candidate({ responseStatus: 504, actual: 'HTTP 504' })),
      'a 504 gateway timeout is transient',
    ).toContain('transient upstream');
    expect(
      candidateRejection(
        candidate({
          title: 'POST /x: no HTTP response',
          actual: 'apiRequestContext.fetch: Timeout 10000ms exceeded',
        }),
      ),
      'a no-response/timeout is transient — the app did not answer',
    ).toContain('transient upstream');
    // But a genuine APP 500 (an NPE the app itself returned) is a real crash and still files.
    expect(
      candidateRejection(candidate({ title: 'GET /x: expected 200, got 500', actual: 'HTTP 500' })),
      'an app 500 is a real server crash, not a gateway failure',
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
    expect(buildWhiteboard(ui)).toBe('[cat:Security][browser:chromium,webkit][source:automation]');
    // The tracker's browser list holds real browsers: the admin-ui project runs chromium, and
    // re-verification maps it back to that project for KPost Admin UI bugs only.
    expect(buildWhiteboard(candidate({ source: 'ui', browsers: ['admin-ui'] }))).toBe(
      '[cat:Functional][browser:chromium][source:automation]',
    );
    expect(projectForBrowser('KPost Admin UI', 'chromium')).toBe('admin-ui');
    expect(projectForBrowser('KPost UI', 'chromium')).toBe('chromium');
    // A bug a person writes by hand shows as a manual test in the tracker, not as automation.
    expect(buildWhiteboard(candidate({ filedBy: 'manual' }))).toBe(
      '[cat:Functional][source:manual]',
    );
    expect(buildWhiteboard(candidate({ category: 'Accessibility' }))).toBe(
      '[cat:Accessibility][source:automation]',
    );

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
        'needs-review': 0,
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

  test('a UI failure that lost its login session is rejected (environmental, not a screen bug)', () => {
    const lost = candidateFromUiFailure(
      {
        file: 'tests/e2e/profile-settings-breakage.spec.ts',
        title: 'the Profile screen and all its sections load without a crash or broken asset',
        message: 'Error: Profile mounted\nexpect(locator).toBeVisible() failed',
        fullMessage: 'Error: Profile mounted\nexpect(locator).toBeVisible() failed',
        browser: 'chromium',
        environment: 'production',
        baseURL: 'https://test.kpostindia.com',
        build: 'local',
        testRunId: 'run-1',
        observedAt: '2026-10-12T00:00:00.000Z',
        endedOnAuthScreen: true,
      },
      config,
    );
    expect(candidateRejection(lost), 'a logged-out test proves nothing about the screen').toContain(
      'transient',
    );
  });

  test('a UI bug names the API calls that failed during the screen failure (contract drift)', () => {
    const ui = candidateFromUiFailure(
      {
        file: 'tests/e2e/contacts.spec.ts',
        title: 'the Katchup contact rail lists contacts and is searchable',
        message: 'Error: a known contact is listed\nexpect(locator).toBeVisible() failed',
        fullMessage: 'Error: a known contact is listed',
        browser: 'chromium',
        environment: 'production',
        baseURL: 'https://test.kpostindia.com',
        build: 'local',
        testRunId: 'run-1',
        observedAt: '2026-10-12T00:00:00.000Z',
        failedApiCalls: [
          'GET /v2/contacts/knownPostBoxContacts → 400',
          'POST /v2/contacts/list → 500',
        ],
      },
      config,
    );
    expect(ui.narrative, 'names the drifting endpoint').toContain(
      'GET /v2/contacts/knownPostBoxContacts → 400',
    );
    expect(ui.narrative, 'explains it is likely contract drift').toContain('Likely API cause');
    expect(ui.narrative, 'tells the triager to file both halves').toContain('both halves');
    // A real UI failure with a failing API is NOT environmental — it still files.
    expect(candidateRejection(ui)).toBeUndefined();
  });

  test('deriveFailureSignals flags a lost session and lists the failed API calls', () => {
    const lost = deriveFailureSignals('https://test.kpostindia.com/login', [
      {
        at: '0',
        method: 'GET',
        url: 'https://api.kpostindia.com/v2/profile/x',
        outcome: 'HTTP 401',
        type: 'xhr',
      },
    ]);
    expect(lost.endedOnAuthScreen, 'login URL + a 401 is a dropped session').toBe(true);
    expect(lost.failedApiCalls, 'a dropped session suppresses the API list').toEqual([]);

    const drift = deriveFailureSignals('https://test.kpostindia.com/contacts', [
      {
        at: '0',
        method: 'GET',
        url: 'https://api.kpostindia.com/v2/contacts/list?x=1',
        outcome: 'HTTP 400',
        type: 'fetch',
      },
      {
        at: '1',
        method: 'GET',
        url: 'https://api.kpostindia.com/v2/contacts/list?x=2',
        outcome: 'HTTP 400',
        type: 'fetch',
      },
      {
        at: '2',
        method: 'GET',
        url: 'https://cdn.kpostindia.com/logo.png',
        outcome: 'HTTP 404',
        type: 'image',
      },
    ]);
    expect(drift.endedOnAuthScreen).toBe(false);
    expect(drift.failedApiCalls, 'dedupes the repeated call and ignores the image').toEqual([
      'GET /v2/contacts/list → 400',
    ]);
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
        baseURL: 'https://test.kpostindia.com',
        build: 'local',
        testRunId: 'run-1',
        observedAt: '2026-09-14T10:00:00.000Z',
      },
      config,
    );
    const desc = buildDescription(ui);

    // The developer has the app, not our test bench — so no internal file path, run command, or the
    // name of our frontend repository.
    expect(desc, 'no internal test file path').not.toContain('tests/e2e');
    expect(desc, 'no internal test command').not.toContain('npx playwright');
    expect(desc, 'no internal repo name').not.toContain('KPOST_REACTJS_2023_V1');
    expect(desc, 'no repository field at all').not.toContain('"repository"');
    // Instead: the app URL and the screen (component), so it is reproducible in the product.
    expect(desc).toContain('test.kpostindia.com');
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

  test('build-independent dedup: a shifted-tag fault comments on the existing bug, no duplicate', async () => {
    // An existing open bug for POST /v2/common/pinCode + null-value, filed against the OLD build.
    const calls = stubBugzilla([
      {
        id: 50,
        summary:
          '[KPV2-0AD111] POST /v2/common/pinCode: body.postalCode: null value (expected 400, got 500)',
        is_open: true,
        product: 'KPost API',
      },
    ]);
    // The SAME fault on the new build — different message → different tag — must NOT create a dup.
    const outcome = await filer().file([
      candidate({
        id: 'KPV2-0BC222',
        endpoint: 'POST /v2/common/pinCode',
        classification: 'request.null-value',
        title: 'POST /v2/common/pinCode: body.postalCode null value (expected 400/422, got 200)',
      }),
    ]);

    expect(outcome.counts.created, 'no duplicate is created across the build change').toBe(0);
    expect(outcome.counts.adopted, 'it adopts the existing ticket').toBe(1);
    expect(outcome.entries[0]?.bugId).toBe(50);
    expect(calls.some((c) => c.url.includes('/bug/50/comment'))).toBe(true);
  });

  test('build-independent dedup: a genuinely new (endpoint,validator) still files', async () => {
    const calls = stubBugzilla([
      {
        id: 50,
        summary: '[KPV2-0AD111] POST /v2/common/pinCode: body.postalCode: null value',
        is_open: true,
        product: 'KPost API',
      },
    ]);
    const outcome = await filer().file([
      candidate({
        id: 'KPV2-0BC999',
        endpoint: 'POST /v2/common/brandNewEndpoint',
        classification: 'response.status-code',
        title: 'POST /v2/common/brandNewEndpoint: expected 200, got 500',
      }),
    ]);
    expect(outcome.counts.created, 'a real new fault is still filed').toBe(1);
    expect(calls.some((c) => c.method === 'POST' && /\/bug\?/.test(c.url))).toBe(true);
  });

  test('a filed UI bug gets its screenshot + video attached as proof', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'proof-'));
    const shot = path.join(dir, 'shot.png');
    const vid = path.join(dir, 'clip.webm');
    writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes
    writeFileSync(vid, Buffer.from([0x1a, 0x45, 0xdf, 0xa3])); // WebM magic bytes

    const calls = stubBugzilla([]);
    await filer().file([
      candidate({
        id: 'KP-UIPROOF',
        source: 'ui',
        proof: [
          { path: shot, contentType: 'image/png', label: 'Screenshot (chromium)' },
          { path: vid, contentType: 'video/webm', label: 'Video (chromium)' },
        ],
      }),
    ]);

    const attachBodies = calls
      .filter((c) => c.method === 'POST' && c.url.includes('/attachment'))
      .map((c) => c.body as { content_type?: string });
    const types = attachBodies.map((b) => b.content_type);
    expect(types, 'the screenshot is attached as an image').toContain('image/png');
    expect(types, 'the video is attached').toContain('video/webm');
  });

  test('proof is not re-attached when it is already on the ticket (idempotent re-run)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'proof-'));
    const shot = path.join(dir, 'shot.png');
    writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    // The ticket is OPEN and already carries this proof file from a previous run.
    const calls = stubBugzilla(
      [{ id: 7, summary: '[KP-UIPROOF] the profile screen', is_open: true, product: 'KPost UI' }],
      { existingAttachments: ['KP-UIPROOF-screenshot-chromium-.png'] },
    );
    await filer().file([
      candidate({
        id: 'KP-UIPROOF',
        source: 'ui',
        product: 'KPost UI',
        component: 'General',
        assignee: 'ayyappan@kpostindia.com',
        title: 'the profile screen',
        proof: [{ path: shot, contentType: 'image/png', label: 'Screenshot (chromium)' }],
      }),
    ]);

    const imageUploads = calls.filter(
      (c) =>
        c.method === 'POST' &&
        c.url.includes('/attachment') &&
        (c.body as { content_type?: string }).content_type === 'image/png',
    );
    expect(imageUploads, 'the already-attached screenshot is not uploaded again').toHaveLength(0);
    expect(
      calls.some((c) => c.url.includes('/comment')),
      'it still comments',
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
    const calls = stubBugzilla([
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
    // REOPENED, not CONFIRMED: the tracker counts "fixes that didn't hold" under that status.
    const update = calls.find((c) => c.method === 'PUT' && /\/bug\/9\?/.test(c.url));
    expect(update?.body, 'the original ticket is set to REOPENED, with a comment').toMatchObject({
      status: 'REOPENED',
      resolution: '',
      comment: { body: expect.any(String) as unknown },
    });
  });

  test('an instance without the REOPENED status reopens as CONFIRMED instead', async () => {
    const client = new BugzillaClient(config, createLogger('test'));
    const statuses: string[] = [];
    globalThis.fetch = ((_url: string, init?: { body?: string }) => {
      const status = (JSON.parse(init?.body ?? '{}') as { status?: string }).status ?? '';
      statuses.push(status);
      const refused = status === 'REOPENED';
      return Promise.resolve({
        ok: !refused,
        status: refused ? 400 : 200,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              refused
                ? { error: true, message: 'There is no status named REOPENED' }
                : { bugs: [] },
            ),
          ),
      } as unknown as Response);
    }) as unknown as typeof fetch;

    expect(await client.reopen(9, 'still broken')).toEqual({ ok: true });
    expect(statuses, 'REOPENED first, then the CONFIRMED fallback').toEqual([
      'REOPENED',
      'CONFIRMED',
    ]);
  });

  test('a flow-triggered server error never reopens a FIXED ticket: it waits for a live replay', async () => {
    stubBugzilla([
      {
        id: 9,
        summary: '[KPV2-ABC123] POST /users: write flow received HTTP 500',
        is_open: false,
        resolution: 'FIXED',
      },
    ]);
    const held = await filer().file([candidate({ classification: 'flow.server-error' })]);

    expect(held.counts['needs-review'], 'held for a human, not reopened').toBe(1);
    expect(held.counts.reopened).toBe(0);
    expect(held.counts.created).toBe(0);
  });

  test('a flow-triggered server error on an OPEN ticket still just comments', async () => {
    stubBugzilla([
      { id: 9, summary: '[KPV2-ABC123] POST /users: write flow received HTTP 500', is_open: true },
    ]);
    const commented = await filer().file([candidate({ classification: 'flow.server-error' })]);

    expect(commented.counts.commented).toBe(1);
    expect(commented.counts['needs-review']).toBe(0);
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

  test('one fault seen with different probe counts in one run is one ticket, not three', () => {
    const msg = (n: string): string =>
      `POST /v2/profile/deleteOtherActivity: ${n} error responses failed: primary (body status 400 != HTTP 404)`;
    const merged = collapseCountVariants([
      candidate({
        id: 'KP-AAA001',
        title: msg('17/31'),
        endpoint: 'POST /v2/profile/deleteOtherActivity',
      }),
      candidate({
        id: 'KP-AAA002',
        title: msg('18/32'),
        endpoint: 'POST /v2/profile/deleteOtherActivity',
      }),
      candidate({
        id: 'KP-AAA003',
        title: msg('19/33'),
        endpoint: 'POST /v2/profile/deleteOtherActivity',
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('KP-AAA001');
    expect(merged[0]?.occurrences).toBe(3);
  });

  test('different faults on the same endpoint are NOT collapsed by the count merge', () => {
    const merged = collapseCountVariants([
      candidate({ id: 'KP-BBB001', title: 'POST /users: 1/2 cases failed: body.x null (got 500)' }),
      candidate({ id: 'KP-BBB002', title: 'POST /users: 1/2 cases failed: body.y null (got 200)' }),
    ]);

    expect(merged).toHaveLength(2);
  });

  test('an aggregate error-response finding is held for review when the endpoint has specific findings', () => {
    const held = holdAggregatesForReview([
      candidate({
        id: 'KP-AGG001',
        classification: 'common.api-error',
        endpoint: 'POST /v2/signupLogin/getLoginHistory',
        title: 'POST /v2/signupLogin/getLoginHistory: 9/31 error responses failed',
      }),
      candidate({
        id: 'KP-SPEC01',
        classification: 'request.data-type',
        endpoint: 'POST /v2/signupLogin/getLoginHistory',
        title:
          'POST /v2/signupLogin/getLoginHistory: selectedDate number instead of string (got 500)',
      }),
    ]);
    const aggregate = held.find((c) => c.id === 'KP-AGG001');
    const specific = held.find((c) => c.id === 'KP-SPEC01');
    expect(aggregate?.reviewHold, 'the aggregate is held for review').toBeTruthy();
    expect(specific?.reviewHold, 'the specific finding is not held').toBeFalsy();
  });

  test('an aggregate error-response finding with no specific findings still files (not held)', () => {
    const held = holdAggregatesForReview([
      candidate({
        id: 'KP-AGG002',
        classification: 'common.api-error',
        endpoint: 'GET /v2/profile/downloadCoverImage/{kpostID}',
        title: 'GET /v2/profile/downloadCoverImage/{kpostID}: 3/13 error responses failed',
      }),
      candidate({
        id: 'KP-OTHER1',
        classification: 'request.data-type',
        endpoint: 'POST /some/other/endpoint',
        title: 'POST /some/other/endpoint: body.x number (got 500)',
      }),
    ]);
    expect(
      held.find((c) => c.id === 'KP-AGG002')?.reviewHold,
      'an aggregate alone on its endpoint still files',
    ).toBeFalsy();
  });

  test('the aggregate hold reaches needs-review on the create path, but a matching open ticket still just comments', async () => {
    const agg = holdAggregatesForReview([
      candidate({
        id: 'KP-AGG003',
        classification: 'common.api-error',
        endpoint: 'POST /ep',
        title: 'POST /ep: 5/10 error responses failed',
      }),
      candidate({ id: 'KP-SPEC02', classification: 'request.null-value', endpoint: 'POST /ep' }),
    ]);
    const aggregate = agg.find((c) => c.id === 'KP-AGG003');
    expect(aggregate?.reviewHold).toBeTruthy();

    // Brand-new (no existing ticket): the hold sends it to needs-review, nothing is created.
    const freshCalls = stubBugzilla([]);
    const newRun = await filer().file([aggregate!]);
    expect(newRun.entries[0]?.decision).toBe('needs-review');
    expect(freshCalls.some((c) => c.method === 'POST' && /\/bug\?/.test(c.url))).toBe(false);

    // Already tracked (open ticket with the same tag): comment, never held.
    stubBugzilla([
      { id: 700, summary: '[KP-AGG003] POST /ep: error responses failed', is_open: true },
    ]);
    const reRun = await filer().file([aggregate!]);
    expect(reRun.entries[0]?.decision).toBe('commented');
  });

  test('a partially-fixed fault maps back to its FIXED ticket (reopen, not re-file)', () => {
    const fixed =
      '[KP-B0743C] POST /redbus/availabletrips/: 2/3 negative request cases failed: body.sourceCityID: number instead of string (expected [400,422], got 200); body.destinationCityID: number instead of string';
    const back =
      '[KP-0AFA5C] POST /redbus/availabletrips/: 1/3 negative request cases failed: body.sourceCityID: number instead of string (expected [400,422], got 200)';
    expect(partialFixKey('KPost API', back)).toBeDefined();
    expect(partialFixKey('KPost API', back)).toBe(partialFixKey('KPost API', fixed));
  });

  test('a different first failing case is a different fault — no reopen', () => {
    const a =
      '[KP-AAA001] POST /redbus/availabletrips/: 1/3 negative request cases failed: body.sourceCityID: number instead of string';
    const b =
      '[KP-AAA002] POST /redbus/availabletrips/: 1/3 negative request cases failed: body.travelDate: number instead of string';
    expect(partialFixKey('KPost API', a)).not.toBe(partialFixKey('KPost API', b));
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
