import { defineConfig, devices, type Project } from '@playwright/test';
import { STORAGE_STATE, STORAGE_STATE_ADMIN, TAGS, TIMEOUTS } from './src/config/constants';
import { env } from './src/config/env';
import { resolveWorkers } from './src/config/run-profiles';

const BUGZILLA_REPORTER = './src/reporting/bugzilla-reporter.ts';
/**
 * Evidence is a TEST-EXECUTION artifact, so it is persisted by its own reporter rather than by the
 * one that files defects (Phase 3.2). It therefore runs whether Bugzilla is configured, dry-run,
 * candidate-free, or not registered at all.
 */
const EVIDENCE_REPORTER = './src/reporting/evidence-reporter.ts';
/** Phase 3.3 — classifies failures into observations, in SHADOW. It changes no filing decision. */
const OBSERVATION_REPORTER = './src/reporting/observation-reporter.ts';
/**
 * Phase 3.4 — assesses whether a classified failure has evidence strong enough to be a defect
 * CANDIDATE, in SHADOW, and measures that answer against the existing candidate pipeline. It reads
 * the same attachments again and writes its own artifacts; it changes no filing decision, and the
 * Bugzilla reporter neither reads its output nor knows it ran.
 */
const CONFIDENCE_REPORTER = './src/reporting/confidence-reporter.ts';
const MOCK_API_STARTUP_TIMEOUT_MS = 30_000;

/**
 * True when a named run profile was selected (`npm run bench -- --profile …`). Without one the
 * `default` profile contributes nothing: every legacy npm script and a bare `npx playwright test`
 * behave exactly as they did before profiles existed.
 */
const PROFILED = env.PROFILE.name !== 'default';

/**
 * The projects this run may use. A profile names them, so `--profile kpost` cannot accidentally run
 * the browser suites; with no profile, every project is defined as before.
 */
function selectProjects(all: Project[]): Project[] {
  if (!PROFILED || !env.PROFILE.projects.length) return all;
  const wanted = new Set(env.PROFILE.projects);
  const selected = all.filter((project) => project.name && wanted.has(project.name));
  const missing = env.PROFILE.projects.filter(
    (name) => !all.some((project) => project.name === name),
  );
  if (missing.length) {
    throw new Error(
      `Run profile "${env.PROFILE.name}" names unknown Playwright project(s): ${missing.join(', ')}.`,
    );
  }
  return selected;
}

/** UI projects reuse the session saved by the `setup` project. */
const browserProject = (name: string, device: Project['use']): Project => ({
  name,
  testDir: './tests/e2e',
  use: { ...device, storageState: STORAGE_STATE },
  dependencies: ['setup'],
  // A live SPA over a throttling third-party host is inherently flakier than an API call: a slow
  // navigation or a transient render can fail one test per full run, rotating between engines. Two
  // retries absorb that intermittent variance without masking a real, repeatable failure (a genuine
  // break fails all three attempts).
  retries: env.RETRIES ?? 2,
});

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  timeout: TIMEOUTS.test,
  expect: { timeout: TIMEOUTS.expect },

  fullyParallel: true,
  forbidOnly: env.CI,
  retries: env.RETRIES ?? (env.CI ? 2 : 0),
  /*
   * With a run profile, the worker count is the profile's — defaulting to 1 and REFUSED (never
   * clamped) above the count that mode has been proven safe for. Without one, this is exactly the
   * previous expression, so every legacy command keeps its behaviour.
   */
  workers: PROFILED
    ? resolveWorkers(env.PROFILE, env.WORKERS)
    : (env.WORKERS ?? (env.CI ? '50%' : undefined)),

  // The profile's tag filter (e.g. `@kpost-api`); a `--grep` on the command line overrides it.
  grep: env.PROFILE.grep ? new RegExp(env.PROFILE.grep) : undefined,

  // Never run data-mutating tests against production unless explicitly allowed.
  grepInvert:
    env.IS_PRODUCTION && !env.ALLOW_DESTRUCTIVE_TESTS ? new RegExp(TAGS.destructive) : undefined,

  // CI emits blob reports so sharded runs can be merged (see merge.config.ts). In CI the shards only
  // produce blobs; the single report (reports/REPORT.{md,json}) and bug filing happen once from the
  // merged report (merge.config.ts), so two shards can never file the same defect twice.
  reporter: env.CI
    ? [['blob'], ['github'], ['list']]
    : [
        ['list'],
        ['html', { open: 'never' }],
        [EVIDENCE_REPORTER],
        [OBSERVATION_REPORTER],
        [CONFIDENCE_REPORTER],
        [BUGZILLA_REPORTER],
      ],

  // Local stand-in for the KPost API (MOCK_API=true, the default for TEST_ENV=local).
  webServer: env.MOCK_API
    ? {
        command: 'node mock-server/server.ts',
        url: `${env.API_BASE_URL}/health`,
        reuseExistingServer: !env.CI,
        timeout: MOCK_API_STARTUP_TIMEOUT_MS,
        env: { MOCK_API_PORT: String(env.MOCK_API_PORT) },
        stdout: 'ignore',
        stderr: 'pipe',
      }
    : undefined,

  use: {
    baseURL: env.BASE_URL,
    headless: env.HEADLESS,
    actionTimeout: TIMEOUTS.action,
    navigationTimeout: TIMEOUTS.navigation,
    testIdAttribute: 'data-testid',
    trace: env.CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: selectProjects([
    // The login setup navigates the live SPA, which occasionally answers a transient
    // ERR_CONNECTION_RESET; retries absorb that so one flaky navigation does not collapse the run
    // (a genuine credential/route failure still fails all attempts).
    {
      name: 'setup',
      testDir: './tests/setup',
      testMatch: /.*\.setup\.ts/,
      retries: env.RETRIES ?? 2,
    },
    browserProject('chromium', devices['Desktop Chrome']),
    browserProject('firefox', devices['Desktop Firefox']),
    browserProject('webkit', devices['Desktop Safari']),
    // The Admin/HR-Setup UI is a SEPARATE SPA (kpostadmin.kpostindia.com) on its own origin, SSO'd
    // by the session `auth-admin.setup.ts` seeds. Its own baseURL + storageState + testDir keep it
    // out of the main-app browser glob; it self-skips unless ADMIN_UI_LIFECYCLE seeds a real session.
    {
      name: 'admin-ui',
      testDir: './tests/e2e-admin',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: env.ADMIN_UI_BASE_URL,
        storageState: STORAGE_STATE_ADMIN,
      },
      dependencies: ['setup'],
      retries: env.RETRIES ?? 2,
    },
    { name: 'api', testDir: './tests/api' },
    { name: 'integration', testDir: './tests/integration' },
    { name: 'framework', testDir: './tests/framework' },
    /*
     * Curated Bugzilla filing. Its own project so the entry point cannot be swept up by a suite run:
     * nothing selects it except `npm run bugs:file:kpost`, which is the only command that may file.
     */
    { name: 'filing', testDir: './tests/filing' },
  ]),
});
