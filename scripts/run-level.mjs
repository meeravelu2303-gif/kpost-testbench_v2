// Run-level runner: the one entry point for smoke / sanity / regression. Cross-platform (Node, no
// bash). See docs/TEST-RUN-LEVELS.md.
//
//   node scripts/run-level.mjs --level smoke
//   node scripts/run-level.mjs --level sanity                  (FULL sanity: every module + Admin)
//   node scripts/run-level.mjs --level sanity --module katchup
//   node scripts/run-level.mjs --level sanity --module admin
//   node scripts/run-level.mjs --level sanity --bug 1267
//   node scripts/run-level.mjs --level regression
//
// Guarantees:
//   - lint:tags runs first; a tag violation aborts before any test runs.
//   - NO run level files bugs: BUGZILLA_DRY_RUN=true is forced and the Bugzilla reporter is replaced
//     with html+junit+json written under reports/<level>/<suite>/<timestamp>/.
//   - workers is capped at 2 by the config; this runner defaults it to 1.
//   - Admin joins SANITY and SMOKE (`@admin` + the level tag), always in its own stages; the KPost
//     smoke gate and regression never select it, so an unreachable Admin box blocks neither.
//   - Runs exactly like the module scripts (`kpost`, `kmail`, `ui:chromium`): QA test accounts only
//     (QATEST_ONLY), every module's write/lifecycle flow switched on, and paused KDoc (@kos) excluded —
//     so a run level measures the same suite the team runs day to day, on accounts no developer uses.
//   - Live-host guard: every level refuses to start unless every target host is a TEST deployment.
//     (.env sets TEST_ENV=production as a safety MODE while pointing at the test hosts, so the guard
//     checks where the tests actually go, not that label.)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Read the same env files the Playwright config reads (process env > .env.<TEST_ENV> > .env), so the
// guard below sees the hosts the tests will really use.
dotenv.config({
  path: [path.join(ROOT, `.env.${process.env.TEST_ENV || 'local'}`), path.join(ROOT, '.env')],
  quiet: true,
});

/** The flags the module scripts set (package.json `kpost` + `kmail` + `ui:chromium`). */
const RUN_FLAGS = {
  QATEST_ONLY: 'true',
  CONCURRENCY_PROBES: 'false',
  TEST_DB_MODE: 'true',
  OTP_TEST_GATEWAY: 'true',
  // API lifecycles (kpost + kmail scripts)
  KATCHUP_LIFECYCLE: 'true',
  KALL_LIFECYCLE: 'true',
  PROFILE_LIFECYCLE: 'true',
  CONTACTS_LIFECYCLE: 'true',
  GROUP_LIFECYCLE: 'true',
  SETTINGS_LIFECYCLE: 'true',
  KDIARY_LIFECYCLE: 'true',
  AWS_LIFECYCLE: 'true',
  KMAIL_LIFECYCLE: 'true',
  // UI lifecycles (ui:chromium script)
  SIGNUP_UI_LIFECYCLE: 'true',
  LOGIN_UI_LIFECYCLE: 'true',
  PROFILE_UI_LIFECYCLE: 'true',
  KATCHUP_UI_LIFECYCLE: 'true',
  CONTACTS_UI_LIFECYCLE: 'true',
  GROUP_UI_LIFECYCLE: 'true',
  KALL_UI_LIFECYCLE: 'true',
  KMAIL_UI_LIFECYCLE: 'true',
  KDIARY_UI_LIFECYCLE: 'true',
  SETTINGS_UI_LIFECYCLE: 'true',
  BUSINESS_UI_LIFECYCLE: 'true',
  // Admin UI session (auth-admin.setup.ts seeds it); read-only screens in sanity.
  ADMIN_UI_LIFECYCLE: 'true',
  // Admin API core write flow in sanity: the self-cleaning org-setup lifecycle (tier → variable →
  // location, HR tier, employee; all deleted). Role posting stays off: it provisions real accounts.
  ADMIN_LIFECYCLE: 'true',
  // KMail's token refusal is fixed on the test deployment; without this every KMail check skips.
  KMAIL_AUTH_FIXED: 'true',
  // The forgot-password lifecycle sends ONE real SMS to the spare account per run (owner,
  // 2026-10-20). Its retries are off and every other dialog test answers the SMS request in-browser.
  FORGOT_PASSWORD_SMS: 'true',
};

/** Paused modules, never run by any level (KDoc/KOS paused by the owner since 2026-10-07). */
const PAUSED_TAGS = '@kos';

/** The only hosts a run level may target: the test deployment (and a local server). */
const TEST_HOSTS = new Set([
  'test.kpostindia.com',
  'testingapi.kpostindia.com',
  'testkmail.kpostindia.com',
  // Admin test deployment (CLAUDE.md §1): the API test box and the Admin UI. The live counterpart
  // (adminmodule.kpostindia.com) is deliberately absent, so pointing at it is refused.
  '192.168.0.38',
  // The Admin API test box's new address (owner, 2026-10-23).
  '192.168.10.38',
  // The Admin UI test build on the internal network (owner, 2026-10-22).
  '192.168.1.170',
  'kpostadmin.kpostindia.com',
  'localhost',
  '127.0.0.1',
]);
const HOST_VARS = [
  'BASE_URL',
  'API_BASE_URL',
  'KPOST_API_BASE_URL',
  'KMAIL_API_BASE_URL',
  'ADMIN_API_BASE_URL',
  'ADMIN_UI_BASE_URL',
];

function arg(name, def) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  const i = process.argv.indexOf(hit);
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const level = String(arg('level', '')).toLowerCase();
const suiteArg = String(arg('suite', 'all')).toLowerCase();
const moduleArg = arg('module') ? String(arg('module')).toLowerCase() : undefined;
const bugArg = arg('bug') ? String(arg('bug')).replace(/^@?bug-?/i, '') : undefined;

const LEVELS = ['smoke', 'sanity', 'regression'];
const MODULES = [
  'auth',
  'katchup',
  'kall',
  'kmail',
  'profile',
  'settings',
  'contacts',
  'home',
  'group',
  'user-management',
  'verticals',
  'platform',
  // Sanity only: the Admin API + Admin UI stages.
  'admin',
];
if (!LEVELS.includes(level)) {
  console.error(`--level must be one of ${LEVELS.join('|')}`);
  process.exit(2);
}
if (moduleArg && !MODULES.includes(moduleArg)) {
  console.error(`--module must be one of ${MODULES.join('|')}`);
  process.exit(2);
}

// Live-host guard (all levels): refuse to start if any configured target is not a test host.
const offTest = HOST_VARS.filter((k) => process.env[k]).flatMap((k) => {
  let host;
  try {
    host = new URL(process.env[k]).hostname.toLowerCase();
  } catch {
    return [`${k}=<unparseable>`];
  }
  return TEST_HOSTS.has(host) ? [] : [`${k} → ${host}`];
});
if (offTest.length) {
  console.error(
    `\n✗ BLOCKED: run levels only target the TEST deployment (${[...TEST_HOSTS].join(', ')}). ` +
      `Not a test host: ${offTest.join('; ')}.`,
  );
  process.exit(3);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

/** Output dirs produced this invocation, scanned at the end for login-throttling (an ENVIRONMENT
 * condition, not a product failure). */
const RUN_DIRS = new Set();
const THROTTLE_RE =
  /\b429\b|too many (requests|attempts)|rate.?limit|throttl|try again (in|later)|temporarily (locked|blocked)|maximum login attempts/i;

/**
 * Scan this run's report.json files for login-throttling markers. One throttled account can fail
 * hundreds of tests for a single environment reason, so surface it distinctly instead of letting it
 * read as ordinary test failures. Returns the number of throttle-tainted test results found.
 */
function reportThrottle() {
  let hits = 0;
  const examples = [];
  for (const dir of RUN_DIRS) {
    const file = path.join(dir, 'report.json');
    if (!fs.existsSync(file)) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const walk = (s) => {
      for (const sp of s.specs || [])
        for (const t of sp.tests || [])
          for (const r of t.results || []) {
            const text = [
              r.error?.message,
              r.error?.stack,
              ...(r.errors || []).map((e) => e.message),
            ]
              .filter(Boolean)
              .join('\n');
            if (text && THROTTLE_RE.test(text)) {
              hits++;
              if (examples.length < 3) examples.push(`${sp.title.slice(0, 50)}`);
            }
          }
      for (const c of s.suites || []) walk(c);
    };
    (json.suites || []).forEach(walk);
  }
  if (hits) {
    console.error(
      `\n⚠ ENVIRONMENT: login throttled — ${hits} test result(s) carry a throttling/rate-limit/lockout ` +
        `signal (e.g. ${examples.join('; ')}). This is an environment condition, NOT a product defect: ` +
        `one throttled account can fail many tests. Re-run after the cool-down, or ask the test env for a ` +
        `higher QA login limit. Do NOT treat these as bugs.`,
    );
  }
  return hits;
}

/** Build and run one Playwright invocation; returns the exit code. */
function runPlaywright({ label, suite, project, grep, grepInvert, paths }) {
  const outDir = path.join(ROOT, 'reports', level, suite, stamp);
  fs.mkdirSync(outDir, { recursive: true });
  RUN_DIRS.add(outDir);
  const args = ['playwright', 'test', `--project=${project}`, ...(paths || []), '--grep', grep];
  // Paused modules are excluded from every level, whatever the caller's invert.
  args.push('--grep-invert', grepInvert ? `${grepInvert}|${PAUSED_TAGS}` : PAUSED_TAGS);
  // Reporters: human list + the three machine artifacts. This REPLACES the config's Bugzilla reporter,
  // so no run level can ever file a bug.
  args.push('--reporter=list,html,junit,json');
  // A module may have tests in only one suite (e.g. a UI-only module's API run matches nothing). An
  // empty match is "nothing to run", not a failure — otherwise one-suite modules fail sanity spuriously.
  args.push('--pass-with-no-tests');
  const env = {
    ...process.env,
    ...RUN_FLAGS,
    BUGZILLA_DRY_RUN: 'true',
    WORKERS: process.env.WORKERS ?? '1',
    PLAYWRIGHT_HTML_REPORT: path.join(outDir, 'html'),
    PLAYWRIGHT_JUNIT_OUTPUT_NAME: path.join(outDir, 'junit.xml'),
    PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(outDir, 'report.json'),
  };
  console.log(
    `\n▶ ${label}  [project=${project}  grep=${grep}${grepInvert ? `  invert=${grepInvert}` : ''}]`,
  );
  console.log(`  report: ${path.relative(ROOT, outDir)}  (dry-run: no bugs filed)`);
  // Quote EVERY arg (JSON.stringify → double-quoted + escaped) so shell metacharacters in grep
  // patterns — | ( ) . * — are passed literally to Playwright, not interpreted by cmd/sh.
  const res = spawnSync(`npx ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
    cwd: ROOT,
    stdio: 'inherit',
    env,
    shell: true,
  });
  return res.status ?? 1;
}

/** Lint gate — always first. */
function lintGate() {
  console.log('▶ lint:tags (governance gate)');
  const res = spawnSync(
    'node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/lint-tags.mjs',
    {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
    },
  );
  return (res.status ?? 1) === 0;
}

// Tag grep helpers. Playwright matches --grep as a regex against "<title> <tags>"; lookahead ANDs tags.
const and = (...tags) => tags.map((t) => `(?=.*${t})`).join('');
// Never pull destructive/quarantined/framework-meta into smoke or sanity; regression drops
// @quarantine and @framework always, and @destructive unless explicitly allowed. @framework = the
// bench's own self-tests (they do not exercise KPOST and run via `npm run check`).
const SMOKE_INVERT = '@quarantine|@destructive|@framework';
const regressionInvert = () =>
  process.env.ALLOW_DESTRUCTIVE_TESTS === 'true'
    ? '@quarantine|@framework'
    : '@quarantine|@destructive|@framework';

/** The KPost hosts every level needs. */
const KPOST_HOST_VARS = ['BASE_URL', 'KPOST_API_BASE_URL', 'KMAIL_API_BASE_URL'];
/** The Admin hosts, checked only for the Admin smoke stages (a down Admin box never stops KPost). */
const ADMIN_HOST_VARS = ['ADMIN_API_BASE_URL', 'ADMIN_UI_BASE_URL'];

/**
 * Is the test deployment reachable at all? Any HTTP answer counts (even a 404); only a network error
 * or a timeout does not. Without this, an outage reads as "smoke failed" and looks like a broken build
 * (2026-10-21: an internet outage failed 57 UI tests with net::ERR_CONNECTION_TIMED_OUT).
 */
async function environmentReachable(hostVars) {
  const down = [];
  for (const key of hostVars) {
    const url = process.env[key];
    if (!url) continue;
    try {
      await fetch(url, { method: 'GET', signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      down.push(`${key} (${new URL(url).host}): ${error.cause?.code ?? error.name}`);
    }
  }
  return down;
}

// Smoke is selected PURELY by the @smoke tag (no file scoping): @smoke is reserved for the curated
// run-level smoke specs (tests/api/smoke/, tests/e2e/smoke/, tests/e2e-admin/smoke/), so grepping it
// yields exactly those. The KPost gate leaves Admin out (`@admin`); Admin has its own stages below.
function smokeGate() {
  // API smoke, then UI smoke; stop at the first failing suite.
  if (suiteArg === 'all' || suiteArg === 'api') {
    if (
      runPlaywright({
        label: 'SMOKE · API',
        suite: 'api',
        project: 'api',
        grep: '@smoke',
        grepInvert: `${SMOKE_INVERT}|@admin`,
      }) !== 0
    )
      return false;
  }
  if (suiteArg === 'all' || suiteArg === 'ui') {
    if (
      runPlaywright({
        label: 'SMOKE · UI',
        suite: 'ui',
        project: 'chromium',
        grep: '@smoke',
        grepInvert: SMOKE_INVERT,
      }) !== 0
    )
      return false;
  }
  return true;
}

/**
 * The Admin smoke stages (`npm run test:smoke` only; the regression gate never runs them). Both stages
 * run even when one fails, and a down Admin box is reported as ENVIRONMENT DOWN, not as a failure.
 * Returns 'pass' | 'fail' | 'down'.
 */
async function adminSmoke() {
  const down = await environmentReachable(ADMIN_HOST_VARS);
  if (down.length) {
    console.error(
      `\n⚠ ENVIRONMENT DOWN (Admin) — the Admin test deployment did not answer, so the Admin smoke did not run:\n  ${down.join('\n  ')}`,
    );
    return 'down';
  }
  let passed = true;
  if (suiteArg === 'all' || suiteArg === 'api')
    passed =
      runPlaywright({
        label: 'SMOKE · Admin API',
        suite: 'admin-api',
        project: 'api',
        grep: and('@smoke', '@admin'),
        grepInvert: SMOKE_INVERT,
      }) === 0 && passed;
  if (suiteArg === 'all' || suiteArg === 'ui')
    passed =
      runPlaywright({
        label: 'SMOKE · Admin UI',
        suite: 'admin-ui',
        project: 'admin-ui',
        grep: and('@smoke', '@admin'),
        grepInvert: SMOKE_INVERT,
      }) === 0 && passed;
  return passed ? 'pass' : 'fail';
}

let ok = true;
if (!lintGate()) {
  console.error('\n✗ lint:tags failed — fix tags before running any level.');
  process.exit(1);
}

// Exit code 4 = ENVIRONMENT DOWN: nothing was tested, so it is neither a pass nor a product failure.
const unreachable = await environmentReachable(KPOST_HOST_VARS);
if (unreachable.length) {
  console.error(
    `\n⚠ ENVIRONMENT DOWN — the test deployment did not answer, so no test was run:\n  ${unreachable.join('\n  ')}\n` +
      '  This is an environment condition (network, server or DNS), NOT a product defect. Re-run when it answers.',
  );
  process.exit(4);
}

let adminDown = false;
if (level === 'smoke') {
  // KPost first (the gate), then Admin in its own stages whatever KPost's result: two products, two verdicts.
  ok = smokeGate();
  const admin = await adminSmoke();
  adminDown = admin === 'down';
  ok = ok && admin !== 'fail';
} else if (level === 'sanity') {
  // No --module and no --bug = FULL sanity: every module's @sanity set on both suites, then Admin.
  // Precondition: auth smoke must pass first.
  console.log('— sanity precondition: auth smoke —');
  const pre =
    runPlaywright({
      label: 'SMOKE · auth (API)',
      suite: 'api',
      project: 'api',
      grep: and('@smoke', '@auth'),
      grepInvert: SMOKE_INVERT,
    }) === 0 &&
    runPlaywright({
      label: 'SMOKE · auth (UI)',
      suite: 'ui',
      project: 'chromium',
      grep: and('@smoke', '@auth'),
      grepInvert: SMOKE_INVERT,
    }) === 0;
  if (!pre) {
    console.error('\n✗ auth smoke precondition failed — stopping.');
    process.exit(1);
  }
  if (bugArg) {
    ok =
      runPlaywright({
        label: `SANITY · bug #${bugArg}`,
        suite: suiteArg === 'all' ? 'api' : suiteArg,
        project: 'api',
        grep: `@bug-${bugArg}`,
        grepInvert: SMOKE_INVERT,
      }) === 0;
    // a bug fix may be UI; also sweep chromium.
    ok =
      runPlaywright({
        label: `SANITY · bug #${bugArg} (UI)`,
        suite: 'ui',
        project: 'chromium',
        grep: `@bug-${bugArg}`,
        grepInvert: SMOKE_INVERT,
      }) === 0 && ok;
  } else {
    // Every stage runs even when an earlier one failed: sanity's job is to say WHICH areas broke.
    const full = !moduleArg;
    const scope = full ? 'all modules' : moduleArg;
    if (moduleArg !== 'admin') {
      const grep = full ? '@sanity' : and('@sanity', `@${moduleArg}`);
      // Admin tests share the `api` project; they run in their own stage below.
      const grepInvert = `${SMOKE_INVERT}|@admin`;
      if (suiteArg === 'all' || suiteArg === 'api')
        ok =
          runPlaywright({
            label: `SANITY · ${scope} (API)`,
            suite: 'api',
            project: 'api',
            grep,
            grepInvert,
          }) === 0 && ok;
      if (suiteArg === 'all' || suiteArg === 'ui')
        ok =
          runPlaywright({
            label: `SANITY · ${scope} (UI)`,
            suite: 'ui',
            project: 'chromium',
            grep,
            grepInvert,
          }) === 0 && ok;
    }
    if (full || moduleArg === 'admin') {
      if (suiteArg === 'all' || suiteArg === 'api')
        ok =
          runPlaywright({
            label: 'SANITY · Admin (API)',
            suite: 'admin-api',
            project: 'api',
            grep: and('@sanity', '@admin'),
            grepInvert: SMOKE_INVERT,
          }) === 0 && ok;
      if (suiteArg === 'all' || suiteArg === 'ui')
        ok =
          runPlaywright({
            label: 'SANITY · Admin (UI)',
            suite: 'admin-ui',
            project: 'admin-ui',
            grep: and('@sanity', '@admin'),
            grepInvert: SMOKE_INVERT,
          }) === 0 && ok;
    }
  }
} else if (level === 'regression') {
  // (The live-host guard at the top already refused any non-test target.)
  console.log('— regression gate: full smoke must pass first —');
  if (!smokeGate()) {
    console.error('\n✗ smoke gate failed — regression not started.');
    process.exit(1);
  }
  const inv = regressionInvert();
  if (suiteArg === 'all' || suiteArg === 'api')
    ok =
      runPlaywright({
        label: 'REGRESSION · API',
        suite: 'api',
        project: 'api',
        grep: '@regression',
        grepInvert: inv,
      }) === 0 && ok;
  if (suiteArg === 'all' || suiteArg === 'ui')
    ok =
      runPlaywright({
        label: 'REGRESSION · UI',
        suite: 'ui',
        project: 'chromium',
        grep: '@regression',
        grepInvert: inv,
      }) === 0 && ok;
}

const throttled = reportThrottle();
console.log(`\n${ok ? '✓' : '✗'} ${level} finished — reports under reports/${level}/`);
if (throttled && !ok)
  console.error(
    '  (note: some/all failures above may be the login-throttling environment condition)',
  );
// A passing KPost smoke with an unreachable Admin box is not a pass: exit 4 (ENVIRONMENT DOWN).
process.exit(!ok ? 1 : adminDown ? 4 : 0);
