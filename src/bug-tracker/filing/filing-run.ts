import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult } from '@playwright/test/reporter';
import { holdAggregatesForReview, type BugCandidate } from '../findings/bug-candidate';
import { BugzillaClient, type BugSummary } from '../bugzilla/bugzilla-client';
import { BugzillaFiler, type FilingOutcome } from '../bugzilla/bugzilla-filer';
import { applyValidityGate, type GateOutcome, type RunValidity } from '../gates/validity-gate';
import {
  buildRunIndex,
  buildUiRunIndex,
  classifyResolve,
  classifyUiResolve,
  parseAffectedEndpoints,
  type ResolveDecision,
} from '../status/verify-resolve';
import { WAITING_ON_A_PERSON, type BugzillaConfig } from '../../config/bugzilla.config';
import { env } from '../../config/env';
import { suiteFor } from '../../config/ownership.config';
import type { Logger } from '../../utils/logger';
import { maskSecretsOnly, maskString } from '../../utils/masking';
import type { ValidationReport } from '../../validation-engine/validation-result';
import {
  buildBugReportConsole,
  buildBugReportMarkdown,
  type HandCheck,
  type ResolveSummary,
} from './bug-report';
import { archivePreviousReport } from '../../reporting/report-archive';
import {
  buildRunSummary,
  renderRunSummaryConsole,
  renderRunSummaryMarkdown,
  type UiTestRecord,
} from '../../reporting/run-summary';

/**
 * Everything the filing step needs from a test run. The reporter builds it at the end of a run; a dry
 * run also saves it, so `npm run bug:apply` can file that run's results later without re-running it.
 * Both paths call `runFiling` below, so the gates and decisions are the same code.
 */
export interface FilingInput {
  version: 1;
  /** When the tests ran: the date every status comment states, even if applied later. */
  checkedAt: string;
  product: string;
  environment: string;
  testRunId: string;
  build: string;
  runStatus: FullResult['status'];
  dryRun: boolean;
  validity: RunValidity;
  /** Merged, collapsed and cascade-consolidated, before the validity gate. */
  candidates: BugCandidate[];
  validationReports: ValidationReport[];
  /** Every UI test's outcome, as it ran. */
  uiRecords: UiTestRecord[];
  /** `project::title` of UI tests whose every failure was environmental: not run, for the status pass. */
  uiEnvironmentalOnly: string[];
  /** Set by `bug:apply` once the plan has been filed, so it can never be applied twice. */
  appliedAt?: string;
}

export interface FilingResult {
  gate: GateOutcome;
  outcome?: FilingOutcome;
  notFiledReason?: string;
  resolved?: ResolveSummary;
}

export const FILING_INPUT_FILE = path.join('reports', 'filing-input.json');
/** A plan older than this is refused: Bugzilla, the servers and the proof files will have moved on. */
export const PLAN_MAX_AGE_HOURS = 24;

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

/**
 * The filing step: validity gate, run gate, then (with Bugzilla configured) dedupe-and-file and the
 * status pass over every open bug of the products that ran. `config.dryRun` previews instead of writing.
 */
export async function runFiling(
  input: FilingInput,
  config: BugzillaConfig,
  log: Logger,
): Promise<FilingResult> {
  const gate = applyValidityGate(input.candidates);
  const client = config.enabled ? new BugzillaClient(config, log) : undefined;
  if (!config.enabled || !client)
    return { gate, notFiledReason: 'BUGZILLA_URL / BUGZILLA_API_KEY not configured' };
  if (!input.validity.valid)
    return { gate, notFiledReason: `run gate blocked filing — ${input.validity.reason}` };

  let outcome: FilingOutcome | undefined;
  let notFiledReason: string | undefined;
  if (config.resolveOnly) {
    notFiledReason =
      'resolve-only mode — verified-fixed bugs are being closed; no new tickets filed';
  } else if (gate.filed.length) {
    // File in module order; overlapping aggregate findings are held for review.
    outcome = await new BugzillaFiler(client, config, log).file(
      orderedForFiling(holdAggregatesForReview(gate.filed)),
    );
  } else {
    notFiledReason = `no valid defects (${gate.rejected.length} rejected by the validity gate)`;
  }

  let resolved: ResolveSummary | undefined;
  if (config.autoResolve) {
    // Bugs the filing pass already commented on; the status pass must not post a second note.
    const touchedByFiler = new Set(
      (outcome?.entries ?? [])
        .filter(
          (e) => e.bugId && ['still-open', 'reopened', 'adopted', 'created'].includes(e.decision),
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
    resolved = await statusPass(
      client,
      input,
      input.candidates.filter((c) => !transient.has(c.id)),
      config,
      log,
      touchedByFiler,
    );
  }
  return { gate, outcome, notFiledReason, resolved };
}

/** Decision reason for a bug with no bench tag — a manual/security finding, never auto-closed. */
export const HAND_FILED = 'hand-filed';

/** Reason prefix: the check passed, but the bug waits on a person (WAITING_ON_A_PERSON). */
const WAITING = 'check passes, but the bug is ';

/** The one note an open bug can get, so a later run sees it was already said. */
const PASSES_NOTE = 'THE CHECK NOW PASSES.';

/** KDoc/KOS/KWord is paused by owner order: its open bugs only get a dated "paused" note. */
function isPausedModule(bug: BugSummary, decision: ResolveDecision): boolean {
  return (
    /\/kword\/|\/kos\/|\bKDoc\b/i.test(`${decision.endpoint ?? ''} ${bug.summary}`) ||
    /\b(KWord|KDoc|KOS)\b/i.test(bug.component ?? '')
  );
}

/**
 * Why no run can ever close this kept-open bug, so a person must re-check it; undefined when a
 * later run can (it still fails, or its check just didn't run this time).
 */
export function handCheckReason(decision: ResolveDecision): string | undefined {
  const r = decision.reason;
  if (r === HAND_FILED) return 'filed by hand: no single automated check covers it';
  if (/is environmental — not auto-verified/.test(r)) {
    return decision.validator === 'response.time'
      ? 'a speed bug: one fast run does not prove it fixed'
      : 'its title does not say which check it is';
  }
  if (/could not parse endpoint|could not match a single originating test/.test(r))
    return 'its title does not name one endpoint or test the bench can re-run';
  return undefined;
}

/** When and where a status comment says the check ran. */
export interface CheckedRun {
  at: string;
  environment: string;
  testRunId: string;
}

/**
 * Status pass over every open bug of each product tested: bench-tagged bugs close when the run
 * verified the fix; every other open bug gets a dated note. Hand-filed bugs are never auto-closed.
 */
async function statusPass(
  client: BugzillaClient,
  input: FilingInput,
  candidates: readonly BugCandidate[],
  config: BugzillaConfig,
  log: Logger,
  touchedByFiler: ReadonlySet<number>,
): Promise<ResolveSummary> {
  const dryRun = config.dryRun;
  const byHand: HandCheck[] = [];
  const summary: ResolveSummary = {
    resolved: [],
    keptOpen: 0,
    checked: 0,
    failed: 0,
    confirmedFailing: 0,
    notVerified: 0,
    touched: 0,
    byHand,
    dryRun,
  };
  const run: CheckedRun = {
    at: input.checkedAt,
    environment: input.environment,
    testRunId: input.testRunId,
  };
  const index = buildRunIndex(input.validationReports);
  const environmental = new Set(input.uiEnvironmentalOnly);
  const uiIndex = buildUiRunIndex(
    input.uiRecords.map((record) => {
      if (!environmental.has(`${record.project}::${record.title}`)) return record;
      // Environmental-only failures count as not run; flaky-then-passed counts as a pass.
      return { ...record, outcome: record.outcome === 'flaky' ? 'expected' : 'skipped' };
    }),
  );
  const reproduced = new Set(candidates.map((c) => c.id.replace(/^\[|\]$/g, '')));
  // A UI product's bugs are re-checked only when its own front end ran this pass.
  const uiProducts = new Set<string>();
  if (input.uiRecords.some((r) => r.project !== 'admin-ui'))
    uiProducts.add(suiteFor('kpost-ui').bugzilla.product);
  if (input.uiRecords.some((r) => r.project === 'admin-ui'))
    uiProducts.add(suiteFor('admin-ui').bugzilla.product);
  const products = new Set(input.validationReports.map((r) => suiteFor(r.suite).bugzilla.product));
  for (const product of uiProducts) products.add(product);
  const benchTag = new RegExp(`\\[${config.tagPrefix}-[0-9A-F]{6}\\]`, 'i');

  /** Whether this run verified the bug fixed: its own check ran again and passed cleanly. */
  const classify = async (bug: BugSummary, product: string): Promise<ResolveDecision> => {
    if (!benchTag.test(bug.summary))
      return { action: 'keep', reason: HAND_FILED, validator: 'manual', systemic: false };
    if (uiProducts.has(product)) return classifyUiResolve(bug, uiIndex, reproduced);
    // A platform-wide ticket is verified against its own endpoints, read from its description.
    let affected: string[] | undefined;
    if (/platform-wide/i.test(bug.summary)) {
      const description = await client.currentDescription(bug.id);
      if (description) affected = parseAffectedEndpoints(description);
    }
    return classifyResolve(bug, index, reproduced, affected);
  };

  for (const product of products) {
    const found = await client.openBugs(product);
    if ('error' in found) {
      log.warn(`auto-resolve: could not list ${product} bugs — ${found.error}`);
      continue;
    }
    for (const bug of found.bugs) {
      summary.checked += 1;
      const touched = touchedByFiler.has(bug.id);
      let decision = await classify(bug, product);
      // A person's decision is pending: a passing check is reported, never acted on.
      const waitingOn = WAITING_ON_A_PERSON.get(bug.status ?? '');
      if (decision.action === 'resolve' && waitingOn) {
        decision = { ...decision, action: 'keep', reason: `${WAITING}${bug.status}: ${waitingOn}` };
      }
      // A paused module's bugs wait for testing to resume; they are nobody's re-check yet.
      const why = isPausedModule(bug, decision) ? undefined : handCheckReason(decision);
      if (why) {
        byHand.push({
          bugId: bug.id,
          product,
          component: bug.component ?? '',
          summary: bug.summary,
          why,
        });
      }
      await applyDecision(client, bug, decision, summary, dryRun, touched, log, run);
    }

    // The tracker's "Ready for re-test" queue: the bench is the re-test. A pass closes the bug; a
    // failure was already reopened by the filer; anything else waits for a person, without a note.
    const retest = await client.awaitingRetest(product);
    if ('error' in retest) {
      log.warn(`auto-resolve: could not list ${product} bugs awaiting re-test — ${retest.error}`);
      continue;
    }
    for (const bug of retest.bugs.filter((b) => benchTag.test(b.summary))) {
      summary.retested = (summary.retested ?? 0) + 1;
      const decision = await classify(bug, product);
      if (decision.action === 'resolve')
        await applyDecision(client, bug, decision, summary, dryRun, false, log, run);
    }
  }
  return summary;
}

/**
 * One decision, one bug: close it, or leave it. An open bug that is still broken, or was not
 * re-checked, gets no comment (owner, 2026-10-27); the only note is "the check now passes" on a bug
 * that waits on a person, posted once.
 */
async function applyDecision(
  client: BugzillaClient,
  bug: BugSummary,
  decision: ResolveDecision,
  summary: ResolveSummary,
  dryRun: boolean,
  touchedByFiler: boolean,
  log: Logger,
  run: CheckedRun,
): Promise<void> {
  if (decision.action !== 'resolve') {
    summary.keptOpen += 1;
    if (decision.reason.startsWith(WAITING)) {
      (summary.waitingOnPerson ??= []).push({
        bugId: bug.id,
        status: bug.status ?? '',
        summary: bug.summary,
      });
    } else if (/still fail|fails somewhere|reproduced/i.test(decision.reason))
      summary.confirmedFailing += 1;
    else summary.notVerified += 1;
    if (!decision.reason.startsWith(WAITING) || touchedByFiler) return;
    const said = (await client.commentTexts(bug.id)).some((text) => text.includes(PASSES_NOTE));
    if (said) return;
    if (dryRun) {
      summary.touched += 1;
      return;
    }
    const res = await client.addComment(bug.id, plainStatusComment(bug, decision, undefined, run));
    if ('error' in res)
      log.warn(`auto-resolve: bug ${bug.id} status comment failed — ${res.error}`);
    else summary.touched += 1;
    return;
  }
  const entry = {
    bugId: bug.id,
    reason: decision.reason,
    summary: bug.summary,
    from: bug.status ?? '',
  };
  if (dryRun) {
    summary.resolved.push(entry);
    return;
  }
  const res = await client.closeVerified(bug, plainStatusComment(bug, decision, undefined, run));
  if ('error' in res) {
    summary.failed += 1;
    log.warn(`auto-resolve: bug ${bug.id} not updated — ${res.error}`);
  } else {
    summary.resolved.push(entry);
  }
}

/**
 * The dated plain-English status note (or close note) for an open bug, written for a developer who
 * reads only the latest comment: which bug, when it was checked, the result, why, and a bottom line.
 */
export function plainStatusComment(
  bug: BugSummary,
  decision: ResolveDecision,
  proofNote?: string,
  run?: CheckedRun,
): string {
  const at = run?.at ?? new Date().toISOString();
  const when = `${at.replace('T', ' ').slice(0, 16)} UTC`;
  const what = bug.summary.replace(/^\[[^\]]+]\s*/, '').trim();
  const head =
    `Re-checked by the automated test bench on ${when} (${run?.environment ?? env.TEST_ENV}, run ${run?.testRunId ?? env.TEST_RUN_ID}).\n` +
    `Bug: ${what}\n\n`;
  const r = decision.reason;

  if (decision.action === 'resolve') {
    return (
      `${head}Result: VERIFIED FIXED. The automated check for this exact problem ran again and passed, ` +
      `so the re-test passed and this bug is closed (CLOSED).\n` +
      `Bottom line: no action needed. If the problem comes back, the next run reopens this ticket automatically.`
    );
  }
  if (r.startsWith(WAITING)) {
    const status = (bug.status ?? '').replace(/_/g, ' ');
    const waitingOn = WAITING_ON_A_PERSON.get(bug.status ?? '') ?? 'waiting for a person';
    return (
      `${head}Result: ${PASSES_NOTE} The automated check for this exact problem ran again and ` +
      `passed. The bug is ${status} (${waitingOn}), so the bench leaves its status to that person.\n` +
      `Bottom line: once that decision is made, the next run closes it if the check still passes.`
    );
  }
  if (isPausedModule(bug, decision)) {
    return (
      `${head}Result: NOT RE-CHECKED. The KDoc module is paused from testing by the project owner until ` +
      `its development is finished, so this bug was not re-tested.\n` +
      `Bottom line: status unchanged (still open). It will be re-checked once KDoc testing resumes.`
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

/**
 * Writes the run's single report (REPORT.md: health, then bugs; REPORT.json: the same, structured),
 * archiving the previous one, and prints both summaries. `write: false` only prints.
 */
export function writeRunReport(
  input: FilingInput,
  result: FilingResult,
  log: Logger,
  { write }: { write: boolean },
): void {
  const generatedAt = new Date().toISOString();
  const { gate, outcome, notFiledReason, resolved } = result;
  const reportInput = {
    environment: input.environment,
    runStatus: input.runStatus,
    testRunId: input.testRunId,
    build: input.build,
    generatedAt,
    validationReports: input.validationReports,
    merged: input.candidates,
    rejected: gate.rejected,
    outcome,
    notFiledReason,
    resolved,
  };
  const runSummary = buildRunSummary({
    environment: input.environment,
    build: input.build,
    testRunId: input.testRunId,
    runStatus: input.runStatus,
    generatedAt,
    profiles: [...new Set(input.validationReports.map((r) => r.profile))],
    validationReports: input.validationReports,
    uiTests: input.uiRecords,
  });
  const combined = {
    // The product this report belongs to, so the archive names it correctly when the next run replaces it.
    product: input.product,
    meta: runSummary.meta,
    api: runSummary.api,
    ui: runSummary.ui,
    // The CI quality gate reads this: a run is green only when every endpoint passed its gate.
    qualityGate: {
      passed: input.validationReports.every((r) => r.gate.passed),
      blockingEndpoints: input.validationReports
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
  if (write) {
    const dir = path.join(process.cwd(), 'reports');
    try {
      mkdirSync(dir, { recursive: true });
      archivePreviousReport(dir);
      writeFileSync(path.join(dir, 'REPORT.json'), JSON.stringify(combined, null, 2));
      writeFileSync(
        path.join(dir, 'REPORT.md'),
        `${renderRunSummaryMarkdown(runSummary)}\n${buildBugReportMarkdown(reportInput)}`,
      );
    } catch (error) {
      log.warn(`could not write reports/REPORT.*: ${(error as Error).message}`);
    }
  }
  // Execution health first, so the bug count is read against the coverage that produced it.
  console.log(`\n${renderRunSummaryConsole(runSummary)}`);
  console.log(`\n${buildBugReportConsole(reportInput)}`);
}

/** Saves a dry run's filing input (credentials masked) for `npm run bug:apply`. */
export function saveFilingInput(input: FilingInput, log: Logger, file = FILING_INPUT_FILE): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(maskSecretsOnly(input), null, 2));
  } catch (error) {
    log.warn(`could not save ${file}: ${(error as Error).message}`);
  }
}

/**
 * Loads the plan `bug:apply` may file, or says why not. Strict on purpose: only an unapplied dry run
 * that passed the run gate, less than a day old.
 */
export function loadFilingPlan({
  file = FILING_INPUT_FILE,
  now = new Date(),
}: { file?: string; now?: Date } = {}): { input: FilingInput } | { refused: string } {
  if (!existsSync(file))
    return { refused: `no ${file}: run a product preview first (e.g. npm run product:kpost-api)` };
  let input: FilingInput;
  try {
    input = JSON.parse(readFileSync(file, 'utf8')) as FilingInput;
  } catch (error) {
    return { refused: `${file} is unreadable: ${(error as Error).message}` };
  }
  if (input.version !== 1) return { refused: `${file} is from another bench version` };
  if (input.appliedAt)
    return {
      refused: `this plan (${input.product}, run ${input.testRunId}) was already applied at ${input.appliedAt}`,
    };
  if (!input.dryRun)
    return { refused: 'that run was not a preview: it already filed its own bugs' };
  // A one-off `playwright test <file>` saves a plan too; applying it would mark every bug the
  // product preview checked as "not re-checked".
  if (!input.product || input.product === 'run')
    return {
      refused:
        'that plan is from a one-off run, not a product command: run the preview again (e.g. npm run product:kpost-api)',
    };
  if (!input.validity.valid)
    return {
      refused: `that run failed the run gate, so nothing from it may be filed: ${input.validity.reason}`,
    };
  const ageHours = (now.getTime() - Date.parse(input.checkedAt)) / 3_600_000;
  if (!(ageHours >= 0 && ageHours <= PLAN_MAX_AGE_HOURS))
    return {
      refused: `the plan is ${Math.round(ageHours)} h old (limit ${PLAN_MAX_AGE_HOURS} h): run the preview again`,
    };
  return { input };
}

/** Marks the saved plan applied, so a second `bug:apply` refuses it. */
export function markFilingPlanApplied(
  input: FilingInput,
  { file = FILING_INPUT_FILE, at = new Date() }: { file?: string; at?: Date } = {},
): void {
  writeFileSync(file, JSON.stringify({ ...input, appliedAt: at.toISOString() }, null, 2));
}
