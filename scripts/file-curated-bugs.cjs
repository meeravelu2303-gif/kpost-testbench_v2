#!/usr/bin/env node
'use strict';

/**
 * `npm run bugs:file:kpost` — the curated KPost API filing command.
 *
 * It files ONLY the canonical defects a person approved in
 * `reports/bugs/KPOST-API-FILING-MANIFEST.json`. It is deliberately NOT the broad `kpost:file`
 * command: that one derives its population from the run and would create every candidate clearing
 * the validity gate.
 *
 * ## What this wrapper is responsible for
 *
 * Only the environment and the exec. All the filing logic lives in
 * `src/bug-tracker/curated/`, driven by `tests/filing/curated-filing.spec.ts` — Playwright is how
 * TypeScript runs in this repository, and this mirrors `bench.cjs`.
 *
 * ## The two safety properties it guarantees
 *
 *   1. **Dry-run unless explicitly armed.** `--file` is required; without it the run previews.
 *      `--force-dry-run` overrules `--file`, so an environment accidentally configured for live
 *      filing can always be neutralised from the command line.
 *   2. **Auto-resolution off, unconditionally.** `BUGZILLA_AUTO_RESOLVE=false` is set here whatever
 *      the surrounding environment says. It is belt-and-braces: the curated filer contains no
 *      resolve, close or reopen code at all, and a framework guard asserts that against its source.
 */

const { spawnSync } = require('node:child_process');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

if (has('--help') || has('-h')) {
  process.stdout.write(
    [
      'Usage: npm run bugs:file:kpost [-- --file] [-- --force-dry-run]',
      '',
      '  (no flags)         DRY RUN — previews what would be filed, writes nothing to Bugzilla.',
      '  --file             ARM real filing. Creates the approved tickets.',
      '  --force-dry-run    Overrules --file. Use when unsure what the environment is set to.',
      '',
      'Population: reports/bugs/KPOST-API-FILING-MANIFEST.json, records marked READY_FOR_BUGZILLA.',
      'This command never resolves, closes or reopens a bug.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const forced = has('--force-dry-run');
const armed = has('--file') && !forced;

const env = {
  ...process.env,
  // Auto-resolution is impossible on this path; this makes it explicit to anyone reading a run log.
  BUGZILLA_AUTO_RESOLVE: 'false',
  BUGZILLA_RESOLVE_ONLY: 'false',
  BUGZILLA_DRY_RUN: armed ? 'false' : 'true',
  CURATED_FILING_ARMED: armed ? 'true' : 'false',
  CURATED_FILING_FORCE_DRY_RUN: forced ? 'true' : 'false',
};

process.stdout.write(
  `curated KPost API filing · ${armed ? 'ARMED — tickets WILL be created' : 'DRY RUN — nothing will be written'}` +
    `${forced ? ' (forced by --force-dry-run)' : ''}\n`,
);

// `shell: true` because on Windows npx is a .cmd, which spawnSync cannot exec directly.
const result = spawnSync(
  'npx',
  ['playwright', 'test', '--project=filing', '--workers=1', '--reporter=list'],
  { stdio: 'inherit', env, shell: true },
);

if (result.error) {
  process.stderr.write(`failed to start Playwright: ${result.error.message}\n`);
  process.exit(1);
}
// A signal death is a failure, never a pass.
process.exit(result.status === null ? 1 : result.status);
