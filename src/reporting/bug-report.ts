import type { BugCandidate } from '../bug-tracker/bug-candidate';
import type { FilingOutcome } from '../bug-tracker/bugzilla-filer';
import { SUITES } from '../config/ownership.config';
import type { ValidationReport } from '../validation-engine/validation-result';

/**
 * THE bug report that lives inside the bench — `reports/bugs/REPORT.md`, written on every run.
 *
 * It answers, in one place: how many endpoints were tested, how many checks ran and how many
 * passed / failed / skipped; how many DISTINCT valid defects that collapsed to; which were filed to
 * Bugzilla and to which developer; and which findings were NOT filed, with the reason. It is the
 * readable companion to filing.json (raw); the neat execution-health report (endpoints, pass/fail/
 * skip by module, and the UI) is `reports/RUN-SUMMARY.md`. So "what did this run find and file"
 * never needs the console scrollback.
 */

export interface BugReportInput {
  environment: string;
  runStatus: string;
  testRunId: string;
  build: string;
  generatedAt: string;
  validationReports: ValidationReport[];
  /** Distinct defects after merge/consolidation, before the validity gate. */
  merged: BugCandidate[];
  /** Findings the validity gate refused, with why. */
  rejected: { candidate: BugCandidate; reason: string }[];
  /** The filing result, when filing actually ran (absent on a disabled/blocked run). */
  outcome?: FilingOutcome;
  /** Why nothing was filed, when `outcome` is absent (or filing was a dry run). */
  notFiledReason?: string;
  /** Bugs auto-closed because this run verified them fixed (absent on a dry run). */
  resolved?: ResolveSummary;
}

/** Result of the auto-resolve pass: bugs closed because this run verified them fixed. */
export interface ResolveSummary {
  resolved: { bugId: number; reason: string; summary: string }[];
  keptOpen: number;
  checked: number;
  failed: number;
  /** True on a preview run — the list is what WOULD be closed; nothing was written to Bugzilla. */
  dryRun: boolean;
}

const OWNER_BY_PRODUCT = new Map(
  Object.values(SUITES).map((s) => [s.bugzilla.product, s.owner.name]),
);

/** Decisions that mean a Bugzilla ticket now exists (or would, on a dry run). */
const TICKETED = new Set(['created', 'commented', 'reopened', 'adopted', 'would-file']);

interface RunTotals {
  endpoints: number;
  validations: number;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
  gateFailed: number;
}

function runTotals(reports: readonly ValidationReport[]): RunTotals {
  const results = reports.flatMap((r) => r.results);
  const count = (status: string): number => results.filter((r) => r.status === status).length;
  return {
    endpoints: reports.length,
    validations: results.length,
    passed: count('PASSED'),
    failed: count('FAILED'),
    warnings: count('WARNING'),
    skipped: count('SKIPPED'),
    gateFailed: reports.filter((r) => !r.gate.passed).length,
  };
}

/**
 * Buckets each SKIPPED check by WHY it was skipped, so the report explains the large skip count
 * (the three production safety controls at work), not just its size. Order matters — the first
 * pattern that matches wins, so specific reasons (OTP, needs-id) are tested before generic ones.
 */
const SKIP_BUCKETS: readonly (readonly [string, RegExp])[] = [
  ['OTP-gated — no OTP bypass on the live app', /\botp\b/i],
  [
    'Needs a runtime id (message / call / group) only a write flow creates',
    /needs[- ]a real|needs-[a-z]+-id|only a write flow|a real .*id that/i,
  ],
  [
    'Mutating / attack probe — unsafe to send at the live app',
    /mutat|inject|\bxss\b|\battack\b|cross[- ]tenant|second tenant|string fields to attack|fuzz|escalat/i,
  ],
  [
    'Write / destructive endpoint — not run on the live app',
    /real sms|real email|real otp|shared by the whole environment|test_env=production|allow_destructive|not cleared for live|productionsafe/i,
  ],
  [
    'Not applicable to this endpoint (no schema / principal / rate-limit / token)',
    /no request schema|no response|documents no error|no principal|no rate limit|disabled for this endpoint|no expired token|no json responses|every role is allowed/i,
  ],
];

/** Skip counts grouped by reason, most first, for the report's "why skipped" section. */
function skipBreakdown(reports: readonly ValidationReport[]): { label: string; count: number }[] {
  const skipped = reports.flatMap((r) => r.results).filter((r) => r.status === 'SKIPPED');
  const counts = new Map<string, number>();
  for (const r of skipped) {
    const msg = r.message ?? '';
    const hit = SKIP_BUCKETS.find(([, re]) => re.test(msg));
    const label = hit ? hit[0] : 'Other';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

/** One row per developer: product, owner, how many tickets this run put on their queue. */
function byDeveloper(
  input: BugReportInput,
): Array<{ product: string; owner: string; count: number }> {
  const counts = new Map<string, number>();
  const source = input.outcome
    ? input.outcome.entries.filter((e) => TICKETED.has(e.decision)).map((e) => e.product)
    : input.merged
        .filter((c) => !input.rejected.some((r) => r.candidate.id === c.id))
        .map((c) => c.product);
  for (const product of source) counts.set(product, (counts.get(product) ?? 0) + 1);
  return [...counts.entries()]
    .map(([product, count]) => ({ product, owner: OWNER_BY_PRODUCT.get(product) ?? '—', count }))
    .sort((a, b) => b.count - a.count);
}

/** The one-line headline used both in the console block and at the top of the file. */
function headline(input: BugReportInput): string {
  const t = runTotals(input.validationReports);
  const distinct = input.merged.length;
  const valid = distinct - input.rejected.length;
  if (!input.outcome) {
    return (
      `${t.endpoints} endpoints, ${t.validations} checks (${t.passed} passed / ${t.failed} failed) → ` +
      `${valid} valid defects — NOT FILED (${input.notFiledReason ?? 'filing did not run'})`
    );
  }
  const c = input.outcome.counts;
  const verb = input.outcome.dryRun ? 'would file' : 'filed';
  const n = input.outcome.dryRun ? c['would-file'] : c.created;
  return (
    `${t.endpoints} endpoints, ${t.validations} checks (${t.passed} passed / ${t.failed} failed) → ` +
    `${valid} valid defects → ${verb} ${n}, commented ${c.commented}, reopened ${c.reopened}, ` +
    `${input.rejected.length} rejected as invalid`
  );
}

export function buildBugReportConsole(input: BugReportInput): string {
  const line = '─'.repeat(72);
  const rows = byDeveloper(input)
    .map((d) => `  • ${d.product} → ${d.owner}: ${d.count}`)
    .join('\n');
  const resolvedLine =
    input.resolved && input.resolved.resolved.length
      ? `\nAuto-resolved (verified fixed): ${input.resolved.resolved.length} bug(s) ` +
        (input.resolved.dryRun ? 'WOULD be closed (preview)' : 'closed')
      : '';
  return [
    line,
    'BUG REPORT — kpost-testbench_v2',
    line,
    headline(input),
    resolvedLine,
    rows ? `\nBy developer:\n${rows}` : '',
    `\nFull report: reports/bugs/REPORT.md`,
    line,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildBugReportMarkdown(input: BugReportInput): string {
  const t = runTotals(input.validationReports);
  const distinct = input.merged.length;
  const valid = distinct - input.rejected.length;
  const systemic = input.merged.filter((c) => c.systemic);
  const systemicEndpoints = systemic.reduce(
    (n, c) => n + Math.max(c.affectedEndpoints?.length ?? 1, 1),
    0,
  );
  const filedEntries = input.outcome?.entries.filter((e) => TICKETED.has(e.decision)) ?? [];

  const lines: string[] = [
    '# Bug report — kpost-testbench_v2',
    '',
    `**GENERATED — do not edit.** Written on every run by the Bugzilla reporter.`,
    '',
    `Environment **${input.environment}** · run \`${input.testRunId}\` · build **${input.build}** · ${input.generatedAt}`,
    '',
    '## 1. This run',
    '',
    '| | Count |',
    '| - | ----: |',
    `| Endpoints tested | ${t.endpoints} |`,
    `| Validations run | ${t.validations} |`,
    `| — passed | ${t.passed} |`,
    `| — failed | ${t.failed} |`,
    `| — warnings | ${t.warnings} |`,
    `| — skipped (blocked on live, by design) | ${t.skipped} |`,
    '',
    ...(t.skipped
      ? [
          `**Why ${t.skipped} checks skipped** — the three production safety controls, not a coverage gap.`,
          'Each has a reason (see `docs/LIVE-ENDPOINTS.md`); the write PROCESSES are covered separately by',
          'the gated self-cleaning lifecycle flows (`*_LIFECYCLE`), off during a filing run.',
          '',
          '| Reason skipped | Count |',
          '| -------------- | ----: |',
          ...skipBreakdown(input.validationReports).map((b) => `| ${b.label} | ${b.count} |`),
          '',
        ]
      : []),
    '## 2. Defects',
    '',
    `The ${t.failed} failed checks collapse to **${distinct} distinct defects** (one ticket each; a`,
    `single fault seen on many endpoints is consolidated, not repeated). Of those,`,
    `**${valid} are valid and fileable** and **${input.rejected.length} were rejected** by the validity`,
    `gate (infrastructure noise, throttling, below the severity floor, or self-contradicting).`,
    '',
    systemic.length
      ? `**${systemic.length}** of the ${distinct} are platform-wide faults (shared gateway / auth filter) ` +
        `consolidated from **${systemicEndpoints}** per-endpoint observations — each ticket lists every ` +
        `endpoint it affects, so one fix closes them all.`
      : '_No platform-wide faults this run; every defect is endpoint-specific._',
    '',
    '## 3. Filed to Bugzilla — by developer',
    '',
  ];

  const devs = byDeveloper(input);
  if (devs.length) {
    lines.push(
      '| Product | Developer | Tickets |',
      '| ------- | --------- | ------: |',
      ...devs.map((d) => `| ${d.product} | ${d.owner} | ${d.count} |`),
      '',
    );
  } else {
    lines.push('_Nothing filed._', '');
  }

  if (input.outcome) {
    const c = input.outcome.counts;
    const mode = input.outcome.dryRun
      ? 'DRY RUN — nothing was written to Bugzilla'
      : 'Filed to Bugzilla';
    lines.push(
      `**${mode}.** created ${c.created}, commented (already open) ${c.commented}, reopened ${c.reopened}, ` +
        `adopted ${c.adopted}, judged-not-a-defect ${c['judged-skip']}, failed ${c.failed}` +
        (input.outcome.dryRun ? `, would-file ${c['would-file']}` : '') +
        '.',
      '',
    );
  } else {
    lines.push(`**Not filed:** ${input.notFiledReason ?? 'filing did not run'}.`, '');
  }

  // 3b. Auto-resolved — bugs this run verified fixed (closed, or would-close on a preview).
  if (input.resolved) {
    const r = input.resolved;
    const verb = r.dryRun ? 'WOULD be closed' : 'were verified fixed and marked **RESOLVED/FIXED**';
    lines.push(
      `## 3b. Auto-resolved (verified fixed)${r.dryRun ? ' — PREVIEW' : ''}`,
      '',
      `Checked **${r.checked}** open bench-filed bugs; **${r.resolved.length}** ${verb} ` +
        `(their exact endpoint+validator ran and passed this run); ` +
        `**${r.keptOpen}** stayed open (still failing, or not exercised this run)` +
        (r.failed ? `; ${r.failed} could not be updated` : '') +
        `.${r.dryRun ? ' Run the non-dry filing command to apply these.' : ' A later run reopens any that recur.'}`,
      '',
    );
    if (r.resolved.length) {
      lines.push(
        '| Bug | Why it was closed |',
        '| --- | ----------------- |',
        ...r.resolved
          .slice(0, 100)
          .map((x) => `| #${x.bugId} | ${x.reason.replace(/\|/g, '\\|')} |`),
        '',
      );
      if (r.resolved.length > 100) lines.push(`…and ${r.resolved.length - 100} more.`, '');
    }
  }

  // 4. Every ticket
  lines.push('## 4. Tickets', '');
  if (filedEntries.length) {
    lines.push(
      '| Bug | Severity | Product | Endpoint(s) | Summary |',
      '| --- | -------- | ------- | ----------- | ------- |',
      ...filedEntries.map((e) => {
        const bug = e.bugId ? `#${e.bugId}` : '(dry-run)';
        const cand = input.merged.find((c) => c.id === e.id);
        const scope = cand?.affectedEndpoints?.length
          ? `${cand.endpoint ?? ''} (+${cand.affectedEndpoints.length - 1} more)`
          : (cand?.endpoint ?? '—');
        const summary = e.summary.replace(/\|/g, '\\|').slice(0, 140);
        return `| ${bug} | ${e.severity} | ${e.product} | ${scope.replace(/\|/g, '\\|')} | ${summary} |`;
      }),
      '',
    );
  } else {
    lines.push('_No tickets._', '');
  }

  // 5. Not filed (transparency: valid-bugs-only means saying why each was dropped)
  if (input.rejected.length) {
    lines.push(
      '## 5. Findings NOT filed (rejected by the validity gate)',
      '',
      `Kept out of Bugzilla on purpose — filing only valid defects. Severity floor is set by`,
      `\`BUGZILLA_MIN_SEVERITY\`; the rest are infrastructure noise or self-contradicting findings.`,
      '',
      '| Finding | Reason |',
      '| ------- | ------ |',
      ...input.rejected
        .slice(0, 100)
        .map(
          ({ candidate, reason }) =>
            `| ${candidate.title.replace(/\|/g, '\\|').slice(0, 90)} | ${reason.replace(/\|/g, '\\|')} |`,
        ),
      '',
    );
    if (input.rejected.length > 100) lines.push(`…and ${input.rejected.length - 100} more.`, '');
  }

  lines.push(
    '---',
    '',
    `Severity floor: **${process.env.BUGZILLA_MIN_SEVERITY ?? 'MEDIUM'}** · ` +
      `dedupe: a re-run comments on the existing \`[KP-…]\` ticket instead of duplicating.`,
    '',
  );

  return `${lines.join('\n')}\n`;
}
