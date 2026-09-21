import { apiRegistry } from '@api/definitions/index';
import { BUSINESS_INVARIANTS } from '../../src/business-rules/invariants/index';
import type { EndpointFilter } from '@api/registry/api-registry';
import { ROOT_DIR } from '@config/constants';
import { RUN_PROFILES, RUN_PROFILE_NAMES, type RunProfile } from '@config/run-profiles';
import { expect, test } from '@fixtures';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The endpoint execution matrix (master plan §6 E/G, and the first measured instalment of §17).
 *
 * ## Why this is generated rather than written
 *
 * "Which endpoints are covered, by what, and which command runs them" is exactly the kind of claim
 * that is true the day someone writes it down and wrong a week later. Phase 4I found the cost of
 * that: 135 hand-written tests were dropped by a tag filter for months while the documentation
 * promised they ran, and 64 registered endpoints had no generated case at all while the coverage
 * ledger reported "0 uncovered" — because the ledger measures DEFINITIONS AGAINST THE CONTRACT, not
 * DEFINITIONS AGAINST EXECUTABLE TESTS. This measures the second thing.
 *
 * It derives everything from the repository: the registry, the generator calls the specs actually
 * make, the endpoint ids the flow specs actually name, and the run-profile registry. Nothing here
 * is a list someone has to remember to update.
 *
 * ## What it asserts
 *
 * Every registered endpoint must be reachable by at least one execution layer, or be named in
 * `DOCUMENTED_EXCLUSIONS` with a reason. That is the master plan's rule that a gap may exist only
 * when it is explicit, evidence-backed and given a recovery path — never silent.
 */

const SPEC_DIRS = ['tests/api', 'tests/e2e', 'tests/e2e-admin', 'tests/integration'];
const GENERATOR_SOURCE = String.raw`describeEndpoint(?:Cases|Contracts)\s*\(`;

/**
 * Endpoints deliberately outside the generated matrix, each with the reason and what would change
 * it. An entry here is a CLAIM a reviewer can check, not a way to make this guard quiet.
 */
const DOCUMENTED_EXCLUSIONS: Readonly<Record<string, string>> = {
  'signup-login-user-logout':
    'session-ending: the engine shares one cached token, so running this through the matrix would ' +
    'log the run out and report 401 everywhere. Excluded by excludeTags in login.spec.ts and pinned ' +
    'by the signup-login coverage guard; driven deliberately by login-flow.spec.ts on its own ' +
    'throwaway session.',
  'common-validate-otp':
    'otp-consume: needs an OTP this bench cannot obtain outside the test gateway. Excluded by ' +
    'excludeTags in otp.spec.ts; driven by otp-signup-lifecycle.spec.ts on the gateway.',
  'common-validate-mail-otp': 'otp-consume: as above, for the mail OTP rather than the mobile one.',
  'signup-login-signup':
    'mints-account: registration creates a PERMANENT account KPOST cannot delete, so it must never ' +
    'become a fuzz target. Driven once, end to end, by otp-signup-lifecycle.spec.ts.',
  'signup-login-admin-registration':
    'mints-account: as above, and it mints a whole tenant — a company as well as its admin.',
};

/**
 * Endpoints no layer can reach TODAY because of a Test Bench architecture limit — coverage debt,
 * not "not applicable". Each states the blocker, the code that enforces it, and what would lift it.
 */
const BLOCKED_BY_ARCHITECTURE: Readonly<Record<string, string>> = {
  /*
   * EMPTY, and that is the point.
   *
   * It held `group-download-image` and `group-download-full-image` — non-destructive GETs keyed by
   * a RUNTIME group id, which no static value can reach. The recorded recovery path was "an
   * authorised-read concept (the read equivalent of `allowLiveWrite`) so a flow can drive a read
   * against a resource it just created". Phase 8 built exactly that (`allowLiveRead`), and the group
   * lifecycle now drives both downloads against the image it sets, before it removes it.
   *
   * The entries were DELETED rather than moved to DOCUMENTED_EXCLUSIONS: the debt was paid, not
   * reclassified. Keeping this record empty rather than removing it altogether is deliberate — it is
   * where the next genuine architecture blocker goes, and an empty list is a claim a reviewer can
   * check.
   */
};

interface Row {
  id: string;
  suite: string;
  module: string;
  method: string;
  path: string;
  label: string;
  /** A request or response SCHEMA is held for this endpoint — the contract itself, not a test. */
  contractDeclared: boolean;
  /** `describeEndpointCases`/`Contracts` generates validator cases for it. */
  contract: boolean;
  /** The request fuzzers apply: generated, and not excluded by `skipValidators`. */
  negative: boolean;
  /** The auth/security probes apply: generated, authenticated, and not excluded. */
  security: boolean;
  flow: boolean;
  live: boolean;
  /** An invariant that names this endpoint also declares the states it observes. */
  state: boolean;
  /** Some business invariant names this endpoint in `appliesTo`. */
  businessRule: boolean;
  /** A UI spec drives or asserts against this endpoint. */
  uiCrossCheck: boolean;
  /** A cross-actor or confirmation spec observes this endpoint independently. */
  confirmation: boolean;
  destructive: boolean;
  sideEffect: string;
  otpDependent: string | null;
  mockFixture: boolean;
}

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (match(entry.name)) out.push(full);
  }
  return out;
}

/** Source with comments removed, so a generator call quoted in prose is never counted as a call. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The balanced first argument of a call whose opening bracket ends at `from`. */
function firstArgument(source: string, from: number): string {
  let depth = 1;
  let index = from;
  let argument = '';
  while (index < source.length && depth > 0) {
    const character = source[index] ?? '';
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
    if (depth === 1 && character === ',') break;
    if (depth > 0) argument += character;
    index += 1;
  }
  return argument;
}

/** Parses the only filter shapes the specs use: arrays of quoted strings under known keys. */
function parseFilter(argument: string): EndpointFilter | undefined {
  const field = (name: string): string[] | undefined => {
    const match = new RegExp(name + String.raw`\s*:\s*\[([^\]]*)\]`).exec(argument);
    if (!match) return undefined;
    return [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((entry) => entry[1] as string);
  };
  const used = Object.entries({
    tags: field('tags'),
    excludeTags: field('excludeTags'),
    suites: field('suites'),
    ids: field('ids'),
  }).filter(([, value]) => value !== undefined);
  return used.length ? Object.fromEntries(used) : undefined;
}

/** Endpoint ids the generated contract matrix covers, derived from the specs' own filter calls. */
function contractCovered(): { ids: Set<string>; calls: number; parsed: number } {
  const ids = new Set<string>();
  let calls = 0;
  let parsed = 0;
  for (const dir of SPEC_DIRS) {
    for (const file of walk(path.join(ROOT_DIR, dir), (name) => name.endsWith('.spec.ts'))) {
      const source = code(file);
      for (const match of source.matchAll(new RegExp(GENERATOR_SOURCE, 'g'))) {
        calls += 1;
        const filter = parseFilter(firstArgument(source, match.index + match[0].length));
        if (!filter) continue;
        parsed += 1;
        for (const definition of apiRegistry.find(filter)) ids.add(definition.id);
      }
    }
  }
  return { ids, calls, parsed };
}

/**
 * Endpoint ids a hand-written flow drives. An id is a distinctive kebab literal
 * (`katchup-delete-message`), so a quoted occurrence in a flow spec is a real reference. The
 * generator specs are skipped so a filter TAG is never mistaken for a driven endpoint.
 */
function flowCovered(registered: readonly string[]): Set<string> {
  const quoted = new Set<string>();
  for (const dir of SPEC_DIRS) {
    for (const file of walk(path.join(ROOT_DIR, dir), (name) => name.endsWith('.ts'))) {
      const source = code(file);
      if (new RegExp(GENERATOR_SOURCE).test(source)) continue;
      for (const match of source.matchAll(/'([a-z][a-z0-9-]{4,})'/g))
        quoted.add(match[1] as string);
    }
  }
  return new Set(registered.filter((id) => quoted.has(id)));
}

/**
 * Endpoint ids quoted in the spec files under `dirs` — the same distinctive-kebab rule
 * `flowCovered` uses, applied to a narrower set of directories so a dimension can be measured
 * separately from "is it driven at all".
 */
function idsQuotedIn(
  registered: readonly string[],
  dirs: readonly string[],
  onlyFiles?: RegExp,
): Set<string> {
  const quoted = new Set<string>();
  for (const dir of dirs) {
    const root = path.join(ROOT_DIR, dir);
    if (!existsSync(root)) continue;
    for (const file of walk(root, (name) => name.endsWith('.ts'))) {
      if (onlyFiles && !onlyFiles.test(file)) continue;
      for (const match of code(file).matchAll(/'([a-z][a-z0-9-]{4,})'/g))
        quoted.add(match[1] as string);
    }
  }
  return new Set(registered.filter((id) => quoted.has(id)));
}

/**
 * Business-rule and state coverage, read from the INVARIANT REGISTRY rather than from test titles.
 *
 * `appliesTo` names endpoint ids and `observedStates` names the states a rule is about, so both
 * dimensions come from the same authoritative declaration the invariant catalogue already maintains.
 * Deriving either from a spec filename would reward naming a file well rather than declaring a rule.
 */
function invariantCoverage(): { rule: Set<string>; state: Set<string> } {
  const rule = new Set<string>();
  const state = new Set<string>();
  for (const entry of BUSINESS_INVARIANTS) {
    for (const endpointId of entry.appliesTo) {
      rule.add(endpointId);
      if ((entry.observedStates?.length ?? 0) > 0) state.add(endpointId);
    }
  }
  return { rule, state };
}

/** Whether a validator family is excluded for this endpoint by its own `skipValidators`. */
const skips = (skipped: readonly string[], prefixes: readonly string[]): boolean =>
  skipped.some((name) => prefixes.some((prefix) => name.startsWith(prefix)));

function buildRows(): Row[] {
  const registered = apiRegistry.all();
  const ids = registered.map((definition) => definition.id);
  const contract = contractCovered().ids;
  const flow = flowCovered(ids);
  const { rule, state } = invariantCoverage();
  const ui = idsQuotedIn(ids, ['tests/e2e', 'tests/e2e-admin']);
  const confirmed = idsQuotedIn(ids, ['tests/api'], /(cross-actor|confirmation)\.spec\.ts$/);
  return registered
    .map((definition): Row => {
      const extra = definition as typeof definition & {
        sideEffect?: string;
        productionSafe?: boolean;
        mockFixture?: boolean;
        otpDependent?: string;
      };
      const skipped = definition.skipValidators ?? [];
      const generated = contract.has(definition.id);
      return {
        id: definition.id,
        suite: definition.suite ?? 'kpost-api',
        module: definition.tags?.[1] ?? definition.tags?.[0] ?? '—',
        method: definition.method,
        path: definition.path,
        label: `${definition.method} ${definition.path}`,
        contractDeclared:
          definition.requestSchema !== undefined || definition.responseSchema !== undefined,
        contract: generated,
        negative: generated && !skips(skipped, ['request.']),
        security:
          generated &&
          definition.authentication?.required !== false &&
          !skips(skipped, ['authentication.', 'authorization.', 'security.']),
        flow: flow.has(definition.id),
        live: extra.productionSafe === true,
        state: state.has(definition.id),
        businessRule: rule.has(definition.id),
        uiCrossCheck: ui.has(definition.id),
        confirmation: confirmed.has(definition.id),
        destructive: definition.destructive === true,
        sideEffect: extra.sideEffect ?? 'data',
        otpDependent: extra.otpDependent ?? null,
        mockFixture: extra.mockFixture === true,
      };
    })
    .sort((a, b) => a.suite.localeCompare(b.suite) || a.id.localeCompare(b.id));
}

/** Report rendering, kept out of the test body: a ternary there reads as test logic. */
const tick = (value: boolean): string => (value ? 'yes' : '—');

/**
 * How this endpoint reaches a live host.
 *
 * Three-valued rather than a tick, because "never runs live" and "runs live only behind its
 * lifecycle flag" are very different claims and a boolean would flatter the second into the first.
 */
function liveness(row: Row): string {
  if (row.live) return 'default';
  return row.flow ? 'gated' : '—';
}

/**
 * Why a row sits where it does — the column that stops any gap being unexplained.
 *
 * It names the FIRST missing dimension that matters for this endpoint kind, rather than listing
 * every absent tick: a read has no business-rule obligation simply for existing, and a matrix that
 * demanded one would manufacture invariants to satisfy itself.
 */
function reason(row: Row): string {
  if (DOCUMENTED_EXCLUSIONS[row.id]) return 'documented exclusion — see above';
  if (BLOCKED_BY_ARCHITECTURE[row.id]) return 'blocked — recovery path above';
  if (!row.contract && !row.flow) return 'no generated case and no flow drives it';
  if (!row.contract) return 'driven by a flow; no generated validator cases';
  if (!row.security)
    return row.negative
      ? 'security probes excluded (skipValidators, or the endpoint is unauthenticated)'
      : 'validator families excluded by the endpoint own skipValidators';
  if (!row.live && !row.flow) return 'contract-validated off live only';
  return 'covered at every layer that applies to it';
}

/** How a row is covered today, in the master plan's vocabulary. */
function status(row: Row): string {
  if (row.contract && row.flow) return 'COVERED (contract + flow)';
  if (row.contract) return 'COVERED (contract)';
  if (row.flow) return 'COVERED (flow only)';
  if (DOCUMENTED_EXCLUSIONS[row.id]) return 'NOT_APPLICABLE (documented)';
  return BLOCKED_BY_ARCHITECTURE[row.id] ? 'BLOCKED (recovery path documented)' : 'NOT_YET_COVERED';
}

test.describe('endpoint execution matrix @framework', () => {
  test('every registered endpoint is reachable by some execution layer', () => {
    const uncovered = buildRows()
      .filter((row) => status(row) === 'NOT_YET_COVERED')
      .map((row) => `${row.id} (${row.label})`);
    expect(
      uncovered,
      'an endpoint with no contract case, no flow and no documented exclusion is invisible coverage',
    ).toEqual([]);
  });

  test('every generator call is understood, so nothing is missed by a parse failure', () => {
    // A filter shape this parser cannot read would make the matrix UNDER-report coverage, and the
    // guard above would then fail for the wrong reason. Fail here instead, loudly and specifically.
    const { calls, parsed } = contractCovered();
    expect(calls, 'the generator calls were found at all').toBeGreaterThan(20);
    expect(parsed, 'every generator call had a readable filter').toBe(calls);
  });

  test('every exclusion and blocker still names a registered endpoint and gives a reason', () => {
    const registered = new Set(apiRegistry.all().map((definition) => definition.id));
    const documented = { ...DOCUMENTED_EXCLUSIONS, ...BLOCKED_BY_ARCHITECTURE };
    expect(
      Object.keys(documented).filter((id) => !registered.has(id)),
      'an entry for an endpoint that no longer exists hides nothing and misleads',
    ).toEqual([]);
    expect(
      Object.entries(documented)
        .filter(([, reason]) => reason.length < 40)
        .map(([id]) => id),
      'an exclusion or blocker needs a reason a reviewer can check',
    ).toEqual([]);
    // A blocker must never quietly become an exclusion: "not applicable" ends the conversation,
    // "blocked" keeps the coverage debt visible. Nothing may be in both lists.
    expect(
      Object.keys(BLOCKED_BY_ARCHITECTURE).filter((id) => id in DOCUMENTED_EXCLUSIONS),
      'a blocker is coverage debt, not a not-applicable',
    ).toEqual([]);
  });

  test('every endpoint carries a reason, so no gap is unexplained @framework', () => {
    /*
     * The master plan asks that every endpoint end as COVERED, NOT_APPLICABLE with evidence,
     * BLOCKED with a recovery path, or NOT_YET_COVERED. A status without a reason satisfies the
     * letter of that and none of the point: "NOT_YET_COVERED" alone tells a reader nothing about
     * what to do next.
     */
    const unexplained = buildRows()
      .filter((row) => reason(row).trim().length < 20)
      .map((row) => row.id);
    expect(unexplained, 'a status needs a reason a reviewer can act on').toEqual([]);
  });

  test('a documented exclusion is genuinely outside the generated matrix @framework', () => {
    /*
     * An exclusion that the generator actually covers is stale, and stale exclusions are worse
     * than none: they claim a deliberate decision where the truth is that nobody re-checked. Each
     * of these names a real hazard — a session-ending call, an OTP the bench cannot obtain, an
     * account KPOST cannot delete — so if one starts being generated, that hazard is live.
     */
    const rows = buildRows();
    const wronglyGenerated = Object.keys(DOCUMENTED_EXCLUSIONS).filter(
      (id) => rows.find((row) => row.id === id)?.contract === true,
    );
    expect(
      wronglyGenerated,
      'this endpoint is excluded for a safety reason and is now being generated anyway',
    ).toEqual([]);
  });

  test('an endpoint cleared for live is actually executed by something @framework', () => {
    /*
     * `productionSafe` is permission, not coverage. One that nothing generates and no flow drives
     * is a claim that an endpoint is safe to run live, with nothing running it — which reads on
     * every report as coverage and is not.
     */
    const permissionOnly = buildRows()
      .filter((row) => row.live && !row.contract && !row.flow)
      .map((row) => row.id);
    expect(permissionOnly, 'cleared for live, but nothing executes it').toEqual([]);
  });

  test('the blocked list and the reported statuses agree @framework', () => {
    // The list is empty today. If a row still reported BLOCKED, one of the two would be lying.
    const blockedRows = buildRows()
      .filter((row) => status(row).startsWith('BLOCKED'))
      .map((row) => row.id);
    expect(blockedRows.sort()).toEqual(Object.keys(BLOCKED_BY_ARCHITECTURE).sort());
  });

  test('writes docs/ENDPOINT-EXECUTION-MATRIX.md', () => {
    const rows = buildRows();
    const count = (predicate: (row: Row) => boolean): string =>
      String(rows.filter(predicate).length);

    const lines: string[] = [
      '# Endpoint execution matrix — what actually runs, and under which command',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/endpoint-execution-matrix.spec.ts`',
      '(`npm run test:framework`). Edit the endpoint definitions or the specs, not this file.',
      '',
      'This answers a different question from `docs/COVERAGE.md`. That ledger measures **definitions',
      'against the documented contract** ("is every workbook row defined?"). This measures',
      '**definitions against executable tests** ("does anything actually run this endpoint?") — the',
      'gap Phase 4I found, where the ledger read 0 uncovered while 64 endpoints had no generated case.',
      '',
      '| | Count |',
      '| - | ----: |',
      `| Registered endpoints | **${String(rows.length)}** |`,
      `| — contract matrix (generated validator cases) | ${count((row) => row.contract)} |`,
      `| — driven by a hand-written application flow | ${count((row) => row.flow)} |`,
      `| — both layers | ${count((row) => row.contract && row.flow)} |`,
      `| — flow only (no generated cases) | ${count((row) => row.flow && !row.contract)} |`,
      `| — cleared for live (\`productionSafe\`) | ${count((row) => row.live)} |`,
      `| — a schema is held for the endpoint (contract declared) | ${count((row) => row.contractDeclared)} |`,
      `| — negative / input-validation probes apply | ${count((row) => row.negative)} |`,
      `| — auth + security probes apply | ${count((row) => row.security)} |`,
      `| — named by a business invariant | ${count((row) => row.businessRule)} |`,
      `| — that invariant also declares observed states | ${count((row) => row.state)} |`,
      `| — cross-checked by a UI spec | ${count((row) => row.uiCrossCheck)} |`,
      `| — observed by a cross-actor or confirmation spec | ${count((row) => row.confirmation)} |`,
      `| — documented exclusions (not applicable) | ${String(Object.keys(DOCUMENTED_EXCLUSIONS).length)} |`,
      `| — blocked (coverage debt, recovery path below) | ${String(Object.keys(BLOCKED_BY_ARCHITECTURE).length)} |`,
      '',
      '## Reading the coverage dimensions',
      '',
      'They answer different questions and are deliberately NOT summed into a single score — a',
      'percentage would let a strong dimension hide a missing one, which is the exact failure this',
      'matrix exists to prevent.',
      '',
      '| Dimension | What a yes claims |',
      '| --------- | ----------------- |',
      '| Contract | a request or response SCHEMA is held for this endpoint — the contract itself, not a test |',
      '| Generated | describeEndpointCases / describeEndpointContracts builds validator cases for it |',
      '| Negative | the request fuzzers apply. For a GET that is query and path only: the body fuzzers are gated on carriesRequestBody, because a body sent with a GET is ignored and a 200 would be a false finding |',
      '| Security | the auth-token and security probes apply — generated, authenticated, and not excluded by the endpoint own skipValidators |',
      '| Flow | a hand-written application flow drives it |',
      '| Live | default = runs on a normal live run; gated = driven live only behind its *_LIFECYCLE flag |',
      '| State | an invariant naming this endpoint also declares the states it observes |',
      '| Rule | some business invariant names it in appliesTo |',
      '| UI | a UI spec drives or asserts against it |',
      '| Confirm | a cross-actor or confirmation spec observes it independently |',
      '',
      '**Business-rule and state coverage are read from the INVARIANT REGISTRY**, never from a test',
      'title or a filename — otherwise the matrix would reward naming a file well rather than',
      'declaring a rule.',
      '',
      '## Documented exclusions',
      '',
      'Deliberately outside the generated matrix. Each is a claim a reviewer can check.',
      '',
      '| Endpoint | Reason |',
      '| -------- | ------ |',
      ...Object.entries(DOCUMENTED_EXCLUSIONS).map(([id, reason]) => `| \`${id}\` | ${reason} |`),
      '',
      '## Blocked — coverage debt with a recovery path',
      '',
      'Not "not applicable": these are endpoints the bench cannot reach today because of a Test Bench',
      'architecture limit. They stay on this list until the recovery path is built.',
      '',
      '| Endpoint | Blocker and recovery path |',
      '| -------- | ------------------------- |',
      ...Object.entries(BLOCKED_BY_ARCHITECTURE).map(([id, reason]) => `| \`${id}\` | ${reason} |`),
      '',
      '## Which command executes what',
      '',
      'Derived from `config/run-profiles.json`, so it cannot drift from the runner.',
      '',
      '| Profile | Target | Projects | Tag filter | Gated write flows | Cleanup | Filing |',
      '| ------- | ------ | -------- | ---------- | ----------------- | ------- | ------ |',
      ...RUN_PROFILE_NAMES.map((name) => {
        const profile = RUN_PROFILES[name] as RunProfile;
        const flows = profile.lifecycles.length ? String(profile.lifecycles.length) : '—';
        return (
          `| \`${name}\` | ${profile.targetKind} | ${profile.projects.join(', ')} | ` +
          `${profile.grep ?? '—'} | ${flows} | ${profile.cleanup} | ${profile.filing} |`
        );
      }),
      '',
      '**Reading the write classes.** `sideEffect: data` writes are the only ones `WRITE_FUZZ` opens,',
      'and only together with `TEST_DB_MODE`. `global` is never opened by any flag while',
      '`TEST_ENV=production`. `external` / `otpDependent: sends` can never reach a real host at all —',
      'the SMS/OTP kill-switch is the first check in `destructiveBlockReason` and no flag overrides it.',
      '',
      '## Per-endpoint',
      '',
      '| Endpoint | Module | Method | Path | Contract | Generated | Negative | Security | Flow | Live | State | Rule | UI | Confirm | Write class | Status | Reason |',
      '| -------- | ------ | ------ | ---- | -------- | --------- | -------- | -------- | ---- | ---- | ----- | ---- | -- | ------- | ----------- | ------ | ------ |',
      ...rows.map((row) => {
        const otp = row.otpDependent ? ` / otp:${row.otpDependent}` : '';
        const writeClass = row.mockFixture
          ? 'mock fixture'
          : row.destructive
            ? `${row.sideEffect}${otp}`
            : 'read';
        return (
          `| \`${row.id}\` | ${row.module} | ${row.method} | \`${row.path}\` | ` +
          `${tick(row.contractDeclared)} | ${tick(row.contract)} | ${tick(row.negative)} | ` +
          `${tick(row.security)} | ${tick(row.flow)} | ${liveness(row)} | ${tick(row.state)} | ` +
          `${tick(row.businessRule)} | ${tick(row.uiCrossCheck)} | ${tick(row.confirmation)} | ` +
          `${writeClass} | ${status(row)} | ${reason(row)} |`
        );
      }),
      '',
    ];
    writeFileSync(path.join(ROOT_DIR, 'docs', 'ENDPOINT-EXECUTION-MATRIX.md'), lines.join('\n'));
    expect(rows.length).toBeGreaterThan(300);
  });
});
