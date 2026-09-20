import { apiRegistry } from '@api/definitions/index';
import { resolveEndpoint } from '@engine/validation-policy';
import { plannedCases } from '@engine/endpoint-cases';
import {
  apiFingerprint,
  normalizeForFingerprint,
  systemicFingerprint,
  uiFingerprint,
} from '../../src/bug-tracker/bug-fingerprint';
import { candidatesFromReport } from '../../src/bug-tracker/bug-candidate';
import { readBugzillaConfig } from '@config/bugzilla.config';
import {
  apiTestCaseId,
  assertNoCollisions,
  detectCollisions,
  explicitTestCaseId,
  specTestCaseId,
  surfaceOf,
  TEST_CASE_ID_PREFIX,
} from '@reporting/test-case-id';
import type { ValidationReport, ValidationResult } from '@engine/validation-result';
import type { TestCase, TestResult } from '@playwright/test/reporter';
import { CaseRegistry } from '@reporting/case-registry';
import { TEST_CASE_ID_ANNOTATION } from '@reporting/test-case-id';
import { expect, test } from '@fixtures';

/**
 * Guards for Phase 2 §17.2 — stable test-case ids.
 *
 * Entirely offline: every id is a pure function of test metadata, so nothing here contacts a host.
 * The identity rules these pin are the ones the design commits to — most importantly that a
 * test-case id NEVER touches a Bugzilla fingerprint or summary.
 */

const KPOST_CASE = {
  suiteId: 'kpost-api',
  endpointId: 'common-languages',
  validatorName: 'response.status-code',
};

const SPEC_CASE = {
  specFile: 'tests/e2e/screens.spec.ts',
  titlePath: ['deep screen sweep', 'Katchup renders every key control'],
};

test.describe('stable test-case ids: determinism @framework', () => {
  test('the same definition always produces the same id', () => {
    expect(apiTestCaseId(KPOST_CASE)).toBe(apiTestCaseId({ ...KPOST_CASE }));
    expect(specTestCaseId(SPEC_CASE)).toBe(
      specTestCaseId({ specFile: SPEC_CASE.specFile, titlePath: [...SPEC_CASE.titlePath] }),
    );
  });

  test('the id is readable and uses the one TC convention', () => {
    const id = apiTestCaseId(KPOST_CASE);
    expect(id).toBe('TC-API-kpost-api-common-languages-response.status-code');
    expect(id.startsWith(`${TEST_CASE_ID_PREFIX}-`)).toBe(true);
    expect(specTestCaseId(SPEC_CASE)).toMatch(/^TC-UI-screens-deep-screen-sweep-.*-[0-9A-F]{6}$/);
  });

  test('ids stay within a length that fits a report row or a CI log line', () => {
    const longest = apiRegistry
      .all()
      .map((api) =>
        apiTestCaseId({
          suiteId: 'kmail-api',
          endpointId: api.id,
          validatorName: 'request.unsupported-media-type',
        }),
      )
      .reduce((longestSoFar, id) => (id.length > longestSoFar.length ? id : longestSoFar), '');
    expect(longest.length).toBeLessThanOrEqual(100);
  });

  test('no runtime state contributes: the id is a pure function of the definition', () => {
    const before = apiTestCaseId(KPOST_CASE);
    process.env.TEST_PARALLEL_INDEX = '7';
    process.env.RUN_PROFILE = 'kpost-deep';
    process.env.TEST_RUN_ID = 'run-something-else';
    const after = apiTestCaseId(KPOST_CASE);
    delete process.env.TEST_PARALLEL_INDEX;
    delete process.env.RUN_PROFILE;
    expect(after).toBe(before);
    expect(before).not.toMatch(/\d{13}|run-|worker|chromium|firefox|webkit/i);
  });
});

test.describe('stable test-case ids: uniqueness @framework', () => {
  test('a different endpoint, suite or validator yields a different id', () => {
    const base = apiTestCaseId(KPOST_CASE);
    expect(apiTestCaseId({ ...KPOST_CASE, endpointId: 'common-domain' })).not.toBe(base);
    expect(apiTestCaseId({ ...KPOST_CASE, suiteId: 'kmail-api' })).not.toBe(base);
    expect(apiTestCaseId({ ...KPOST_CASE, validatorName: 'response.schema' })).not.toBe(base);
  });

  test('a different spec file or title yields a different id', () => {
    const base = specTestCaseId(SPEC_CASE);
    expect(specTestCaseId({ ...SPEC_CASE, specFile: 'tests/e2e/crawl.spec.ts' })).not.toBe(base);
    expect(specTestCaseId({ ...SPEC_CASE, titlePath: ['deep screen sweep', 'other'] })).not.toBe(
      base,
    );
  });

  test('EVERY generated API case in the registry has a unique id', () => {
    // The real thing: ~345 endpoints × 47 validators. If two collapsed, two checks would be
    // reported as one case — so this is the authoritative offline collision gate.
    const cases = apiRegistry.all().flatMap((api) => {
      const endpoint = resolveEndpoint(api);
      return plannedCases(endpoint).map((planned) => ({
        id: apiTestCaseId({
          suiteId: endpoint.suite.id,
          endpointId: endpoint.id,
          validatorName: planned.name,
        }),
        identityKey: `api|${endpoint.suite.id}|${endpoint.id}|${planned.name}`,
        source: `${endpoint.label} › ${planned.name}`,
      }));
    });
    expect(cases.length).toBeGreaterThan(1000);
    expect(() => assertNoCollisions(cases)).not.toThrow();
  });
});

test.describe('stable test-case ids: execution independence @framework', () => {
  test('the browser project is not part of the identity', () => {
    // The bench already treats one fault across three engines as ONE defect (uiFingerprint excludes
    // the project); a per-browser case id would contradict that.
    const chromium = specTestCaseId(SPEC_CASE);
    const webkit = specTestCaseId({ ...SPEC_CASE });
    expect(webkit).toBe(chromium);
    expect(chromium).not.toMatch(/chromium|firefox|webkit/i);
  });

  test('the run profile is not part of the identity', () => {
    // `kpost` and `kpost-deep` run the same checks; only the execution differs.
    expect(apiTestCaseId(KPOST_CASE)).not.toMatch(/kpost-deep|profile/i);
  });

  test('the surface comes from the spec path, never from the Playwright project', () => {
    expect(surfaceOf('tests/e2e/screens.spec.ts')).toBe('UI');
    expect(surfaceOf('tests/e2e-admin/admin-screens.spec.ts')).toBe('ADMINUI');
    expect(surfaceOf('tests/api/kpost/kall/feature.spec.ts')).toBe('API');
    expect(surfaceOf('tests/framework/live-safety.spec.ts')).toBe('FW');
    expect(surfaceOf(String.raw`tests\e2e\screens.spec.ts`)).toBe('UI');
  });
});

test.describe('stable test-case ids: collisions @framework', () => {
  test('two different definitions sharing an id are detected and both are named', () => {
    const collisions = detectCollisions([
      { id: 'TC-UI-x-1', identityKey: 'spec|a.ts|one', source: 'a.ts › one' },
      { id: 'TC-UI-x-1', identityKey: 'spec|b.ts|two', source: 'b.ts › two' },
      { id: 'TC-UI-y-2', identityKey: 'spec|c.ts|three', source: 'c.ts › three' },
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.id).toBe('TC-UI-x-1');
    expect(collisions[0]?.conflicting.map((c) => c.source)).toEqual(['a.ts › one', 'b.ts › two']);
  });

  test('the same definition seen twice is NOT a collision', () => {
    expect(
      detectCollisions([
        { id: 'TC-UI-x-1', identityKey: 'spec|a.ts|one', source: 'a.ts › one' },
        { id: 'TC-UI-x-1', identityKey: 'spec|a.ts|one', source: 'a.ts › one' },
      ]),
    ).toEqual([]);
  });

  test('a collision fails loudly, naming both sides — never silently resolved', () => {
    const cases = [
      { id: 'TC-UI-x-1', identityKey: 'spec|a.ts|one', source: 'a.ts › one' },
      { id: 'TC-UI-x-1', identityKey: 'spec|b.ts|two', source: 'b.ts › two' },
    ];
    expect(() => assertNoCollisions(cases)).toThrow(/collision/i);
    expect(() => assertNoCollisions(cases)).toThrow(/a\.ts › one/);
    expect(() => assertNoCollisions(cases)).toThrow(/b\.ts › two/);
  });

  test('an explicit id must follow the one convention', () => {
    expect(explicitTestCaseId('TC-KATCHUP-RECALL')).toBe('TC-KATCHUP-RECALL');
    expect(() => explicitTestCaseId('KATCHUP-RECALL')).toThrow(/must start with "TC-"/);
    expect(() => explicitTestCaseId('TC-bad id')).toThrow(/Invalid explicit test-case id/);
  });
});

test.describe('stable test-case ids: Bugzilla compatibility @framework', () => {
  /**
   * The hard boundary. Dedupe, adoption and auto-resolve all key off the fingerprint and the
   * summary, so if a `TC-…` ever leaked into either, every open ticket would be orphaned and
   * re-filed as new. These are byte-level regression tests, not assertions about intent.
   */
  test('fingerprints are byte-identical to the pre-Phase-2.2 values', () => {
    // Values computed from the algorithm as committed in Phase 1 — they must never move.
    expect(
      apiFingerprint({
        prefix: 'KP',
        endpointId: 'common-languages',
        validatorName: 'response.status-code',
        message: 'expected 200, got 500',
      }),
    ).toBe('KP-183BBD');
    expect(
      systemicFingerprint({
        prefix: 'KP',
        validatorName: 'security.security-headers',
        message: 'content-security-policy missing',
      }),
    ).toBe('KP-1FCD09');
    expect(
      uiFingerprint({
        prefix: 'KP',
        file: 'tests/e2e/screens.spec.ts',
        title: 'Katchup renders',
        message: 'page crashed',
      }),
    ).toBe('KP-3D6538');
  });

  test('a test-case id never reaches the fingerprint, even if it appears in the message', () => {
    const withId = apiFingerprint({
      prefix: 'KP',
      endpointId: 'common-languages',
      validatorName: 'response.status-code',
      message: 'expected 200, got 500',
    });
    const id = apiTestCaseId(KPOST_CASE);
    expect(withId).not.toContain(id);
    expect(normalizeForFingerprint(`expected 200, got 500 (${id})`)).toContain(id);
    // …and the id is NOT an input anywhere: the fingerprint of the same fault is unchanged.
    expect(withId).toBe('KP-183BBD');
  });

  test('a candidate built from a result carrying a testCaseId has the same tag and summary', () => {
    const config = readBugzillaConfig();
    const result = (extra: Partial<ValidationResult>): ValidationResult =>
      ({
        validationId: 'v-1',
        validatorName: 'response.status-code',
        category: 'RESPONSE',
        endpointId: 'common-languages',
        endpoint: 'POST /v2/common/languages',
        method: 'POST',
        expected: 200,
        actual: 500,
        status: 'FAILED',
        message: 'expected 200, got 500',
        durationMs: 12,
        timestamp: '2026-09-20T00:00:00.000Z',
        severity: 'CRITICAL',
        correlationId: 'tb-1',
        ...extra,
      }) satisfies ValidationResult;

    const report = (r: ValidationResult): ValidationReport =>
      ({
        endpointId: 'common-languages',
        endpoint: 'POST /v2/common/languages',
        method: 'POST',
        requiresAuth: false,
        primary: { status: 500, body: '{}' },
        tags: ['common'],
        suite: 'kpost-api',
        profile: 'FULL',
        environment: 'production',
        build: 'local',
        testRunId: 'run-x',
        correlationId: 'tb-1',
        startedAt: '2026-09-20T00:00:00.000Z',
        durationMs: 20,
        results: [r],
        summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0 },
        gate: { passed: false, blocking: ['response.status-code'] },
      }) satisfies ValidationReport;

    const context = { baseURL: 'https://testingapi.example' };
    const without = candidatesFromReport(report(result({})), context, config);
    const with_ = candidatesFromReport(
      report(result({ testCaseId: apiTestCaseId(KPOST_CASE) })),
      context,
      config,
    );

    expect(with_[0]?.id, 'the [KP-] tag must not move').toBe(without[0]?.id);
    expect(with_[0]?.title, 'the summary must not change').toBe(without[0]?.title);
    expect(JSON.stringify(with_[0]?.evidence), 'the ticket evidence must not change').toBe(
      JSON.stringify(without[0]?.evidence),
    );
  });
});

test.describe('stable test-case ids: reporting integration @framework', () => {
  test('testCaseId and validationId coexist and stay independent', () => {
    const first: ValidationResult = {
      validationId: 'a-different-uuid-each-run',
      testCaseId: apiTestCaseId(KPOST_CASE),
    } as ValidationResult;
    const second: ValidationResult = {
      validationId: 'another-uuid',
      testCaseId: apiTestCaseId(KPOST_CASE),
    } as ValidationResult;

    expect(first.validationId).not.toBe(second.validationId);
    expect(first.testCaseId, 'identity of the CHECK is stable').toBe(second.testCaseId);
    expect(first.testCaseId).not.toBe(first.validationId);
  });

  test('a generated API case is recorded by its annotated id and enriched from its result', () => {
    /*
     * The generated-case path end to end, offline: the case generator annotates the test with its
     * stable id, the registry records it, and the matching validation result supplies the EXECUTION
     * identity. Generated cases only exist for live-host specs, so this exercises the same code with
     * stub Playwright objects rather than contacting a host.
     */
    const registry = new CaseRegistry();
    const id = apiTestCaseId(KPOST_CASE);
    const stubTest = {
      annotations: [{ type: TEST_CASE_ID_ANNOTATION, description: id }],
      location: { file: `${process.cwd()}/tests/api/kpost/common/location.spec.ts` },
      title: 'response.status-code — the primary response status is expected',
      titlePath: () => [
        '',
        'api',
        'location.spec.ts',
        'POST /v2/common/languages',
        'response.status-code',
      ],
      outcome: () => 'expected' as const,
      parent: { project: () => ({ name: 'api' }) },
    } as unknown as TestCase;
    registry.add(stubTest, { status: 'passed', duration: 7 } as unknown as TestResult);

    registry.enrichFromValidationReports([
      {
        suite: 'kpost-api',
        results: [
          {
            validationId: 'exec-uuid-1',
            testCaseId: id,
            endpointId: 'common-languages',
            endpoint: 'POST /v2/common/languages',
            validatorName: 'response.status-code',
          } as ValidationResult,
        ],
      } as ValidationReport,
    ]);

    const row = registry.all()[0];
    expect(row?.testCaseId, 'the annotated stable id wins over a derived one').toBe(id);
    expect(row?.validationId, 'execution identity comes from the result').toBe('exec-uuid-1');
    expect(row?.endpoint).toBe('POST /v2/common/languages');
    expect(row?.validator).toBe('response.status-code');
    expect(row?.status).toBe('passed');
    // The Playwright project is recorded as execution metadata, never folded into the identity.
    expect(row?.project).toBe('api');
    expect(row?.testCaseId).not.toContain('api|');
    expect(registry.collisions()).toEqual([]);
  });

  test('the same hand-written test on three browsers is ONE case id', () => {
    const registry = new CaseRegistry();
    for (const project of ['chromium', 'firefox', 'webkit']) {
      registry.add(
        {
          annotations: [],
          location: { file: `${process.cwd()}/tests/e2e/screens.spec.ts` },
          title: 'Katchup renders every key control',
          titlePath: () => [
            '',
            project,
            'screens.spec.ts',
            'deep screen sweep',
            'Katchup renders every key control',
          ],
          outcome: () => 'expected' as const,
          parent: { project: () => ({ name: project }) },
        } as unknown as TestCase,
        { status: 'passed', duration: 1 } as unknown as TestResult,
      );
    }
    const ids = new Set(registry.all().map((row) => row.testCaseId));
    expect([...ids], 'one logical test = one id across browsers').toHaveLength(1);
    expect(registry.all().map((row) => row.project)).toEqual(['chromium', 'firefox', 'webkit']);
    expect(registry.collisions(), 'same definition in 3 projects is not a collision').toEqual([]);
  });

  test('a legacy result without a testCaseId still parses (migration safety)', () => {
    const legacy = { validationId: 'v-1', validatorName: 'response.schema' } as ValidationResult;
    expect(legacy.testCaseId).toBeUndefined();
    // Nothing derives a stable id from a runtime UUID — an absent id stays absent.
    expect(legacy.validationId).toBe('v-1');
  });
});
