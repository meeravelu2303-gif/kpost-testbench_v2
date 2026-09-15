import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import {
  candidateFromUiFailure,
  candidatesFromReport,
  mergeCandidates,
  type BugCandidate,
} from '../bug-tracker/bug-candidate';
import { BugzillaClient } from '../bug-tracker/bugzilla-client';
import { BugzillaFiler, type FilingOutcome } from '../bug-tracker/bugzilla-filer';
import { applyValidityGate, assessRunValidity } from '../bug-tracker/validity-gate';
import { readBugzillaConfig } from '../config/bugzilla.config';
import { env } from '../config/env';
import { suiteFor } from '../config/ownership.config';
import { createLogger } from '../utils/logger';
import type { ValidationReport } from '../validation-engine/validation-result';
import { buildBugReportConsole, buildBugReportMarkdown } from './bug-report';
import { VALIDATION_REPORT_ATTACHMENT } from './report-attachment';

/**
 * Files this run's defects into Bugzilla.
 *
 * Order of operations, and why:
 *   1. the RUN gate — a collapsed run files nothing, or a broken bench becomes 50 fake tickets
 *   2. candidates are built only from evidence the run produced (validation results, UI failures)
 *   3. the CANDIDATE gate drops infrastructure noise and claims their own evidence contradicts
 *   4. the filer dedupes against live Bugzilla and creates, comments, reopens or skips
 *
 * Dry run is the default (`BUGZILLA_DRY_RUN`), because filing cannot be undone. Nothing here can
 * fail the run or change its exit code.
 */
const BROWSER_PROJECTS = new Set(['chromium', 'firefox', 'webkit']);
const LOG = '[bugzilla]';

/**
 * Only the **observational** UI specs may file bugs: the deep screen sweep (`screens.spec.ts` — 9
 * checks on every screen, calibrated to zero false positives) and the structural smoke
 * (`navigation`/`shell` — a route that will not open or a missing shell is a real defect). The
 * interaction / write-flow specs (the gated `*_UI_LIFECYCLE` feature tests, compose, search, login,
 * two-session, copies, contacts, group, profile-edit, settings-theme, …) are FUNCTIONAL tests whose
 * failures during the build/tuning phase are selector issues, not app defects — filing those would
 * put false bugs on the developer's queue. Their failures still surface in the Playwright report for
 * human triage; they are simply never auto-filed.
 */
const UI_FILING_SPECS = new Set(['screens.spec.ts', 'navigation.spec.ts', 'shell.spec.ts']);

export default class BugzillaReporter implements Reporter {
  private readonly config = readBugzillaConfig();
  private readonly log = createLogger('bugzilla');
  private readonly validationReports: ValidationReport[] = [];
  private suite: Suite | undefined;
  private loadErrors = 0;

  printsToStdio(): boolean {
    return true;
  }

  onBegin(_config: unknown, suite: Suite): void {
    this.suite = suite;
  }

  onError(): void {
    this.loadErrors += 1;
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name !== VALIDATION_REPORT_ATTACHMENT || !attachment.body) continue;
      try {
        this.validationReports.push(
          JSON.parse(attachment.body.toString('utf8')) as ValidationReport,
        );
      } catch {
        // A malformed attachment must not take the reporter down.
      }
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    try {
      await this.publish(result);
    } catch (error) {
      console.log(`${LOG} skipped — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async publish(result: FullResult): Promise<void> {
    // Candidates and the validity gate need no Bugzilla connection, so they are computed on every
    // run — the in-bench bug report is written even when filing is off (dry run, no host).
    const tests = this.suite?.allTests() ?? [];
    const candidates = mergeCandidates([...this.apiCandidates(), ...this.uiCandidates(tests)]);
    const gate = applyValidityGate(candidates);
    this.write('candidates.json', {
      testRunId: env.TEST_RUN_ID,
      environment: env.TEST_ENV,
      generatedAt: new Date().toISOString(),
      accepted: gate.filed,
      rejected: gate.rejected.map(({ candidate, reason }) => ({
        id: candidate.id,
        summary: candidate.title,
        reason,
      })),
    });

    // Decide whether filing may run, and why not when it may not.
    const executed = tests.filter((test) => test.results.length > 0).length;
    const validity = assessRunValidity({
      executed,
      collected: tests.length,
      loadErrors: this.loadErrors,
      status: result.status,
    });

    let outcome: FilingOutcome | undefined;
    let notFiledReason: string | undefined;
    if (!this.config.enabled) {
      notFiledReason = 'BUGZILLA_URL / BUGZILLA_API_KEY not configured';
    } else if (!validity.valid) {
      notFiledReason = `run gate blocked filing — ${validity.reason}`;
    } else if (!gate.filed.length) {
      notFiledReason = `no valid defects (${gate.rejected.length} rejected by the validity gate)`;
    } else {
      const filer = new BugzillaFiler(
        new BugzillaClient(this.config, this.log),
        this.config,
        this.log,
      );
      outcome = await filer.file(gate.filed);
      this.write('filing.json', { ...outcome, rejected: gate.rejected.length });
    }

    // The clear, in-bench bug report — always written, always the source of truth for a run.
    const reportInput = {
      environment: env.TEST_ENV,
      runStatus: result.status,
      testRunId: env.TEST_RUN_ID,
      build: env.BUILD_ID,
      generatedAt: new Date().toISOString(),
      validationReports: this.validationReports,
      merged: candidates,
      rejected: gate.rejected,
      outcome,
      notFiledReason,
    };
    this.writeText('REPORT.md', buildBugReportMarkdown(reportInput));
    console.log(`\n${buildBugReportConsole(reportInput)}`);
  }

  private apiCandidates(): BugCandidate[] {
    return this.validationReports.flatMap((report) =>
      // The module's own host, so the ticket names the service that actually answered.
      candidatesFromReport(report, { baseURL: suiteFor(report.suite).baseUrl }, this.config),
    );
  }

  private uiCandidates(tests: readonly TestCase[]): BugCandidate[] {
    if (!this.config.fileUiFailures) return [];
    return tests.flatMap((test) => {
      const project = test.parent.project()?.name ?? '';
      // Only consistently failing browser tests: a flaky pass-on-retry is not solid evidence.
      if (!BROWSER_PROJECTS.has(project) || test.outcome() !== 'unexpected') return [];
      // Only the observational specs file; a feature/write-flow selector failure is not a defect.
      if (!UI_FILING_SPECS.has(path.basename(test.location.file))) return [];
      const failure = [...test.results].reverse().find((attempt) => attempt.error?.message);
      const message = stripAnsi(failure?.error?.message ?? '');
      if (!message) return [];
      return [
        candidateFromUiFailure(
          {
            file: path.relative(process.cwd(), test.location.file).replace(/\\/g, '/'),
            title: test.title,
            message: firstLine(message),
            fullMessage: message,
            browser: project,
            environment: env.TEST_ENV,
            baseURL: env.BASE_URL,
            build: env.BUILD_ID,
            testRunId: env.TEST_RUN_ID,
            observedAt: new Date().toISOString(),
          },
          this.config,
        ),
      ];
    });
  }

  private write(file: string, payload: unknown): void {
    this.writeText(file, JSON.stringify(payload, null, 2));
  }

  private writeText(file: string, content: string): void {
    try {
      const dir = path.join(process.cwd(), 'reports', 'bugs');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, file), content);
    } catch (error) {
      this.log.warn(`could not write reports/bugs/${file}: ${(error as Error).message}`);
    }
  }
}

// Playwright colourises assertion messages; the escape codes are noise in a ticket.
// Built from a char code so the regex literal carries no control character.
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const stripAnsi = (value: string): string => value.replace(ANSI, '').trim();

function firstLine(message: string): string {
  const MAX = 180;
  return (message.split('\n').find((line) => line.trim().length > 0) ?? 'Assertion failed')
    .trim()
    .slice(0, MAX);
}
