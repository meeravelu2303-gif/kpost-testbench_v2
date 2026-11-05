// Phone screenshots for `npm run mobile:test`, so a mobile bug is filed with proof like a browser one.
// A Patrol test records only what it asserts, and the realme C55 refuses screen recording, so the
// runner watches the phone's log instead: each `BENCH-SCREEN <label>` line a test prints (dumpScreen in
// tests/kpost-mobile/support/first_run.dart, called just before the checks) and each Flutter test
// failure is a screenshot, taken over adb at that moment. Only the failed tests' screenshots are kept:
//
//   reports/mobile/<run>/<NN>-<test>-<label>.png
//   reports/mobile/<run>/failures.json   [{ test, screenshots: [path, …] }]
//   reports/mobile/latest.json           { dir } of the newest run
//
// A hand-filed mobile bug names its test as "mobileTest" in the bug JSON; `npm run bug:file` attaches
// that test's screenshots (tests/framework/bug-tracker/manual-bug.spec.ts). reports/ is gitignored.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const KEEP_RUNS = 10;

const slug = (text) =>
  text
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);

/** Starts watching `device`; call `stop()` after the run to keep the failed tests' screenshots. */
export function watchScreens(root, device) {
  const base = path.join(root, 'reports', 'mobile');
  const dir = path.join(base, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  fs.mkdirSync(dir, { recursive: true });

  // Only this run's lines: an old BENCH-SCREEN must not be photographed again.
  spawnSync('adb', ['-s', device, 'logcat', '-c']);
  const logcat = spawn('adb', [
    '-s',
    device,
    'logcat',
    '-v',
    'brief',
    'TestRunner:I',
    'flutter:I',
    '*:S',
  ]);

  const shots = new Map(); // test → screenshot paths
  const failed = new Set();
  let current = 'before-first-test';
  let count = 0;
  let queue = Promise.resolve();

  // One capture at a time: screencap writes the PNG to stdout, straight into the file.
  const capture = (label) => {
    const test = current;
    count += 1;
    const file = path.join(
      dir,
      `${String(count).padStart(2, '0')}-${slug(test)}-${slug(label)}.png`,
    );
    queue = queue.then(
      () =>
        new Promise((resolve) => {
          const out = fs.openSync(file, 'w');
          const cap = spawn('adb', ['-s', device, 'exec-out', 'screencap', '-p'], {
            stdio: ['ignore', out, 'ignore'],
          });
          cap.on('close', () => {
            fs.closeSync(out);
            if (fs.statSync(file).size > 0) shots.set(test, [...(shots.get(test) ?? []), file]);
            else fs.rmSync(file, { force: true });
            resolve();
          });
          cap.on('error', () => {
            fs.closeSync(out);
            fs.rmSync(file, { force: true });
            resolve();
          });
        }),
    );
  };

  const testName = (line) => line.match(/runDartTest\[(?:\S+ )?(.*)\]\(/)?.[1];
  // The failing screen is caught on Patrol's failed step: the exception banner comes ~4 s later, in
  // several log lines, as the app is torn down (a screenshot then shows whatever is underneath).
  const failureShot = new Set();
  readline.createInterface({ input: logcat.stdout }).on('line', (line) => {
    if (line.includes('TestRunner') && line.includes('started: runDartTest[')) {
      current = testName(line) ?? current;
    } else if (line.includes('TestRunner') && line.includes('failed: runDartTest[')) {
      failed.add(testName(line) ?? current);
    } else if (line.includes('BENCH-SCREEN ')) {
      capture(line.split('BENCH-SCREEN ')[1].split(':')[0]);
    } else if (line.includes('PATROL_LOG') && line.includes('"status":"failure"')) {
      failed.add(current);
      if (!failureShot.has(current)) {
        failureShot.add(current);
        capture('failed-step');
      }
    } else if (line.includes('EXCEPTION CAUGHT BY FLUTTER TEST FRAMEWORK')) {
      // An expect() failure has no failed step: its banner is the first sign.
      failed.add(current);
      if (!failureShot.has(current)) {
        failureShot.add(current);
        capture('failure');
      }
    }
  });

  return {
    async stop() {
      logcat.kill();
      await queue;
      const failures = [];
      for (const [test, files] of shots) {
        if (failed.has(test)) failures.push({ test, screenshots: files });
        else for (const file of files) fs.rmSync(file, { force: true });
      }
      fs.writeFileSync(path.join(dir, 'failures.json'), JSON.stringify(failures, null, 2));
      fs.writeFileSync(path.join(base, 'latest.json'), JSON.stringify({ dir }, null, 2));
      // The last KEEP_RUNS runs only.
      const runs = fs
        .readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const old of runs.slice(0, -KEEP_RUNS)) {
        fs.rmSync(path.join(base, old), { recursive: true, force: true });
      }
      return { dir, failures };
    },
  };
}
