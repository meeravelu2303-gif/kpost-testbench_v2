#!/usr/bin/env node
/**
 * Runs several bench suites one after another and keeps every suite's report.
 *
 *   node scripts/run-suites.cjs kpost kmail ui          (what `npm run all` does)
 *   node scripts/run-suites.cjs kpost:file kmail:file ui:file
 *
 * Why this exists instead of `npm run kpost && npm run kmail && npm run ui`:
 *
 *  1. A suite that FINDS defects exits non-zero (a finding is a failed test), so `&&` stopped the
 *     chain after the first suite with any finding — kmail and ui never ran. Here every suite runs
 *     regardless, and the exit code reports whether any of them failed.
 *  2. Every run writes `reports/REPORT.{md,json}`, so a chain kept only the LAST suite's report.
 *     Here each suite's report is copied to `reports/<suite>/` before the next one starts, and
 *     `reports/SUITES.md` indexes them.
 *
 * The suites stay SEQUENTIAL on purpose: they share the QA accounts, and an API login displaces the
 * UI session (single active session per account), so running them concurrently would be wrong.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPORTS = path.join(ROOT, 'reports');
const REPORT_FILES = ['REPORT.md', 'REPORT.json'];

const suites = process.argv.slice(2);
if (!suites.length) {
  console.error('usage: node scripts/run-suites.cjs <npm-script> [<npm-script> …]');
  process.exit(2);
}

/** `kpost:file` → `kpost-file`, a safe folder name. */
const folderFor = (script) => script.replace(/[^a-z0-9-]+/gi, '-');

function clearCurrentReport() {
  for (const file of REPORT_FILES) fs.rmSync(path.join(REPORTS, file), { force: true });
}

/** Copies this suite's report aside; returns the folder, or undefined when the run wrote none. */
function keepReport(script) {
  const present = REPORT_FILES.filter((file) => fs.existsSync(path.join(REPORTS, file)));
  if (!present.length) return undefined;
  const dir = path.join(REPORTS, folderFor(script));
  fs.mkdirSync(dir, { recursive: true });
  for (const file of present) fs.copyFileSync(path.join(REPORTS, file), path.join(dir, file));
  return path.relative(ROOT, dir).replace(/\\/g, '/');
}

/** The quality-gate verdict recorded in the suite's REPORT.json, when there is one. */
function gateOf(folder) {
  if (!folder) return 'no report written';
  try {
    const report = JSON.parse(fs.readFileSync(path.join(ROOT, folder, 'REPORT.json'), 'utf8'));
    return report.qualityGate?.passed ? 'passed' : 'failed (see report)';
  } catch {
    return 'unreadable REPORT.json';
  }
}

const results = [];
for (const script of suites) {
  console.log(`\n=== run-suites: npm run ${script} ===\n`);
  clearCurrentReport();
  const run = spawnSync('npm', ['run', script], { cwd: ROOT, stdio: 'inherit', shell: true });
  const exitCode = run.status ?? 1;
  const folder = keepReport(script);
  results.push({ script, exitCode, folder, gate: gateOf(folder) });
}

const lines = [
  '# Suite runs',
  '',
  `Generated ${new Date().toISOString()} by \`scripts/run-suites.cjs\`.`,
  '',
  '| Suite | Exit code | Quality gate | Report |',
  '| --- | ---: | --- | --- |',
  ...results.map(
    (r) =>
      `| \`${r.script}\` | ${r.exitCode} | ${r.gate} | ${r.folder ? `\`${r.folder}/REPORT.md\`` : '—'} |`,
  ),
  '',
];
fs.mkdirSync(REPORTS, { recursive: true });
fs.writeFileSync(path.join(REPORTS, 'SUITES.md'), lines.join('\n'));

console.log('\n=== run-suites: summary ===');
for (const r of results) {
  console.log(`  ${r.script.padEnd(14)} exit ${r.exitCode}  gate ${r.gate}  ${r.folder ?? ''}`);
}
console.log('  index: reports/SUITES.md');

process.exit(results.every((r) => r.exitCode === 0) ? 0 : 1);
