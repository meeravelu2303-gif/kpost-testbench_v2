// Runs the bench's Patrol tests (mobile/patrol_test) on the running emulator or a USB phone, against the
// app copy that `npm run mobile:prepare` built (docs/proposals/mobile-testing.md). Never files bugs.
//
//   npm run mobile:test                                    every test
//   npm run mobile:test -- --target login_test.dart        one file
//   npm run mobile:test -- --device emulator-5554          a chosen device
//
// The phone signs in as qatest7 (no Playwright run uses it, so neither kicks the other's session) and
// qatest8 is the second user, driven over the API from inside the test. Account values reach the test
// through a defines file in the gitignored copy, deleted after the run, never on a command line.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const COPY = path.join(ROOT, 'mobile', '.app');
const APP = path.join(COPY, 'kpost');
const TESTS = path.join(ROOT, 'mobile', 'patrol_test');
const QA_HOSTS = new Set(['192.168.0.100']);

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

function fail(message, code = 1) {
  console.error(`mobile:test: ${message}`);
  process.exit(code);
}

const run = (command, commandArgs, options = {}) =>
  spawnSync(command, commandArgs, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options,
  });

// ---- Preconditions: the copy, its servers, the tools, a device
const stampFile = path.join(COPY, 'BENCH_SOURCE.json');
if (!fs.existsSync(stampFile)) fail('no app copy yet: run `npm run mobile:prepare` first');
const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
for (const url of [stamp.kpost, stamp.kmail]) {
  if (!QA_HOSTS.has(new URL(url).hostname)) fail(`the copy calls ${url}; re-run mobile:prepare`);
}
if (run('patrol', ['--version']).status !== 0) {
  fail(
    'patrol is not on PATH: run `npm run mobile:setup` (after office hours), then open a new terminal',
  );
}
const devices = (run('adb', ['devices']).stdout ?? '')
  .split('\n')
  .filter((line) => /\tdevice\s*$/.test(line))
  .map((line) => line.split('\t')[0]);
if (!devices.length)
  fail('no emulator or phone connected: start one with `emulator -avd kpost_api36`', 4);

const env = (name) => process.env[name] || fail(`${name} is not set in .env`);
const accessCode = env('QATEST7_ACCESS_CODE');
if (!/^\d{4}$/.test(accessCode)) fail('QATEST7_ACCESS_CODE must be the 4-digit app access code');

// ---- The tests, fresh from the bench (no full prepare needed after editing a test)
fs.rmSync(path.join(APP, 'patrol_test'), { recursive: true, force: true });
fs.cpSync(TESTS, path.join(APP, 'patrol_test'), { recursive: true });

const definesFile = path.join(COPY, 'bench-defines.json');
fs.writeFileSync(
  definesFile,
  JSON.stringify({
    BENCH_KPOST_ID: env('QATEST7_KPOST_ID'),
    BENCH_PASSWORD: env('QATEST_SHARED_PASSWORD'),
    BENCH_ACCESS_CODE: accessCode,
    BENCH_PEER_ID: env('QATEST8_KPOST_ID'),
    BENCH_PEER_PASSWORD: env('QATEST_SHARED_PASSWORD'),
    BENCH_KPOST_API: stamp.kpost,
  }),
  'utf8',
);

const target = option('--target');
const device = option('--device') ?? devices[0];
const patrolArgs = [
  'test',
  `--dart-define-from-file=${definesFile}`,
  '--device',
  device,
  '--record-video',
  ...(target ? ['--target', path.join('patrol_test', target)] : []),
];
console.log(`mobile:test: ${stamp.branch} @ ${stamp.commit} on ${device}, KPost ${stamp.kpost}`);
try {
  const result = run('patrol', patrolArgs, { cwd: APP, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(definesFile, { force: true });
}
