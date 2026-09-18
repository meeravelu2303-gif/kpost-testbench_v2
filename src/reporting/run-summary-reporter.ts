import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { env } from '../config/env';
import type { ValidationReport } from '../validation-engine/validation-result';
import { VALIDATION_REPORT_ATTACHMENT } from './report-attachment';
import {
  buildRunSummary,
  renderRunSummaryConsole,
  renderRunSummaryMarkdown,
  type UiTestRecord,
} from './run-summary';

/**
 * Writes the at-a-glance run report — `reports/RUN-SUMMARY.{json,md}` — on every run, and prints a
 * short console block. Pure aggregation of what the run already produced: it sends nothing, files
 * nothing, and never changes the exit code (a failure here is swallowed).
 *
 * API numbers come from the per-endpoint validation-report attachments (check-level); UI numbers
 * come from Playwright's own test outcomes (test-level). See `run-summary.ts` for the shape.
 */
const BROWSER_PROJECTS = new Set(['chromium', 'firefox', 'webkit', 'admin-ui']);
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

export default class RunSummaryReporter implements Reporter {
  /** Latest attempt per test, so a retry does not double-count its checks. */
  private readonly reportsByTest = new Map<string, ValidationReport[]>();
  private suite: Suite | undefined;

  printsToStdio(): boolean {
    return true;
  }

  onBegin(_config: unknown, suite: Suite): void {
    this.suite = suite;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const reports: ValidationReport[] = [];
    for (const attachment of result.attachments) {
      if (attachment.name !== VALIDATION_REPORT_ATTACHMENT || !attachment.body) continue;
      try {
        reports.push(JSON.parse(attachment.body.toString('utf8')) as ValidationReport);
      } catch {
        // A malformed attachment must not take the reporter down.
      }
    }
    if (reports.length) this.reportsByTest.set(test.id, reports);
  }

  onEnd(result: FullResult): void {
    try {
      const validationReports = [...this.reportsByTest.values()].flat();
      const summary = buildRunSummary({
        environment: env.TEST_ENV,
        build: env.BUILD_ID,
        testRunId: env.TEST_RUN_ID,
        runStatus: result.status,
        generatedAt: new Date().toISOString(),
        profiles: [...new Set(validationReports.map((r) => r.profile))],
        validationReports,
        uiTests: this.uiTests(),
      });
      const dir = path.join(process.cwd(), 'reports');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'RUN-SUMMARY.json'), JSON.stringify(summary, null, 2));
      writeFileSync(path.join(dir, 'RUN-SUMMARY.md'), renderRunSummaryMarkdown(summary));
      console.log(`\n${renderRunSummaryConsole(summary)}`);
    } catch (error) {
      console.log(
        `[run-summary] skipped — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Every browser (UI) test's outcome, for the UI section. */
  private uiTests(): UiTestRecord[] {
    const tests = this.suite?.allTests() ?? [];
    const records: UiTestRecord[] = [];
    for (const test of tests) {
      const project = test.parent.project()?.name ?? '';
      if (!BROWSER_PROJECTS.has(project)) continue;
      const failure = [...test.results].reverse().find((attempt) => attempt.error?.message);
      records.push({
        project,
        spec: path.basename(test.location.file),
        title: test.title,
        outcome: test.outcome(),
        message: failure?.error?.message?.replace(ANSI, '').trim(),
      });
    }
    return records;
  }
}
