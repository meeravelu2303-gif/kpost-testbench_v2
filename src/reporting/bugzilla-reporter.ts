import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import {
  accessibilityCandidatesFromScreens,
  candidateFromUiFailure,
  collapseCountVariants,
  candidatesFromReport,
  consolidateCascades,
  mergeCandidates,
  type AccessibilityScreenInput,
  type BugCandidate,
  type ProofFile,
} from '../bug-tracker/bug-candidate';
import { AXE_DETAILS_ATTACHMENT, AXE_JSON_ATTACHMENT } from '../ui/accessibility-evidence';
import { FAILURE_DIAGNOSIS_ATTACHMENT } from '../ui/failure-diagnostics';
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
 * Only the **observational** UI specs may file bugs: the deep screen sweep (`screens-batch1/2/3.spec.ts`
 * — 9 checks on every screen, calibrated to zero false positives, split into 3 batches 2026-10-07) and
 * the structural smoke
 * (`navigation`/`shell` — a route that will not open or a missing shell is a real defect). The
 * interaction / write-flow specs (the gated `*_UI_LIFECYCLE` feature tests, compose, search, login,
 * two-session, copies, contacts, group, profile-edit, settings-theme, …) are FUNCTIONAL tests whose
 * failures during the build/tuning phase are selector issues, not app defects — filing those would
 * put false bugs on the developer's queue. Their failures still surface in the Playwright report for
 * human triage; they are simply never auto-filed.
 */
const UI_FILING_SPECS = new Set([
  // The deep screen sweep was split into 3 batches on 2026-10-07 (same catalogue, same filing
  // rationale as before) to stop a continuous 13-screen run from tripping a server-side
  // rate-limiter — see `tests/e2e/support/screen-sweep.ts` for why.
  'screens-batch1.spec.ts',
  'screens-batch2.spec.ts',
  'screens-batch3.spec.ts',
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
  // The signed-out (Signup/Login) screen sweep files too, for the same reason as `screens.spec.ts`
  // itself — same catalogue (health/performance/layout), just applied to the two screens that sweep
  // cannot reach (it requires a live session). Confirmed clean across two consecutive live runs
  // (2026-09-29) before being added here.
  'signup-login-screens.spec.ts',
  // The Admin/HR-Setup SPA (`admin-ui` project → Bugzilla "KPost Admin UI"): its screen/sub-tab
  // health sweeps, the dead-screen crash pins and the login-screen injection probes report only
  // crashes, JS errors, broken assets or an executed payload — selector-independent defects. The
  // PII-masking spec stays review-only: a masking verdict needs a person to confirm the cell read.
  'admin-screens.spec.ts',
  'admin-subtabs-health.spec.ts',
  'admin-dead-screens.spec.ts',
  'admin-login.spec.ts',
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
    // Candidates and the validity gate need no Bugzilla connection, so they are computed on every
    // run — the in-bench bug report is written even when filing is off (dry run, no host).
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
        // File in module order so created bug ids are ascending (KPost → KMail → UI).
        outcome = await filer.file(orderedForFiling(gate.filed));
      } else {
        notFiledReason = `no valid defects (${gate.rejected.length} rejected by the validity gate)`;
      }
      // Auto-close bugs this run VERIFIED as fixed — independent of whether anything was filed, so a
      // clean run (nothing to file) still closes what the developers already fixed. On a DRY run it
      // only REPORTS what it would close (a reviewable preview); it writes to Bugzilla only for real.
      if (this.config.autoResolve) {
        // Bugs the filing pass already wrote a dated comment to moments ago (reproduced, reopened,
        // adopted) — the status pass must not post a second note on them in the same run.
        const touchedByFiler = new Set(
          (outcome?.entries ?? [])
            .filter(
              (e) =>
                e.bugId && ['commented', 'reopened', 'adopted', 'created'].includes(e.decision),
            )
            .map((e) => e.bugId as number),
        );
        // A candidate the gate rejected as a timeout / bench fault / throttle is not a reproduction:
        // it must not mark a bug "confirmed still broken".
        const transient = new Set(
          gate.rejected
            .filter(({ reason }) =>
              /transient|infrastructure or bench fault|throttled/i.test(reason),
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
      // Every failed attempt was the app not answering (throttling, a network blip) — not evidence about
      // the app, either way. The status pass treats such a test as not run, and its "error page"
      // screenshot is never attached as proof. (The run summary below still shows the true outcome.)
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
   * The per-run status pass over EVERY open bug of each product tested this run. Bench-filed bugs
   * (carrying our `[KP-xxxxxx]` tag) are closed when this run VERIFIED the fix (their endpoint+validator
   * ran and passed, and the fault did not reproduce); every bug that stays open gets a dated,
   * plain-English status note. Hand-filed bugs (manual/security findings, other tag formats) are never
   * auto-closed — no single automated check stands for them — but still get the dated note, so no open
   * bug is ever left without an update. A wrong close is self-correcting: a later run reopens it.
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
        // Failed only because the app did not answer: proves nothing (as if not run); a flaky one that then
        // passed counts as the clean pass it was.
        return { ...record, outcome: record.outcome === 'flaky' ? 'expected' : 'skipped' };
      }),
    );
    const reproduced = new Set(candidates.map((c) => c.id.replace(/^\[|\]$/g, '')));
    // Two UI products, one per front end: the browser projects drive the KPost React app, the
    // `admin-ui` project the Admin/HR-Setup SPA. A product's open bugs are re-checked only when its
    // own front end actually ran this pass.
    const uiProducts = new Set<string>();
    if (uiRecords.some((r) => r.project !== 'admin-ui'))
      uiProducts.add(suiteFor('kpost-ui').bugzilla.product);
    if (uiRecords.some((r) => r.project === 'admin-ui'))
      uiProducts.add(suiteFor('admin-ui').bugzilla.product);
    const products = new Set(this.validationReports.map((r) => suiteFor(r.suite).bugzilla.product));
    // UI tests never produce a `ValidationReport` (that's an API-only attachment), so a UI
    // product would otherwise never appear here at all — which is exactly why a UI run's
    // auto-resolve pass always reported "checked 0 bugs" before this. Any UI test having run this
    // pass (regardless of pass/fail) is reason enough to check that product's open bugs.
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
        // A systemic (platform-wide) ticket is verified against ITS OWN endpoints, not globally — so a
        // ticket whose endpoints are fixed closes even if the same class still fails on an unrelated
        // endpoint (which is a different ticket). Read those from the description.
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
      // Split kept-open bugs: did the run confirm the fault still fails on THIS host, or was the
      // check simply not exercised (a write/OTP endpoint, a UI test that didn't run, a hand-filed
      // finding) so it stays unverified on this URL?
      if (/still fail|fails somewhere|reproduced/i.test(decision.reason)) {
        summary.confirmedFailing += 1;
      } else {
        summary.notVerified += 1;
      }
      // Standing owner directive: every open bug is touched every run with today's date. A bug the
      // filing pass already commented on moments ago (reproduced / reopened / adopted) is skipped —
      // two notes on one ticket in one run is noise, not a second signal.
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
   * Attaches THIS run's failure screenshot to a UI bug whose test just failed again — dated proof that
   * it is still broken, not the screenshot from when it was first filed. Named by date + browser so a
   * second run the same day does not upload it twice. Returns a plain-English note for the comment.
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
      // The developers' diagnostics: JS stack, the steps / Tab path, console errors, failed requests and
      // the element that made each one, and (layout) the elements wider than the screen.
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
      // Only consistently failing UI tests: a flaky pass-on-retry is not solid evidence. The three
      // browser projects drive the KPost React app; `admin-ui` drives the Admin/HR-Setup SPA.
      if (!BROWSER_PROJECTS.has(project) && project !== 'admin-ui') return [];
      if (test.outcome() !== 'unexpected') return [];
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
            // The host the failing screen actually lives on, so the ticket names the right SPA.
            baseURL:
              project === 'admin-ui' ? (env.ADMIN_UI_BASE_URL ?? env.BASE_URL) : env.BASE_URL,
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

  /**
   * WCAG (accessibility) findings from `accessibility-axe.spec.ts`, collapsed to one ticket per RULE
   * across every screen it hit. Reads back the structured JSON each screen attached (see
   * `@ui/accessibility-evidence`) regardless of that screen's pass/fail outcome — a screen with only
   * moderate/minor findings still "passes" its soft assertions, but any critical/serious violation the
   * JSON carries is still a candidate; the severity bar is enforced in `accessibilityCandidatesFromScreens`,
   * not by filtering on outcome here.
   */
  private accessibilityCandidates(tests: readonly TestCase[]): BugCandidate[] {
    if (!this.config.fileAccessibilityFailures) return [];
    const screens: AccessibilityScreenInput[] = [];
    for (const test of tests) {
      // `signup-login-accessibility.spec.ts` runs the identical axe-core scan + evidence shape,
      // just on the signed-out Signup/Login screens `accessibility-axe.spec.ts` cannot reach
      // (it requires a live session). Same rule-level consolidation applies across both files.
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
            // The screenshot/video Playwright captured for this failing test. A WCAG violation
            // is a static property (nothing visibly changes), so the test paints the violations onto
            // the page and holds them before finishing — the video now ends on that readable report
            // instead of an unremarkable blank page, and the annotated screenshot ('a11y-evidence')
            // shows the same thing as a still image. Both are meaningful now, so both are kept.
            parsed.proof = proofFrom(result.attachments, parsed.screen);
            screens.push(parsed);
          }
        } catch {
          // A missing/malformed evidence file is a bench problem, not a product defect — skip it
          // rather than let a parse error crash the whole reporting pass.
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
 * The dated status note written to an open bug on every run (and the close note when one is verified
 * fixed). Written for a developer reading the exported sheet's "Last Comment" column, not for QA: it
 * restates which bug this is, gives the date, the result in capitals, why, and an explicit bottom line —
 * never the bench's internal validator jargon on its own.
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
  // Order matters: the UI reason "its originating test did not run on firefox this pass" also contains
  // "did not run on", so it must be matched BEFORE the API one ("validator X did not run on <endpoint>").
  // Checked the other way round (2026-10-09), ~every Firefox/WebKit-only UI bug was told its check was
  // "skipped on its endpoint" — a wrong reason, though the status (still open) was right.
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

/**
 * The screenshot and video Playwright captured for a failed UI test, as proof to attach to the
 * ticket. Playwright records these on failure (`screenshot: 'only-on-failure'`, `video:
 * 'retain-on-failure'`); each attachment carries the file `path` and `contentType`.
 */
/** Bytes on disk, or -1 if the file cannot be statted (never wins a largest-file comparison). */
function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

/** Among several attachments sharing a name, the one whose file is actually the largest — Playwright
 * can emit more than one under the same name (e.g. a brief secondary browser context produces a
 * near-empty stub video alongside the real recording), and "first in the array" is not reliable. */
function largestByName(
  attachments: readonly { name: string; path?: string; contentType: string }[],
  name: string,
): { name: string; path?: string; contentType: string } | undefined {
  const matches = attachments.filter((a) => a.name === name && a.path);
  if (!matches.length) return undefined;
  return matches.reduce((best, a) => (fileSize(a.path!) > fileSize(best.path!) ? a : best));
}

export function proofFrom(
  attachments: readonly { name: string; path?: string; contentType: string }[] | undefined,
  browser: string,
  // A video only earns its storage cost when it shows something a still image cannot — motion, a
  // sequence, an overlay appearing. A static defect (a WCAG rule, a form's resting state) looks
  // IDENTICAL at the first frame and the last: the whole recording is just a blank/unchanging page,
  // which bloats Bugzilla's attachment storage for zero extra evidence. Callers for that kind of
  // finding pass includeVideo: false so only the screenshot — which shows exactly the same thing —
  // gets attached.
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
      // The WCAG violations painted onto the actual page — the only way a static accessibility
      // defect (missing alt text, low contrast, …) becomes visible in a screenshot at all.
      proof.push({
        path: a.path,
        contentType: a.contentType,
        label: `Annotated WCAG screenshot (${browser})`,
      });
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
    } else if (a.name === 'trace') {
      // The full Playwright trace (network, DOM snapshots, console, every action) — lets a developer
      // step through the exact failure in trace viewer rather than guessing from a still frame. Can
      // be large; `attachProof`'s own size cap silently skips it rather than failing the ticket.
      proof.push({
        path: a.path,
        contentType: a.contentType,
        label: `Playwright trace (${browser})`,
      });
    } else if (a.name === FAILURE_DIAGNOSIS_ATTACHMENT || a.name === AXE_DETAILS_ATTACHMENT) {
      // The evidence the UI developers asked for (stack, steps, failed requests + who made them,
      // overflowing elements / failing elements with colours). Dated label → a fresh copy is attached
      // on each day it is re-confirmed, not skipped as "already there" from an older run.
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
