#!/usr/bin/env node
/**
 * Runs every product in turn, whatever the previous one returned (a found bug exits 1, which
 * stopped an `a && b` chain); exits non-zero if any failed. Each product's report is archived.
 *
 *   node scripts/run-products.mjs          # preview every product (dry run, files nothing)
 *   node scripts/run-products.mjs --file   # every product, filing to Bugzilla
 */
import { spawnSync } from 'node:child_process';

const PRODUCTS = ['kpost-api', 'kmail-api', 'kpost-admin', 'kpost-ui', 'kpost-admin-ui'];
const file = process.argv.includes('--file');
const results = [];

for (const product of PRODUCTS) {
  const script = `product:${product}${file ? ':file' : ''}`;
  console.log(`\n=== ${script} ===\n`);
  const started = Date.now();
  const run = spawnSync('npm', ['run', script], { stdio: 'inherit', shell: true });
  results.push({
    script,
    code: run.status ?? 1,
    minutes: Math.round((Date.now() - started) / 60_000),
  });
}

console.log('\n=== product:all summary ===');
for (const { script, code, minutes } of results)
  console.log(
    `  ${code === 0 ? 'all passed  ' : 'had failures'}  ${script.padEnd(30)} ${minutes} min`,
  );
console.log('  Reports: reports/REPORT.md (last product) and reports/history/ (each product).');
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
