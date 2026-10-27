// Run-level runner for smoke / sanity / regression (docs/guides/run-levels.md). Lints tags first,
// never files bugs (dry run, reports under reports/<level>/), and refuses any non-test host.
//
//   node scripts/run-level.mjs --level smoke
//   node scripts/run-level.mjs --level sanity                  (FULL sanity: every module + Admin)
//   node scripts/run-level.mjs --level sanity --module katchup
//   node scripts/run-level.mjs --level sanity --module admin
//   node scripts/run-level.mjs --level sanity --bug 1267
//   node scripts/run-level.mjs --level regression
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Same env files as the Playwright config, so the host guard sees the hosts the tests will use.
dotenv.config({
  path: [path.join(ROOT, `.env.${process.env.TEST_ENV || 'local'}`), path.join(ROOT, '.env')],
  quiet: true,
});

/** The flags the product scripts set, so a run level runs the same suite on QA accounts. */
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
  // Admin API self-cleaning org-setup lifecycle. Role posting stays off: it provisions real accounts.
  ADMIN_LIFECYCLE: 'true',
  // Without this every KMail check skips.
  KMAIL_AUTH_FIXED: 'true',
  // Sends ONE real SMS to the spare account per run; every other dialog test stubs the SMS request.
  FORGOT_PASSWORD_SMS: 'true',
};

/** Paused modules, never run by any level (KDoc/KOS). */
const PAUSED_TAGS = '@kos';

/** The only hosts a run level may target: the test deployment (and a local server). */
const TEST_HOSTS = new Set([
  'test.kpostindia.com',
  'testingapi.kpostindia.com',
  'testkmail.kpostindia.com',
  // Admin test API (+ MongoDB) and Admin UI. The live Admin host is deliberately absent.
  '192.168.11.11',
  '192.168.10.22',
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

/** Output dirs of this invocation, scanned at the end for login throttling. */
const RUN_DIRS = new Set();
const THROTTLE_RE =
  /\b429\b|too many (requests|attempts)|rate.?limit|throttl|try again (in|later)|temporarily (locked|blocked)|maximum login attempts/i;

/**
 * Counts test results in this run's report.json files that carry a throttling marker, and reports
 * them as an environment condition (one throttled account can fail hundreds of tests).
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

/** Keeps the newest KEEP_RUNS runs of one level+suite (each holds tens of MB of traces and video). */
const KEEP_RUNS = 3;
function pruneRunDirs(suiteDir) {
  const runs = fs
    .readdirSync(suiteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const old of runs.slice(KEEP_RUNS))
    fs.rmSync(path.join(suiteDir, old), { recursive: true, force: true });
}

/** Build and run one Playwright invocation; returns the exit code. */
function runPlaywright({ label, suite, project, grep, grepInvert, paths }) {
  const outDir = path.join(ROOT, 'reports', level, suite, stamp);
  fs.mkdirSync(outDir, { recursive: true });
  RUN_DIRS.add(outDir);
  pruneRunDirs(path.dirname(outDir));
  const args = ['playwright', 'test', `--project=${project}`, ...(paths || []), '--grep', grep];
  // Paused modules are excluded from every level, whatever the caller's invert.
  args.push('--grep-invert', grepInvert ? `${grepInvert}|${PAUSED_TAGS}` : PAUSED_TAGS);
  // Replaces the config's Bugzilla reporter, so no run level can file a bug.
  args.push('--reporter=list,html,junit,json');
  // A UI-only module's API run matches nothing; that is "nothing to run", not a failure.
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
  // Quote every arg so grep metacharacters (| ( ) . *) reach Playwright, not the shell.
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
// Smoke/sanity never run @destructive, @quarantine or @framework (bench self-tests); regression
// allows @destructive only with ALLOW_DESTRUCTIVE_TESTS.
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
 * Lists the hosts that do not answer. Any HTTP answer counts (even a 404); only a network error or
 * timeout does, so an outage is reported as ENVIRONMENT DOWN instead of a failed smoke.
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

// Smoke is selected by the @smoke tag alone (reserved for the curated smoke specs). The KPost gate
// leaves Admin out; Admin has its own stages below.
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
 * The Admin smoke stages (never part of the regression gate). Both run even when one fails.
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
