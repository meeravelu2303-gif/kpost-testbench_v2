import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import {
  accessibilityCandidatesFromScreens,
  candidateFromUiFailure,
  collapseCountVariants,
  holdAggregatesForReview,
  candidatesFromReport,
  consolidateCascades,
  mergeCandidates,
  type AccessibilityScreenInput,
  type BugCandidate,
  type ProofFile,
} from '../bug-tracker/bug-candidate';
import { AXE_DETAILS_ATTACHMENT, AXE_JSON_ATTACHMENT } from '../ui/accessibility-evidence';
import { archivePreviousReport } from './report-archive';
import {
  FAILURE_DIAGNOSIS_ATTACHMENT,
  FAILURE_SIGNALS_ATTACHMENT,
  type FailureSignals,
} from '../ui/failure-diagnostics';
import { BugzillaClient, type BugSummary } from '../bug-tracker/bugzilla-client';
import { BugzillaFiler, type FilingOutcome } from '../bug-tracker/bugzilla-filer';
import {
  applyValidityGate,
  assessRunValidity,
  ENVIRONMENTAL_UI_OR_API_FAILURE,
} from '../bug-tracker/validity-gate';
import {
  buildRunIndex,
  buildUiRunIndex,
  classifyResolve,
  classifyUiResolve,
  parseAffectedEndpoints,
  uiTitleMatches,
  type ResolveDecision,
} from '../bug-tracker/verify-resolve';
import { maskString } from '../utils/masking';
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
 * Files this run's defects into Bugzilla: run gate, candidates from run evidence, validity gate,
 * then dedupe and file. Dry run is the default because filing cannot be undone; never fails the
 * run.
 */
const BROWSER_PROJECTS = new Set(['chromium', 'firefox', 'webkit']);
const LOG = '[bugzilla]';

/**
 * The UI specs allowed to file bugs: only those whose signals are selector-independent (crashes,
 * broken assets, freezes, dead routes, executed payloads). Other UI failures stay in the Playwright
 * report for triage.
 */
const UI_FILING_SPECS = new Set([
  'screens-batch1.spec.ts',
  'screens-batch2.spec.ts',
  'screens-batch3.spec.ts',
  'navigation.spec.ts',
  'shell.spec.ts',
  'interactions.spec.ts',
  'crawl.spec.ts',
  // axe-a11y and visual regression are review-only, so not listed.
  'keyboard-nav.spec.ts',
  'network-resilience.spec.ts',
  'profile-settings-breakage.spec.ts',
  'contacts-breakage.spec.ts',
  'chat-avatar-session.spec.ts',
  'signup-login-screens.spec.ts',
  // Admin UI health sweeps; the PII-masking spec stays review-only (a person must check it).
  'admin-screens.spec.ts',
  'admin-subtabs-health.spec.ts',
  'admin-dead-screens.spec.ts',
  'admin-login.spec.ts',
  // Deterministic stubs of states the real server returns, so a failure is a code defect. Stubs of
  // shapes the server never returns (`home-resilience.spec.ts`) are not real bugs and are not
  // listed.
  'home-api-handling.spec.ts',
  'katchup-api-handling.spec.ts',
  'katchup-write-handling.spec.ts',
]);

/** Filing order (module, component, endpoint, summary), so new bug ids ascend by module. */
const SUITE_FILING_ORDER: Record<string, number> = {
  'kpost-api': 0,
  'admin-api': 1,
  'kmail-api': 2,
  'kpost-ui': 3,
  'admin-ui': 4,
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
  /** This run's failure screenshots, by `project::test title` — attached as dated proof. */
  private readonly uiProof = new Map<string, ProofFile[]>();
  /** `project::title` of UI tests whose every failure was environmental (see uiTestRecords). */
  private readonly uiEnvironmentalOnly = new Set<string>();
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
    // Candidates and the gate need no Bugzilla, so the report is written even when filing is off.
    const tests = this.suite?.allTests() ?? [];
    const uiRecords = this.uiTestRecords(tests);
    const candidates = consolidateCascades(
      collapseCountVariants(
        mergeCandidates([
          ...this.apiCandidates(),
          ...this.uiCandidates(tests),
          ...this.accessibilityCandidates(tests),
        ]),
      ),
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
        // File in module order; overlapping aggregate findings are held for review.
        outcome = await filer.file(orderedForFiling(holdAggregatesForReview(gate.filed)));
      } else {
        notFiledReason = `no valid defects (${gate.rejected.length} rejected by the validity gate)`;
      }
      // Close bugs this run verified as fixed, even when nothing was filed. A dry run previews.
      if (this.config.autoResolve) {
        // Bugs the filing pass already commented on; the status pass must not post a second note.
        const touchedByFiler = new Set(
          (outcome?.entries ?? [])
            .filter(
              (e) =>
                e.bugId && ['commented', 'reopened', 'adopted', 'created'].includes(e.decision),
            )
            .map((e) => e.bugId as number),
        );
        // A transient/bench-fault rejection is no reproduction, so cannot mark a bug still broken.
        const transient = new Set(
          gate.rejected
            .filter(({ reason }) =>
              /transient|infrastructure or bench fault|throttled|setup step failed/i.test(reason),
            )
            .map(({ candidate }) => candidate.id),
        );
        resolved = await this.autoResolve(
          client,
          candidates.filter((c) => !transient.has(c.id)),
          this.config.dryRun,
          uiRecords,
          touchedByFiler,
        );
      }
    }

    // The run's single report: REPORT.md (health, then bugs) and its structured REPORT.json.
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
      uiTests: uiRecords,
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
    // A framework-only run must not replace the last product run's report.
    const frameworkOnly =
      tests.length > 0 && tests.every((test) => test.parent.project()?.name === 'framework');
    if (!frameworkOnly) {
      archivePreviousReport(path.join(process.cwd(), 'reports'));
      this.writeReport('REPORT.json', JSON.stringify(combined, null, 2));
      this.writeReport('REPORT.md', markdown);
    }
    // Execution health first, so the bug count is read against the coverage that produced it.
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
      // Failed only because the app did not answer: counts as not run, and is never used as proof.
      const failedAttempts = test.results.filter((attempt) => attempt.error?.message);
      const envOnly =
        failedAttempts.length > 0 &&
        failedAttempts.every((attempt) =>
          ENVIRONMENTAL_UI_OR_API_FAILURE.test(stripAnsi(attempt.error?.message ?? '')),
        );
      if (envOnly) this.uiEnvironmentalOnly.add(`${project}::${test.title}`);
      else if (failure)
        this.uiProof.set(`${project}::${test.title}`, proofFrom(failure.attachments, project));
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
   * Status pass over every open bug of each product tested: bench-tagged bugs close when this run
   * verified the fix; every other open bug gets a dated note. Hand-filed bugs are never
   * auto-closed.
   */
  private async autoResolve(
    client: BugzillaClient,
    candidates: readonly BugCandidate[],
    dryRun: boolean,
    uiRecords: readonly UiTestRecord[],
    touchedByFiler: ReadonlySet<number>,
  ): Promise<ResolveSummary> {
    const summary: ResolveSummary = {
      resolved: [],
      keptOpen: 0,
      checked: 0,
      failed: 0,
      confirmedFailing: 0,
      notVerified: 0,
      touched: 0,
      dryRun,
    };
    const index = buildRunIndex(this.validationReports);
    const uiIndex = buildUiRunIndex(
      uiRecords.map((record) => {
        if (!this.uiEnvironmentalOnly.has(`${record.project}::${record.title}`)) return record;
        // Environmental-only failures count as not run; flaky-then-passed counts as a pass.
        return { ...record, outcome: record.outcome === 'flaky' ? 'expected' : 'skipped' };
      }),
    );
    const reproduced = new Set(candidates.map((c) => c.id.replace(/^\[|\]$/g, '')));
    // A UI product's bugs are re-checked only when its own front end ran this pass.
    const uiProducts = new Set<string>();
    if (uiRecords.some((r) => r.project !== 'admin-ui'))
      uiProducts.add(suiteFor('kpost-ui').bugzilla.product);
    if (uiRecords.some((r) => r.project === 'admin-ui'))
      uiProducts.add(suiteFor('admin-ui').bugzilla.product);
    const products = new Set(this.validationReports.map((r) => suiteFor(r.suite).bugzilla.product));
    // UI tests produce no ValidationReport, so add the UI products explicitly.
    for (const product of uiProducts) products.add(product);
    const benchTag = new RegExp(`\\[${this.config.tagPrefix}-[0-9A-F]{6}\\]`, 'i');
    for (const product of products) {
      const found = await client.openBugs(product);
      if ('error' in found) {
        this.log.warn(`auto-resolve: could not list ${product} bugs — ${found.error}`);
        continue;
      }
      for (const bug of found.bugs) {
        summary.checked += 1;
        const touched = touchedByFiler.has(bug.id);
        if (!benchTag.test(bug.summary)) {
          const decision: ResolveDecision = {
            action: 'keep',
            reason: HAND_FILED,
            validator: 'manual',
            systemic: false,
          };
          await this.applyResolveDecision(client, bug, decision, summary, dryRun, touched);
          continue;
        }
        if (uiProducts.has(product)) {
          const decision = classifyUiResolve(bug, uiIndex, reproduced);
          const proofNote =
            decision.action === 'keep' && /still failed/i.test(decision.reason) && !dryRun
              ? await this.attachDatedProof(client, bug)
              : undefined;
          await this.applyResolveDecision(
            client,
            bug,
            decision,
            summary,
            dryRun,
            touched,
            proofNote,
          );
          continue;
        }
        // A platform-wide ticket is verified against its own endpoints, read from its description.
        let affected: string[] | undefined;
        if (/platform-wide/i.test(bug.summary)) {
          const description = await client.firstComment(bug.id);
          if (description) affected = parseAffectedEndpoints(description);
        }
        const decision = classifyResolve(bug, index, reproduced, affected);
        await this.applyResolveDecision(client, bug, decision, summary, dryRun, touched);
      }
    }
    return summary;
  }

  /** Shared outcome handling for both the API and UI resolve paths — one decision, one bug. */
  private async applyResolveDecision(
    client: BugzillaClient,
    bug: BugSummary,
    decision: ResolveDecision,
    summary: ResolveSummary,
    dryRun: boolean,
    touchedByFiler: boolean,
    proofNote?: string,
  ): Promise<void> {
    if (decision.action !== 'resolve') {
      summary.keptOpen += 1;
      // Split kept-open bugs into confirmed still failing vs not verified this run.
      if (/still fail|fails somewhere|reproduced/i.test(decision.reason)) {
        summary.confirmedFailing += 1;
      } else {
        summary.notVerified += 1;
      }
      // Every open bug gets a dated note each run, unless the filing pass already commented on it.
      if (touchedByFiler) {
        summary.touched += 1;
        return;
      }
      if (dryRun) {
        summary.touched += 1; // preview — would have been touched
        return;
      }
      const res = await client.addComment(bug.id, plainStatusComment(bug, decision, proofNote));
      if ('error' in res) {
        this.log.warn(`auto-resolve: bug ${bug.id} status comment failed — ${res.error}`);
      } else {
        summary.touched += 1;
      }
      return;
    }
    if (dryRun) {
      // Preview only — record what WOULD be closed, write nothing to Bugzilla.
      summary.resolved.push({ bugId: bug.id, reason: decision.reason, summary: bug.summary });
      return;
    }
    const res = await client.resolveFixed(bug.id, plainStatusComment(bug, decision));
    if ('error' in res) {
      summary.failed += 1;
      this.log.warn(`auto-resolve: bug ${bug.id} not updated — ${res.error}`);
    } else {
      summary.resolved.push({ bugId: bug.id, reason: decision.reason, summary: bug.summary });
    }
  }

  /**
   * Attaches this run's failure screenshot and diagnosis to a UI bug that failed again, named by
   * date and browser so a same-day re-run does not upload twice. Returns a note for the comment.
   */
  private async attachDatedProof(
    client: BugzillaClient,
    bug: BugSummary,
  ): Promise<string | undefined> {
    const title = bug.summary.replace(/^\[[^\]]+]\s*/, '').trim();
    const day = new Date().toISOString().slice(0, 10);
    const existing = await client.attachmentNames(bug.id);
    const attached: string[] = [];
    const upload = async (fileName: string, file: ProofFile, summary: string): Promise<void> => {
      if (existing.has(fileName)) {
        attached.push(fileName);
        return;
      }
      let data: Buffer;
      try {
        data = readFileSync(file.path);
      } catch {
        return;
      }
      if (
        await client.attachFile(bug.id, { fileName, summary, data, contentType: file.contentType })
      ) {
        attached.push(fileName);
      }
    };
    for (const [key, proof] of this.uiProof) {
      const split = key.indexOf('::');
      const project = key.slice(0, split);
      if (!uiTitleMatches(title, key.slice(split + 2))) continue;
      const shot = proof.find((p) => p.contentType.startsWith('image/'));
      if (shot) {
        await upload(
          `proof-${day}-${project}-bug${bug.id}${path.extname(shot.path) || '.png'}`,
          shot,
          `Proof ${day} (${project}): the screen test failed again in this run — screenshot of the failure`,
        );
      }
      // JS stack, steps, console errors and failed requests.
      const diagnosis = proof.find((p) => p.label.startsWith('Failure diagnosis'));
      if (diagnosis) {
        await upload(
          `diagnosis-${day}-${project}-bug${bug.id}.txt`,
          diagnosis,
          `Failure diagnosis ${day} (${project}): error stack, the steps before the failure, console errors and failed requests`,
        );
      }
    }
    return attached.length
      ? `Proof: this run's failure evidence is attached to this bug (${attached.join(', ')}).`
      : undefined;
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
      // Only consistently failing UI tests; a flaky pass-on-retry is not solid evidence.
      if (!BROWSER_PROJECTS.has(project) && project !== 'admin-ui') return [];
      if (test.outcome() !== 'unexpected') return [];
      // Only the observational specs file; a feature/write-flow selector failure is not a defect.
      if (!UI_FILING_SPECS.has(path.basename(test.location.file))) return [];
      const failure = [...test.results].reverse().find((attempt) => attempt.error?.message);
      const message = stripAnsi(failure?.error?.message ?? '');
      if (!message) return [];
      const signals = readFailureSignals(failure?.attachments);
      return [
        candidateFromUiFailure(
          {
            file: path.relative(process.cwd(), test.location.file).replace(/\\/g, '/'),
            title: test.title,
            message: firstLine(message),
            fullMessage: message,
            browser: project,
            environment: env.TEST_ENV,
            // The host the failing screen actually lives on, so the ticket names the right SPA.
            baseURL:
              project === 'admin-ui' ? (env.ADMIN_UI_BASE_URL ?? env.BASE_URL) : env.BASE_URL,
            build: env.BUILD_ID,
            testRunId: env.TEST_RUN_ID,
            observedAt: new Date().toISOString(),
            proof: proofFrom(failure?.attachments, project),
            endedOnAuthScreen: signals.endedOnAuthScreen,
            failedApiCalls: signals.failedApiCalls,
          },
          this.config,
        ),
      ];
    });
  }

  /**
   * WCAG findings from the axe specs, one ticket per rule. Reads every screen's evidence JSON
   * regardless of test outcome; the severity bar is applied in
   * `accessibilityCandidatesFromScreens`.
   */
  private accessibilityCandidates(tests: readonly TestCase[]): BugCandidate[] {
    if (!this.config.fileAccessibilityFailures) return [];
    const screens: AccessibilityScreenInput[] = [];
    for (const test of tests) {
      // The signed-out Signup/Login scan uses the same evidence shape.
      if (
        !['accessibility-axe.spec.ts', 'signup-login-accessibility.spec.ts'].includes(
          path.basename(test.location.file),
        )
      )
        continue;
      for (const result of test.results) {
        const attachment = result.attachments.find((a) => a.name === AXE_JSON_ATTACHMENT);
        if (!attachment?.path) continue;
        try {
          const parsed = JSON.parse(
            readFileSync(attachment.path, 'utf8'),
          ) as AccessibilityScreenInput;
          if (parsed.violations?.length) {
            // The test paints the violations onto the page, so screenshot and video both show them.
            parsed.proof = proofFrom(result.attachments, parsed.screen);
            screens.push(parsed);
          }
        } catch {
          // A malformed evidence file is a bench problem, not a defect; skip it.
        }
      }
    }
    return accessibilityCandidatesFromScreens(screens, this.config);
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

/** Decision reason for a bug with no bench tag — a manual/security finding, never auto-closed. */
const HAND_FILED = 'hand-filed';

/**
 * The dated plain-English status note (or close note) for an open bug, written for a developer who
 * reads only the latest comment: which bug, the date, the result, why, and a bottom line.
 */
export function plainStatusComment(
  bug: BugSummary,
  decision: ResolveDecision,
  proofNote?: string,
): string {
  const when = `${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  const what = bug.summary.replace(/^\[[^\]]+]\s*/, '').trim();
  const head =
    `Re-checked by the automated test bench on ${when} (${env.TEST_ENV}, run ${env.TEST_RUN_ID}).\n` +
    `Bug: ${what}\n\n`;
  const r = decision.reason;

  if (decision.action === 'resolve') {
    return (
      `${head}Result: FIXED. The automated check for this exact problem ran again and passed, so this ` +
      `bug has been marked RESOLVED/FIXED.\n` +
      `Bottom line: no action needed. If the problem comes back, the next run reopens this ticket automatically.`
    );
  }
  if (r === HAND_FILED) {
    return (
      `${head}Result: NOT AUTOMATICALLY RE-CHECKED. This bug was raised from a manual or security ` +
      `investigation, not by a single automated check, so the bench cannot confirm on its own whether ` +
      `it is fixed.\n` +
      `Bottom line: still open. To close it, re-run the steps in the bug description by hand and confirm the result.`
    );
  }
  if (/still fail|fails somewhere|reproduced/i.test(r)) {
    return (
      `${head}Result: STILL BROKEN. The automated check for this exact problem ran again on this date ` +
      `and did not pass, so the bug stays open.\n` +
      (decision.evidence
        ? `What failed on this date: ${maskString(decision.evidence).slice(0, 700)}\n`
        : '') +
      (proofNote ? `${proofNote}\n` : '') +
      `Bottom line: still open — not fixed yet. Use the reproduction steps / curl in the description to confirm before marking it fixed.`
    );
  }
  if (/failed for a different reason/i.test(r)) {
    const browser = r.match(/this pass on ([\w, ]+?) —/)?.[1] ?? 'this browser';
    return (
      `${head}Result: NOT CONFIRMED THIS RUN. The screen test for this bug ran on ${browser}, but it failed for a ` +
      `different reason — this bug's own problem did not appear in the failure. It is not marked fixed, ` +
      `because the test did not pass cleanly.\n` +
      `Bottom line: status unchanged (still open). It closes automatically once its test passes cleanly; the ` +
      `other failure is tracked on its own ticket.`
    );
  }
  if (/environmental/i.test(r) && decision.validator === 'response.time') {
    return (
      `${head}Result: NOT AUTO-CLOSED. This is a speed / response-time finding, which naturally varies ` +
      `between runs, so the bench never closes it automatically.\n` +
      `Bottom line: still open — a person needs to judge whether it is acceptable now.`
    );
  }
  if (/\/kword\/|\/kos\/|\bKDoc\b/i.test(`${decision.endpoint ?? ''} ${bug.summary}`)) {
    return (
      `${head}Result: NOT RE-CHECKED. The KDoc module is paused from testing by the project owner until ` +
      `its development is finished, so this bug was not re-tested.\n` +
      `Bottom line: status unchanged (still open). It will be re-checked once KDoc testing resumes.`
    );
  }
  let why = r;
  // Order matters: the UI reason also contains "did not run on", so match it before the API one.
  if (/originating test did not run/i.test(r)) {
    const browser = r.match(/did not run on (\w+)/i)?.[1];
    why = browser
      ? `This bug was found on ${browser}, and this run did not test ${browser} (or its screen test did not run there).`
      : 'The screen test that originally found this bug did not run in this pass.';
  } else if (/endpoint not tested this run|none of the ticket|not exercised/i.test(r)) {
    why = 'The endpoint this bug is about was not exercised in this run.';
  } else if (/did not run on/i.test(r)) {
    why =
      'The specific check for this bug was skipped on its endpoint this time (for example it needs a ' +
      'write, OTP or test-data step that was switched off, or the server did not answer in time).';
  } else if (
    /could not parse endpoint|could not match a single originating test|environmental/i.test(r)
  ) {
    why =
      'The bench could not match this bug to one automated check, so it could not re-check it on its own.';
  }
  return (
    `${head}Result: NOT RE-CHECKED IN THIS RUN. ${why}\n` +
    `Bottom line: status unchanged (still open). It will be re-checked automatically the next time this check runs.`
  );
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

/** Bytes on disk, or -1 if the file cannot be statted (never wins a largest-file comparison). */
function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

/** The largest same-named attachment (a secondary context can add a near-empty stub video). */
function largestByName(
  attachments: readonly { name: string; path?: string; contentType: string }[],
  name: string,
): { name: string; path?: string; contentType: string } | undefined {
  const matches = attachments.filter((a) => a.name === name && a.path);
  if (!matches.length) return undefined;
  return matches.reduce((best, a) => (fileSize(a.path!) > fileSize(best.path!) ? a : best));
}

/** Reads the structured failure signals the UI harness attached, tolerant of any read/parse failure. */
export function readFailureSignals(
  attachments: readonly { name: string; path?: string; contentType: string }[] | undefined,
): FailureSignals {
  const empty: FailureSignals = { endedOnAuthScreen: false, failedApiCalls: [] };
  const file = (attachments ?? []).find((a) => a.name === FAILURE_SIGNALS_ATTACHMENT);
  if (!file?.path) return empty;
  try {
    const parsed = JSON.parse(readFileSync(file.path, 'utf8')) as Partial<FailureSignals>;
    return {
      endedOnAuthScreen: parsed.endedOnAuthScreen === true,
      failedApiCalls: Array.isArray(parsed.failedApiCalls) ? parsed.failedApiCalls : [],
    };
  } catch {
    return empty;
  }
}

/**
 * The screenshot, video and diagnostics Playwright captured for a failed UI test, as ticket proof.
 */
export function proofFrom(
  attachments: readonly { name: string; path?: string; contentType: string }[] | undefined,
  browser: string,
  // Static defects pass includeVideo: false; their video shows nothing the screenshot does not.
  { includeVideo = true }: { includeVideo?: boolean } = {},
): ProofFile[] {
  const proof: ProofFile[] = [];
  const list = attachments ?? [];

  const screenshot = largestByName(list, 'screenshot');
  if (screenshot?.path) {
    proof.push({
      path: screenshot.path,
      contentType: screenshot.contentType,
      label: `Screenshot (${browser})`,
    });
  }
  if (includeVideo) {
    const video = largestByName(list, 'video');
    if (video?.path) {
      proof.push({ path: video.path, contentType: video.contentType, label: `Video (${browser})` });
    }
  }

  for (const a of list) {
    if (!a.path) continue;
    if (a.name === 'screenshot' || a.name === 'video') {
      continue;
    } else if (a.name === 'a11y-evidence') {
      // The WCAG violations painted onto the page.
      proof.push({
        path: a.path,
        contentType: a.contentType,
        label: `Annotated WCAG screenshot (${browser})`,
      });
    } else if (a.name === 'crash-evidence') {
      // The JS crash painted onto the page as text, since the raw screenshot looks normal.
      proof.push({
        path: a.path,
        contentType: a.contentType,
        label: `Annotated crash screenshot (${browser})`,
      });
    } else if (a.name === 'crash-diagnosis') {
      // A plain-English explanation of a JS crash (error, stack, the API call behind it).
      proof.push({
        path: a.path,
        contentType: a.contentType,
        label: `Crash diagnosis (${browser})`,
      });
    } else if (a.name === 'trace') {
      // The full Playwright trace; the filer's size cap skips it when too large.
      proof.push({
        path: a.path,
        contentType: a.contentType,
        label: `Playwright trace (${browser})`,
      });
    } else if (a.name === FAILURE_DIAGNOSIS_ATTACHMENT || a.name === AXE_DETAILS_ATTACHMENT) {
      // Dated label, so a fresh copy is attached on each day the failure is re-confirmed.
      const day = new Date().toISOString().slice(0, 10);
      const what =
        a.name === AXE_DETAILS_ATTACHMENT ? 'Accessibility details' : 'Failure diagnosis';
      proof.push({
        path: a.path,
        contentType: a.contentType,
        label: `${what} (${browser}, ${day})`,
      });
    }
  }
  return proof;
}
