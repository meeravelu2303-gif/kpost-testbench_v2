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
} from '../findings/bug-candidate';
import { AXE_DETAILS_ATTACHMENT, AXE_JSON_ATTACHMENT } from '../../ui/accessibility-evidence';
import { runFiling, saveFilingInput, writeRunReport, type FilingInput } from './filing-run';
import {
  FAILURE_DIAGNOSIS_ATTACHMENT,
  FAILURE_SIGNALS_ATTACHMENT,
  type FailureSignals,
} from '../../ui/failure-diagnostics';
import { assessRunValidity, ENVIRONMENTAL_UI_OR_API_FAILURE } from '../gates/validity-gate';
import { readBugzillaConfig } from '../../config/bugzilla.config';
import { suiteFor, type SuiteId } from '../../config/ownership.config';
import { env } from '../../config/env';
import { createLogger } from '../../utils/logger';
import type { ValidationReport } from '../../validation-engine/validation-result';
import { VALIDATION_REPORT_ATTACHMENT } from '../../reporting/report-attachment';
import {
  buildHappyPath,
  FLOW_CALLS_ANNOTATION,
  flowCreditsFrom,
  happyPathHeadline,
  happyPathMarkdown,
  isHappyPathTitle,
} from '../../reporting/happy-path';
import type { UiTestRecord } from '../../reporting/run-summary';

/**
 * Files this run's defects into Bugzilla: run gate, candidates from run evidence, validity gate,
 * then dedupe and file. Dry run is the default because filing cannot be undone; never fails the
 * run.
 */
const BROWSER_PROJECTS = new Set(['chromium', 'firefox', 'webkit']);
const LOG = '[bugzilla]';
/** The API suite (and so the host) behind each `BENCH_PRODUCT` that runs the engine. */
const HAPPY_PATH_SUITE: Readonly<Record<string, SuiteId>> = {
  'kpost-api': 'kpost-api',
  'kmail-api': 'kmail-api',
  'kpost-admin': 'admin-api',
};

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

export default class BugzillaReporter implements Reporter {
  private readonly config = readBugzillaConfig();
  private readonly log = createLogger('bugzilla');
  private readonly validationReports: ValidationReport[] = [];
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
    // `--list` runs nothing: writing would replace the last run's report and filing plan, and
    // archive real runs out of reports/history/ (ten listings on 2026-10-27 pushed them all out).
    if (process.argv.includes('--list')) return;
    try {
      await this.publish(result);
    } catch (error) {
      console.log(`${LOG} skipped — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async publish(result: FullResult): Promise<void> {
    const tests = this.suite?.allTests() ?? [];
    const uiRecords = this.uiTestRecords(tests);
    const input: FilingInput = {
      version: 1,
      checkedAt: new Date().toISOString(),
      product: process.env.BENCH_PRODUCT ?? 'run',
      environment: env.TEST_ENV,
      testRunId: env.TEST_RUN_ID,
      build: env.BUILD_ID,
      runStatus: result.status,
      dryRun: this.config.dryRun,
      validity: assessRunValidity({
        executed: tests.filter((test) => test.results.length > 0).length,
        collected: tests.length,
        loadErrors: this.loadErrors,
        status: result.status,
      }),
      candidates: consolidateCascades(
        collapseCountVariants(
          mergeCandidates([
            ...this.apiCandidates(),
            ...this.uiCandidates(tests),
            ...this.accessibilityCandidates(tests),
          ]),
        ),
      ),
      validationReports: this.validationReports,
      uiRecords,
      uiEnvironmentalOnly: [...this.uiEnvironmentalOnly],
    };
    // A framework-only run tests no product: it must not replace the last product run's report or plan.
    const productRun = !(
      tests.length > 0 && tests.every((test) => test.parent.project()?.name === 'framework')
    );
    // A preview saves what it found, so `npm run bug:apply` can file it without running the tests again.
    if (productRun && this.config.dryRun) saveFilingInput(input, this.log);
    // Written before filing, so a Bugzilla outage cannot lose the coverage picture.
    if (productRun) this.writeHappyPath(tests, input);
    const filing = await runFiling(input, this.config, this.log);
    writeRunReport(input, filing, this.log, { write: productRun });
  }

  /** `reports/happy-path/<product>.md`: did each endpoint's normal request run and pass? */
  private writeHappyPath(tests: readonly TestCase[], input: FilingInput): void {
    const suite = HAPPY_PATH_SUITE[input.product];
    if (!suite) return;
    // Each call a flow made that got the endpoint's documented answer proves that endpoint's happy
    // path, even when the flow failed later on a bug it records (a reallocate 409, an IDOR): that
    // failure is filed on its own, and the call that worked still worked.
    const credits = tests
      .filter((test) => test.results.length > 0)
      .flatMap((test) => {
        const last = test.results[test.results.length - 1];
        const calls = [...(last?.annotations ?? []), ...test.annotations].find(
          (a) => a.type === FLOW_CALLS_ANNOTATION,
        );
        return flowCreditsFrom(calls?.description, suite);
      });
    const happy = tests
      .filter((test) => isHappyPathTitle(test.title))
      .map((test) => {
        const last = test.results[test.results.length - 1];
        const skip = [...(last?.annotations ?? []), ...test.annotations].find(
          (a) => a.type === 'skip',
        );
        return {
          describe: test.parent.title,
          outcome: test.outcome(),
          ran: test.results.length > 0,
          skipReason: skip?.description,
          error: last?.error?.message,
        };
      });
    const summary = buildHappyPath(happy, credits);
    if (!summary.rows.length) return;
    try {
      const dir = path.join(process.cwd(), 'reports', 'happy-path');
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${input.product}.md`);
      const markdown = happyPathMarkdown(input.product, summary, {
        generatedAt: input.checkedAt,
        baseUrl: suiteFor(suite).baseUrl,
        testRunId: input.testRunId,
      });
      writeFileSync(file, markdown, 'utf8');
      console.log(`${LOG} ${happyPathHeadline(summary)} → ${path.relative(process.cwd(), file)}`);
    } catch (error) {
      console.log(
        `${LOG} happy-path report not written — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
