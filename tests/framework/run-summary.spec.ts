import {
  buildRunSummary,
  renderRunSummaryMarkdown,
  type RunSummaryInput,
} from '../../src/reporting/run-summary';
import type {
  ValidationCategory,
  ValidationReport,
  ValidationResult,
  ValidationStatus,
} from '../../src/validation-engine/validation-result';
import { expect, test } from '@fixtures';

/**
 * The at-a-glance run report must count what the run produced, and keep API (check-level) and UI
 * (test-level) numbers separate. These pin the aggregation so a future change cannot silently
 * miscount or conflate the two surfaces.
 */

function report(over: Partial<ValidationReport>): ValidationReport {
  const results = over.results ?? [];
  return {
    endpointId: 'x',
    endpoint: 'POST /x',
    method: 'POST',
    tags: [],
    suite: 'kpost-api',
    profile: 'REGRESSION',
    environment: 'production',
    build: 'local',
    testRunId: 'run-1',
    correlationId: 'c',
    startedAt: new Date().toISOString(),
    durationMs: 1,
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === 'PASSED').length,
      failed: results.filter((r) => r.status === 'FAILED').length,
      warnings: results.filter((r) => r.status === 'WARNING').length,
      skipped: results.filter((r) => r.status === 'SKIPPED').length,
    },
    gate: { passed: !results.some((r) => r.status === 'FAILED'), blocking: [] },
    ...over,
  };
}

function result(
  status: ValidationStatus,
  validator = 'response.status-code',
  category: ValidationCategory = 'RESPONSE',
): ValidationResult {
  return {
    validationId: 'v',
    validatorName: validator,
    category,
    endpointId: 'x',
    endpoint: 'POST /x',
    method: 'POST',
    expected: null,
    actual: null,
    status,
    message: '',
    durationMs: 1,
    timestamp: new Date().toISOString(),
    severity: 'HIGH',
    correlationId: 'c',
  };
}

const base: Omit<RunSummaryInput, 'validationReports' | 'uiTests'> = {
  environment: 'production',
  build: 'local',
  testRunId: 'run-1',
  runStatus: 'passed',
  generatedAt: '2026-09-18T00:00:00.000Z',
  profiles: ['REGRESSION'],
};

test.describe('run summary', () => {
  test('counts API checks by module and by category, worst endpoint first @framework', () => {
    const summary = buildRunSummary({
      ...base,
      uiTests: [],
      validationReports: [
        report({
          endpoint: 'POST /a',
          suite: 'kpost-api',
          results: [
            result('PASSED'),
            result('FAILED', 'response.error-format'),
            result('FAILED', 'response.error-format'),
            result('SKIPPED'),
          ],
        }),
        report({
          endpoint: 'POST /b',
          suite: 'kmail-api',
          results: [result('PASSED'), result('FAILED', 'security.security-headers', 'SECURITY')],
        }),
      ],
    });

    expect(summary.api.endpoints).toBe(2);
    expect(summary.api.checks).toEqual({ total: 6, passed: 2, failed: 3, warnings: 0, skipped: 1 });
    // Two modules, each its own row.
    expect(summary.api.bySuite.map((s) => s.suite).sort()).toEqual(['kmail-api', 'kpost-api']);
    // Worst endpoint (most failures) first.
    expect(summary.api.endpointsWithFailures[0]?.endpoint).toBe('POST /a');
    // Top failing validator is the one with the most failed checks.
    expect(summary.api.topFailingValidators[0]).toMatchObject({
      validator: 'response.error-format',
      failed: 2,
    });
  });

  test('counts UI tests per project and per spec, separate from API @framework', () => {
    const summary = buildRunSummary({
      ...base,
      validationReports: [report({ results: [result('PASSED')] })],
      uiTests: [
        { project: 'chromium', spec: 'screens.spec.ts', title: 'home', outcome: 'expected' },
        {
          project: 'chromium',
          spec: 'screens.spec.ts',
          title: 'kmail',
          outcome: 'unexpected',
          message: 'boom\nsecond line',
        },
        { project: 'firefox', spec: 'navigation.spec.ts', title: 'nav', outcome: 'skipped' },
        { project: 'webkit', spec: 'shell.spec.ts', title: 'shell', outcome: 'flaky' },
      ],
    });

    expect(summary.ui.ran).toBe(true);
    expect(summary.ui.tests).toEqual({ total: 4, passed: 1, failed: 1, skipped: 1, flaky: 1 });
    expect(summary.ui.byProject.find((p) => p.project === 'chromium')).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
    });
    // The failure is captured with only its first line.
    expect(summary.ui.failures).toHaveLength(1);
    expect(summary.ui.failures[0]).toMatchObject({ spec: 'screens.spec.ts', message: 'boom' });
    // API count is untouched by UI.
    expect(summary.api.checks.passed).toBe(1);
  });

  test('renders markdown with both surfaces and no UI section when none ran @framework', () => {
    const withUi = renderRunSummaryMarkdown(
      buildRunSummary({
        ...base,
        validationReports: [report({ results: [result('PASSED')] })],
        uiTests: [{ project: 'chromium', spec: 's.spec.ts', title: 't', outcome: 'expected' }],
      }),
    );
    expect(withUi).toContain('# Run summary');
    expect(withUi).toContain('## 6. UI tests');
    expect(withUi).toContain('chromium');

    const noUi = renderRunSummaryMarkdown(
      buildRunSummary({
        ...base,
        validationReports: [report({ results: [result('PASSED')] })],
        uiTests: [],
      }),
    );
    expect(noUi).toContain('No UI (browser) tests ran');
  });
});
