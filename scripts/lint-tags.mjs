// Tag governance — fails the run when the tag taxonomy is violated. Lists tests through Playwright
// (`--list --reporter=json`, which needs no live credentials and never writes the Bugzilla report),
// NOT by regexing source. Run as the first step of every run level, and in CI.
//
// Fails when an IN-SCOPE test:
//   - has neither @regression nor @quarantine;
//   - has no module tag;
//   - carries a tag not defined in src/config/constants.ts (TAGS) and not @bug-<number>;
//   - pushes @smoke over budget (default 3 per module per suite, override --budget=N);
// or when an Admin test is selected/tagged at all.
//
//   node scripts/lint-tags.mjs [--budget=3] [--sanity-budget=8] [--report]
//   --report also writes reports/tag-map.md (file → module tags → run-level tags + per-module counts).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { MODULE_TAGS, isValidTag } = await import(
  pathToFileURL(path.join(ROOT, 'src/config/tags.ts')).href
);
// The in-scope filter is shared with the runner (one definition of what counts), so counts agree.
const { isAdminPath, isAdminTags, isMetaPath, isMetaTags, suiteOf, normalizeTags, RUN_LEVELS } =
  await import(pathToFileURL(path.join(ROOT, 'scripts/test-scope.mjs')).href);
const WANT_REPORT = process.argv.includes('--report');
const BUDGET = Number(
  (process.argv.find((a) => a.startsWith('--budget=')) || '').split('=')[1] || 3,
);
const SANITY_BUDGET = Number(
  (process.argv.find((a) => a.startsWith('--sanity-budget=')) || '').split('=')[1] || 8,
);

const modules = new Set(MODULE_TAGS); // e.g. '@katchup'

// 1) List every test as JSON (reporter override => no Bugzilla write; no server contact).
// Single command string under a shell (args are fixed + safe) to avoid Node's shell+args warning.
const res = spawnSync('npx playwright test --list --reporter=json', {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: true,
});
if (res.status !== 0 && !res.stdout) {
  console.error('lint:tags — could not list tests:\n', res.stderr || res.error);
  process.exit(2);
}
let report;
try {
  report = JSON.parse(res.stdout);
} catch {
  console.error('lint:tags — Playwright did not emit valid JSON. stderr:\n', res.stderr);
  process.exit(2);
}

// 2) Flatten specs (dedupe the same spec across browser projects by file+title).
const seen = new Map();
const walk = (suite) => {
  for (const sp of suite.specs || []) {
    const key = `${sp.file}::${sp.title}`;
    if (seen.has(key)) continue;
    const anns = (sp.tests || []).flatMap((t) => t.annotations || []);
    seen.set(key, { file: sp.file, title: sp.title, tags: normalizeTags(sp.tags), anns });
  }
  for (const c of suite.suites || []) walk(c);
};
for (const s of report.suites || []) walk(s);

// 3) Validate.
const errors = [];
const warnings = []; // non-fatal: in-scope tests with no requirement/non-functional annotation
const REQ_ID_RE = /\b(?:FR|BR|NFR)-[A-Z0-9][A-Z0-9-]*\b/;
const smokeCount = {}; // `${module}|${suite}` -> count
const sanityCount = {}; // `${module}|${suite}` -> count
const fileMap = new Map(); // file -> { modules:Set, levels:Set, count }
const moduleCount = {}; // module -> total in-scope tests
let inScope = 0;
for (const { file, title, tags, anns } of seen.values()) {
  if (isMetaPath(file) || isMetaTags(tags)) continue;
  if (isAdminPath(file) || isAdminTags(tags)) {
    // Admin is out of scope and left untouched. Only a problem if it leaked a RUN-LEVEL tag, which
    // would pull it into smoke/sanity/regression.
    const leaked = RUN_LEVELS.filter((t) => tags.includes(t));
    if (leaked.length)
      errors.push(
        `ADMIN test leaked into a run level (${leaked.join(',')}): ${path.basename(file)} › ${title}`,
      );
    continue;
  }
  inScope += 1;
  const where = `${path.basename(file)} › ${title.slice(0, 60)}`;
  // Governance (WARN, not error for now): every in-scope test should carry a requirement or
  // non-functional annotation (an FR id in the title counts as a requirement link).
  const annTypes = (anns || []).map((a) => a.type);
  if (
    !annTypes.includes('requirement') &&
    !annTypes.includes('requirement-partial') &&
    !annTypes.includes('non-functional') &&
    !REQ_ID_RE.test(title)
  )
    warnings.push(where);
  if (!tags.includes('@regression') && !tags.includes('@quarantine'))
    errors.push(`no @regression / @quarantine: ${where}`);
  if (!tags.some((t) => modules.has(t))) errors.push(`no module tag: ${where}`);
  for (const t of tags) if (!isValidTag(t)) errors.push(`unknown tag "${t}": ${where}`);
  const suite = suiteOf(file);
  const mods = tags.filter((t) => modules.has(t));
  if (tags.includes('@smoke'))
    for (const m of mods) smokeCount[`${m}|${suite}`] = (smokeCount[`${m}|${suite}`] || 0) + 1;
  if (tags.includes('@sanity'))
    for (const m of mods) sanityCount[`${m}|${suite}`] = (sanityCount[`${m}|${suite}`] || 0) + 1;
  for (const m of mods) moduleCount[m] = (moduleCount[m] || 0) + 1;
  const fm = fileMap.get(file) || { modules: new Set(), levels: new Set(), count: 0 };
  mods.forEach((m) => fm.modules.add(m));
  RUN_LEVELS.filter((l) => tags.includes(l)).forEach((l) => fm.levels.add(l));
  fm.count += 1;
  fileMap.set(file, fm);
}

// 3b) Optional tag-map report for human review of the classification.
if (WANT_REPORT) {
  const out = [];
  out.push(
    '# Tag map',
    '',
    `Generated by \`npm run lint:tags -- --report\` · ${inScope} in-scope tests.`,
    '',
  );
  out.push('## Per-module totals', '', '| Module | In-scope tests |', '|---|---|');
  for (const [m, n] of Object.entries(moduleCount).sort()) out.push(`| ${m} | ${n} |`);
  out.push(
    '',
    '## Per-file classification',
    '',
    '| File | Module tag(s) | Run level(s) | Tests |',
    '|---|---|---|---|',
  );
  for (const f of [...fileMap.keys()].sort()) {
    const fm = fileMap.get(f);
    out.push(
      `| ${f} | ${[...fm.modules].join(', ') || '—'} | ${[...fm.levels].join(', ') || '—'} | ${fm.count} |`,
    );
  }
  const dir = path.join(ROOT, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tag-map.md'), out.join('\n') + '\n', 'utf8');
  console.log(`tag-map written to reports/tag-map.md (${fileMap.size} files).`);
  // Regenerate the RTM from the same listing (annotation-driven).
  try {
    const { generateRtm } = await import(
      pathToFileURL(path.join(ROOT, 'scripts/rtm-lib.mjs')).href
    );
    const r = await generateRtm({ report, root: ROOT });
    console.log(
      `rtm written to reports/rtm.xlsx — verified coverage ${r.covered}/${r.inScopeReqs} = ${r.overall}% ` +
        `(${r.covPass} covered & passing); ${r.partial} partial; orphans ${r.orphanTests} tests / ${r.orphanFiles} files; ` +
        `review links ${r.reviewPending} (${r.reviewMedium} medium / ${r.reviewLow} low).`,
    );
    if (r.unknownIds)
      console.warn(
        `WARN — ${r.unknownIds} requirement annotation(s) name an id with no RTM row (see the ` +
          `"Unknown links" sheet): ${[...new Set(r.unknownRows.map((u) => u['Annotation id']))].join(', ')}`,
      );
  } catch (e) {
    console.error('rtm generation skipped:', e.message);
  }
}

// 4) Budgets: smoke (default 3) and sanity (default 8) per module per suite.
for (const [k, n] of Object.entries(smokeCount)) {
  if (n > BUDGET)
    errors.push(`smoke budget exceeded: ${k.replace('|', ' / ')} has ${n} @smoke (max ${BUDGET})`);
}
for (const [k, n] of Object.entries(sanityCount)) {
  if (n > SANITY_BUDGET)
    errors.push(
      `sanity budget exceeded: ${k.replace('|', ' / ')} has ${n} @sanity (max ${SANITY_BUDGET})`,
    );
}

// 5) Report.
console.log(
  `lint:tags — ${inScope} in-scope tests checked; smoke budget ${BUDGET}, sanity budget ${SANITY_BUDGET} /module/suite.`,
);
if (Object.keys(smokeCount).length)
  console.log('smoke by module/suite:', JSON.stringify(smokeCount));
if (Object.keys(sanityCount).length)
  console.log('sanity by module/suite:', JSON.stringify(sanityCount));
if (warnings.length)
  console.warn(
    `\nWARN — ${warnings.length} in-scope test(s) have no requirement/non-functional annotation ` +
      `(governance warning, not a failure). Run with --report for the RTM + Review-links sheet.`,
  );
if (errors.length) {
  // Group by the file (last path segment before ' › ') for a readable triage summary.
  const byFile = {};
  for (const e of errors) {
    const m = e.match(/: ([^›]+?\.(?:spec|ts)) ›/) || e.match(/: ([^›]+?\.ts) /);
    const f = m ? m[1].trim() : '(other)';
    byFile[f] = (byFile[f] || 0) + 1;
  }
  console.error(`\nFAILED — ${errors.length} violation(s). By file:`);
  for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1]))
    console.error(`  ${n.toString().padStart(4)}  ${f}`);
  if (process.argv.includes('--raw')) {
    console.error('\n--- raw ---');
    for (const e of errors) console.error('  ✗ ' + e);
  }
  process.exit(1);
}
console.log('OK — all tags valid.');
