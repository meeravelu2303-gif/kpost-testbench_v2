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
import { createLogger } from '../utils/logger';
import type { ValidationReport } from '../validation-engine/validation-result';
import { VALIDATION_REPORT_ATTACHMENT } from './report-attachment';

/**
 * Files this run's defects into Bugzilla.
 *
 * Order of operations, and why:
 *   1. the RUN gate â€” a collapsed run files nothing, or a broken bench becomes 50 fake tickets
 *   2. candidates are built only from evidence the run produced (validation results, UI failures)
 *   3. the CANDIDATE gate drops infrastructure noise and claims their own evidence contradicts
 *   4. the filer dedupes against live Bugzilla and creates, comments, reopens or skips
 *
 * Dry run is the default (`BUGZILLA_DRY_RUN`), because filing cannot be undone. Nothing here can
 * fail the run or change its exit code.
 */
const BROWSER_PROJECTS = new Set(['chromium', 'firefox', 'webkit']);
const LOG = '[bugzilla]';

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
      console.log(`${LOG} skipped â€” ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async publish(result: FullResult): Promise<void> {
    if (!this.config.enabled) {
      console.log(`${LOG} BUGZILLA_URL / BUGZILLA_API_KEY not configured â€” no bugs filed`);
      return;
    }

    const tests = this.suite?.allTests() ?? [];
    const executed = tests.filter((test) => test.results.length > 0).length;
    const validity = assessRunValidity({
      executed,
      collected: tests.length,
      loadErrors: this.loadErrors,
      status: result.status,
    });
    if (!validity.valid) {
      console.log(`${LOG} nothing filed â€” ${validity.reason}`);
      this.write('filing.json', { skipped: true, reason: validity.reason });
      return;
    }

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

    for (const { candidate, reason } of gate.rejected) {
      this.log.info(`not filed (${candidate.id}): ${reason}`);
    }
    if (!gate.filed.length) {
      console.log(
        `${LOG} no valid defects to file (${gate.rejected.length} candidate(s) rejected by the validity gate)`,
      );
      return;
    }

    const filer = new BugzillaFiler(
      new BugzillaClient(this.config, this.log),
      this.config,
      this.log,
    );
    const outcome = await filer.file(gate.filed);
    this.write('filing.json', { ...outcome, rejected: gate.rejected.length });
    this.report(outcome, gate.rejected.length);
  }

  private apiCandidates(): BugCandidate[] {
    return this.validationReports.flatMap((report) =>
      candidatesFromReport(report, { tags: report.tags, baseURL: env.API_BASE_URL }, this.config),
    );
  }

  private uiCandidates(tests: readonly TestCase[]): BugCandidate[] {
    if (!this.config.fileUiFailures) return [];
    return tests.flatMap((test) => {
      const project = test.parent.project()?.name ?? '';
      // Only consistently failing browser tests: a flaky pass-on-retry is not solid evidence.
      if (!BROWSER_PROJECTS.has(project) || test.outcome() !== 'unexpected') return [];
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

  private report(outcome: FilingOutcome, rejected: number): void {
    const { counts } = outcome;
    const mode = outcome.dryRun ? 'DRY RUN â€” would file' : 'filed';
    console.log(
      `${LOG} ${mode} ${outcome.dryRun ? counts['would-file'] : counts.created}, ` +
        `commented ${counts.commented}, reopened ${counts.reopened}, adopted ${counts.adopted}, ` +
        `${counts['judged-skip']} judged-skip, ${counts.capped} capped, ${counts.failed} failed, ` +
        `${rejected} rejected by the validity gate. Details: reports/bugs/filing.json`,
    );
    for (const entry of outcome.entries) {
      const bug = entry.bugId ? ` bug ${entry.bugId}` : '';
      console.log(
        `${LOG}   ${entry.decision}${bug} [${entry.component}] ${entry.summary}${entry.reason ? ` â€” ${entry.reason}` : ''}`,
      );
    }
  }

  private write(file: string, payload: unknown): void {
    try {
      const dir = path.join(process.cwd(), 'reports', 'bugs');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, file), JSON.stringify(payload, null, 2));
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
