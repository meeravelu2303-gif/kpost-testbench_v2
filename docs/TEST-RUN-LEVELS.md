# Test run levels — Smoke, Sanity, Regression

The bench runs at three **levels**, selected by **tags**. One runner (`scripts/run-level.mjs`)
drives them, lints the tags first, and never files bugs.

> **Scope.** In-scope modules: **Auth (Signup & Login), Katchup, Kall, KMail**, plus the wider
> in-scope set for regression/sanity (Profile, Settings, Contacts, Home, Group, User Management,
> verticals, platform). **Admin (Admin API + Admin UI) joins SANITY only** (since 2026-10-19, matching
> CLAUDE.md); smoke and regression never select it — its full runs stay on the `admin:*` commands.

## 1. What each level is

| Level          | Question it answers                                 | Shape                                                                                                                                               | When                                                                           |
| -------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **smoke**      | "Is the build even alive?"                          | Broad + shallow — 1–3 critical checks per in-scope core module, per suite. Read-only.                                                               | First. If smoke fails, nothing else runs. API smoke ≤ 2 min, UI smoke ≤ 5 min. |
| **sanity**     | "Does every area still work after this deploy/fix?" | **Full sanity** (default): every module's reads + one core write flow + every screen, API and UI, plus Admin. Narrow it with `--module` or `--bug`. | After a deploy, or after a fix (narrowed).                                     |
| **regression** | "Did we break anything that used to work?"          | The full stable suite.                                                                                                                              | Before a release — and only after smoke passes.                                |

Smoke ⊆ sanity ⊆ regression: every stable test carries `@regression`; smoke and sanity tests carry it
too, because they are subsets of it. Two deliberate exceptions: **sweep** tests (`@sanity-sweep`) are a
cheap SMOKE-profile projection of what regression already runs in depth, so they carry `@sanity` without
`@regression`; and **Admin** tests carry `@sanity` + `@admin` only.

## 2b. What full sanity covers

`npm run test:sanity` (no arguments) runs four stages, Chromium only, dry-run, and keeps going after a
failing stage so one run names every broken area:

| Stage         | What runs                                                                                                                                                                                                                                                                                                                                               | Where it comes from                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **KPost API** | Every live-safe read endpoint of every module at the SMOKE profile (status, envelope, schema, content type, refusal without a token); one core write flow per module (send/recall, compose, place a call, add a contact, create a group, edit profile, toggle settings, diary write, booking search, presigned upload, dashboard, login); the API smoke | `tests/api/sanity/read-sweep.spec.ts` (derived from `productionSafe`), `@sanity` on each module's `feature.spec.ts` |
| **KPost UI**  | Every screen in the registry loads cleanly in its own session (personal, business, public); each module's curated `@sanity` UI tests; the UI smoke (incl. Katchup + KMail send)                                                                                                                                                                         | `tests/e2e/sanity-screens.spec.ts` (derived from `src/ui/screens.ts`), `@sanity` on the module specs                |
| **Admin API** | Every live-safe Admin / HR-Setup read at the SMOKE profile                                                                                                                                                                                                                                                                                              | `tests/api/admin/sanity-read-sweep.spec.ts`                                                                         |
| **Admin UI**  | The login front door; every Admin screen mounts with its shell, no crash, no 5xx                                                                                                                                                                                                                                                                        | `tests/e2e-admin/admin-sanity.spec.ts`, `admin-login.spec.ts`                                                       |

Selection is derived wherever it can be: a new live-safe endpoint or a new screen joins sanity with no
spec change; a paused one (KDoc/KOS) leaves it. KMail API sanity follows the KMail auth gate (skips with
the tracked reason until `KMAIL_AUTH_FIXED=true`). Group has no live-safe read, so its API sanity is its
curated feature flow.

**Coverage is enforced, not hoped for.** `lint:tags` fails if any module has in-scope tests in a suite
but no `@sanity` test there, or if the Admin API or Admin UI has none — so a module cannot quietly drop
out of sanity.

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

1. every in-scope test has `@regression`, `@quarantine` **or** `@sanity-sweep` (with `@sanity`);
2. every in-scope test has at least one module tag;
3. every hand-written tag is defined in `tags.ts` (or is a valid `@bug-<number>`); an engine-generated
   test's extra endpoint area tags (`@katchup-read`, `@company`, …) belong to its endpoint definition;
4. **smoke budget:** at most **3** `@smoke` tests per module per suite (override `--budget=N`);
5. **sanity budget:** at most **15** curated `@sanity` tests per module per suite (`--sanity-budget=N`;
   `@sanity-sweep` tests are exempt);
6. **sanity coverage:** every module with in-scope tests in a suite has a `@sanity` test there, and the
   Admin API and Admin UI each have one (see §2b);
7. an Admin test may carry `@sanity` (with `@admin`) and no other run level.

Lint counts every generated engine test (one per endpoint × check, ~16,900 in-scope tests), keyed by the
real spec file and describe path. Before 2026-10-19 it keyed by `file + title`, and every generated test
reports the engine's helper file, so the whole engine sweep collapsed to ~50 checked entries.

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

npm run test:sanity                        # FULL sanity: auth smoke, then KPost API, KPost UI, Admin API, Admin UI
npm run test:sanity -- --suite api         # full sanity, API stages only (KPost + Admin)
npm run test:sanity -- --module katchup    # auth smoke precondition, then @sanity + @katchup
npm run test:sanity -- --module admin      # auth smoke precondition, then the two Admin stages
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

**Live-host guard:** every level refuses to start unless each target (`BASE_URL`, `API_BASE_URL`,
`KPOST_API_BASE_URL`, `KMAIL_API_BASE_URL`, `ADMIN_API_BASE_URL`, `ADMIN_UI_BASE_URL`, read from `.env`
like the config does) is a test deployment host — `test.kpostindia.com`, `testingapi.kpostindia.com`,
`testkmail.kpostindia.com`, the Admin test box `192.168.0.38`, `kpostadmin.kpostindia.com` (or
localhost). `adminmodule.kpostindia.com` (the live Admin) is refused. There is no override. (`TEST_ENV=production` in `.env` is the bench's safety _mode_ while
pointing at the test hosts, so the guard checks the hosts, not that label.) `@destructive` tests never
run in smoke/sanity, and run in regression only when `ALLOW_DESTRUCTIVE_TESTS=true`.

**Same suite as the module scripts:** every level runs on the QA test accounts only (`QATEST_ONLY=true`),
with every module's write/lifecycle flow switched on (the flags `kpost`, `kmail` and `ui:chromium` set),
and always excludes paused modules (`@kos` — KDoc/KOS). Without this, the gated write flows would
silently skip and the run would use developer-shared accounts.

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
