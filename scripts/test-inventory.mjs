// Writes tests/README.md: how many products, test types, files and tests the bench has, from the real
// test tree. The layout itself is declared in src/config/test-layout.ts and enforced by
// tests/framework/layout/test-layout.spec.ts.
//
//   npm run tests:inventory              lists every test with Playwright (`--list`, nothing runs) and counts
//   npm run tests:inventory -- --files   file counts only (no Playwright; test counts left as they were)
//
// Playwright tests are counted with the FULL-profile flags of the product commands, so the engine's
// generated tests (one per endpoint × validator) are included. UI tests are counted once (Chromium);
// each extra browser runs the same tests again. Mobile tests are the `patrolTest(` calls in each file.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = path.join(ROOT, 'tests');
const README = path.join(TESTS, 'README.md');
/** Tests per file, kept beside the other generated ledgers (the README shows the totals). */
const COUNTS = path.join(ROOT, 'docs', 'generated', 'test-inventory.json');
const { TEST_PRODUCTS, TEST_INFRA_DIRS, FRAMEWORK_AREAS } = await import(
  pathToFileURL(path.join(ROOT, 'src/config/test-layout.ts')).href
);
const filesOnly = process.argv.includes('--files');

const rel = (full) => path.relative(TESTS, full).split(path.sep).join('/');
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name.endsWith('-snapshots') ? [] : filesUnder(full);
    return [rel(full)];
  });
}

/** Rule 1: never run Playwright while another run is in progress (the editor's test server is fine). */
function liveRun() {
  if (process.platform !== 'win32') return false;
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'playwright.*\\stest(\\s|$)' -and $_.CommandLine -notmatch 'test-server|--list' } | Measure-Object | Select-Object -ExpandProperty Count",
    ],
    { encoding: 'utf8' },
  );
  return Number(ps.stdout.trim() || 0) > 0;
}

/** Tests per spec file (`<product>/<path>` relative to tests/), from `playwright test --list`. */
function listCounts() {
  if (liveRun()) {
    console.error('tests:inventory: a Playwright run is in progress; try again when it ends.');
    process.exit(2);
  }
  const out = path.join(os.tmpdir(), `kpost-inventory-${process.pid}.json`);
  const fd = fs.openSync(out, 'w');
  const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  const res = spawnSync(
    process.execPath,
    [
      cli,
      'test',
      '--list',
      '--reporter=json',
      ...['api', 'chromium', 'admin-ui', 'framework'].map((p) => `--project=${p}`),
    ],
    {
      cwd: ROOT,
      stdio: ['ignore', fd, 'pipe'],
      encoding: 'utf8',
      env: {
        ...process.env,
        VALIDATION_PROFILE: 'FULL',
        WRITE_FUZZ: 'true',
        TEST_DB_MODE: 'true',
        ALLOW_DESTRUCTIVE_TESTS: 'true',
        CONCURRENCY_PROBES: 'false',
        QATEST_ONLY: 'true',
        BUGZILLA_DRY_RUN: 'true',
      },
    },
  );
  fs.closeSync(fd);
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(out, { force: true });
  if (res.status !== 0 || report.errors?.length) {
    console.error(
      'tests:inventory: playwright --list failed',
      res.stderr?.slice(0, 2000),
      report.errors,
    );
    process.exit(1);
  }
  const counts = {};
  const walk = (suite, file) => {
    for (const spec of suite.specs || [])
      for (const t of spec.tests || [])
        if (t.projectName !== 'setup') counts[file] = (counts[file] || 0) + 1;
    for (const child of suite.suites || []) walk(child, file);
  };
  for (const s of report.suites || []) walk(s, s.file.replace(/\\/g, '/'));
  return counts;
}

/** The counts recorded last time, when only file counts are refreshed. */
function previousCounts() {
  return fs.existsSync(COUNTS) ? JSON.parse(fs.readFileSync(COUNTS, 'utf8')).tests : {};
}

const testCounts = filesOnly ? previousCounts() : listCounts();
for (const file of filesUnder(path.join(TESTS, 'kpost-mobile')).filter((f) =>
  f.endsWith('_test.dart'),
))
  testCounts[file] = (
    fs.readFileSync(path.join(TESTS, file), 'utf8').match(/\bpatrolTest\(/g) || []
  ).length;

// ---- Aggregate: product → type → { files, tests, modules }
const fmt = (n) => n.toLocaleString('en-IN');
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
const inventoryFiles = {};
const products = TEST_PRODUCTS.map((product) => {
  const files = filesUnder(path.join(TESTS, product.dir)).filter((f) => product.testFile.test(f));
  const types = product.types
    .filter((t) => t.kind !== 'support')
    .map((type) => {
      const mine = files.filter((f) => f.split('/')[1] === type.dir);
      const modules = new Map();
      for (const f of mine) {
        const mod = type.byModule ? f.split('/')[2] : '';
        const m = modules.get(mod) || { files: 0, tests: 0 };
        m.files += 1;
        m.tests += testCounts[f] || 0;
        modules.set(mod, m);
      }
      if (mine.length) inventoryFiles[`${product.dir}/${type.dir}`] = mine.length;
      return {
        ...type,
        files: mine.length,
        tests: mine.reduce((n, f) => n + (testCounts[f] || 0), 0),
        modules: [...modules.entries()].sort(([a], [b]) => a.localeCompare(b)),
      };
    })
    .filter((t) => t.files);
  const live = types.filter((t) => t.kind !== 'excluded');
  return {
    ...product,
    types,
    files: live.reduce((n, t) => n + t.files, 0),
    tests: live.reduce((n, t) => n + t.tests, 0),
    excludedFiles: types.filter((t) => t.kind === 'excluded').reduce((n, t) => n + t.files, 0),
  };
});
const frameworkFiles = filesUnder(path.join(TESTS, 'framework')).filter((f) =>
  f.endsWith('.spec.ts'),
);
const areas = FRAMEWORK_AREAS.map((a) => {
  const mine = frameworkFiles.filter((f) => f.split('/')[1] === a.dir);
  return { ...a, files: mine.length, tests: mine.reduce((n, f) => n + (testCounts[f] || 0), 0) };
});
const total = {
  files: products.reduce((n, p) => n + p.files, 0),
  tests: products.reduce((n, p) => n + p.tests, 0),
  types: new Set(
    products.flatMap((p) => p.types.filter((t) => t.kind !== 'excluded').map((t) => t.dir)),
  ).size,
};
const runner = {
  'playwright-api': 'Playwright (API)',
  'playwright-ui': 'Playwright (browser)',
  patrol: 'Patrol (Android phone)',
};

// ---- README
const L = [];
const today = new Date().toISOString().slice(0, 10);
L.push('# tests/ — what the KPost Test Bench tests', '');
L.push(
  `> Generated by \`npm run tests:inventory\` on ${today}. Do not edit by hand. The layout is declared in`,
  '> `src/config/test-layout.ts` and enforced by `tests/framework/layout/test-layout.spec.ts`.',
  '',
);
L.push('## At a glance', '');
L.push('| Products | Test types | Test files | Tests |', '| ---: | ---: | ---: | ---: |');
L.push(`| ${products.length} | ${total.types} | ${fmt(total.files)} | ${fmt(total.tests)} |`, '');
L.push(
  'Tests are counted the way the product commands run them (FULL profile): the API engine generates one',
  'test per endpoint × validator. UI tests are counted once; each browser (Chromium, Firefox, WebKit) runs',
  `them again. Excluded tests (KDoc/KOS and concurrency, out of scope) are not counted. The bench's own`,
  `self-tests are listed separately below.`,
  '',
);
L.push('## Products', '');
L.push('| Folder | Bugzilla product | Runs with | Test types | Test files | Tests |');
L.push('| --- | --- | --- | ---: | ---: | ---: |');
for (const p of products)
  L.push(
    `| [\`${p.dir}/\`](${p.dir}/) | ${p.bugzilla} | ${runner[p.runner]} | ${p.types.filter((t) => t.kind !== 'excluded').length} | ${fmt(p.files)} | ${fmt(p.tests)} |`,
  );
L.push(`| **Total** | | | | **${fmt(total.files)}** | **${fmt(total.tests)}** |`, '');

L.push('## The tree', '', '```');
L.push('tests/');
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));
products.forEach((p, i) => {
  L.push(
    `├── ${pad(`${p.dir}/`, 22)}${p.bugzilla} · ${plural(p.files, 'file')} · ${plural(p.tests, 'test')}`,
  );
  const hasSupport = fs.existsSync(path.join(TESTS, p.dir, 'support'));
  const rows = [...p.types, ...(hasSupport ? [{ dir: 'support', support: true }] : [])];
  rows.forEach((t, j) => {
    const branch = j === rows.length - 1 ? '└' : '├';
    if (t.support) return L.push(`│   ${branch}── support/`);
    const what =
      t.kind === 'excluded'
        ? `${plural(t.files, 'file')} · not collected`
        : `${plural(t.files, 'file')} · ${plural(t.tests, 'test')}`;
    const mods = t.modules.map(([m]) => m).filter(Boolean);
    L.push(
      `│   ${branch}── ${pad(`${t.dir}/`, 18)}${what}${mods.length ? `  (${mods.join(', ')})` : ''}`,
    );
  });
  if (i < products.length - 1) L.push('│');
});
L.push('│');
for (const [i, d] of TEST_INFRA_DIRS.entries())
  L.push(
    `${i === TEST_INFRA_DIRS.length - 1 ? '└' : '├'}── ${pad(`${d.dir}/`, 22)}${d.holds.replace(/`/g, '')}`,
  );
L.push('```', '');

for (const p of products) {
  L.push(`## ${p.bugzilla} — \`tests/${p.dir}/\``, '');
  L.push(`${fmt(p.files)} test files, ${fmt(p.tests)} tests.`, '');
  L.push(
    '| Type | What it proves | Files | Tests | Modules (files) |',
    '| --- | --- | ---: | ---: | --- |',
  );
  for (const t of p.types) {
    const mods = t.modules
      .filter(([m]) => m)
      .map(([m, c]) => `${m} (${c.files})`)
      .join(', ');
    const tests = t.kind === 'excluded' ? 'not collected' : fmt(t.tests);
    L.push(
      `| [\`${t.dir}/\`](${p.dir}/${t.dir}/) | ${t.holds} | ${t.files} | ${tests} | ${mods || '—'} |`,
    );
  }
  L.push('');
}

L.push("## The bench's own self-tests — `tests/framework/`", '');
L.push(
  `${frameworkFiles.length} files, ${fmt(areas.reduce((n, a) => n + a.tests, 0))} tests. No KPost server is called; \`npm run framework\`.`,
  '',
);
L.push('| Area | What it checks | Files | Tests |', '| --- | --- | ---: | ---: |');
for (const a of areas.filter((x) => x.files))
  L.push(`| [\`${a.dir}/\`](framework/${a.dir}/) | ${a.holds} | ${a.files} | ${fmt(a.tests)} |`);
L.push('');

L.push('## Where a new test goes', '');
L.push(
  '1. **Product** = the Bugzilla product its bugs are filed to (the table above).',
  '2. **Type** = what the test proves (the type tables above). Smoke and sanity are run levels, chosen by tag.',
  '3. **Module** = the KPost module (`katchup/`, `kall/`, `profile/`, …) for KPost API, KPost UI and mobile;',
  '   cross-module checks go in `platform/`. KMail API, KPost Admin and the Admin UI are flat inside a type.',
  '4. **File name**: KPost API `<module>-<what>.spec.ts`; UI `<module>-<area>-<type>.spec.ts` (the name ends',
  "   in its type folder); mobile `<flow>_test.dart`. Helpers go in the product's `support/`.",
  '5. Run `npm run tests:inventory` to refresh this page (the layout self-test fails until you do).',
  '',
  "**UI bug tags:** a UI bug's Bugzilla tag is hashed from its spec path. When a UI spec moves or is renamed,",
  'add `"<new path>": "<old path>"` to `src/bug-tracker/findings/ui-spec-renames.json` so its bugs keep',
  'their tags (`uiFingerprintPath`). Run tests through the product commands in `docs/guides/commands.md`.',
  '',
);
const recordedTests = Object.fromEntries(
  Object.entries(testCounts).sort(([a], [b]) => a.localeCompare(b)),
);
L.push(
  `<!-- inventory-files: ${JSON.stringify(Object.fromEntries(Object.entries(inventoryFiles).sort()))} -->`,
);
L.push('');
fs.writeFileSync(README, L.join('\n'), 'utf8');
fs.writeFileSync(
  COUNTS,
  JSON.stringify({ generated: today, tests: recordedTests }, null, 1) + '\n',
  'utf8',
);
// The README is checked by prettier with every other hand-kept doc.
spawnSync(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'prettier', 'bin', 'prettier.cjs'), '--write', README],
  { cwd: ROOT, stdio: 'ignore' },
);
console.log(
  `tests/README.md: ${products.length} products, ${total.types} test types, ${fmt(total.files)} test files, ${fmt(total.tests)} tests` +
    (filesOnly ? ' (test counts from the previous inventory)' : ''),
);
