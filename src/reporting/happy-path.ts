/**
 * Happy-path coverage: did each endpoint's normal request run and pass in this run? The engine
 * plans one test per endpoint × check under a describe titled `<label> [<endpoint-id>]`; the
 * `response.status-code` test is the happy path (the endpoint's own request, its expected status).
 * A blocked endpoint still has that test, skipped with the guard's reason, so a run's tests alone
 * say what was and was not covered. Some endpoints can only be driven inside a flow (signup, the
 * OTP chains, device changes); a passing flow that got an expected answer from one counts too.
 */

/** The check that sends the endpoint's normal request and judges its status. */
export const HAPPY_PATH_CHECK = 'response.status-code';

/** Test annotation listing the endpoints a flow drove (`[[id, FlowCall], …]`, from `sendTo`). */
export const FLOW_CALLS_ANNOTATION = 'api-calls';

/** An endpoint a passing flow drove with an expected answer. */
export interface FlowCredit {
  endpointId: string;
  /** `METHOD /path`. */
  route: string;
}

/**
 * The endpoints of `suite` a passing flow test proved, from its `api-calls` annotation (bad JSON →
 * none). Another product's endpoints a flow touched (the KPost login before KMail) are left out.
 */
export function flowCreditsFrom(annotation: string | undefined, suite: string): FlowCredit[] {
  if (!annotation) return [];
  try {
    const entries = JSON.parse(annotation) as [
      string,
      { suite: string; route: string; ok: boolean },
    ][];
    return entries
      .filter(([, call]) => call.ok && call.suite === suite)
      .map(([endpointId, call]) => ({ endpointId, route: call.route }));
  } catch {
    return [];
  }
}

export type HappyPathStatus = 'passed' | 'failed' | 'blocked' | 'not-run';

/** One endpoint's happy-path test, as the reporter saw it. */
export interface HappyPathTest {
  /** The engine describe title, `<label> [<endpoint-id>]`. */
  describe: string;
  /** Playwright's verdict; `flaky` passed on a retry. */
  outcome: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  /** False when the run ended before the test started (interrupted). */
  ran: boolean;
  skipReason?: string;
  error?: string;
}

export interface HappyPathRow {
  endpointId: string;
  /** `METHOD /path`, from the describe label. */
  endpoint: string;
  status: HappyPathStatus;
  /** Plain reason for a blocked or failed endpoint. */
  reason?: string;
  /** What proved a pass: the endpoint's own check, or a flow that drove it. */
  source?: 'engine' | 'flow';
}

export interface HappyPathSummary {
  rows: HappyPathRow[];
  counts: Record<HappyPathStatus, number>;
  /** Endpoints whose happy path passed, of all endpoints in this run. */
  passRate: number;
}

const DESCRIBE = /^(.*)\s\[([a-z0-9][a-z0-9-]*)\]$/;

/** True for an engine test title that is the happy path (`response.status-code — …`). */
export function isHappyPathTitle(title: string): boolean {
  return title.startsWith(`${HAPPY_PATH_CHECK} —`) || title === HAPPY_PATH_CHECK;
}

/** Endpoint id and `METHOD /path` from an engine describe title, or undefined for any other. */
export function endpointOf(describe: string): { endpointId: string; endpoint: string } | undefined {
  const m = DESCRIBE.exec(describe.trim());
  if (!m) return undefined;
  const label = m[1]!.trim();
  // The label ends with `METHOD /path` (e.g. `KPost Katchup · sends › POST /v2/katchup/sendMessage/`).
  const route = /(GET|POST|PUT|DELETE|PATCH)\s+\/\S*$/.exec(label);
  return { endpointId: m[2]!, endpoint: route ? route[0] : label };
}

/** Why a happy path was skipped, in the words a reader of the report needs. */
export function blockReason(skipReason: string | undefined): string {
  const r = skipReason ?? '';
  if (/forgot.?password/i.test(r) && /texts a real phone/i.test(r))
    return 'texts a real phone (forgot password: one SMS per run, in the browser test)';
  if (/texts the account's real phone/i.test(r))
    return 'texts the account’s real phone (this OTP sender ignores the test bypass)';
  if (/SMS kill-switch|real OTP|OTP\/SMS|real SMS or email/i.test(r))
    return 'sends a real OTP / SMS / e-mail';
  if (/no bypass/i.test(r)) return 'needs a real OTP (no test-gateway bypass)';
  if (/^BLOCKED: needs /.test(r)) return 'needs a record an earlier step did not create';
  if (/changes state shared by the whole environment/i.test(r))
    return 'changes data shared by the whole environment (company, app version)';
  if (/not cleared for the live application/i.test(r))
    return 'not cleared to run on this server (no productionSafe flag)';
  if (/prerequisite failed/i.test(r)) return 'an earlier check of the same endpoint failed';
  if (/^BLOCKED: /.test(r)) return r.slice('BLOCKED: '.length, 140);
  return r ? r.slice(0, 140) : 'skipped without a reason';
}

/**
 * One row per endpoint; an endpoint planned twice (two profiles) keeps its best result. A flow
 * credit turns a not-passed engine row into a pass, and adds a row for an endpoint only flows drive.
 */
export function buildHappyPath(
  tests: readonly HappyPathTest[],
  flowCredits: readonly FlowCredit[] = [],
): HappyPathSummary {
  const rank: Record<HappyPathStatus, number> = { passed: 3, failed: 2, blocked: 1, 'not-run': 0 };
  const byId = new Map<string, HappyPathRow>();
  for (const test of tests) {
    const ep = endpointOf(test.describe);
    if (!ep) continue;
    const row: HappyPathRow = !test.ran
      ? { ...ep, status: 'not-run', reason: 'the run ended before this test started' }
      : test.outcome === 'skipped'
        ? { ...ep, status: 'blocked', reason: blockReason(test.skipReason) }
        : test.outcome === 'unexpected'
          ? { ...ep, status: 'failed', reason: firstLine(test.error) }
          : { ...ep, status: 'passed', source: 'engine' };
    const previous = byId.get(ep.endpointId);
    if (!previous || rank[row.status] > rank[previous.status]) byId.set(ep.endpointId, row);
  }
  for (const credit of flowCredits) {
    const row = byId.get(credit.endpointId);
    if (row?.status === 'passed') continue;
    byId.set(credit.endpointId, {
      endpointId: credit.endpointId,
      endpoint: row?.endpoint ?? credit.route,
      status: 'passed',
      source: 'flow',
    });
  }
  const rows = [...byId.values()].sort((a, b) => a.endpointId.localeCompare(b.endpointId));
  const counts: Record<HappyPathStatus, number> = {
    passed: 0,
    failed: 0,
    blocked: 0,
    'not-run': 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return { rows, counts, passRate: rows.length ? counts.passed / rows.length : 0 };
}

function firstLine(text: string | undefined): string | undefined {
  // eslint-disable-next-line no-control-regex
  const clean = (text ?? '').replace(/\u001b\[[0-9;]*m/g, '').trim();
  return clean ? clean.split('\n')[0]!.slice(0, 160) : undefined;
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '0%');

/** The one-line headline the reporter prints. */
export function happyPathHeadline(summary: HappyPathSummary): string {
  const { counts, rows } = summary;
  return (
    `happy path: ${counts.passed}/${rows.length} endpoints passed (${pct(counts.passed, rows.length)})` +
    ` · ${counts.failed} failed · ${counts.blocked} blocked · ${counts['not-run']} not run`
  );
}

/** `reports/happy-path/<product>.md`: the headline, then every endpoint that did not pass. */
export function happyPathMarkdown(
  product: string,
  summary: HappyPathSummary,
  meta: { generatedAt: string; baseUrl?: string; testRunId?: string },
): string {
  const { rows, counts } = summary;
  const lines: string[] = [
    `# Happy path — ${product}`,
    '',
    `**GENERATED — do not edit.** Written by every \`product:*\` run. Run \`${meta.testRunId ?? ''}\`` +
      ` at ${meta.generatedAt}${meta.baseUrl ? ` against ${meta.baseUrl}` : ''}.`,
    '',
    "The happy path is each endpoint's normal request with its expected answer: the engine's " +
      `\`${HAPPY_PATH_CHECK}\` check, or a passing flow that drove the endpoint and got an expected ` +
      'answer (signup, OTP chains, device changes). Endpoints no test drives are not in this file: see ' +
      '`docs/proposals/kpost-api-backend-gaps.md`.',
    '',
    '| | Endpoints | Share |',
    '| --- | ---: | ---: |',
    `| ✅ Passed | ${counts.passed} | ${pct(counts.passed, rows.length)} |`,
    `| — by its own check | ${rows.filter((r) => r.source === 'engine').length} | |`,
    `| — by a flow | ${rows.filter((r) => r.source === 'flow').length} | |`,
    `| ❌ Failed | ${counts.failed} | ${pct(counts.failed, rows.length)} |`,
    `| ⛔ Blocked | ${counts.blocked} | ${pct(counts.blocked, rows.length)} |`,
    `| ➖ Not run | ${counts['not-run']} | ${pct(counts['not-run'], rows.length)} |`,
    `| **Total** | **${rows.length}** | |`,
  ];

  const failed = rows.filter((r) => r.status === 'failed');
  if (failed.length) {
    lines.push(
      '',
      `## ❌ Failed (${failed.length})`,
      '',
      '| Endpoint | Id | What failed |',
      '| --- | --- | --- |',
    );
    for (const r of failed)
      lines.push(`| \`${r.endpoint}\` | ${r.endpointId} | ${cell(r.reason)} |`);
  }

  const blocked = rows.filter((r) => r.status === 'blocked');
  if (blocked.length) {
    lines.push('', `## ⛔ Blocked (${blocked.length}), by reason`);
    const byReason = new Map<string, HappyPathRow[]>();
    for (const r of blocked)
      byReason.set(r.reason ?? '', [...(byReason.get(r.reason ?? '') ?? []), r]);
    for (const [reason, list] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
      lines.push('', `**${reason}** (${list.length})`, '');
      for (const r of list) lines.push(`- \`${r.endpoint}\` (${r.endpointId})`);
    }
  }

  const notRun = rows.filter((r) => r.status === 'not-run');
  if (notRun.length) {
    lines.push('', `## ➖ Not run (${notRun.length})`, '');
    for (const r of notRun) lines.push(`- \`${r.endpoint}\` (${r.endpointId})`);
  }

  const passed = rows.filter((r) => r.status === 'passed');
  if (passed.length) {
    lines.push('', `<details><summary>✅ Passed (${passed.length})</summary>`, '');
    for (const r of passed)
      lines.push(
        `- \`${r.endpoint}\` (${r.endpointId})${r.source === 'flow' ? ' — by a flow' : ''}`,
      );
    lines.push('', '</details>');
  }
  return `${lines.join('\n')}\n`;
}

const cell = (text: string | undefined) => (text ?? '').replace(/\|/g, '\\|');
