// Run-level runner for smoke / sanity / regression, one product at a time (docs/guides/run-levels.md).
// Lints tags first, never files bugs (reports under reports/<level>/<product>/), refuses non-test hosts.
//
//   node scripts/run-level.mjs --level smoke --product kmail-api
//   node scripts/run-level.mjs --level sanity --product kpost-ui --module katchup
//   node scripts/run-level.mjs --level sanity --product kpost-api --bug 1267
//   node scripts/run-level.mjs --level regression                (no --product: every product, in order)
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
  // The KPost API QA backend on the office network (KPOST_V5.0, branch kpostV5_Qa, port 8989).
  '192.168.0.100',
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
const productArg = arg('product') ? String(arg('product')).toLowerCase() : undefined;
const moduleArg = arg('module') ? String(arg('module')).toLowerCase() : undefined;
const bugArg = arg('bug') ? String(arg('bug')).replace(/^@?bug-?/i, '') : undefined;

/**
 * The five Bugzilla products, in dependency order. `needs` is what must work before the product can be
 * judged: KMail and Admin accept the KPost login token, the KPost UI is one app over the KPost and KMail
 * APIs, and the Admin UI signs in with the KPost token and reads the Admin API.
 */
const PRODUCTS = {
  'kpost-api': {
    name: 'KPost API',
    project: 'api',
    // Every folder but concurrency/ (excluded by the owner) and kos/ (paused).
    paths: [
      'tests/kpost-api/admin',
      'tests/kpost-api/aws',
      'tests/kpost-api/common',
      'tests/kpost-api/contacts',
      'tests/kpost-api/dashboard',
      'tests/kpost-api/group',
      'tests/kpost-api/kall',
      'tests/kpost-api/katchup',
      'tests/kpost-api/kbooking',
      'tests/kpost-api/kdiary',
      'tests/kpost-api/profile',
      'tests/kpost-api/sanity',
      'tests/kpost-api/security',
      'tests/kpost-api/settings',
      'tests/kpost-api/signup-login',
      'tests/kpost-api/smoke',
    ],
    hosts: ['KPOST_API_BASE_URL'],
    needs: [],
    // Regression = the full product run (`product:kpost-api`), chosen by folder: the @regression tag
    // missed the core /admin/* tests (tagged @admin) and untagged specs. The flags add every
    // endpoint's write checks (tagged @destructive), the write fuzz and the security profile; without
    // them regression left out the engine checks of ~100 write endpoints and every FULL validator.
    regressionPaths: 'paths',
    regressionEnv: {
      ALLOW_DESTRUCTIVE_TESTS: 'true',
      VALIDATION_PROFILE: 'FULL',
      WRITE_FUZZ: 'true',
    },
  },
  'kmail-api': {
    name: 'KMail API',
    project: 'api',
    paths: ['tests/kmail-api/'],
    hosts: ['KMAIL_API_BASE_URL', 'KPOST_API_BASE_URL'],
    needs: ['kpost-login'],
  },
  'kpost-admin': {
    name: 'KPost Admin API',
    project: 'api',
    paths: ['tests/admin-api/'],
    hosts: ['ADMIN_API_BASE_URL', 'KPOST_API_BASE_URL'],
    needs: ['kpost-login'],
    // Admin tests carry no @regression tag (they sit outside the KPost tag scope), so regression is
    // chosen by folder: the product run's set without maintenance/ (one-time setup).
    regressionPaths: [
      'tests/admin-api/contract.spec.ts',
      'tests/admin-api/engine',
      'tests/admin-api/flows',
      'tests/admin-api/performance',
      'tests/admin-api/security',
      'tests/admin-api/validation',
      'tests/admin-api/sanity',
    ],
  },
  'kpost-ui': {
    name: 'KPost UI',
    project: 'chromium',
    paths: [],
    hosts: ['BASE_URL', 'KPOST_API_BASE_URL', 'KMAIL_API_BASE_URL'],
    needs: ['kpost-api', 'kmail-api'],
  },
  'kpost-admin-ui': {
    name: 'KPost Admin UI',
    project: 'admin-ui',
    paths: [],
    hosts: ['ADMIN_UI_BASE_URL', 'ADMIN_API_BASE_URL', 'KPOST_API_BASE_URL'],
    needs: ['kpost-login', 'kpost-admin'],
    // Every Admin UI test, as in its product run (no @regression tag, like the Admin API).
    regressionPaths: ['tests/admin-ui/'],
  },
};
/** Dependency checks: a product's smoke, or just the KPost login smoke. */
const CHECKS = {
  'kpost-login': { name: 'KPost login', product: 'kpost-api', tags: ['@smoke', '@auth'] },
  ...Object.fromEntries(
    Object.keys(PRODUCTS).map((id) => [
      id,
      { name: PRODUCTS[id].name, product: id, tags: ['@smoke'] },
    ]),
  ),
};

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
if (productArg && !PRODUCTS[productArg]) {
  console.error(`--product must be one of ${Object.keys(PRODUCTS).join('|')}`);
  process.exit(2);
}
if (moduleArg && !MODULES.includes(moduleArg)) {
  console.error(`--module must be one of ${MODULES.join('|')}`);
  process.exit(2);
}
if ((moduleArg || bugArg) && !productArg) {
  console.error('--module and --bug need a --product');
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
function runPlaywright({ label, suite, project, grep, grepInvert, paths, extraEnv = {} }) {
  const outDir = path.join(ROOT, 'reports', level, suite, stamp);
  fs.mkdirSync(outDir, { recursive: true });
  RUN_DIRS.add(outDir);
  pruneRunDirs(path.dirname(outDir));
  // No grep = every test under `paths` (a level chosen by folder, not by tag).
  const args = ['playwright', 'test', `--project=${project}`, ...(paths || [])];
  if (grep) args.push('--grep', grep);
  // Paused modules are excluded from every level, whatever the caller's invert.
  args.push('--grep-invert', grepInvert ? `${grepInvert}|${PAUSED_TAGS}` : PAUSED_TAGS);
  // Replaces the config's Bugzilla reporter, so no run level can file a bug.
  args.push('--reporter=list,html,junit,json');
  // A UI-only module's API run matches nothing; that is "nothing to run", not a failure.
  args.push('--pass-with-no-tests');
  const env = {
    ...process.env,
    ...RUN_FLAGS,
    ...extraEnv,
    BUGZILLA_DRY_RUN: 'true',
    WORKERS: process.env.WORKERS ?? '1',
    PLAYWRIGHT_HTML_REPORT: path.join(outDir, 'html'),
    PLAYWRIGHT_JUNIT_OUTPUT_NAME: path.join(outDir, 'junit.xml'),
    PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(outDir, 'report.json'),
  };
  console.log(
    `\n▶ ${label}  [project=${project}  ${grep ? `grep=${grep}` : `paths=${paths.join(' ')}`}${grepInvert ? `  invert=${grepInvert}` : ''}]`,
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
const regressionInvert = (extraEnv = {}) =>
  (extraEnv.ALLOW_DESTRUCTIVE_TESTS ?? process.env.ALLOW_DESTRUCTIVE_TESTS) === 'true'
    ? '@quarantine|@framework'
    : '@quarantine|@destructive|@framework';

/**
 * Lists the hosts that do not answer. Any HTTP answer counts (even a 404); only a network error or
 * timeout does, so an outage is reported as ENVIRONMENT DOWN instead of a failed check.
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

/** One stage of one product: its project and folder, plus the level's tags. */
function runStage(label, productId, tags, invert, { onlyIf = true } = {}) {
  if (!onlyIf) return 0;
  const product = PRODUCTS[productId];
  return runPlaywright({
    label,
    suite: productId,
    project: product.project,
    paths: product.paths,
    grep: tags.length > 1 ? and(...tags) : tags[0],
    grepInvert: invert,
  });
}

/** Dependency results within this invocation, so `product:all`-style runs check each one once. */
const checked = new Map();
function dependencyPasses(checkId) {
  // The login check is part of the KPost API smoke: a passed smoke already proves it.
  if (checkId === 'kpost-login' && checked.get('kpost-api') === true) return true;
  if (!checked.has(checkId)) {
    const check = CHECKS[checkId];
    const code = runStage(`CHECK · ${check.name} works`, check.product, check.tags, SMOKE_INVERT);
    checked.set(checkId, code === 0);
  }
  return checked.get(checkId);
}

const VERDICT = { pass: 0, fail: 1, down: 4, blocked: 5 };

/**
 * One product through one level:
 *   1. its own hosts answer (else ENVIRONMENT DOWN — nothing was tested);
 *   2. what it depends on works (else BLOCKED, naming the broken dependency — not this product's fault);
 *   3. smoke: its smoke. sanity / regression: its smoke first, then the level.
 */
async function runProduct(productId) {
  const product = PRODUCTS[productId];
  console.log(`\n═══ ${level.toUpperCase()} · ${product.name} ═══`);
  const down = await environmentReachable(product.hosts);
  if (down.length) {
    console.error(
      `⚠ ENVIRONMENT DOWN — ${product.name} was not tested; these hosts did not answer:\n  ${down.join('\n  ')}`,
    );
    return { productId, verdict: 'down', reason: down.join('; ') };
  }
  for (const need of product.needs) {
    // A product's own smoke is not its dependency; the login check is part of the KPost API smoke.
    if (need === 'kpost-login' && productId === 'kpost-api') continue;
    if (!dependencyPasses(need)) {
      const reason = `${CHECKS[need].name} is not working, so ${product.name} cannot be judged`;
      console.error(`⚠ BLOCKED — ${reason}.`);
      return { productId, verdict: 'blocked', reason };
    }
  }
  const smoke = checked.has(productId)
    ? checked.get(productId)
      ? 0
      : 1
    : runStage(`SMOKE · ${product.name}`, productId, ['@smoke'], SMOKE_INVERT);
  checked.set(productId, smoke === 0);
  if (level === 'smoke') return { productId, verdict: smoke === 0 ? 'pass' : 'fail' };
  if (smoke !== 0) {
    console.error(`✗ ${product.name} smoke failed — ${level} not started.`);
    return { productId, verdict: 'fail', reason: 'smoke failed' };
  }
  let code;
  if (level === 'sanity') {
    const tags = bugArg
      ? [`@bug-${bugArg}`]
      : moduleArg
        ? ['@sanity', `@${moduleArg}`]
        : ['@sanity'];
    const scope = bugArg ? `bug #${bugArg}` : (moduleArg ?? 'all modules');
    code = runStage(`SANITY · ${product.name} · ${scope}`, productId, tags, SMOKE_INVERT);
  } else if (product.regressionPaths) {
    const extraEnv = product.regressionEnv ?? {};
    code = runPlaywright({
      label: `REGRESSION · ${product.name}`,
      suite: productId,
      project: product.project,
      // 'paths' = the product's own folders, without the tag filter; their sanity sweep is a
      // SMOKE-profile copy of checks regression already runs in depth. (Admin lists its folders
      // and keeps its sweep.)
      paths: product.regressionPaths === 'paths' ? product.paths : product.regressionPaths,
      grepInvert:
        product.regressionPaths === 'paths'
          ? `${regressionInvert(extraEnv)}|@sanity-sweep`
          : regressionInvert(extraEnv),
      extraEnv,
    });
  } else {
    code = runStage(`REGRESSION · ${product.name}`, productId, ['@regression'], regressionInvert());
  }
  return { productId, verdict: code === 0 ? 'pass' : 'fail' };
}

if (!lintGate()) {
  console.error('\n✗ lint:tags failed — fix tags before running any level.');
  process.exit(1);
}

const results = [];
for (const id of productArg ? [productArg] : Object.keys(PRODUCTS))
  results.push(await runProduct(id));

const throttled = reportThrottle();
console.log(`\n═══ ${level} — one verdict per product (reports under reports/${level}/) ═══`);
const WORDS = { pass: 'PASSED ', fail: 'FAILED ', down: 'ENV DOWN', blocked: 'BLOCKED ' };
for (const r of results)
  console.log(`  ${WORDS[r.verdict]}  ${PRODUCTS[r.productId].name.padEnd(16)} ${r.reason ?? ''}`);
if (throttled && results.some((r) => r.verdict === 'fail'))
  console.error('  (note: some failures above may be the login-throttling environment condition)');
// Worst verdict wins: a failure beats an outage or a block, which beat a pass.
const worst = ['fail', 'blocked', 'down', 'pass'].find((v) => results.some((r) => r.verdict === v));
process.exit(VERDICT[worst]);
