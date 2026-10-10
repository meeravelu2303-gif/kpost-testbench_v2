#!/usr/bin/env node
/**
 * Preflight — run before any live run (`npm run preflight`).
 *
 * A hand-run bench fails in the first minute for boring reasons: a key missing from `.env`, a second
 * Playwright run still going, a host that does not answer, a Bugzilla key that expired, a report
 * from the last run about to be overwritten. This proves each prerequisite up front and exits
 * non-zero on a hard failure, so the run that follows can be trusted to have started clean.
 *
 * Read-only except for one thing: it copies `reports/REPORT.{json,md}` aside before they are
 * overwritten. It never prints a secret — key NAMES only.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({
  path: path.join(ROOT, '.env'),
  quiet: true,
});

const results = [];
const ok = (what, detail = '') => results.push({ level: 'ok', what, detail });
const warn = (what, detail = '') => results.push({ level: 'warn', what, detail });
const fail = (what, detail = '') => results.push({ level: 'fail', what, detail });
const env = (k) => (process.env[k] ?? '').trim();

// 1. The file exists and targets the live application.
if (!fs.existsSync(path.join(ROOT, '.env'))) {
  fail('.env is missing', 'copy .env.example to .env and fill it in');
} else {
  ok('.env present');
}
if (env('TEST_ENV') !== 'production') {
  fail(
    `TEST_ENV is "${env('TEST_ENV') || '(unset)'}"`,
    'the live-safety controls arm only on production',
  );
} else {
  ok('TEST_ENV=production (live-safety controls armed)');
}

// 2. Required keys — the KPost/KMail/UI runs cannot start without these.
const REQUIRED = [
  'BASE_URL',
  'KPOST_API_BASE_URL',
  'KMAIL_API_BASE_URL',
  'BUGZILLA_URL',
  'BUGZILLA_API_KEY',
  'QATEST1_KPOST_ID',
  'QATEST2_KPOST_ID',
  'QATEST3_KPOST_ID',
  'QATEST4_KPOST_ID',
  'QATEST5_KPOST_ID',
  'QATEST6_KPOST_ID',
  'QATEST_SHARED_PASSWORD',
];
const ADMIN_REQUIRED = [
  'ADMIN_API_BASE_URL',
  'QA_BUSINESS_M_KPOST_ID',
  'QA_BUSINESS_S_KPOST_ID',
  'QA_PASSWORD',
];
const missing = REQUIRED.filter((k) => !env(k));
if (missing.length) fail(`required keys empty: ${missing.join(', ')}`);
else ok(`all ${REQUIRED.length} required keys set`);
const adminMissing = ADMIN_REQUIRED.filter((k) => !env(k));
if (adminMissing.length)
  warn(`Admin runs need: ${adminMissing.join(', ')}`, 'KPost/KMail/UI runs are unaffected');
else ok('Admin account keys set');
if (env('WORKERS') && env('WORKERS') !== '1')
  warn(
    `WORKERS=${env('WORKERS')}`,
    'live runs must be serial (the named commands force --workers=1)',
  );
if (env('ALLOW_DESTRUCTIVE_TESTS') === 'true')
  warn(
    'ALLOW_DESTRUCTIVE_TESTS=true in .env',
    'grants nothing on production, but should not be the default',
  );
if (env('CONCURRENCY_PROBES') === 'true')
  warn(
    'CONCURRENCY_PROBES=true in .env',
    'concurrency is paused by owner directive (shared server)',
  );

// 3. Template drift — the framework test enforces it; this is the early warning.
const templateKeys = new Set(
  [
    ...fs
      .readFileSync(path.join(ROOT, '.env.example'), 'utf8')
      .matchAll(/(?:^|\s)([A-Z][A-Z0-9_]+)=/gm),
  ].map((m) => m[1]),
);
const realKeys = fs.existsSync(path.join(ROOT, '.env'))
  ? [...fs.readFileSync(path.join(ROOT, '.env'), 'utf8').matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map(
      (m) => m[1],
    )
  : [];
const undocumented = realKeys.filter((k) => !templateKeys.has(k));
if (undocumented.length)
  warn(`.env keys not in .env.example: ${undocumented.join(', ')}`, 'add them to the template');
else ok('.env.example documents every key in .env');

// 4. No other Playwright run in progress (the bash PID does not map to the Windows PID).
function runningPlaywright() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $_.ProcessId.ToString() + ' ' + $_.CommandLine }",
        ],
        { encoding: 'utf8' },
      );
      return out
        .split(/\r?\n/)
        .filter(
          (l) =>
            /playwright[\\/]cli\.js|playwright test|@playwright[\\/]test/i.test(l) &&
            !l.startsWith(`${process.pid} `),
        );
    }
    const out = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });
    return out
      .split('\n')
      .filter(
        (l) => /playwright/.test(l) && /test/.test(l) && !l.trim().startsWith(String(process.pid)),
      );
  } catch {
    return [];
  }
}
const running = runningPlaywright();
if (running.length)
  fail(
    `${running.length} Playwright process(es) already running`,
    'never start a run during a live run; wait or Stop-Process the real PID',
  );
else ok('no Playwright run in progress');

// 5. Hosts answer and Bugzilla accepts the key — plain reads, no login, nothing written.
async function probe(label, url, { hard } = { hard: true }) {
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    ok(`${label} answers`, `HTTP ${res.status}`);
  } catch (e) {
    (hard ? fail : warn)(`${label} does not answer`, e instanceof Error ? e.message : String(e));
  }
}
async function bugzilla() {
  const base = env('BUGZILLA_URL').replace(/\/+$/, '');
  if (!base) return;
  try {
    const v = await fetch(`${base}/version`, { signal: AbortSignal.timeout(10_000) });
    const vj = await v.json();
    ok('Bugzilla answers', `version ${vj.version ?? '?'}`);
  } catch (e) {
    fail('Bugzilla does not answer', e instanceof Error ? e.message : String(e));
    return;
  }
  if (!env('BUGZILLA_API_KEY')) return;
  // Bugzilla 5.2 has no `whoami` resource; an authenticated read validates the key the same way —
  // an invalid key is refused with error 306 before any query runs. One bug, one field, no write.
  try {
    const w = await fetch(
      `${base}/bug?limit=1&include_fields=id&api_key=${encodeURIComponent(env('BUGZILLA_API_KEY'))}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const wj = await w.json();
    if (wj.error) fail('Bugzilla rejects BUGZILLA_API_KEY', wj.message ?? `code ${wj.code}`);
    else ok('Bugzilla accepts the API key');
  } catch (e) {
    fail('Bugzilla key check failed', e instanceof Error ? e.message : String(e));
  }
}

// 6. Keep the last report: every run overwrites reports/REPORT.*.
function backupReports() {
  const dir = path.join(ROOT, 'reports');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const copied = [];
  for (const ext of ['json', 'md']) {
    const src = path.join(dir, `REPORT.${ext}`);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dir, `REPORT-before-${stamp}.${ext}`);
    fs.copyFileSync(src, dest);
    copied.push(path.basename(dest));
  }
  if (copied.length) ok('previous report backed up', copied.join(', '));
  else ok('no previous report to back up');
}

(async () => {
  await probe('KPost API host', env('KPOST_API_BASE_URL'));
  await probe('KMail API host', env('KMAIL_API_BASE_URL'));
  await probe('front end (BASE_URL)', env('BASE_URL'));
  await probe('Admin API host', env('ADMIN_API_BASE_URL'), { hard: false });
  await bugzilla();
  if (!results.some((r) => r.level === 'fail')) backupReports();

  const width = Math.max(...results.map((r) => r.what.length));
  console.log('\nPREFLIGHT — KPost test bench\n');
  for (const r of results) {
    const tag = r.level === 'ok' ? '  OK  ' : r.level === 'warn' ? ' WARN ' : ' FAIL ';
    console.log(`[${tag}] ${r.what.padEnd(width)}  ${r.detail}`);
  }
  const fails = results.filter((r) => r.level === 'fail').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  console.log(`\n${fails ? 'NOT READY' : 'READY'} — ${fails} failure(s), ${warns} warning(s).`);
  if (!fails)
    console.log(
      'Next: npm run product:<kpost-api|kmail-api|kpost-admin|kpost-ui>  (dry run), read reports/REPORT.md, then the :file variant.',
    );
  process.exit(fails ? 1 : 0);
})();
