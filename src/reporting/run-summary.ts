import type { ValidationReport, ValidationStatus } from '../validation-engine/validation-result';

/**
 * The EXECUTION-HEALTH section of the single run report — `reports/REPORT.md` (+ `REPORT.json`),
 * written on every run by the reporter.
 *
 * It answers, in one screen: how many endpoints were tested and how many checks passed / failed /
 * skipped / warned, broken down by module and by category, with the top failing validators (so the
 * systemic noise collapses to its real size) and the worst endpoints; and the SAME for the UI —
 * per browser project and per spec, with the real failures.
 *
 * This is EXECUTION HEALTH; the bug report (distinct defects found and filed) is the section that
 * follows it in the same file. API numbers are check-level (from the validation-report attachments);
 * UI numbers are test-level (from Playwright outcomes) — each labelled so the two are never conflated.
 */

/** One UI/browser test outcome, as seen by the Playwright reporter. */
export interface UiTestRecord {
  project: string;
  spec: string;
  title: string;
  /** Playwright's verdict: 'expected' | 'unexpected' | 'flaky' | 'skipped'. */
  outcome: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  message?: string;
}

export interface RunSummaryInput {
  environment: string;
  build: string;
  testRunId: string;
  runStatus: string;
  generatedAt: string;
  profiles: string[];
  validationReports: readonly ValidationReport[];
  uiTests: readonly UiTestRecord[];
}

interface Counts {
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
}

interface SuiteRow extends Counts {
  suite: string;
  endpoints: number;
  gateFailedEndpoints: number;
}

interface CategoryRow extends Counts {
  category: string;
}

interface ValidatorRow {
  validator: string;
  category: string;
  failed: number;
}

interface EndpointRow extends Counts {
  endpoint: string;
  suite: string;
  gatePassed: boolean;
}

interface UiProjectRow {
  project: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

interface UiSpecRow {
  spec: string;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

export interface RunSummary {
  meta: {
    generatedAt: string;
    environment: string;
    build: string;
    testRunId: string;
    runStatus: string;
    profiles: string[];
  };
  api: {
    endpoints: number;
    checks: Counts & { total: number };
    gateFailedEndpoints: number;
    bySuite: SuiteRow[];
    byCategory: CategoryRow[];
    topFailingValidators: ValidatorRow[];
    endpointsWithFailures: EndpointRow[];
    /**
     * The honest breakdown of WHY checks skipped, so the raw skip count is not read as a coverage
     * hole. Most skips are a validator correctly declining an endpoint it cannot apply to (a body
     * fuzzer on a GET, an authz check on a public route) — that is full coverage of what applies,
     * not a gap. See `classifySkip`.
     */
    skips: {
      notApplicable: number;
      recoverable: number;
      blockedByDefect: number;
      environmental: number;
      deliberate: number;
    };
    /**
     * Coverage measured over the checks that actually APPLIED and ran (passed + failed), ignoring the
     * inapplicable matrix cells. This is the number that means something — a GET fully checked by the
     * validators that apply to a GET is 100% here, even though the body-fuzzers "skipped" it.
     */
    applicable: { ran: number; passed: number; passRate: number };
  };
  ui: {
    ran: boolean;
    tests: { total: number; passed: number; failed: number; skipped: number; flaky: number };
    byProject: UiProjectRow[];
    bySpec: UiSpecRow[];
    failures: Array<{ project: string; spec: string; title: string; message: string }>;
  };
}

const zero = (): Counts => ({ passed: 0, failed: 0, warnings: 0, skipped: 0 });

function add(target: Counts, status: ValidationStatus): void {
  if (status === 'PASSED') target.passed += 1;
  else if (status === 'FAILED') target.failed += 1;
  else if (status === 'WARNING') target.warnings += 1;
  else if (status === 'SKIPPED') target.skipped += 1;
}

/** How many UI failures to list in full before summarising the remainder. */
const MAX_UI_FAILURES = 40;
/** How many endpoints (worst first) to list in the API failures table. */
const MAX_ENDPOINT_ROWS = 40;
/** How many validators to show in the "top failing validators" table. */
const MAX_VALIDATOR_ROWS = 20;

/**
 * Why a check skipped, in the terms that matter for coverage.
 *
 *  - **not-applicable** the validator cannot apply to this endpoint/response by design — a body
 *    fuzzer on a GET with no body, an authz check on a public route, an email-format check on a
 *    response with no email field. This is NOT a gap: it is full coverage of what applies.
 *  - **recoverable** a contract or config gap the team can close — a missing response schema, an
 *    undocumented error envelope, an unconfigured cross-tenant scenario. Filling it makes the check
 *    run.
 *  - **blocked-by-defect** a dependent check that could not run because the primary request already
 *    failed (a 401/500/400, or a failed prerequisite). It recovers automatically when the root
 *    defect is fixed — it is not a separate gap.
 *  - **environmental** a timeout or no-response — transient, not a coverage decision.
 *  - **deliberate** switched off for this endpoint on purpose (`skipValidators`).
 *
 * The point of splitting these is that a single "skipped" total is misleading: the overwhelming
 * majority is not-applicable-by-design, and only `recoverable` is a coverage hole anyone can act on.
 */
export type SkipClass =
  'not-applicable' | 'recoverable' | 'blocked-by-defect' | 'environmental' | 'deliberate';

export function classifySkip(reason: string): SkipClass {
  const r = reason.toLowerCase();
  if (/skipvalidators|disabled for this endpoint/.test(r)) return 'deliberate';
  if (
    /prerequisite .* did not pass|the primary request answered \d|answered 404: the route is unknown/.test(
      r,
    )
  ) {
    return 'blocked-by-defect';
  }
  if (/no http response|no response within|timeout|response has no content \(http 0\)/.test(r)) {
    return 'environmental';
  }
  if (
    /defines no (response|request) schema|documents no error envelope|no expired token available|no privilege-escalation scenario configured|not tenant-scoped|no principals of a second tenant|does not declare concurrency\.singlewritewins/.test(
      r,
    )
  ) {
    return 'recoverable';
  }
  // Everything else that skipped is a validator declining an endpoint it cannot apply to.
  return 'not-applicable';
}

export function buildRunSummary(input: RunSummaryInput): RunSummary {
  const reports = input.validationReports;
  const results = reports.flatMap((r) => r.results);

  const checks = { ...zero(), total: results.length };
  for (const r of results) add(checks, r.status);

  // Classify every SKIPPED check by its reason, so the skip total is legible instead of alarming.
  const skips = {
    notApplicable: 0,
    recoverable: 0,
    blockedByDefect: 0,
    environmental: 0,
    deliberate: 0,
  };
  for (const r of results) {
    if (r.status !== 'SKIPPED') continue;
    switch (classifySkip(r.message ?? '')) {
      case 'recoverable':
        skips.recoverable += 1;
        break;
      case 'blocked-by-defect':
        skips.blockedByDefect += 1;
        break;
      case 'environmental':
        skips.environmental += 1;
        break;
      case 'deliberate':
        skips.deliberate += 1;
        break;
      default:
        skips.notApplicable += 1;
    }
  }
  const ran = checks.passed + checks.failed;
  const applicable = {
    ran,
    passed: checks.passed,
    passRate: ran > 0 ? Math.round((checks.passed / ran) * 1000) / 10 : 0,
  };

  // Aggregate by DISTINCT endpoint — an endpoint can produce several reports in one run (multiple
  // test blocks, or a retry), and counting each report as an endpoint would inflate the totals and
  // list the same endpoint many times. One row per `suite + endpoint`, summing its checks.
  const endpointAgg = new Map<string, EndpointRow>();
  for (const report of reports) {
    const key = `${report.suite}  ${report.endpoint}`;
    let row = endpointAgg.get(key);
    if (!row) {
      row = { endpoint: report.endpoint, suite: report.suite, gatePassed: true, ...zero() };
      endpointAgg.set(key, row);
    }
    for (const r of report.results) add(row, r.status);
    if (!report.gate.passed) row.gatePassed = false;
  }

  // By module (suite) — endpoints counted once (distinct), checks summed.
  const suiteMap = new Map<string, SuiteRow>();
  for (const ep of endpointAgg.values()) {
    let row = suiteMap.get(ep.suite);
    if (!row) {
      row = { suite: ep.suite, endpoints: 0, gateFailedEndpoints: 0, ...zero() };
      suiteMap.set(ep.suite, row);
    }
    row.endpoints += 1;
    if (!ep.gatePassed) row.gateFailedEndpoints += 1;
    row.passed += ep.passed;
    row.failed += ep.failed;
    row.warnings += ep.warnings;
    row.skipped += ep.skipped;
  }

  // By validator category.
  const categoryMap = new Map<string, CategoryRow>();
  for (const r of results) {
    let row = categoryMap.get(r.category);
    if (!row) {
      row = { category: r.category, ...zero() };
      categoryMap.set(r.category, row);
    }
    add(row, r.status);
  }

  // Top failing validators — the real signal, since one systemic fault repeats across endpoints.
  const validatorFail = new Map<string, ValidatorRow>();
  for (const r of results) {
    if (r.status !== 'FAILED') continue;
    let row = validatorFail.get(r.validatorName);
    if (!row) {
      row = { validator: r.validatorName, category: r.category, failed: 0 };
      validatorFail.set(r.validatorName, row);
    }
    row.failed += 1;
  }

  // Worst endpoints, by failed-check count (distinct endpoints).
  const endpointsWithFailures: EndpointRow[] = [...endpointAgg.values()]
    .filter((e) => e.failed > 0)
    .sort((a, b) => b.failed - a.failed);

  // ---- UI (test-level, from Playwright outcomes) ----
  const projectMap = new Map<string, UiProjectRow>();
  const specMap = new Map<string, UiSpecRow>();
  const uiFailures: RunSummary['ui']['failures'] = [];
  const uiTally = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };

  for (const t of input.uiTests) {
    uiTally.total += 1;
    let proj = projectMap.get(t.project);
    if (!proj) {
      proj = { project: t.project, total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
      projectMap.set(t.project, proj);
    }
    let spec = specMap.get(t.spec);
    if (!spec) {
      spec = { spec: t.spec, passed: 0, failed: 0, skipped: 0, flaky: 0 };
      specMap.set(t.spec, spec);
    }
    proj.total += 1;
    const bucket =
      t.outcome === 'expected'
        ? 'passed'
        : t.outcome === 'unexpected'
          ? 'failed'
          : t.outcome === 'flaky'
            ? 'flaky'
            : 'skipped';
    proj[bucket] += 1;
    spec[bucket] += 1;
    uiTally[bucket] += 1;
    if (t.outcome === 'unexpected') {
      uiFailures.push({
        project: t.project,
        spec: t.spec,
        title: t.title,
        message: (t.message ?? '').split('\n')[0]?.slice(0, 200) ?? '',
      });
    }
  }

  return {
    meta: {
      generatedAt: input.generatedAt,
      environment: input.environment,
      build: input.build,
      testRunId: input.testRunId,
      runStatus: input.runStatus,
      profiles: input.profiles,
    },
    api: {
      endpoints: endpointAgg.size,
      checks,
      gateFailedEndpoints: [...endpointAgg.values()].filter((e) => !e.gatePassed).length,
      bySuite: [...suiteMap.values()].sort((a, b) => b.failed - a.failed),
      byCategory: [...categoryMap.values()].sort((a, b) => b.failed - a.failed),
      topFailingValidators: [...validatorFail.values()]
        .sort((a, b) => b.failed - a.failed)
        .slice(0, MAX_VALIDATOR_ROWS),
      endpointsWithFailures,
      skips,
      applicable,
    },
    ui: {
      ran: input.uiTests.length > 0,
      tests: uiTally,
      byProject: [...projectMap.values()].sort((a, b) => a.project.localeCompare(b.project)),
      bySpec: [...specMap.values()].sort(
        (a, b) => b.failed - a.failed || a.spec.localeCompare(b.spec),
      ),
      failures: uiFailures,
    },
  };
}

const pct = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;

export function renderRunSummaryMarkdown(s: RunSummary): string {
  const c = s.api.checks;
  const L: string[] = [
    '# Run summary — kpost-testbench_v2',
    '',
    '**GENERATED — do not edit.** Written on every run. Part 1 is execution health; the bug report',
    '(distinct defects found and filed) follows below in the same file.',
    '',
    `Environment **${s.meta.environment}** · run \`${s.meta.testRunId}\` · build **${s.meta.build}** · ` +
      `status **${s.meta.runStatus}** · ${s.meta.generatedAt}`,
    '',
    '## 1. Headline',
    '',
    '| Surface | Unit | Total | Passed | Failed | Warn | Skipped |',
    '| ------- | ---- | ----: | -----: | -----: | ---: | ------: |',
    `| **API** | checks on ${s.api.endpoints} endpoints | ${c.total} | ${c.passed} | ${c.failed} | ${c.warnings} | ${c.skipped} |`,
  ];
  if (s.ui.ran) {
    const u = s.ui.tests;
    L.push(
      `| **UI** | browser tests | ${u.total} | ${u.passed} | ${u.failed} | ${u.flaky} flaky | ${u.skipped} |`,
    );
  } else {
    L.push('| **UI** | browser tests | — | — | — | — | not run this pass |');
  }
  L.push(
    '',
    `API pass rate (of checks that ran): **${pct(c.passed, c.passed + c.failed)}** · ` +
      `${s.api.gateFailedEndpoints} endpoint(s) failed the quality gate.`,
    '',
  );

  // 2. API by module
  L.push(
    '## 2. API — by module',
    '',
    '| Module | Endpoints | Passed | Failed | Warn | Skipped | Gate-failed endpoints |',
    '| ------ | --------: | -----: | -----: | ---: | ------: | --------------------: |',
    ...s.api.bySuite.map(
      (r) =>
        `| ${r.suite} | ${r.endpoints} | ${r.passed} | ${r.failed} | ${r.warnings} | ${r.skipped} | ${r.gateFailedEndpoints} |`,
    ),
    '',
  );

  // 3. API by category
  L.push(
    '## 3. API — by check category',
    '',
    '| Category | Passed | Failed | Warn | Skipped |',
    '| -------- | -----: | -----: | ---: | ------: |',
    ...s.api.byCategory.map(
      (r) => `| ${r.category} | ${r.passed} | ${r.failed} | ${r.warnings} | ${r.skipped} |`,
    ),
    '',
  );

  // 4. Top failing validators
  if (s.api.topFailingValidators.length) {
    L.push(
      '## 4. Top failing checks (validators)',
      '',
      '_One systemic fault repeats across many endpoints, so this collapses the noise to its real shape._',
      '',
      '| Validator | Category | Failed checks |',
      '| --------- | -------- | ------------: |',
      ...s.api.topFailingValidators.map((r) => `| ${r.validator} | ${r.category} | ${r.failed} |`),
      '',
    );
  }

  // 5. Endpoints with the most failures
  if (s.api.endpointsWithFailures.length) {
    const rows = s.api.endpointsWithFailures.slice(0, MAX_ENDPOINT_ROWS);
    L.push(
      '## 5. Endpoints with failures',
      '',
      `${s.api.endpointsWithFailures.length} endpoint(s) have at least one failing check` +
        (rows.length < s.api.endpointsWithFailures.length ? ` (worst ${rows.length} shown)` : '') +
        '.',
      '',
      '| Endpoint | Module | Passed | Failed | Skipped | Gate |',
      '| -------- | ------ | -----: | -----: | ------: | ---- |',
      ...rows.map(
        (r) =>
          `| ${r.endpoint} | ${r.suite} | ${r.passed} | ${r.failed} | ${r.skipped} | ${r.gatePassed ? '✅' : '❌'} |`,
      ),
      '',
    );
  }

  // 6. UI
  L.push('## 6. UI tests', '');
  if (!s.ui.ran) {
    L.push('_No UI (browser) tests ran in this pass._', '');
  } else {
    L.push(
      '### By project',
      '',
      '| Project | Total | Passed | Failed | Skipped | Flaky |',
      '| ------- | ----: | -----: | -----: | ------: | ----: |',
      ...s.ui.byProject.map(
        (r) =>
          `| ${r.project} | ${r.total} | ${r.passed} | ${r.failed} | ${r.skipped} | ${r.flaky} |`,
      ),
      '',
      '### By spec',
      '',
      '| Spec | Passed | Failed | Skipped | Flaky |',
      '| ---- | -----: | -----: | ------: | ----: |',
      ...s.ui.bySpec.map(
        (r) => `| ${r.spec} | ${r.passed} | ${r.failed} | ${r.skipped} | ${r.flaky} |`,
      ),
      '',
    );
    if (s.ui.failures.length) {
      const shown = s.ui.failures.slice(0, MAX_UI_FAILURES);
      L.push(
        '### UI failures',
        '',
        '| Project | Spec | Test | Message |',
        '| ------- | ---- | ---- | ------- |',
        ...shown.map(
          (f) =>
            `| ${f.project} | ${f.spec} | ${f.title.replace(/\|/g, '\\|').slice(0, 80)} | ${f.message.replace(/\|/g, '\\|')} |`,
        ),
        '',
      );
      if (s.ui.failures.length > shown.length) {
        L.push(`…and ${s.ui.failures.length - shown.length} more UI failures.`, '');
      }
    } else {
      L.push('_No UI failures._', '');
    }
  }

  L.push(
    '---',
    '',
    '_Structured data for this run: `reports/REPORT.json`. The bug report follows._',
    '',
  );
  return `${L.join('\n')}\n`;
}

/* ------------------------------------------------------------------------------------------------
 * Console rendering
 * ---------------------------------------------------------------------------------------------- */

const RULE = '═'.repeat(78);
const THIN = '─'.repeat(78);

/** Right-pad, and left-pad numbers, so the columns line up in a terminal. */
const pad = (value: string | number, width: number, right = false): string => {
  const text = String(value);
  return right ? text.padStart(width) : text.padEnd(width);
};

const share = (part: number, whole: number): string =>
  whole === 0 ? '  — ' : `${((part / whole) * 100).toFixed(1).padStart(5)}%`;

/**
 * The end-of-run summary printed to the terminal.
 *
 * The same numbers already go to `reports/REPORT.md`, but a file nobody opens is not a report. This
 * is the version a person reads the moment a run finishes: how much ran, what passed, how much of
 * the API surface was actually covered, and — separately — the browser results.
 *
 * API numbers are CHECK-level and UI numbers are TEST-level. They are never added together, because
 * one endpoint contributes dozens of checks and one browser test contributes one result; a combined
 * "total" would be a number with no meaning. Each block says which it is.
 */
export function renderRunSummaryConsole(s: RunSummary): string {
  const out: string[] = [];
  const api = s.api;
  const ui = s.ui;

  out.push(RULE);
  out.push('  TEST RUN SUMMARY — kpost-testbench_v2');
  out.push(RULE);
  out.push(
    `  Environment  ${s.meta.environment}` + `    Build ${s.meta.build}    Run ${s.meta.testRunId}`,
  );
  out.push(`  Finished     ${s.meta.generatedAt}    Status ${s.meta.runStatus}`);
  if (s.meta.profiles.length) out.push(`  Profiles     ${s.meta.profiles.join(', ')}`);

  /* ---- API ------------------------------------------------------------------------------- */
  if (api.checks.total > 0) {
    const c = api.checks;
    out.push('');
    out.push(THIN);
    out.push('  API LAYER — validation checks (one endpoint runs many checks)');
    out.push(THIN);
    out.push(`  Endpoints tested     ${pad(api.endpoints, 6, true)}`);
    out.push(
      `  Endpoints with a failing check  ${pad(api.gateFailedEndpoints, 6, true)}` +
        `   (${share(api.gateFailedEndpoints, api.endpoints)} of the surface)`,
    );
    out.push('');
    out.push(`  Checks run           ${pad(c.total, 6, true)}`);
    out.push(`    passed             ${pad(c.passed, 6, true)}   ${share(c.passed, c.total)}`);
    out.push(`    failed             ${pad(c.failed, 6, true)}   ${share(c.failed, c.total)}`);
    out.push(`    warnings           ${pad(c.warnings, 6, true)}   ${share(c.warnings, c.total)}`);
    out.push(`    skipped            ${pad(c.skipped, 6, true)}   ${share(c.skipped, c.total)}`);

    /*
     * Applicable coverage — the number that means something. Of the checks that actually applied and
     * ran, how many passed. The skipped total above is dominated by validators correctly declining
     * endpoints they cannot apply to, so a raw "X% skipped" understates coverage badly.
     */
    out.push('');
    out.push(
      `  Applicable coverage  ${api.applicable.passed}/${api.applicable.ran} checks passed  (${api.applicable.passRate}%)`,
    );
    out.push('  Skips, by why (only "recoverable" is a coverage hole anyone can act on):');
    out.push(
      `    not applicable (by design)  ${pad(api.skips.notApplicable, 6, true)}   correct — nothing to check`,
    );
    out.push(
      `    recoverable (config/contract)${pad(api.skips.recoverable, 5, true)}   fillable — schema/scenario gaps`,
    );
    out.push(
      `    blocked by a defect         ${pad(api.skips.blockedByDefect, 6, true)}   recovers when the root bug is fixed`,
    );
    out.push(
      `    environmental (timeouts)    ${pad(api.skips.environmental, 6, true)}   transient`,
    );
    out.push(
      `    deliberately disabled       ${pad(api.skips.deliberate, 6, true)}   switched off on purpose`,
    );

    if (api.bySuite.length) {
      out.push('');
      out.push(
        `  ${pad('MODULE', 22)}${pad('ENDPOINTS', 11, true)}${pad('PASS', 9, true)}` +
          `${pad('FAIL', 8, true)}${pad('WARN', 8, true)}${pad('SKIP', 8, true)}`,
      );
      for (const row of api.bySuite) {
        out.push(
          `  ${pad(row.suite, 22)}${pad(row.endpoints, 11, true)}${pad(row.passed, 9, true)}` +
            `${pad(row.failed, 8, true)}${pad(row.warnings, 8, true)}${pad(row.skipped, 8, true)}`,
        );
      }
    }

    if (api.topFailingValidators.length) {
      /*
       * The top failing validators, because a platform-wide fault inflates the raw failure count
       * enormously — 71 "information-disclosure" failures are one missing header, not 71 defects.
       * Showing this next to the totals stops the headline number being read as 71 problems.
       */
      out.push('');
      out.push('  Most frequent failures (one root cause can span many endpoints):');
      for (const row of api.topFailingValidators.slice(0, 5)) {
        out.push(`    ${pad(row.validator, 34)}${pad(row.failed, 5, true)} failed`);
      }
    }
  }

  /* ---- UI -------------------------------------------------------------------------------- */
  if (ui.ran) {
    const t = ui.tests;
    out.push('');
    out.push(THIN);
    out.push('  UI LAYER — browser tests (one result per test)');
    out.push(THIN);
    out.push(`  Tests run            ${pad(t.total, 6, true)}`);
    out.push(`    passed             ${pad(t.passed, 6, true)}   ${share(t.passed, t.total)}`);
    out.push(`    failed             ${pad(t.failed, 6, true)}   ${share(t.failed, t.total)}`);
    out.push(`    flaky              ${pad(t.flaky, 6, true)}   ${share(t.flaky, t.total)}`);
    out.push(`    skipped            ${pad(t.skipped, 6, true)}   ${share(t.skipped, t.total)}`);

    if (ui.byProject.length) {
      out.push('');
      out.push(
        `  ${pad('BROWSER', 22)}${pad('TESTS', 11, true)}${pad('PASS', 9, true)}` +
          `${pad('FAIL', 8, true)}${pad('FLAKY', 8, true)}${pad('SKIP', 8, true)}`,
      );
      for (const row of ui.byProject) {
        out.push(
          `  ${pad(row.project, 22)}${pad(row.total, 11, true)}${pad(row.passed, 9, true)}` +
            `${pad(row.failed, 8, true)}${pad(row.flaky, 8, true)}${pad(row.skipped, 8, true)}`,
        );
      }
    }

    if (ui.failures.length) {
      out.push('');
      out.push(`  Failing UI tests (${ui.failures.length}):`);
      for (const failure of ui.failures.slice(0, 10)) {
        out.push(`    ✗ [${failure.project}] ${failure.spec} › ${failure.title}`);
        const first = (failure.message || '').split('\n')[0]?.trim();
        if (first) out.push(`        ${first.slice(0, 96)}`);
      }
      if (ui.failures.length > 10) {
        out.push(`    …and ${ui.failures.length - 10} more — see reports/REPORT.md`);
      }
    }
  }

  out.push('');
  out.push(`  Full report: reports/REPORT.md   ·   machine-readable: reports/REPORT.json`);
  out.push(RULE);
  return out.join('\n');
}
