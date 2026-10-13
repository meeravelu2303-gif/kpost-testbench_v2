// Run-level runner: the one entry point for smoke / sanity / regression. Cross-platform (Node, no
// bash). See docs/TEST-RUN-LEVELS.md.
//
//   node scripts/run-level.mjs --level smoke
//   node scripts/run-level.mjs --level sanity --module katchup
//   node scripts/run-level.mjs --level sanity --bug 1267
//   node scripts/run-level.mjs --level regression
//
// Guarantees:
//   - lint:tags runs first; a tag violation aborts before any test runs.
//   - NO run level files bugs: BUGZILLA_DRY_RUN=true is forced and the Bugzilla reporter is replaced
//     with html+junit+json written under reports/<level>/<suite>/<timestamp>/.
//   - workers is capped at 2 by the config; this runner defaults it to 1.
//   - Admin is never selected (its tests carry no @regression/@smoke/@sanity and no module tag).
//   - Production guard: regression is blocked unless ALLOW_PROD_REGRESSION=true.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
];
if (!LEVELS.includes(level)) {
  console.error(`--level must be one of ${LEVELS.join('|')}`);
  process.exit(2);
}
if (moduleArg && !MODULES.includes(moduleArg)) {
  console.error(`--module must be one of ${MODULES.join('|')}`);
  process.exit(2);
}

const IS_PROD = String(process.env.TEST_ENV || '').toLowerCase() === 'production';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

/** Build and run one Playwright invocation; returns the exit code. */
function runPlaywright({ label, suite, project, grep, grepInvert, paths }) {
  const outDir = path.join(ROOT, 'reports', level, suite, stamp);
  fs.mkdirSync(outDir, { recursive: true });
  const args = ['playwright', 'test', `--project=${project}`, ...(paths || []), '--grep', grep];
  if (grepInvert) args.push('--grep-invert', grepInvert);
  // Reporters: human list + the three machine artifacts. This REPLACES the config's Bugzilla reporter,
  // so no run level can ever file a bug.
  args.push('--reporter=list,html,junit,json');
  // A module may have tests in only one suite (e.g. a UI-only module's API run matches nothing). An
  // empty match is "nothing to run", not a failure — otherwise one-suite modules fail sanity spuriously.
  args.push('--pass-with-no-tests');
  const env = {
    ...process.env,
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

// Smoke is selected PURELY by the @smoke tag (no file scoping): @smoke is reserved for the curated
// run-level smoke specs, so grepping it yields exactly those.
function smokeGate() {
  // API smoke, then UI smoke; stop at the first failing suite.
  if (suiteArg === 'all' || suiteArg === 'api') {
    if (
      runPlaywright({
        label: 'SMOKE · API',
        suite: 'api',
        project: 'api',
        grep: '@smoke',
        grepInvert: SMOKE_INVERT,
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

let ok = true;
if (!lintGate()) {
  console.error('\n✗ lint:tags failed — fix tags before running any level.');
  process.exit(1);
}

if (level === 'smoke') {
  ok = smokeGate();
} else if (level === 'sanity') {
  if (!moduleArg && !bugArg) {
    console.error('sanity requires --module <name> or --bug <BugzillaID>.');
    process.exit(2);
  }
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
    const grep = and('@sanity', `@${moduleArg}`);
    if (suiteArg === 'all' || suiteArg === 'api')
      ok =
        runPlaywright({
          label: `SANITY · ${moduleArg} (API)`,
          suite: 'api',
          project: 'api',
          grep,
          grepInvert: SMOKE_INVERT,
        }) === 0 && ok;
    if (suiteArg === 'all' || suiteArg === 'ui')
      ok =
        runPlaywright({
          label: `SANITY · ${moduleArg} (UI)`,
          suite: 'ui',
          project: 'chromium',
          grep,
          grepInvert: SMOKE_INVERT,
        }) === 0 && ok;
  }
} else if (level === 'regression') {
  if (IS_PROD && process.env.ALLOW_PROD_REGRESSION !== 'true') {
    console.error(
      '\n✗ BLOCKED: regression against PRODUCTION (TEST_ENV=production). Set ALLOW_PROD_REGRESSION=true to override.',
    );
    process.exit(3);
  }
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

console.log(`\n${ok ? '✓' : '✗'} ${level} finished — reports under reports/${level}/`);
process.exit(ok ? 0 : 1);
