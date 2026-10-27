# Test run levels — Smoke, Sanity, Regression

The bench runs at three **levels**, selected by **tags**. One runner (`scripts/run-level.mjs`)
drives them, lints the tags first, and never files bugs.

> **Scope.** In-scope modules: **Auth (Signup & Login), Katchup, Kall, KMail**, plus the wider
> in-scope set for regression/sanity (Profile, Settings, Contacts, Home, Group, User Management,
> verticals, platform). **Admin (Admin API + Admin UI) joins SANITY (since 2026-10-19) and SMOKE (since
> 2026-10-22)**, always in its own runner stages; regression never selects it — its full runs stay on the
> `admin:*` commands.

## 1. What each level is

| Level          | Question it answers                                 | Shape                                                                                                                                               | When                                                                            |
| -------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **smoke**      | "Is the build even alive?"                          | Broad + shallow — 1–3 critical checks per in-scope module, per suite (§2a). Read-mostly; the few writes clean up after themselves.                  | First. If smoke fails, nothing else runs. API smoke ≤ 2 min, UI smoke ≤ 15 min. |
| **sanity**     | "Does every area still work after this deploy/fix?" | **Full sanity** (default): every module's reads + one core write flow + every screen, API and UI, plus Admin. Narrow it with `--module` or `--bug`. | After a deploy, or after a fix (narrowed).                                      |
| **regression** | "Did we break anything that used to work?"          | The full stable suite.                                                                                                                              | Before a release — and only after smoke passes.                                 |

Smoke ⊆ sanity ⊆ regression: every stable test carries `@regression`; smoke and sanity tests carry it
too, because they are subsets of it. Two deliberate exceptions: **sweep** tests (`@sanity-sweep`) are a
cheap SMOKE-profile projection of what regression already runs in depth, so they carry `@sanity` without
`@regression`; and **Admin** tests carry `@admin` with `@sanity` and/or `@smoke`, never `@regression`.

## 2a. What smoke covers

`npm run test:smoke` checks first that the test deployment answers at all (exit code **4 = ENVIRONMENT
DOWN**, nothing run, not a product failure), then runs the API smoke and, if it passed, the UI smoke.
Every in-scope KPost module is covered on both layers, within the budget of 3 smoke tests per module
per suite (`lint:tags` enforces it). Then the **Admin smoke** runs in its own two stages (Admin API, Admin UI),
whatever the KPost result, so the two products get two verdicts. An unreachable Admin box is reported as
ENVIRONMENT DOWN (Admin) and never blocks the KPost smoke or the regression gate.

```
tests/support/smoke/
  smoke-checks.ts      the API checks as data: module → 1–3 reads, the fields each answer must hold
  smoke-read.ts        how a read is judged: HTTP 200, SUCCESS envelope, fields present, our own account, hang guard
tests/kpost-api/smoke/kpost-api.smoke.spec.ts   one test per KPost row, plus "no login → 401"
tests/kmail-api/smoke/kmail-api.smoke.spec.ts   one test per KMail row
tests/admin-api/smoke/admin-api.smoke.spec.ts   the Admin API rows (Admin stage), plus "no login → 401"
tests/admin-ui/smoke/
  admin.smoke.spec.ts  the Admin login screen for a visitor; every Admin screen loads (company admin)
tests/kpost-ui/smoke/
  smoke-ui.ts          shared steps: which screens belong to which module, how a screen proves it loaded
  screens.smoke.spec.ts   every registry screen loads in its session, one test per module
  auth.smoke.spec.ts      sign in through the login screen and sign out (spare account qatest5)
  katchup.smoke.spec.ts   qatest1 sends, qatest2 receives in their own browser
  kmail.smoke.spec.ts     qatest1 sends a mail, qatest2 opens it and reads the text; both copies deleted
  kall.smoke.spec.ts      the Kool Kall scheduling form opens, ready to fill
  contacts.smoke.spec.ts  the contact list finds a known contact
  group.smoke.spec.ts     a group the user is added to appears in Katchup and opens (created/deleted as qatest3)
  account.smoke.spec.ts   Home and Profile show the signed-in user; the side navigation opens each module
```

| Module           | API smoke (what the answer must hold)                              | UI smoke                                        |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Signup & Login   | active session is ours; login history; no login → 401              | Login + Signup screens; real sign-in / sign-out |
| Katchup          | unread count; frequent contacts; conversation count                | screen loads; message delivered to the 2nd user |
| Kall             | call history; today's Kool Kalls; frequent contacts                | screens load; Kool Kall form opens              |
| KMail            | status counts; unread count; salutations                           | inbox + compose load; mail delivered and read   |
| Contacts         | contact list; blocked list                                         | contact list finds a known contact              |
| Group            | groups the user belongs to                                         | a new group appears in Katchup and opens        |
| Profile          | own profile (our account); languages                               | screen loads; shows the user's own name, photo  |
| Settings         | personalisation; notifications                                     | screen loads                                    |
| Home             | the dashboard feed                                                 | screen loads; header shows the signed-in user   |
| Verticals        | KDiary today + events; KBooking city search                        | KDiary, KCloud, KBooking, KNews, ECommerce, …   |
| User Management  | member summary; company details (business admin)                   | screen loads (business session)                 |
| Platform         | the API is up                                                      | 404 + public pages load; side navigation works  |
| Admin / HR-Setup | Work Place, HR Setup, Role Posting, Employee reads; no login → 401 | login screen; every Admin screen loads          |

A smoke check never skips because the saved session is gone: landing on the login page is a failure.
The KMail mail-body check asserts the correct behaviour, so it stays red while #1348 (empty mail body)
is open.

## 2b. What full sanity covers

`npm run test:sanity` (no arguments) runs four stages, Chromium only, dry-run, and keeps going after a
failing stage so one run names every broken area:

| Stage         | What runs                                                                                                                                                                                                                                                                                                                                               | Where it comes from                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KPost API** | Every live-safe read endpoint of every module at the SMOKE profile (status, envelope, schema, content type, refusal without a token); one core write flow per module (send/recall, compose, place a call, add a contact, create a group, edit profile, toggle settings, diary write, booking search, presigned upload, dashboard, login); the API smoke | `tests/kpost-api/sanity/read-sweep.spec.ts` and `tests/kmail-api/sanity/read-sweep.spec.ts` (derived from `productionSafe`), `@sanity` on each module's `feature.spec.ts` |
| **KPost UI**  | Every screen in the registry loads cleanly in its own session (personal, business, public); each module's curated `@sanity` UI tests; the UI smoke (incl. Katchup + KMail send)                                                                                                                                                                         | `tests/kpost-ui/sanity/sanity-screens.spec.ts` (derived from `src/ui/screens.ts`), `@sanity` on the module specs                                                          |
| **Admin API** | Every live-safe Admin / HR-Setup read at the SMOKE profile; the core write flow (workplace tier → variable → location, HR tier, employee record: create, read back, delete, no external side effect)                                                                                                                                                    | `tests/admin-api/engine/sanity-read-sweep.spec.ts`, `tests/admin-api/flows/feature.spec.ts` (`ADMIN_LIFECYCLE`, set by the runner)                                        |
| **Admin UI**  | The login front door; every Admin screen mounts with its shell, no crash, no 5xx                                                                                                                                                                                                                                                                        | `tests/admin-ui/sanity/admin-sanity.spec.ts`, `admin-login.spec.ts`                                                                                                       |

Selection is derived wherever it can be: a new live-safe endpoint or a new screen joins sanity with no
spec change; a paused one (KDoc/KOS) leaves it. KMail API sanity follows the KMail auth gate (skips with
the tracked reason until `KMAIL_AUTH_FIXED=true`; the runner sets it since 2026-10-22). Group has no
live-safe read, so its API sanity is its curated feature flow.

**How sanity reads a result.** A response slower than its time budget is a **warning** (shown with its
timing), not a failure; a request that never answers still **fails**. A check that fails exactly the way a
person already ruled "not a defect" in Bugzilla (INVALID/WONTFIX) is **skipped with that ruling and the ticket
number** (`JUDGED_CHECKS` in `src/bug-tracker/known-false-positives.ts`), never passed. Every other failure
counts. Regression keeps the strict time budgets.

**Deliberately without an API write in sanity: User Management (business).** All 8 of its writes (add
member, terminate, reset password, hold/release, backup admin, company, bank, role) are `sideEffect:
'global'`: they create, end or change real business accounts. The production guard refuses every
`global` write on this environment and no flag unlocks it (`tests/kpost-api/admin/member-lifecycle.spec.ts`
is written and stays skipped). Its API sanity is the reads; its write paths are covered on screen
(`usermanagement.spec.ts`).

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
7. an Admin test may carry `@sanity` and `@smoke` (always with `@admin`), never `@regression`.

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
`testkmail.kpostindia.com`, the Admin API test box `192.168.11.11`, the Admin UI test build `192.168.10.22`, `kpostadmin.kpostindia.com` (or
localhost). `adminmodule.kpostindia.com` (the live Admin) is refused. There is no override. (`TEST_ENV=production` in `.env` is the bench's safety _mode_ while
pointing at the test hosts, so the guard checks the hosts, not that label.) `@destructive` tests never
run in smoke/sanity, and run in regression only when `ALLOW_DESTRUCTIVE_TESTS=true`.

**Same suite as the module scripts:** every level runs on the QA test accounts only (`QATEST_ONLY=true`),
with every module's write/lifecycle flow switched on (the flags `product:kpost-api`, `product:kmail-api` and `product:kpost-ui:chromium` set),
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

Live test suites **do not run in CI** (shared-server safety): they are started by hand from the QA
machine, and nothing runs on a schedule (owner decision).
