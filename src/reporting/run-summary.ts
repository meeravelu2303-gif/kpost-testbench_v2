import type { ValidationReport, ValidationStatus } from '../validation-engine/validation-result';

/**
 * THE at-a-glance run report — `reports/RUN-SUMMARY.{md,json}`, written on every run.
 *
 * It answers, in one screen: how many endpoints were tested and how many checks passed / failed /
 * skipped / warned, broken down by module and by category, with the top failing validators (so the
 * systemic noise collapses to its real size) and the worst endpoints; and the SAME for the UI —
 * per browser project and per spec, with the real failures.
 *
 * This is EXECUTION HEALTH, deliberately separate from `reports/bugs/REPORT.md` (which owns "what
 * distinct defects were found and filed"). API numbers are check-level (from the validation-report
 * attachments); UI numbers are test-level (from Playwright outcomes) — each is labelled so the two
 * counts are never conflated.
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

export function buildRunSummary(input: RunSummaryInput): RunSummary {
  const reports = input.validationReports;
  const results = reports.flatMap((r) => r.results);

  const checks = { ...zero(), total: results.length };
  for (const r of results) add(checks, r.status);

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

export function renderRunSummaryConsole(s: RunSummary): string {
  const line = '─'.repeat(72);
  const c = s.api.checks;
  const parts = [
    line,
    'RUN SUMMARY — kpost-testbench_v2',
    line,
    `Environment ${s.meta.environment} · run ${s.meta.testRunId} · ${s.meta.generatedAt}`,
    '',
    `API : ${s.api.endpoints} endpoints · ${c.total} checks — ` +
      `${c.passed} passed / ${c.failed} failed / ${c.warnings} warn / ${c.skipped} skipped`,
  ];
  if (s.ui.ran) {
    const u = s.ui.tests;
    parts.push(
      `UI  : ${u.total} tests — ${u.passed} passed / ${u.failed} failed / ${u.skipped} skipped / ${u.flaky} flaky`,
    );
  } else {
    parts.push('UI  : not run this pass');
  }
  parts.push('', 'Full report: reports/RUN-SUMMARY.md', line);
  return parts.join('\n');
}

export function renderRunSummaryMarkdown(s: RunSummary): string {
  const c = s.api.checks;
  const L: string[] = [
    '# Run summary — kpost-testbench_v2',
    '',
    '**GENERATED — do not edit.** Written on every run. Execution health for this run; for the',
    'distinct defects found and filed see `reports/bugs/REPORT.md`.',
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
    'Companion reports: `reports/bugs/REPORT.md` (defects filed) · `reports/RUN-SUMMARY.json` (this, structured).',
    '',
  );
  return `${L.join('\n')}\n`;
}
