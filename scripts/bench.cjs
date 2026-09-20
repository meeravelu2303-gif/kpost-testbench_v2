#!/usr/bin/env node
/**
 * The unified Test Bench runner — one entry point for every named run profile.
 *
 *   npm run bench -- --profile kpost
 *   npm run bench -- --profile kpost --file          # arm bug filing for THIS run
 *   npm run bench -- --profile framework --workers 4
 *   npm run bench -- --profile kmail --grep @kmail-read -- --headed
 *   npm run bench -- --list-profiles
 *
 * What it does, and deliberately does not do:
 *
 *  - It ORCHESTRATES the existing infrastructure: it resolves a profile, checks the request is
 *    coherent, then execs Playwright. It contains no test-execution logic of its own — the projects,
 *    tag filter, workers and flags are applied by `playwright.config.ts` and `src/config/env.ts`
 *    from the SAME registry (config/run-profiles.json), so there is one source of truth.
 *  - It never relaxes a safety control. Filing can only be armed here because arming from the
 *    command is exactly what Phase 1 requires; a profile marked `filing: never` refuses `--file`.
 *  - The host/target check lives in `assertTargetAllowed` (src/config/run-profiles.ts) and runs when
 *    the configuration loads — before a single test executes.
 *
 * Legacy commands (`npm run kpost`, `kmail`, `admin`, `ui`, `all`, …) are unchanged and keep working
 * exactly as before; a framework guard proves each one resolves to the same environment as its
 * profile, so the two cannot drift.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY = require(path.join(ROOT, 'config', 'run-profiles.json'));
const PROFILES = REGISTRY.profiles;
const NAMES = Object.keys(PROFILES).sort();

const USAGE = `
Usage: npm run bench -- --profile <name> [options] [-- <playwright args>]

Options:
  --profile <name>   the run profile (required unless --list-profiles)
  --file             arm bug filing for this run (refused for profiles that may never file)
  --workers <n>      request N workers; refused above what the profile has been proven safe for
  --grep <pattern>   additional tag/name filter, overriding the profile's own
  --list-profiles    print the profiles and exit
  --print            print the command that would run, and exit (no tests are executed)
  -h, --help         this message

Profiles:
${NAMES.map((name) => `  ${name.padEnd(12)} ${PROFILES[name].description}`).join('\n')}

Legacy commands (npm run kpost | kmail | admin | ui | all | resolve) continue to work unchanged.
`.trim();

function fail(message) {
  console.error(`\n[bench] ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { passthrough: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const needsValue = (name) => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) fail(`${name} needs a value.`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--profile':
        options.profile = needsValue('--profile');
        break;
      case '--workers':
        options.workers = needsValue('--workers');
        break;
      case '--grep':
        options.grep = needsValue('--grep');
        break;
      case '--file':
        options.file = true;
        break;
      case '--list-profiles':
        options.listProfiles = true;
        break;
      case '--print':
        options.print = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--':
        options.passthrough.push(...argv.slice(i + 1));
        i = argv.length;
        break;
      default:
        // Anything else is passed to Playwright verbatim (--headed, --last-failed, a file filter…).
        options.passthrough.push(arg);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

if (options.listProfiles) {
  for (const name of NAMES) {
    const p = PROFILES[name];
    const workers =
      p.execution.mode === 'sequential' ? 'sequential' : `up to ${p.execution.maxWorkers} workers`;
    console.log(
      `${name.padEnd(12)} ${p.description}\n${''.padEnd(12)} ` +
        `[target: ${p.targetKind} · ${workers} · filing: ${p.filing} · cleanup: ${p.cleanup}]`,
    );
  }
  process.exit(0);
}

if (!options.profile) fail(`--profile is required.\n\n${USAGE}`);

const profile = PROFILES[options.profile];
if (!profile) {
  fail(`Unknown profile "${options.profile}".\nKnown profiles: ${NAMES.join(', ')}.`);
}

// Filing is a property of the MODE first: a profile that may never file cannot be talked into it.
if (options.file && profile.filing === 'never') {
  fail(
    `Profile "${options.profile}" never files bugs (${profile.description}). ` +
      'Remove --file, or choose a profile whose filing is "command-armed".',
  );
}
if (options.file && profile.filing === 'resolve-only') {
  fail(
    `Profile "${options.profile}" only RESOLVES bugs it verifies fixed and files nothing new, ` +
      'so --file does not apply to it.',
  );
}

// Refused, never clamped: a request above the proven ceiling means an untrue belief about isolation.
let workers;
if (options.workers !== undefined) {
  workers = Number(options.workers);
  if (!Number.isInteger(workers) || workers < 1) {
    fail(`--workers must be a positive integer (got "${options.workers}").`);
  }
  if (workers > profile.execution.maxWorkers) {
    fail(
      `Profile "${options.profile}" is proven safe up to ${profile.execution.maxWorkers} worker(s); ` +
        `${workers} requested.` +
        (profile.execution.mode === 'sequential'
          ? ' This mode is SEQUENTIAL: the QA accounts are shared and single-session, and account' +
            ' isolation does not exist yet (planned — docs/PHASE-2-DESIGN.md §5).'
          : ''),
    );
  }
}

const args = ['playwright', 'test'];
if (profile.testFilter) args.push(profile.testFilter);
if (options.grep) args.push('--grep', options.grep);
// Always explicit, so the run is never at the mercy of a machine's WORKERS value.
args.push(`--workers=${workers ?? 1}`);
args.push(...options.passthrough);

const childEnv = { ...process.env, RUN_PROFILE: options.profile };
if (options.file) {
  // Arming filing from the COMMAND is the only way Phase 1 allows (src/config/env.ts).
  childEnv.BUGZILLA_DRY_RUN = 'false';
  childEnv.BUGZILLA_AUTO_RESOLVE = 'true';
} else if (profile.filing !== 'resolve-only') {
  childEnv.BUGZILLA_DRY_RUN = 'true';
}

const banner =
  `[bench] profile "${options.profile}" · target ${profile.targetKind} · ` +
  `projects ${profile.projects.join(', ')} · workers ${workers ?? 1} · ` +
  `filing ${options.file ? 'ARMED (--file)' : profile.filing === 'resolve-only' ? 'resolve-only' : 'dry run'}`;

if (options.print) {
  console.log(banner);
  console.log(`[bench] would run: npx ${args.join(' ')}`);
  process.exit(0);
}

console.log(banner);
const result = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit', shell: true, env: childEnv });
// Propagate the real outcome: a signal death is a failure, not a pass.
process.exit(result.status === null ? 1 : result.status);
