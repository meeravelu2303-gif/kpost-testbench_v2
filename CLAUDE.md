# CLAUDE.md — KPost Test Bench v2

Read this first. It is the map and the rulebook; the detail lives in `docs/`:

- `docs/reference/bench-reference.md`: full product, architecture, pipeline, contracts, plan and conventions
  (the original long sections, verbatim; "§6", "§8" in older notes refer to it)
- `docs/reference/decision-log.md`: every decision and incident, newest first. **After changing a flow, add an entry at the top.**
- `docs/reference/production-readiness-plan.md`: the measured state of the bench, the phased plan to production grade, and its scoreboard
- `docs/guides/commands.md`: every npm script · `docs/guides/runbook.md` · `docs/guides/bug-filing.md` · `docs/guides/validation-framework.md`

## 1. What this bench tests

KPOST is a unified communications platform (chat, calling, mail under one login). The bench finds real
defects in it and files them to Bugzilla, routed to the developer who owns the module.

| Bugzilla product | Suite       | Owner                                    | Host (from `.env`)                                                      |
| ---------------- | ----------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| KPost API        | `kpost-api` | Jaganathan Murthy (jagan@kpost.in)       | `KPOST_API_BASE_URL` (testingapi.kpostindia.com)                        |
| KPost Admin      | `admin-api` | Jaganathan Murthy                        | `ADMIN_API_BASE_URL` (http://192.168.0.38:9595)                         |
| KMail API        | `kmail-api` | Jitendra Kumar (jitendra@kpost.in)       | `KMAIL_API_BASE_URL` (testkmail.kpostindia.com, prefix `/testkmail/v2`) |
| KPost UI         | `kpost-ui`  | Ayyappan Ashok (ayyappan@kpostindia.com) | `BASE_URL` (test.kpostindia.com)                                        |
| KPost Admin UI   | `admin-ui`  | Ayyappan Ashok                           | `ADMIN_UI_BASE_URL` (kpostadmin.kpostindia.com), `tests/e2e-admin`      |

**The target is the TEST deployment only** — `test.kpostindia.com`, `testingapi`, `testkmail`, the Admin
test box. Never `account.kpostindia.com`, `devapi2`, `kmail5` or `adminmodule.kpostindia.com`; those
names appear in docs only as "the live counterpart". `TEST_ENV=production` names the safety mode, not a host.

Owners are declared once in `src/config/ownership.config.ts`; a framework test fails on drift.

Modules: Signup & Login, Katchup (chat with a Subject on every message), Group, Kall, KMail, KDirectory,
Profile, Contacts, Settings, KDiary, KBooking, Admin/HR-Setup. Requirement ids `FR-xx-NNN` come from the
six per-module FRDs in `D:\Kpost Documents`; map in `docs/reference/requirements-frd.md`.

**Scope right now (owner directives, restated 2026-10-10: "exclude concurrency and KWord, test everything else"):**

- **KDoc/KOS/KWord (`/kword/*`, `/kdoc`) is EXCLUDED from ALL testing (API and UI)** until the owner says
  otherwise. Wired into the commands (`--grep-invert @kos`, KOS dir excluded, `PAUSED_SCREENS`); a memory
  note alone is not enforcement. Open KDoc bugs only get a dated "paused" note.
- **Concurrency is EXCLUDED** (`CONCURRENCY_PROBES=false` on every command, the `concurrency/` dir is never
  listed, `@concurrency` is grep-inverted). Load/soak tests do not exist; per-request performance validators
  DO run as part of every FULL profile.
- **Everything else is in scope, business tiers included.** `QATEST_ONLY=true` re-points the PERSONAL roles
  at qatest1-6 but KEEPS the business accounts (`QA_BUSINESS_*`, with their own `QA_BUSINESS_PASSWORD`),
  so business UI specs, the admin-api suite and the role/cross-tenant authorization validators run under
  the product commands. The business accounts are shared with developers: a lost session there is noise,
  not a defect.
- **Admin API scope = the owner's PDF list** (38 definitions, `scripts/apply-admin-pdf-payloads.cjs`). Admin payloads never send `companyId`; the
  backend takes it from the token (security specs send a FOREIGN one on purpose).

## 2. Application flow the bench exercises

```
REGISTER ─► ACTIVATE ─► LOGIN (JWT) ─┬─► KATCHUP  compose(Subject) → send → edit/recall/forward/… → read receipts
 (OTP test gateway)                  ├─► KALL     schedule → modify → join → reschedule (new id, original → ReScheduled) → end
                                     ├─► KMAIL    compose → receipts → external recipients
                                     └─► PROFILE / CONTACTS / GROUP / SETTINGS / KDIARY / KBOOKING / ADMIN
```

Architecture risk: microservices on a **shared monolithic DB**, KMail↔Katchup circular dependency, Auth
service outside the registry. A cascade is expected, so one infrastructure failure must never become
50 tickets (the validity gate exists for this).

## 3. Repository structure

```
src/config/             env (zod, all flags + defaults), api, auth profiles, database, thresholds, ownership
src/api/                client (pool, request builder, token provider) · registry · schemas · definitions/<product>/<module>/*.api.ts
src/validation-engine/  engine · policy (profiles) · endpoint-cases.ts (one test per endpoint×validator) · flow-finding · production guard
src/validators/         centralized validators (auth, authz, request, response, security, performance, concurrency, common)
src/business-rules/     business-rule registry (KPost's rules are asserted in the module feature specs)
src/database/           MySQL / disabled adapters, per-suite pool, repositories, named DB validations
src/bug-tracker/        Bugzilla client · fingerprint · candidate · validity gate · filer · verify-resolve · bug-builder
src/reporting/          bugzilla-reporter (the filing pipeline) · run-summary · bug-report
src/ui/                 screens registry (PAUSED_SCREENS), failure-diagnostics
tests/api/<product>/    per-module specs: *.spec.ts wrappers + feature.spec.ts lifecycle flows; tests/api/kpost/security/*
tests/e2e/, tests/e2e-admin/, tests/framework/   UI specs, Admin UI specs, bench self-tests
contracts/, openapi/    GENERATED from the Excel workbook. Never hand-edit
docs/                   guides/ (how to run) · reference/ (what the bench is + the decision log) · modules/ · ui/ · scope/
                        · generated/ (written by `framework`; never hand-edit) · audits/ · api-specs/ (the owner's
                        workbooks and PDF) · archive/. Index: docs/README.md
```

**The central idea:** a validation exists once. An endpoint definition states only what is specific to it;
the engine applies every applicable validator. Test title format: `<label> [<endpoint-id>] › <validator> — …`,
so `--grep "\[endpoint-id\]"` targets one endpoint.

Playwright projects: `setup`, browser projects (chromium/firefox/webkit), `admin-ui`, `api`, `framework`.
Profiles: `SMOKE` → `REGRESSION` (default) → `SECURITY` → `FULL` (= everything, incl. security).

Key flags (defaults in `src/config/env.ts`): `BUGZILLA_DRY_RUN` (true), `BUGZILLA_AUTO_RESOLVE` (true),
`BUGZILLA_RESOLVE_ONLY`, `VALIDATION_PROFILE`, `TEST_DB_MODE` (full matrix on a disposable test DB),
`WRITE_FUZZ` (fuzz writes; needs TEST_DB_MODE), `ALLOW_DESTRUCTIVE_TESTS`, `OTP_TEST_GATEWAY` (123456
validates; only on a genuine test gateway), `*_LIFECYCLE` (gated feature flows), `DB_ALLOW_WRITES`.
Always armed regardless of flags: the QA-identifier guard (no request may name a record we don't own),
the OTP/SMS kill-switch, and `sideEffect: 'global'`/`external` blocks.

## 4. The run → Bugzilla flow (one command per product)

| Product        | Preview (dry run)                | Real filing                           |
| -------------- | -------------------------------- | ------------------------------------- |
| KPost API      | `npm run product:kpost-api`      | `npm run product:kpost-api:file`      |
| KMail API      | `npm run product:kmail-api`      | `npm run product:kmail-api:file`      |
| KPost Admin    | `npm run product:kpost-admin`    | `npm run product:kpost-admin:file`    |
| KPost UI       | `npm run product:kpost-ui`       | `npm run product:kpost-ui:file`       |
| KPost Admin UI | `npm run product:kpost-admin-ui` | `npm run product:kpost-admin-ui:file` |
| Everything     | `npm run product:all`            | `npm run product:all:file`            |

Also: `kpost:full:verify` (status pass only: closes verified fixes, dates every open bug, files nothing),
`ui:chromium:file` / `ui:firefox:file` / `ui:webkit:file` (one browser per run), `framework` (bench self-tests),
`check` (typecheck + lint + format; must pass before anything is "done"). `cross-env` works only via `npm run`;
in a shell, set env vars natively.

What one `*:file` run does, in order (`src/reporting/bugzilla-reporter.ts`):

```
tests run ─► candidates built (API reports, UI failures, a11y) ─► merge + collapseCountVariants + consolidateCascades
  ─► validity gate (rejects transient/infra/env noise, 429, gateway 5xx, bench faults, NS_ERROR_*/net::ERR_*)
  ─► run sanity gate (blocks ALL filing if the run collapsed, was interrupted or ran zero tests)
  ─► dedupe vs live Bugzilla: open → comment · INVALID/WONTFIX/DUPLICATE → never refile · FIXED-but-back → reopen
     (same tag or same fault via reopenByFault) · uncertain brand-new → needs-review (held back) · search failed → file nothing
  ─► file (with curl, proof: screenshot / video / trace / diagnosis / a11y details)
  ─► status pass over EVERY open bug of the product: close if its own check passed cleanly this run,
     otherwise a dated plain-English note (STILL BROKEN / NOT RE-CHECKED + why / KDoc paused)
  ─► reports/REPORT.md + REPORT.json
```

API bugs re-verify by their `(endpoint, validator)` pair; UI bugs by their originating test title, only on
the browsers in their `[browser:…]` whiteboard tag. Full spec: `docs/reference/bench-reference.md` §6.

## 5. Running safely: hard rules

1. **Never run Playwright while a live run is in progress**, not even `--list` or `framework`. Check
   `Get-CimInstance Win32_Process` first (the bash PID doesn't map to the Windows PID).
2. **Back up `reports/REPORT.json`/`.md` before any other Playwright command**: every run overwrites them.
3. **Never edit source files while a run is reading them** (one mid-run delete auto-filed 46 false bugs).
4. **Run logs and ad-hoc output go to the scratchpad, never the repo root.** Any extra Playwright output
   folder must match `/test-results*/` or `/playwright-report*/` (gitignored). Traces contain bearer tokens and
   login passwords; a committed `*-admin` report folder leaked `QA_PASSWORD` to the public GitHub repo.
5. **Never delete the log of a running background task.**
6. **Long runs throttle the server**: give it a 25–40 min cool-down between browsers. Run WebKit in small
   file batches; kill a hung run with PowerShell `Stop-Process`.
7. **One wrong-password attempt per account per run**, always followed by a good login, never in parallel.
8. **Never write to an endpoint with no delete/cleanup path** on a live system; use an auth-gate probe
   (unparseable body, no token) to prove "requires login" with zero write risk.
9. **The Admin DB is live**: it stays read-only in code; no env var unlocks it.

## 6. Bug filing: standing rules (owner directives, do not ask again)

- **Run everything, then file once** per product. No drip of tickets after every sub-run.
- **Verify live before filing, reopening or closing.** Replay the exact original request. A developer's
  "fixed" claim, a bench verdict and a source review all lose to a live replay. The live Admin server is
  newer than the local source copy.
- **Reopen the same bug id, never refile.** Duplicate-check before any
  manual filing (`scripts/bugzilla-duplicate-check.cjs`), against the right component and platform-wide components (General/Home) too.
- **Plain English, every product.** What's broken + a bottom line a non-QA reader follows. API bugs keep the
  `bug-builder.ts` template (Classification / curl / evidence); UI bugs use the one UI template
  (Classification / Module / Summary / Steps / Expected / Actual), never a curl.
- **`status_whiteboard` must be `[cat:X][browser:Y]`** or the bug shows as Unclassified.
- **One root cause = one bug**, naming its blast radius (count + affected tests/endpoints/screens). A shared
  background component failing on every screen is one systemic ticket (`uiSystemicFingerprint`).
- **API status-code drift vs a stale frontend** is its own bug class: file both halves.
- **Every open bug gets a dated, self-contained, plain-English comment on every full run**, filed or not.
  That comment is the only thing developers read (BUGZILLA-UI Excel "Comments (newest first)" column), so
  write it as if they've never seen the ticket.
- **Post-deploy flow:** when the owner names bugs to mark fixed, wait for explicit "deploy done", then live-verify
  each one: FIXED with what was checked, or left open with what still failed. Never close on request alone.
- **Hand-filed bugs** (no `[KP-xxxxxx]` tag) are never auto-closed; they need a by-hand re-check.

## 7. Verification discipline: lessons that cost real time

- **Assert correct behaviour, not the predicted bug.** The live failure is the evidence.
- **A batch failure isn't real until it reproduces alone.** Re-run isolated before filing.
- **Read the real request bytes.** Playwright re-encodes a non-JSON string body; `rawBody` is sent as a
  `Buffer` (`tests/framework/raw-body.spec.ts`). Check `sendTo()` literal bodies the same way.
- **No response ≠ failed check.** A transport error/timeout/429 is "not re-checked", never "still broken".
- **A 401 streak confined to one endpoint (happy path included) is a bench auth blip**, not a finding: re-test
  with a known-good token before writing it into Bugzilla.
- **Cross-tenant "fixed" needs an owner control**: the owner's identical call must succeed while the
  stranger's fails, or the 4xx proves nothing.
- **Flow-triggered bugs (`flow.server-error`) and business rules inside `feature.spec.ts`** are not reachable
  by `--grep "[endpoint-id]"`; re-test them by running the lifecycle flow with its `*_LIFECYCLE` flag.
- **Test a matcher against real Bugzilla data**, not hand-written fixtures. Browser-filter counts use
  substring match on the whiteboard (`[browser:chromium,firefox]` counts for both).
- **A check that couldn't run says SKIPPED with a reason**, never PASSED. A collapsed run is loud, never clean.

## 8. Contracts and conventions

- **The Excel workbook wins** (`docs/api-specs/KPOST API (N).xlsx`; the highest N is used).
  `npm run contract:excel` → `contract:coverage` → `contract:gaps`. Never hand-edit `contracts/` or `openapi/`.
- **Only POST and GET exist.** Documented payload = POST, none = GET; every derived method records its source.
- **Never invent a contract or a payload value.** Send what the real frontend sends; `payload-audit.spec.ts`
  enforces it. Admin save endpoints take a JSON array; update takes an object.
- **Use `testData.*` and the account registry** (`src/fixtures/test-accounts.*`, by role), never hardcoded ids.
  QA test companies: 242 (`QA_BUSINESS_M_*`) and 1034 (`QA_BUSINESS_S_*`).
- **Secrets come from `.env` only** and are masked in logs, reports and tickets. `.env`, `.auth/`, reports and
  traces are gitignored.
- **SQL binds values and validates identifiers**; DB writes need `DB_ALLOW_WRITES=true`.
- Tests say **which** endpoint is tested; the engine owns **how**.
