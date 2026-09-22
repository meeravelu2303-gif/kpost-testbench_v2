import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import {
  candidateFromUiFailure,
  candidatesFromReport,
  consolidateCascades,
  mergeCandidates,
  type BugCandidate,
  type ProofFile,
} from '../bug-tracker/bug-candidate';
import { BugzillaClient } from '../bug-tracker/bugzilla-client';
import { BugzillaFiler, type FilingOutcome } from '../bug-tracker/bugzilla-filer';
import { applyValidityGate, assessRunValidity } from '../bug-tracker/validity-gate';
import {
  buildRunIndex,
  classifyResolve,
  parseAffectedEndpoints,
} from '../bug-tracker/verify-resolve';
import type { ResolveSummary } from './bug-report';
import { readBugzillaConfig } from '../config/bugzilla.config';
import { env } from '../config/env';
import { suiteFor } from '../config/ownership.config';
import { createLogger } from '../utils/logger';
import type { ValidationReport } from '../validation-engine/validation-result';
import { buildBugReportConsole, buildBugReportMarkdown } from './bug-report';
import { VALIDATION_REPORT_ATTACHMENT } from './report-attachment';
import {
  buildRunSummary,
  renderRunSummaryConsole,
  renderRunSummaryMarkdown,
  type UiTestRecord,
} from './run-summary';

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
const UI_FILING_SPECS = new Set([
  'screens.spec.ts',
  'navigation.spec.ts',
  'shell.spec.ts',
  // The interaction sweep files too: its signals (a JS crash, a broken asset, or a frozen main
  // thread during real use) are selector-INDEPENDENT — a real defect, never a tuning miss.
  'interactions.spec.ts',
  // The systematic crawl files for the same reason: it clicks every safe control and reports only
  // crashes / freezes / raw-value renders — unambiguous defects, never a false bug from a selector.
  'crawl.spec.ts',
  // Keyboard navigation and network resilience file too: their signals are selector-INDEPENDENT — a
  // screen you cannot Tab into (WCAG 2.1.1), or one that crashes/freezes when the network drops — a
  // real defect, never a tuning miss. (axe-a11y and visual regression are review-only, not here.)
  'keyboard-nav.spec.ts',
  'network-resilience.spec.ts',
  // The Profile/Settings breakage sweep files too: it reports only crashes / broken assets / frozen
  // renders across those screens' sections and panels — selector-INDEPENDENT defects, never a
  // tuning miss.
  'profile-settings-breakage.spec.ts',
  // The Contacts breakage sweep files for the same reason — crashes / broken assets on the Contacts
  // tab and its Add / KDirectory / Group surfaces.
  'contacts-breakage.spec.ts',
  // The chat session-safety check files: "clicking a contact avatar logs the user out" is a
  // selector-INDEPENDENT, unambiguous functional defect (the session ends), captured with clear
  // visible proof — never a tuning miss.
  'chat-avatar-session.spec.ts',
]);

/**
 * Deterministic filing order so Bugzilla ids come out **ascending by module** — KPost API first, then
 * Admin, then KMail, then UI — and within a module by component, then endpoint, then summary. Without
 * this, parallel test completion would file candidates in a random order and the bug ids would not
 * track the modules. (Running one module per command reinforces the same ordering across runs.)
 */
const SUITE_FILING_ORDER: Record<string, number> = {
  'kpost-api': 0,
  'admin-api': 1,
  'kmail-api': 2,
  'kpost-ui': 3,
};

function orderedForFiling(candidates: readonly BugCandidate[]): BugCandidate[] {
  return [...candidates].sort((a, b) => {
    const suite = (SUITE_FILING_ORDER[a.suiteId] ?? 9) - (SUITE_FILING_ORDER[b.suiteId] ?? 9);
    if (suite !== 0) return suite;
    const component = a.component.localeCompare(b.component);
    if (component !== 0) return component;
    const endpoint = (a.endpoint ?? '').localeCompare(b.endpoint ?? '');
    if (endpoint !== 0) return endpoint;
    return a.title.localeCompare(b.title);
  });
}

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
    const candidates = consolidateCascades(
      mergeCandidates([...this.apiCandidates(), ...this.uiCandidates(tests)]),
    );
    const gate = applyValidityGate(candidates);

    // Decide whether filing may run, and why not when it may not.
    const executed = tests.filter((test) => test.results.length > 0).length;
    const validity = assessRunValidity({
      executed,
      collected: tests.length,
      loadErrors: this.loadErrors,
      status: result.status,
    });

    const client = this.config.enabled ? new BugzillaClient(this.config, this.log) : undefined;
    let outcome: FilingOutcome | undefined;
    let notFiledReason: string | undefined;
    let resolved: ResolveSummary | undefined;
    if (!this.config.enabled || !client) {
      notFiledReason = 'BUGZILLA_URL / BUGZILLA_API_KEY not configured';
    } else if (!validity.valid) {
      notFiledReason = `run gate blocked filing — ${validity.reason}`;
    } else {
      if (this.config.resolveOnly) {
        // Reconcile-only pass: close what the developers already fixed, file no new tickets.
        notFiledReason =
          'resolve-only mode — verified-fixed bugs are being closed; no new tickets filed';
      } else if (gate.filed.length) {
        const filer = new BugzillaFiler(client, this.config, this.log);
        // File in module order so created bug ids are ascending (KPost → KMail → UI).
        outcome = await filer.file(orderedForFiling(gate.filed));
      } else {
        notFiledReason = `no valid defects (${gate.rejected.length} rejected by the validity gate)`;
      }
      // Auto-close bugs this run VERIFIED as fixed — independent of whether anything was filed, so a
      // clean run (nothing to file) still closes what the developers already fixed. On a DRY run it
      // only REPORTS what it would close (a reviewable preview); it writes to Bugzilla only for real.
      if (this.config.autoResolve) {
        resolved = await this.autoResolve(client, candidates, this.config.dryRun);
      }
    }

    // The single, in-bench report — ONE Markdown + ONE JSON, always written, the source of truth
    // for a run. The Markdown carries execution health (endpoints, pass/fail/skip by module + UI)
    // followed by the bug report (distinct defects, filed-by-developer, not-filed reasons); the JSON
    // is the structured companion (run summary + quality gate + bug candidates/filing/resolved).
    const generatedAt = new Date().toISOString();
    const reportInput = {
      environment: env.TEST_ENV,
      runStatus: result.status,
      testRunId: env.TEST_RUN_ID,
      build: env.BUILD_ID,
      generatedAt,
      validationReports: this.validationReports,
      merged: candidates,
      rejected: gate.rejected,
      outcome,
      notFiledReason,
      resolved,
    };
    const runSummary = buildRunSummary({
      environment: env.TEST_ENV,
      build: env.BUILD_ID,
      testRunId: env.TEST_RUN_ID,
      runStatus: result.status,
      generatedAt,
      profiles: [...new Set(this.validationReports.map((r) => r.profile))],
      validationReports: this.validationReports,
      uiTests: this.uiTestRecords(tests),
    });
    const combined = {
      meta: runSummary.meta,
      api: runSummary.api,
      ui: runSummary.ui,
      // The CI quality gate reads this: a run is green only when every endpoint passed its gate.
      qualityGate: {
        passed: this.validationReports.every((r) => r.gate.passed),
        blockingEndpoints: this.validationReports
          .filter((r) => !r.gate.passed)
          .map((r) => r.endpoint),
      },
      bugs: {
        distinctDefects: gate.filed.length,
        candidates: gate.filed,
        rejected: gate.rejected.map(({ candidate, reason }) => ({
          id: candidate.id,
          summary: candidate.title,
          reason,
        })),
        filing: outcome ?? null,
        resolved: resolved ?? null,
        notFiledReason: notFiledReason ?? null,
      },
    };
    const markdown = `${renderRunSummaryMarkdown(runSummary)}\n${buildBugReportMarkdown(reportInput)}`;
    this.writeReport('REPORT.json', JSON.stringify(combined, null, 2));
    this.writeReport('REPORT.md', markdown);
    /*
     * Execution health first, then the defects: "what ran" before "what is broken". A bug count
     * read without the coverage that produced it is unanchored — 4 defects out of 5 checks and
     * 4 out of 4,000 describe very different runs.
     */
    console.log(`\n${renderRunSummaryConsole(runSummary)}`);
    console.log(`\n${buildBugReportConsole(reportInput)}`);
  }

  /** Every browser (UI) test's outcome, for the execution-health section of the report. */
  private uiTestRecords(tests: readonly TestCase[]): UiTestRecord[] {
    const records: UiTestRecord[] = [];
    for (const test of tests) {
      const project = test.parent.project()?.name ?? '';
      if (!BROWSER_PROJECTS.has(project) && project !== 'admin-ui') continue;
      const failure = [...test.results].reverse().find((attempt) => attempt.error?.message);
      records.push({
        project,
        spec: path.basename(test.location.file),
        title: test.title,
        outcome: test.outcome(),
        message: failure?.error?.message ? stripAnsi(failure.error.message).trim() : undefined,
      });
    }
    return records;
  }

  /**
   * Closes every OPEN bench-filed bug this run VERIFIED as fixed (its endpoint+validator ran and
   * passed and the fault did not reproduce). Only touches products actually tested this run, and only
   * bugs carrying our tag; a human-judged resolution is never reopened here. If the bench is wrong, a
   * later run reopens the ticket — so a wrong close is self-correcting, never a lost defect.
   */
  private async autoResolve(
    client: BugzillaClient,
    candidates: readonly BugCandidate[],
    dryRun: boolean,
  ): Promise<ResolveSummary> {
    const summary: ResolveSummary = {
      resolved: [],
      keptOpen: 0,
      checked: 0,
      failed: 0,
      confirmedFailing: 0,
      notVerified: 0,
      dryRun,
    };
    const index = buildRunIndex(this.validationReports);
    const reproduced = new Set(candidates.map((c) => c.id.replace(/^\[|\]$/g, '')));
    const products = [
      ...new Set(this.validationReports.map((r) => suiteFor(r.suite).bugzilla.product)),
    ];
    for (const product of products) {
      const found = await client.openBenchBugs(product, this.config.tagPrefix);
      if ('error' in found) {
        this.log.warn(`auto-resolve: could not list ${product} bugs — ${found.error}`);
        continue;
      }
      for (const bug of found.bugs) {
        summary.checked += 1;
        // A systemic (platform-wide) ticket is verified against ITS OWN endpoints, not globally — so a
        // ticket whose endpoints are fixed closes even if the same class still fails on an unrelated
        // endpoint (which is a different ticket). Read those from the description.
        let affected: string[] | undefined;
        if (/platform-wide/i.test(bug.summary)) {
          const description = await client.firstComment(bug.id);
          if (description) affected = parseAffectedEndpoints(description);
        }
        const decision = classifyResolve(bug, index, reproduced, affected);
        if (decision.action !== 'resolve') {
          summary.keptOpen += 1;
          // Split kept-open bugs: did the run confirm the fault still fails on THIS host, or was the
          // check simply not exercised (a write/OTP endpoint) so it stays unverified on this URL?
          if (/still fail|fails somewhere|reproduced/i.test(decision.reason)) {
            summary.confirmedFailing += 1;
          } else {
            summary.notVerified += 1;
          }
          continue;
        }
        if (dryRun) {
          // Preview only — record what WOULD be closed, write nothing to Bugzilla.
          summary.resolved.push({ bugId: bug.id, reason: decision.reason, summary: bug.summary });
          continue;
        }
        const comment =
          `Verified fixed by test run ${env.TEST_RUN_ID} against ${env.TEST_ENV}: ${decision.reason}. ` +
          `The bench no longer reproduces this fault, so it is auto-resolved. ` +
          `(If it recurs, the next run will reopen this ticket automatically.)`;
        const res = await client.resolveFixed(bug.id, comment);
        if ('error' in res) {
          summary.failed += 1;
          this.log.warn(`auto-resolve: bug ${bug.id} not updated — ${res.error}`);
        } else {
          summary.resolved.push({ bugId: bug.id, reason: decision.reason, summary: bug.summary });
        }
      }
    }
    return summary;
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
            proof: proofFrom(failure?.attachments, project),
          },
          this.config,
        ),
      ];
    });
  }

  private writeReport(file: string, content: string): void {
    try {
      const dir = path.join(process.cwd(), 'reports');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, file), content);
    } catch (error) {
      this.log.warn(`could not write reports/${file}: ${(error as Error).message}`);
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

/**
 * The screenshot and video Playwright captured for a failed UI test, as proof to attach to the
 * ticket. Playwright records these on failure (`screenshot: 'only-on-failure'`, `video:
 * 'retain-on-failure'`); each attachment carries the file `path` and `contentType`.
 */
function proofFrom(
  attachments: readonly { name: string; path?: string; contentType: string }[] | undefined,
  browser: string,
): ProofFile[] {
  const proof: ProofFile[] = [];
  for (const a of attachments ?? []) {
    if (!a.path) continue;
    if (a.name === 'screenshot') {
      proof.push({ path: a.path, contentType: a.contentType, label: `Screenshot (${browser})` });
    } else if (a.name === 'video') {
      proof.push({ path: a.path, contentType: a.contentType, label: `Video (${browser})` });
    } else if (a.name === 'crash-evidence') {
      // An annotated screenshot: the JS crash painted onto the page as readable text, so the IMAGE
      // itself shows the bug (the raw screenshot only shows a normal-looking screen).
      proof.push({
        path: a.path,
        contentType: a.contentType,
        label: `Annotated crash screenshot (${browser})`,
      });
    } else if (a.name === 'crash-diagnosis') {
      // A plain-English explanation of a JS crash (error + stack + the API call behind it) — the
      // evidence a screenshot/video cannot give for an exception that fires silently in the console.
      proof.push({
        path: a.path,
        contentType: a.contentType,
        label: `Crash diagnosis (${browser})`,
      });
    }
  }
  return proof;
}
