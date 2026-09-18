import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import type { ValidationReport, ValidationResult } from '../validation-engine/validation-result';
import { VALIDATION_REPORT_ATTACHMENT } from './report-attachment';

interface ReporterOptions {
  outputDir?: string;
}

/**
 * Playwright reporter that aggregates every endpoint's validation report into
 * reports/validation/summary.{json,md} — the input for dashboards and the CI quality gate.
 */
export default class ValidationReporter implements Reporter {
  /** Latest attempt per test, so retries do not double count. */
  private readonly reportsByTest = new Map<string, ValidationReport[]>();

  constructor(private readonly options: ReporterOptions = {}) {}

  printsToStdio(): boolean {
    return false;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const reports = result.attachments
      .filter((a) => a.name === VALIDATION_REPORT_ATTACHMENT && a.body)
      .map((a) => JSON.parse(a.body!.toString('utf8')) as ValidationReport);
    if (reports.length) this.reportsByTest.set(test.id, reports);
  }

  onEnd(result: FullResult): void {
    const reports = [...this.reportsByTest.values()].flat();
    if (!reports.length) return;

    const results = reports.flatMap((r) => r.results);
    const count = (status: ValidationResult['status']): number =>
      results.filter((r) => r.status === status).length;
    const failures = results.filter((r) => r.status === 'FAILED');
    const first = reports[0]!;

    const summary = {
      generatedAt: new Date().toISOString(),
      runStatus: result.status,
      testRunId: first.testRunId,
      environment: first.environment,
      build: first.build,
      profiles: [...new Set(reports.map((r) => r.profile))],
      totals: {
        endpoints: reports.length,
        validations: results.length,
        passed: count('PASSED'),
        failed: count('FAILED'),
        warnings: count('WARNING'),
        skipped: count('SKIPPED'),
      },
      qualityGate: {
        passed: reports.every((r) => r.gate.passed),
        blockingEndpoints: reports.filter((r) => !r.gate.passed).map((r) => r.endpoint),
      },
      endpoints: reports.map((r) => ({
        endpoint: r.endpoint,
        endpointId: r.endpointId,
        profile: r.profile,
        correlationId: r.correlationId,
        summary: r.summary,
        gate: r.gate,
      })),
      failures: failures.map((f) => ({
        endpoint: f.endpoint,
        validator: f.validatorName,
        category: f.category,
        severity: f.severity,
        message: f.message,
        correlationId: f.correlationId,
      })),
    };

    const outputDir = this.options.outputDir ?? path.join(process.cwd(), 'reports', 'validation');
    mkdirSync(outputDir, { recursive: true });
    // Only the machine-readable summary.json is written here (the CI quality gate + dashboards read
    // it). The human-readable run report is the single, neat `reports/RUN-SUMMARY.md` written by the
    // run-summary reporter — a per-endpoint Markdown table here would just duplicate it, so it is not
    // written.
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(
      `\nValidation summary: ${summary.totals.endpoints} endpoints, ${summary.totals.validations} validations — ` +
        `${summary.totals.passed} passed, ${summary.totals.failed} failed, ${summary.totals.warnings} warnings, ${summary.totals.skipped} skipped. ` +
        `Quality gate: ${summary.qualityGate.passed ? 'PASSED' : 'FAILED'} (reports/RUN-SUMMARY.md)`,
    );
  }
}
