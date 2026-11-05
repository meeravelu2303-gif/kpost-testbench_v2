/**
 * The test bench's folder layout, declared once: `tests/<product>/<type>/[<module>/]<file>`.
 *
 * Read by the layout self-test (`tests/framework/layout/test-layout.spec.ts`, which fails on a file in
 * the wrong place) and by `npm run tests:inventory` (which writes the counts to `tests/README.md`).
 * Adding a product or a test type starts here.
 */

import { CHECK_TYPE_INFO, CHECK_TYPES } from '../validation-engine/check-types.ts';

export interface TestType {
  /** Folder name under the product. */
  readonly dir: string;
  /** One line: what a test in this folder proves. */
  readonly holds: string;
  /** Files sit in `<type>/<module>/` (true) or directly in `<type>/` (false). */
  readonly byModule: boolean;
  /** Not a test folder: helpers, or tests the owner took out of scope. */
  readonly kind?: 'support' | 'excluded';
}

export interface TestProduct {
  /** Folder name under `tests/`. */
  readonly dir: string;
  /** The Bugzilla product its bugs are filed to. */
  readonly bugzilla: string;
  /** How its tests run. */
  readonly runner: 'playwright-api' | 'playwright-ui' | 'patrol';
  /** Test file name pattern. */
  readonly testFile: RegExp;
  readonly types: readonly TestType[];
}

const SPEC = /\.spec\.ts$/;

const support: TestType = {
  dir: 'support',
  holds: "Helpers for this product's tests only (no tests).",
  byModule: false,
  kind: 'support',
};
const excluded: TestType = {
  dir: 'excluded',
  holds:
    'Out of scope by owner decision (KDoc/KOS, concurrency). Never collected: `testIgnore` in playwright.config.ts.',
  byModule: true,
  kind: 'excluded',
};

const smoke: TestType = {
  dir: 'smoke',
  holds: 'Is the product up and usable? A few minutes, run first.',
  byModule: false,
};
const sanity: TestType = {
  dir: 'sanity',
  holds: 'Every main read/screen once, after a deploy.',
  byModule: false,
};

/**
 * The API test types. The engine's checks are split over the first ten (`CHECK_TYPES`, one
 * `<module>-endpoints-<type>.spec.ts` each); hand-written specs of the same kind sit beside them.
 */
const apiTypes = (modules: boolean): readonly TestType[] => [
  smoke,
  sanity,
  ...CHECK_TYPES.map((dir) => ({ dir, holds: CHECK_TYPE_INFO[dir], byModule: modules })),
  {
    dir: 'e2e',
    holds: 'End to end: a lifecycle (create → read → update → delete), across accounts.',
    byModule: modules,
  },
  {
    dir: 'coverage',
    holds: 'No HTTP: every documented endpoint is defined, routed and owned.',
    byModule: false,
  },
  {
    dir: 'maintenance',
    holds: 'QA data cleanup and one-time setup (self-cleaning).',
    byModule: false,
  },
  excluded,
  support,
];

const uiTypes: readonly TestType[] = [
  smoke,
  sanity,
  {
    dir: 'e2e',
    holds: 'Multi-step flows that write data, through the real screens.',
    byModule: true,
  },
  {
    dir: 'functional',
    holds: "One screen's behaviour (read-only or local state).",
    byModule: true,
  },
  { dir: 'screens', holds: 'Render, health and layout sweeps of every screen.', byModule: true },
  {
    dir: 'validation',
    holds: 'Form rules: invalid input refused AND valid input accepted.',
    byModule: true,
  },
  {
    dir: 'api-handling',
    holds: 'Server errors and slow replies shown properly to the user.',
    byModule: true,
  },
  {
    dir: 'security',
    holds: 'Token handling, XSS, data exposure in the browser.',
    byModule: true,
  },
  {
    dir: 'accessibility',
    holds: 'axe-core WCAG scans and keyboard use.',
    byModule: true,
  },
  {
    dir: 'resilience',
    holds: 'Offline, slow network and failed requests.',
    byModule: true,
  },
  { dir: 'responsive', holds: 'Phone, tablet and desktop widths.', byModule: true },
  { dir: 'visual', holds: 'Screenshot baselines (`-snapshots/` beside the spec).', byModule: true },
  { dir: 'performance', holds: 'Page-load timings.', byModule: true },
  {
    dir: 'journeys',
    holds: 'End-to-end user stories across modules and accounts.',
    byModule: false,
  },
  {
    dir: 'cross-layer',
    holds: 'A UI write checked through the API and the database.',
    byModule: false,
  },
  excluded,
  support,
];

export const TEST_PRODUCTS: readonly TestProduct[] = [
  {
    dir: 'kpost-api',
    bugzilla: 'KPost API',
    runner: 'playwright-api',
    testFile: SPEC,
    types: apiTypes(true),
  },
  {
    dir: 'kmail-api',
    bugzilla: 'KMail API',
    runner: 'playwright-api',
    testFile: SPEC,
    types: apiTypes(false),
  },
  {
    dir: 'admin-api',
    bugzilla: 'KPost Admin',
    runner: 'playwright-api',
    testFile: SPEC,
    types: apiTypes(false),
  },
  {
    dir: 'kpost-ui',
    bugzilla: 'KPost UI',
    runner: 'playwright-ui',
    testFile: SPEC,
    types: uiTypes,
  },
  {
    dir: 'admin-ui',
    bugzilla: 'KPost Admin UI',
    runner: 'playwright-ui',
    testFile: SPEC,
    types: uiTypes.map((t) => ({ ...t, byModule: false })),
  },
  {
    dir: 'kpost-mobile',
    bugzilla: 'Kpost Mobile Application',
    runner: 'patrol',
    testFile: /_test\.dart$/,
    types: [
      { dir: 'e2e', holds: 'Flows on the phone that write data.', byModule: true },
      {
        dir: 'validation',
        holds: 'Form rules and wrong input on the phone.',
        byModule: true,
      },
      { dir: 'screens', holds: 'Every screen of a module opens.', byModule: true },
      {
        dir: 'support',
        holds: 'Dart helpers: QA API calls, first-run steps.',
        byModule: false,
        kind: 'support',
      },
    ],
  },
];

/** Folders under `tests/` that are not products. */
export const TEST_INFRA_DIRS: readonly { dir: string; holds: string }[] = [
  {
    dir: 'framework',
    holds: "The bench's own self-tests (no KPost server): `npm run framework`.",
  },
  { dir: 'setup', holds: 'Logs each QA account in once and saves the session to `.auth/`.' },
  {
    dir: 'support',
    holds: 'Helpers shared by products (flow-state, live-condition, smoke checks).',
  },
];

/** Areas of `tests/framework/`, one folder each. */
export const FRAMEWORK_AREAS: readonly { dir: string; holds: string }[] = [
  { dir: 'bug-tracker', holds: 'Bug filing: candidates, gates, dedupe, ticket text, status pass.' },
  { dir: 'validators', holds: 'Each centralized validator against fixed replies.' },
  { dir: 'engine', holds: 'The validation engine, sweeps, flow findings, token handling.' },
  { dir: 'contracts', holds: 'Source contracts, input limits, types and payload audit.' },
  { dir: 'coverage', holds: 'Coverage ledgers: endpoints, screens, UI rules, FRD, skips.' },
  { dir: 'safety', holds: 'Live-system guards: Admin DB, uploads, secrets, raw bodies.' },
  { dir: 'config', holds: 'Env template, flags, ownership routing.' },
  { dir: 'reporting', holds: 'Run summary, report archive, run continuity.' },
  { dir: 'ui', holds: 'UI health classification.' },
  { dir: 'layout', holds: 'This folder layout and the tests/README.md inventory.' },
  { dir: 'local-tools', holds: 'One-off local probes (`_*.local.spec.ts`), self-skipping.' },
];
