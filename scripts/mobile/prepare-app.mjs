// Builds the bench's own copy of the KPost Flutter app with Patrol added (docs/proposals/mobile-testing.md).
// The developers' repo is only read: the copy is a local git clone of its Test_ENV branch in mobile/.app
// (gitignored), reset to that branch on every run, then patched:
//   - every server the app calls points at the QA backend from .env (KPOST_API_BASE_URL, KMAIL_API_BASE_URL),
//     and the copy is refused when a live host is left in the app's code;
//   - Patrol: the dev dependency, its pubspec section, the Android test runner and MainActivityTest;
//   - the bench's tests (mobile/patrol_test) are copied in.
//
//   npm run mobile:prepare
//   npm run mobile:prepare -- --tunnel     the phone reaches the QA backend through this PC (see below)
//   node scripts/mobile/prepare-app.mjs --source D:/KPOST_PROJECTS/kpost5_flutter
//
// --tunnel: a phone on a network that cannot reach a QA port (the office Wi-Fi is refused on 8989) calls
// 127.0.0.1:<port> instead; `npm run mobile:test` relays each port through this PC (adb reverse + a TCP
// relay to the same QA host and port), so the app still talks only to the QA backend.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const SOURCE = path.resolve(option('--source', 'D:/KPOST_PROJECTS/kpost5_flutter'));
const BRANCH = 'Test_ENV';
const COPY = path.join(ROOT, 'mobile', '.app');
const APP = path.join(COPY, 'kpost');
const TESTS = path.join(ROOT, 'mobile', 'patrol_test');

const PATROL_VERSION = '^4.10.0';
const ANDROID_PACKAGE = 'com.kpost.kpost5_flutter';
const IOS_BUNDLE = 'com.kpost.kpost5Flutter';

/** The owner's QA backend (CLAUDE.md §1): the only servers a phone run may call. */
const QA_HOSTS = new Set(['192.168.0.100']);
/** Live hosts that must never be called from the copy (comments and share-link texts aside). */
const FORBIDDEN =
  /devapi2\.kpostindia|kmail5\.kpostindia|adminmodule\.kpostindia|testingapi\.kpostindia/;

function fail(message) {
  console.error(`mobile:prepare: ${message}`);
  process.exit(1);
}

function git(...gitArgs) {
  const result = spawnSync('git', gitArgs, { encoding: 'utf8' });
  if (result.status !== 0) fail(`git ${gitArgs.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

/** Replace exactly one match, or stop: a silent no-op would build an app pointing somewhere else. */
function replaceOnce(file, pattern, replacement, what) {
  const text = fs.readFileSync(file, 'utf8');
  const matches = text.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`));
  if (matches?.length !== 1) {
    fail(
      `${what}: expected one match in ${path.relative(COPY, file)}, found ${matches?.length ?? 0}`,
    );
  }
  fs.writeFileSync(file, text.replace(pattern, replacement), 'utf8');
}

function qaBase(variable) {
  const value = process.env[variable];
  if (!value) fail(`${variable} is not set in .env`);
  const url = new URL(value);
  if (!QA_HOSTS.has(url.hostname)) {
    fail(
      `${variable} is ${url.host}; the phone runs only against the QA backend (${[...QA_HOSTS]})`,
    );
  }
  return url.origin;
}

// ---- 1. The copy: clone once, then reset to the branch on every run (ignored build caches kept)
if (!fs.existsSync(path.join(SOURCE, '.git'))) fail(`${SOURCE} is not a git repository`);
if (fs.existsSync(path.join(COPY, '.git'))) {
  git('-C', COPY, 'fetch', '--quiet', 'origin', BRANCH);
  git('-C', COPY, 'checkout', '--quiet', '-f', '-B', BRANCH, `origin/${BRANCH}`);
  git('-C', COPY, 'clean', '-fdq');
} else {
  fs.mkdirSync(path.dirname(COPY), { recursive: true });
  // autocrlf off: the files stay byte-identical to the developers' (the patches anchor on LF lines).
  git(
    'clone',
    '--quiet',
    '-c',
    'core.autocrlf=false',
    '--branch',
    BRANCH,
    '--single-branch',
    SOURCE,
    COPY,
  );
}
const commit = git('-C', COPY, 'log', '-1', '--format=%h %ad %s', '--date=short');

// ---- 2. Servers: the QA backend's /v2 routes (unprefixed paths answer 401, even for login).
// Test_ENV has used these values itself since 1145282ff (2026-10-29); the patches keep the copy on
// .env's QA hosts if the branch moves again. Each pattern is anchored to the start of the line, so
// the commented-out live URL above it is left.
const TUNNEL = args.includes('--tunnel');
/** The address the app calls for a QA origin: the origin itself, or 127.0.0.1 on its port (--tunnel). */
const tunnelTo = {};
const reach = (origin) => {
  if (!TUNNEL) return origin;
  const url = new URL(origin);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  tunnelTo[port] = origin;
  return `${url.protocol}//127.0.0.1:${port}`;
};
const kpost = reach(qaBase('KPOST_API_BASE_URL'));
const kmail = `${reach(qaBase('KMAIL_API_BASE_URL'))}${process.env.KMAIL_PATH_PREFIX || '/v2'}`;
const urls = path.join(APP, 'lib', 'app_common', 'constants', 'api_url_constants.dart');
const strings = path.join(APP, 'lib', 'app_common', 'constants', 'string_constant.dart');
replaceOnce(
  urls,
  /^([ \t]*)static const String apiBaseUrl = '[^']*';/m,
  `$1static const String apiBaseUrl = '${kpost}/v2/';`,
  'KPost base URL',
);
replaceOnce(
  urls,
  /^([ \t]*)static const String apiKmailBaseUrl = '[^']*';/m,
  `$1static const String apiKmailBaseUrl = '${kmail}/';`,
  'KMail base URL',
);
// K-AI / KDoc root: excluded from testing; pointed at the QA backend so it can never reach devapi2.
replaceOnce(
  urls,
  /^([ \t]*)static const String baseUrl = '[^']*';/m,
  `$1static const String baseUrl = '${kpost}/v2/';`,
  'K-AI base URL',
);
replaceOnce(
  strings,
  /^([ \t]*)static const String kmailThumbnailAPI =\s*"[^"]*";/m,
  `$1static const String kmailThumbnailAPI = "${kmail}/readMail/downloadThumbnail/";`,
  'KMail thumbnail URL',
);

const leftovers = [];
for (const dir of [path.join(APP, 'lib'), path.join(COPY, 'kpost_common', 'lib')]) {
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.dart')) continue;
    const file = path.join(entry.parentPath, entry.name);
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (!line.trimStart().startsWith('//') && FORBIDDEN.test(line)) {
          leftovers.push(`${path.relative(COPY, file)}:${index + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
  }
}
if (leftovers.length) fail(`live hosts left in the app's code:\n  ${leftovers.join('\n  ')}`);

// ---- 3. Patrol: dev dependency + pubspec section
const pubspec = path.join(APP, 'pubspec.yaml');
replaceOnce(
  pubspec,
  /^dev_dependencies:\r?\n/m,
  `dev_dependencies:\n  patrol: ${PATROL_VERSION}\n`,
  'dev_dependencies',
);
fs.appendFileSync(
  pubspec,
  [
    '',
    "# Added by the test bench (scripts/mobile/prepare-app.mjs); not in the developers' repo.",
    'patrol:',
    '  app_name: KPost',
    '  test_directory: patrol_test',
    '  android:',
    `    package_name: ${ANDROID_PACKAGE}`,
    '  ios:',
    `    bundle_id: ${IOS_BUNDLE}`,
    '',
  ].join('\n'),
  'utf8',
);

// ---- 4. Patrol: the Android test runner (Patrol's Groovy setup) and its entry class
const gradle = path.join(APP, 'android', 'app', 'build.gradle');
replaceOnce(
  gradle,
  /^([ \t]*)multiDexEnabled true$/m,
  '$1multiDexEnabled true\n$1testInstrumentationRunner "pl.leancode.patrol.PatrolJUnitRunner"\n$1testInstrumentationRunnerArguments clearPackageData: "true"',
  'defaultConfig',
);
replaceOnce(
  gradle,
  /^([ \t]*)lintOptions \{$/m,
  '$1testOptions {\n$1    execution "ANDROIDX_TEST_ORCHESTRATOR"\n$1}\n\n$1lintOptions {',
  'testOptions',
);
replaceOnce(
  gradle,
  /^dependencies \{$/m,
  'dependencies {\n    androidTestUtil "androidx.test:orchestrator:1.5.1"',
  'dependencies',
);
const testClassDir = path.join(
  APP,
  'android',
  'app',
  'src',
  'androidTest',
  'java',
  ...ANDROID_PACKAGE.split('.'),
);
fs.mkdirSync(testClassDir, { recursive: true });
fs.writeFileSync(
  path.join(testClassDir, 'MainActivityTest.java'),
  `package ${ANDROID_PACKAGE};

import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;
import org.junit.runners.Parameterized.Parameters;
import pl.leancode.patrol.PatrolJUnitRunner;

// Patrol's entry point: one JUnit case per Dart patrolTest. Added by the test bench.
@RunWith(Parameterized.class)
public class MainActivityTest {
    @Parameters(name = "{0}")
    public static Object[] testCases() {
        PatrolJUnitRunner instrumentation = (PatrolJUnitRunner) InstrumentationRegistry.getInstrumentation();
        instrumentation.setUp(MainActivity.class);
        instrumentation.waitForPatrolAppService();
        return instrumentation.listDartTests();
    }

    public MainActivityTest(String dartTestName) {
        this.dartTestName = dartTestName;
    }

    private final String dartTestName;

    @Test
    public void runDartTest() {
        PatrolJUnitRunner instrumentation = (PatrolJUnitRunner) InstrumentationRegistry.getInstrumentation();
        instrumentation.runDartTest(dartTestName);
    }
}
`,
  'utf8',
);

/*
 * Flutter 3.47 refuses Android Gradle Plugin versions below 8.11.1; Test_ENV is on 8.9.1 (the app
 * needs Flutter >=3.41). Skip that version gate in the copy rather than change the developers' AGP:
 * `skipDependencyChecks` is the Gradle property behind --android-skip-build-dependency-validation.
 */
fs.appendFileSync(
  path.join(APP, 'android', 'gradle.properties'),
  "\n# Added by the test bench: Flutter 3.47 vs the app's AGP 8.9.1 (see prepare-app.mjs).\nskipDependencyChecks=true\n",
  'utf8',
);

// ---- 5. The bench's tests
fs.cpSync(TESTS, path.join(APP, 'patrol_test'), { recursive: true });

const stamp = {
  source: SOURCE,
  branch: BRANCH,
  commit,
  kpost: `${kpost}/v2/`,
  kmail: `${kmail}/`,
  // --tunnel: phone port → the QA origin mobile:test relays it to.
  ...(TUNNEL && { tunnelTo }),
  preparedAt: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(COPY, 'BENCH_SOURCE.json'),
  `${JSON.stringify(stamp, null, 2)}\n`,
  'utf8',
);
console.log(`mobile:prepare: ${path.relative(ROOT, APP)} ready`);
console.log(`  ${BRANCH} @ ${commit}`);
console.log(`  KPost ${stamp.kpost} · KMail ${stamp.kmail}`);
if (TUNNEL) console.log(`  tunnelled through this PC to ${Object.values(tunnelTo).join(', ')}`);
console.log('  next: npm run mobile:test (emulator running)');
