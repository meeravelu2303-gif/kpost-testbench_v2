import { defineConfig, devices, type Project } from '@playwright/test';
import { STORAGE_STATE, STORAGE_STATE_ADMIN, TAGS, TIMEOUTS } from './src/config/constants';
import { env } from './src/config/env';

const BUGZILLA_REPORTER = './src/reporting/bugzilla-reporter.ts';

/** Workers default to 1 and are hard-capped at 2 here, so no invocation overloads the shared server. */
const WORKERS_CAP = 2;
const resolveWorkers = (): number => Math.min(Math.max(1, env.WORKERS ?? 1), WORKERS_CAP);

/** One retry everywhere: absorbs a single transient blip without masking a repeatable failure. */
const RETRIES = env.RETRIES ?? 1;

/** UI projects reuse the session saved by the `setup` project. */
const browserProject = (
  name: string,
  device: Project['use'],
  extraUse: Project['use'] = {},
): Project => ({
  name,
  testDir: './tests/kpost-ui',
  use: { ...device, storageState: STORAGE_STATE, ...extraUse },
  dependencies: ['setup'],
  retries: RETRIES,
});

/** Fake camera/microphone with permissions granted, so Kall media flows run on Chromium. */
const CHROMIUM_MEDIA: Project['use'] = {
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['camera', 'microphone'],
};

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  timeout: TIMEOUTS.test,
  expect: { timeout: TIMEOUTS.expect },

  // With 1 worker the run is effectively serial; the worker cap is the real throughput guard.
  fullyParallel: true,
  forbidOnly: env.CI,
  retries: RETRIES,
  workers: resolveWorkers(),

  // Never run data-mutating tests against production unless explicitly allowed.
  grepInvert:
    env.IS_PRODUCTION && !env.ALLOW_DESTRUCTIVE_TESTS ? new RegExp(TAGS.destructive) : undefined,

  // The Bugzilla reporter writes reports/REPORT.{md,json} and files once from the complete run.
  reporter: [['list'], ['html', { open: 'never' }], [BUGZILLA_REPORTER]],

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

  projects: [
    // Logs in and saves the sessions; retried so one connection reset cannot collapse the run.
    {
      name: 'setup',
      testDir: './tests/setup',
      testMatch: /.*\.setup\.ts/,
      retries: RETRIES,
    },
    browserProject('chromium', devices['Desktop Chrome'], CHROMIUM_MEDIA),
    // FIREFOX_SPEECH_ON=true enables speech recognition so the app's "Microphone not available"
    // alert() does not block a Firefox run. Off by default so that defect stays visible.
    browserProject(
      'firefox',
      devices['Desktop Firefox'],
      process.env.FIREFOX_SPEECH_ON === 'true'
        ? {
            launchOptions: {
              firefoxUserPrefs: {
                'media.webspeech.recognition.enable': true,
                'media.webspeech.recognition.force_enable': true,
              },
            },
          }
        : {},
    ),
    browserProject('webkit', devices['Desktop Safari']),
    // The Admin UI is a separate SPA with its own baseURL and the session auth-admin.setup.ts seeds;
    // it self-skips unless ADMIN_UI_LIFECYCLE is on.
    {
      name: 'admin-ui',
      testDir: './tests/admin-ui',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: env.ADMIN_UI_BASE_URL,
        storageState: STORAGE_STATE_ADMIN,
      },
      dependencies: ['setup'],
      retries: RETRIES,
    },
    // The three API products, one folder each.
    {
      name: 'api',
      testDir: './tests',
      testMatch: /(^|[\\/])tests[\\/](kpost|kmail|admin)-api[\\/].*\.spec\.ts$/,
    },
    { name: 'framework', testDir: './tests/framework' },
  ],
});
