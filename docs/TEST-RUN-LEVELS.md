# Test run levels — Smoke, Sanity, Regression

The bench runs at three **levels**, selected by **tags**. One runner (`scripts/run-level.mjs`)
drives them, lints the tags first, and never files bugs.

> **Scope.** In-scope modules: **Auth (Signup & Login), Katchup, Kall, KMail**, plus the wider
> in-scope set for regression/sanity (Profile, Settings, Contacts, Home, Group, verticals). **Admin is
> out of scope** and is never selected by any level.

## 1. What each level is

| Level          | Question it answers                                     | Shape                                                                                                                         | When                                                                           |
| -------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **smoke**      | "Is the build even alive?"                              | Broad + shallow — 1–3 critical checks per in-scope core module, per suite. Read-only.                                         | First. If smoke fails, nothing else runs. API smoke ≤ 2 min, UI smoke ≤ 5 min. |
| **sanity**     | "Did this one fix/area work, without obvious breakage?" | A curated set of core functional tests, **one module or one bug at a time**. Broader than smoke, far smaller than regression. | After a fix or change.                                                         |
| **regression** | "Did we break anything that used to work?"              | The full stable suite.                                                                                                        | Before a release — and only after smoke passes.                                |

Smoke ⊆ sanity ⊆ regression: every stable test carries `@regression`; smoke and sanity tests carry it
too, because they are subsets of it.

## 2. Tag taxonomy

All tag strings live in one place — `src/config/tags.ts` (re-exported from `src/config/constants.ts`).
Import them as `TAGS.katchup`; never hand-type a tag, and never put tags in test **titles**.

- **Run levels:** `@smoke`, `@sanity`, `@regression`.
- **Layers:** `@ui`, `@api`.
- **Modules (≥1 required on every test):** `@auth`, `@katchup`, `@kall`, `@kmail`, `@profile`,
  `@settings`, `@contacts`, `@home`, `@group`, `@verticals`, `@platform` (app-wide/cross-cutting).
- **Bug verification:** `@bug-<BugzillaID>`, e.g. `@bug-1267`. Put the internal `[KP-xxxxxx]`
  fingerprint in a comment next to it.
- **Quarantine:** `@quarantine` — excluded from **all** levels; see §6.
- **Feature/area sub-tags** (optional, finer selectors): `@security`, `@database`, `@destructive`,
  `@signup`, `@kmail-read`, `@aws`, `@common`, `@concurrency`, … (full list in `tags.ts`).

Rules enforced by `npm run lint:tags`:

1. every in-scope test has `@regression` **or** `@quarantine`;
2. every in-scope test has at least one module tag;
3. every tag is defined in `tags.ts` (or is a valid `@bug-<number>`);
4. **smoke budget:** at most **3** `@smoke` tests per module per suite (override `--budget=N`);
5. no Admin test is ever selected/tagged into a run level.

Example:

```ts
import { TAGS } from '@config/constants';

test.describe('KPost Katchup · recall', { tag: [TAGS.ui, TAGS.katchup, TAGS.regression] }, () => {
  test('recall removes an unread message', { tag: [TAGS.smoke, TAGS.sanity] }, async ({ page }) => { … });

  // verifies a fixed bug:
  test('legacy recall cannot be spoofed', { tag: ['@bug-1267'] /* [KP-6F5E6B] */ }, async () => { … });
});
```

## 3. How to run

```bash
npm run test:smoke                 # API smoke, then UI smoke (stops at first failing suite)
npm run test:smoke:api             # API smoke only
npm run test:smoke:ui              # UI smoke only

npm run test:sanity -- --module katchup   # auth smoke precondition, then @sanity + @katchup
npm run test:sanity -- --bug 1267          # auth smoke precondition, then @bug-1267

npm run test:regression            # full smoke gate, then the full @regression suite
npm run test:regression:ui         # regression, UI suite only
```

Every level **lints tags first** and runs with `BUGZILLA_DRY_RUN=true` — **no run level files bugs**.
Real filing stays in the reviewed workflow (`npm run report:filing`, `bug:file-reviewed`,
`file-approved.cjs`). The runner prints where each dry-run report was written.

Flags: `--level smoke|sanity|regression`, `--suite api|ui|all`, `--module <name>`, `--bug <BugzillaID>`.

## 4. Server safety & the production guard

The KPost bench is **one low-capacity shared server**. Enforced in `playwright.config.ts`:

- `workers` defaults to **1**, hard-capped at **2** (`WORKERS` can lower but never raise past 2);
- `retries: 1`; smoke/sanity run **Chromium only** (Firefox/WebKit stay out).

**Production guard:** when `TEST_ENV=production`, smoke and sanity are allowed but **regression is
blocked** unless `ALLOW_PROD_REGRESSION=true`. `@destructive` tests never run in smoke/sanity, and run
in regression only when `ALLOW_DESTRUCTIVE_TESTS=true`.

## 5. Environment

Config reads everything from env via `dotenv` (`.env`, git-ignored; see `.env.example`):
`BASE_URL` (default `https://test.kpostindia.com`), `API_BASE_URL`/`KMAIL_API_BASE_URL`, `WORKERS`,
`RETRIES`, `TEST_ENV`, QA credentials. Smoke/sanity target `test.kpostindia.com` / `testkmail` /
`testingapi`. Never commit credentials.

An auth `setup` project logs in once and saves `storageState`; tests reuse it and must not log in
individually (except tests that test login). Kall runs on Chromium with fake-media flags
(`--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`) and camera/mic granted.

## 6. Adding, tagging and quarantining

- **New test:** give it `@regression`, one module tag, and a layer tag (`@ui`/`@api`). Add `@smoke`
  only if it is a true build-acceptance check (mind the budget) and `@sanity` if it belongs to the
  module's core set.
- **Multi-user** (A→B Katchup/KMail/Kall): two accounts (`QATEST1`/`QATEST2`) in two contexts.
- **Data-creating** tests tag `@destructive` and clean up in `afterEach`/`finally` (runs even on
  failure).
- **Flaky/broken:** tag `@quarantine` with a comment giving the reason + date. Never delete a test to
  make a run green. Quarantined tests are excluded from every level and surfaced by `lint:tags`.

## 7. Reporting

Each level writes HTML + JUnit XML + JSON to `reports/<level>/<suite>/<timestamp>/` (git-ignored).
The runner prints a per-run summary and the report path.

## 8. CI

The hosted **Quality gate** workflow (`.github/workflows/playwright.yml`) runs static checks
(`npm run check`) **and `npm run lint:tags`** — `lint:tags` lists tests via `playwright --list` with no
server contact and no live credentials, so it is safe on a hosted runner.

Live test suites **do not run in hosted CI** (shared-server safety). Run them from the QA machine. A
ready-to-use **self-hosted** stage, gated smoke → regression:

```yaml
# .github/workflows/qa-machine.yml — run on a self-hosted runner on the QA machine, manually or nightly
name: QA run levels
on: { workflow_dispatch: {}, schedule: [{ cron: '0 2 * * *' }] }
jobs:
  smoke:
    runs-on: [self-hosted, qa-machine]
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run test:smoke
  regression:
    needs: smoke # regression only starts if smoke passed
    runs-on: [self-hosted, qa-machine]
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run test:regression
```
