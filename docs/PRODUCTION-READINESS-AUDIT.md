# KPost Test Bench — Production-Readiness Audit & Target Plan

**Date:** 2026-09-19 · **Branch audited:** `19-09-2026` @ `53ebb2a` · **Status:** approved by the owner.
**Phase 1 is done** (the four P0 defects in §3.6 and the Phase 1 items in §12 — see CLAUDE.md §8,
2026-09-19). The scores below describe the bench **as audited, before Phase 1**.

**Method.** Read `CLAUDE.md` (4 509 lines), every `docs/*.md`, the KPost documents index
(`D:\Kpost Documents`: BRD, PRD, SRS, FSD, FullSuite FRD + six per-module FRDs), and the backend
configs (`D:\KPOST_PROJECTS\{KPOST_V5.0, Kpost_Kmail_5.0, Admin_Module}`). Four parallel code audits
(API/validation engine, UI, DB/test data, CI/reporting) then read the bench source, and every claim
that drives a score below was re-checked against the code by hand. Also ran:

| Check                                 | Result                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run check`                       | ✅ 0 errors, 32 lint warnings, formatting clean                                                        |
| `playwright test --project=framework` | ✅ 107 passed, 4 skipped (4.5 s)                                                                       |
| `playwright test --list`              | 5 902 api · 148 × 3 browsers · 8 admin-ui · 111 framework · 5 setup (**integration: 0 KPost tests**)   |
| Size                                  | 392 tracked files, 330 `.ts` (207 in `src/`), ~32 500 LOC, 111 spec files, 79 commits since 2026-09-12 |

Nothing was run against a live or test host during this audit.

---

## 1. Application understanding

### 1.1 What KPOST is

A unified-communications suite (KPOST India Pvt. Ltd.): **Katchup** (chat, with a _subject on every
message_ as its differentiator), **Kall** (scheduled + ad-hoc calls, one log), **KMail** (mail with read
receipts and external interop), **KDirectory**, plus Profile, Contacts, Groups, KDiary, Settings,
KOS/KWord/K-AI, and a separate **Admin/HR-Setup** product for Medium/Large businesses. KDOC is out of
scope (BRD §4.2). Requirements: ≈165 FRs across six per-module FRDs (`FR-SL/KU/GC/GM/GMSG/KL/KM/KD`).

### 1.2 Runtime architecture (as measured, not assumed)

```
                    account.kpostindia.com / test.kpostindia.com   (React SPA, no data-testid)
                    kpostadmin.kpostindia.com                       (Admin/HR CoreUI SPA, SSO via token)
                                      │ JWT (Bearer)
       ┌──────────────────────────────┼─────────────────────────────────────┐
       ▼                              ▼                                     ▼
 KPost core API (Java/Spring)   KMail API (/testkmail/v2)          Admin API (adminmodule / :9595)
 testingapi / devapi2           MySQL + MongoDB                    MongoDB  (db: admin_enterprise)
 MySQL (JPA) — SHARED DB        ▲        │                         ObjectId ids, envelope {value,…}
       ▲   │                    │ circular dependency (SRS §4.2)
       │   └────────────────────┘
       │
 Auth service (outside Eureka) ── every module depends on it (NFR-R01)
 External: SMS/OTP gateway (Nettyfish), AWS S3 (attachments), KSMACC (account provisioning),
           AI service (K-AI), translation service, Bugzilla (192.168.0.50)
```

Data stores confirmed from the backend `application.properties`/`pom.xml`: **KPost core = MySQL (JPA)**,
**KMail = MySQL + MongoDB**, **Admin = MongoDB**. Consequences for testing (CLAUDE.md §3): a defect in
one module can surface in another (shared DB), a KMail outage can break Katchup and vice versa, and an
auth outage cascades everywhere. That is why the bench's filing path has a validity gate and cascade
consolidation.

### 1.3 Users and roles

| Axis         | Values                                                                | Where it matters                                       |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------------ |
| Account tier | PERSONAL (`@kpostindia.com` only), BUSINESS_S, BUSINESS_M, BUSINESS_L | Login (`userType` is part of the credential), admin    |
| Company role | company admin, backup admin, member                                   | `/admin/*` user management, Admin/HR module (M/L only) |
| Group role   | group admin, member (min-one-admin rule FR-GM-014)                    | Group lifecycle                                        |
| Message role | sender vs recipient — different action sets (BR-K02)                  | Katchup actions, recall/edit visibility                |
| Copy role    | TO, Copy (visible), Confidential Copy (hidden, NFR-SEC02)             | Katchup + KMail                                        |
| Call role    | host / participant                                                    | Kall schedule, join, end                               |

Auth: JWT from `userLogin` (tier in `loginRO`); **single active session per account** (a second login
displaces the first). Business-admin tokens carry `companyID`/`role`; the Admin module is SSO'd by the
same token. OTP-gated flows (signup, forgot-password, device designation, deactivation) are testable
only on the OTP test gateway (`123456`).

### 1.4 End-to-end application flow

```
 SIGNUP (OTP mobile+mail) ─► ACCOUNT ─► LOGIN (tier, device, session) ─► JWT
                                                                          │
      ┌──────────────┬───────────────┬──────────────┬──────────────┬──────┴───────┬───────────────┐
      ▼              ▼               ▼              ▼              ▼              ▼               ▼
  KATCHUP         GROUP            KALL           KMAIL         PROFILE/       KDIARY /       ADMIN/HR (M/L)
  compose→send→   create→add→      schedule→      compose→      SETTINGS/      KOS / AWS      tier→variable→
  receipt→act     admin→rename→    reschedule→    send→read→    CONTACTS       (S3 upload)    location→HR tier→
  (edit/recall/   leave/remove→    join→end→log   receipt→act                                 role→employee→
  forward…)       delete                                                                      assign role
      │              │               │              │                                              │
      └──────── shared MySQL / Mongo (cross-module side effects) ─────────────────────────────────┘
                              │
                 UI renders the same state (SPA) — cross-checked by read-back
```

### 1.5 Workflow catalogue (what a complete bench must exercise)

DB table names are **not** listed: the bench has no schema access yet and I will not guess them.
"DB change" names the entity to verify once read access exists (§5, Phase 6).

| Workflow                  | Preconditions                      | API calls (bench-registered)                                                                           | UI                             | DB change (entity)                            | Business validations                                                                                     | Negatives                                                     | Cleanup                                 | Depends on                    |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------- | ----------------------------- |
| Login & session           | Activated account                  | `fetchUserDetails` → `userLogin` → `getActiveSession` → `userLogout`                                   | `/login` 2-step, header logout | session / login-history row                   | tier must match; no enumeration; token signed + expiring                                                 | wrong pw (not 200), unknown id, wrong tier, bad/expired token | logout the throwaway session            | —                             |
| Signup (OTP gateway only) | `OTP_TEST_GATEWAY` + disposable DB | `sendOTP` → `validateOTP` → `sendOTPtoMail` → `validateMailOTP` → `signup`/`adminRegistration`         | `/signup`                      | user, company (+KSMACC for M/L)               | BR-S01 activation before login; BR-S02 unique id at submission                                           | duplicate id, weak password, missing OTP                      | **none possible** — needs DB reset      | OTP gateway                   |
| Katchup message lifecycle | 2–3 PERSONAL accounts              | `sendMessage` (messageType variants) → conversation read → edit/recall/delete/forward/…                | `/katchup` compose, bell menu  | message, per-recipient receipt                | subject on every msg (BR-K01); recall hides for recipient (BR-K03); confidential copy hidden (NFR-SEC02) | empty subject, foreign msgID, recall by non-sender            | recall/delete (in `finally` — see gaps) | Login                         |
| Disappearing messages     | 2 accounts                         | `sendMessage` with `isVanished` / `secretMessageExpireTime`                                            | lock icon (not built)          | message expiry                                | vanish after read / at schedule (FR-KU-017..024)                                                         | past expiry, read-then-fetch                                  | delete                                  | Katchup                       |
| Group lifecycle           | ≥3 accounts                        | `createUserGroup` → add → makeAdmin → rename → image → leave/remove → `deleteGroup`                    | create-group modal             | group, membership                             | min-one-admin on exit (FR-GM-014); delete requires empty group                                           | sole-admin exit, non-admin remove                             | remove all members → delete             | Login, Contacts               |
| Kall schedule / direct    | 2–3 accounts                       | `scheduledKall` → `reScheduleKall` → `joinScheduleKall` → `endKoolKall`; `initiateKall` → status → end | `CreateKallModal`              | kall, participants, call log                  | reschedule keeps kallID, status 6→7 (BR-C01)                                                             | reschedule foreign kall, end by non-host                      | `clearKallHistory` for every party      | Login                         |
| KMail compose & receipts  | 2–3 accounts                       | `postMail` → mail-content / details / read-status → mark / delete                                      | `/writemail`                   | mail, recipients, receipt                     | single TO (FR-KM-005); bcc hidden (NFR-SEC02); receipt parity with Katchup (BR-X01)                      | multiple TO, missing subject, foreign kmailID                 | delete                                  | Login, **Katchup (circular)** |
| Profile / Settings        | 1 account                          | update about/designation/basic/education → read back                                                   | `/userprofile`, `/settings`    | profile, preferences                          | read-back equals write                                                                                   | invalid DOB, oversized fields                                 | restore original                        | Login                         |
| Contacts / block          | 2 accounts                         | add → reference → delete; block → unblock                                                              | contact rail, blocked panel    | contact, block list                           | blocked user cannot message (**not asserted today**)                                                     | block self, block unknown                                     | unblock / delete                        | Login                         |
| KDiary events             | 1–2 accounts                       | `createEvent` → remarks → participants → `deleteEvent`                                                 | none (route disabled)          | event                                         | —                                                                                                        | foreign eventID                                               | delete                                  | Login                         |
| Admin/HR org build        | BUSINESS_M admin                   | tier → variable → location → HR tier → variable → employee → (role posting, gated)                     | kpostadmin 8 screens           | Mongo: tiers, variables, locations, employees | one role per employee (not in FRD — owner rule); ordered dependencies                                    | missing parent, delete in-use tier                            | reverse-order delete in `finally`       | Business login                |
| Business user management  | BUSINESS_S admin + members         | `userManagementDetails`, `addingUserByAdmin` (external, gated), hold/release, backup admin             | `/usermanagement`              | members, licences                             | licence limit; only admins manage                                                                        | member calling admin ops (**RBAC — not tested**)              | not reversible → gated                  | Business login                |
| Attachments (S3)          | 1 account                          | presigned URL → upload → check → download/thumbnail/stream → delete                                    | attach in compose              | S3 object + attachment row                    | only owner can fetch                                                                                     | foreign uuid (IDOR)                                           | delete                                  | Login, AWS                    |
| Cross-module              | 2–3 accounts                       | Katchup ↔ KMail receipts; KDirectory → launch Katchup/Kall; NFR-R02 degrade                            | —                              | —                                             | BR-X01, BR-X02                                                                                           | dependent service down → no silent data loss                  | per module                              | all                           |

---

## 2. Current architecture (what exists)

### 2.1 Layers

```
contracts/ + openapi/   ← generated from the Excel workbook (KPost/KMail) and live api-docs + PDF (Admin)
src/config/             env (zod), auth profiles, ownership, response contracts, test data (QA_* allowlist)
src/api/                client pool (1 per host) · request builder (correlation id) · registry
  definitions/          ~341–349 endpoints via define{Kpost,Katchup,Kmail,Admin}Endpoint (contract-bound)
src/validation-engine/  engine · policy (profile + production exclusion + skipValidators) · executor
                        (THE single send chokepoint) · production guard · QA-identifier guard · flow findings
src/validators/         47 validators: response 8 · request 13 · auth 5 · authz 5 · security 7 · perf 3 · common 6
src/business-rules/     4 rules — all on mock fixtures
src/database/           client/repository/validation shell — mock or disabled only
src/ui/                 screen registry · 9-check catalogue · health monitor · crawler · admin screens
src/pages/              BasePage + LoginPage only
src/bug-tracker/        fingerprint · candidate · validity gate · filer (4-layer dedup) · auto-resolve · guidance
src/reporting/          one reporter → reports/REPORT.{md,json}
tests/api/**            engine specs (describeEndpointCases) + *feature/lifecycle* specs per module
tests/e2e/ (35)         sweeps (screens/interactions/crawl/axe/keyboard/offline/visual) + feature specs
tests/framework/ (18)   the bench's own guards (live-safety, payload-audit, dedup, resolve, coverage ledgers …)
```

### 2.2 How an API test runs

A spec says only _what_: `describeEndpointCases({ tags: ['kall-read'] })`. The engine runs each
endpoint **once** (cached, pinned to one worker so an SMS endpoint is not hit once per case), then
emits **one Playwright test per validator** (≈40 per endpoint → 5 902 API cases). Each validator reads
the resolved endpoint (contract, schema, auth, toggles). Probes (negative payloads) are generated from
the request schema and pass through the same executor, so the production guard, OTP kill-switch and
QA-identifier guard apply to every request the bench sends. Findings become Bugzilla candidates →
validity gate → cascade/systemic consolidation → dedup → filed to the module owner.

### 2.3 How a workflow test runs

Hand-written `feature.spec.ts` per module, gated by `<MODULE>_LIFECYCLE=true`, calling
`endpoints.call/sendTo` with `allowLiveWrite`, self-cleaning (to varying degrees — §4). A 5xx from a
lifecycle write files as `flow.server-error`; a confirmed business-rule violation can file via
`recordBusinessRuleViolation` (used once, BR-C01).

---

## 3. Production-readiness score

Scores are evidence-based; each cites what raised or capped it.

| Category                         |   Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture                     |       7 | **+** definition → policy → engine → validator pipeline; one send chokepoint (`endpoint-executor.ts:120-190`); contract-bound definitions fail at import. **−** mock-template residue presented as product tests (`tests/api/{users,companies,health,auth,dictionary}.spec.ts`, `tests/integration/user-lifecycle.spec.ts`, `business-rules/users/*`, `database/repositories/user,company`); `TEST_ENV=production` overloaded to mean "the test hosts"; three factories duplicate a ~25-line mapping. |
| Code Quality                     |       7 | **+** strict TS, effectively 0 `any`, 6 `as unknown as`, 0 `@ts-ignore`, engine files < 350 lines, `npm run check` clean. **−** real bug: `defineKmailEndpoint` ignores `config.requestSchema` (`kmail-endpoint.ts:47`), `note` dropped by all factories, 29 `eslint-disable`, 32 lint warnings.                                                                                                                                                                                                      |
| API Automation                   |       7 | **+** ~345 endpoints registered, 0 uncovered in the contract ledger, 12 module lifecycles, payload audit + frontend-payload guards. **−** lifecycle assertions mostly `status < 300` (≈15 in Kall alone); many id-keyed reads only reachable through lifecycles.                                                                                                                                                                                                                                      |
| UI Automation                    |       6 | **+** 7 every-screen sweeps (9 checks, crawler, axe, keyboard, offline, hang detector), 3 browsers, 2–3-account flows proving NFR-SEC02, filing limited to selector-independent signals. **−** 2 page objects (login only), 131 raw `locator(`, 0 app `data-testid`, 18 hard sleeps, 8 forced clicks, 76 swallowed `.catch`, 4 NEEDS-CODEGEN flows, visual has no baselines, vertical screens' "mounted" check only sees the shell.                                                                   |
| Test Coverage                    |       6 | **+** breadth is excellent (every endpoint × 47 validators; every screen × 9 checks). **−** depth gaps: authorization 0 real endpoints, DB 0, business rules ≈26 % verified (11 ✅ / 12 🟡 / 18 ⬜ of 43), FR ledger hand-maintained (~110/165 "covered", 29 FR ids tagged), **injection/XSS/rate-limit never run on `npm run kpost`** (profile trap, §4).                                                                                                                                            |
| Validation Framework             |       8 | **+** 47 composable, profile-aware, auto-applied validators; per-endpoint `skipValidators`/`expectedStatus`/`requestSchema`; reasoned skips; systemic/cascade consolidation. **−** profile-filtered validators disappear silently instead of reporting SKIPPED; no KPost business-rule registry.                                                                                                                                                                                                      |
| Test Data Management             |       5 | **+** QA-identifier allowlist built only from explicitly-set values; production throws on missing ids; Kall + Admin tear down in `finally`. **−** Katchup (13 tests, 2 `finally`), Profile (0), AWS (0) clean up after hard `expect` → orphans on failure; every cleanup error swallowed; no ledger, no global teardown, no orphan sweep; uniqueness via ad-hoc `Date.now()`; `.env.example` has none of the ~45 `QA_*` keys.                                                                         |
| Database Validation              |       2 | Clean client → repository → validation shell, **but** no driver in `package.json`, client kinds are `'mock' \| 'none'` (`database.config.ts:3`), the 4 validations target mock `users`/`companies`. **0 DB checks on any real endpoint.** Real stores are MySQL + MongoDB.                                                                                                                                                                                                                            |
| Authentication & Authorization   |       4 | Authentication **8**: missing/invalid/malformed/expired/unsigned token probes on every endpoint, enumeration test, token-claim tests, single-session logout. Authorization **~0**: `authorization.roles/tenantScoped/privilegeEscalation` set only on mock fixtures; all 5 authz validators in `PRODUCTION_BLOCKED_VALIDATORS`; a `victim` principal exists but no scenario uses it.                                                                                                                  |
| Error Handling                   |       6 | **+** transport errors classified (timeout vs network), setup failures explicit, 429 → inconclusive, gateway 5xx gated. **−** product findings are test failures, so a run's exit code cannot distinguish "bench broken" from "API has known bugs"; cleanup failures silent; `npm run all` short-circuits on the first suite's findings.                                                                                                                                                              |
| Reporting                        |       6 | **+** single `REPORT.{md,json}`, rich bug evidence (curl, masked body, correlation id, owner, component, proof video/screenshot). **−** no per-case records (method/request/duration per test) in JSON, no stable test-case id (random `validationId`), FR ids never reach the report, no history/trend, each run overwrites the last (kpost → kmail → ui leaves only ui's report).                                                                                                                   |
| Logging & Debugging              |       7 | **+** structured logger with masking, `LOG_FORMAT=json`, `x-correlation-id` per request carried into tickets, trace/video/screenshot on failure. **−** no persisted run log file, `TEST_RUN_ID` random per process (shards differ), phone numbers not masked, a string `rawBody` printed unmasked in curl.                                                                                                                                                                                            |
| CI/CD Readiness                  |       3 | **+** well-shaped sharded workflow, files once from merged blobs, concurrency cancel, artifacts. **−** defaults to the mock (`MOCK_API: 'true'`); sets stale env names (`API_BASE_URL`, `AUTH_PRINCIPALS`, `TEST_COMPANY_ID`) the live bench never reads, never sets `KPOST_API_BASE_URL`/`QA_*`/lifecycle flags; GitHub-hosted runners cannot reach `192.168.0.38` or Bugzilla `192.168.0.50`; the quality gate is structurally always red on live.                                                  |
| Parallel Execution               |       2 | Every run script is `--workers=1`. Reasons are real and documented: fixed shared QA accounts, single-session displacement, 4 concurrent logins → 500, rate limits. No account pool or per-worker allocation. `fullyParallel: true` is unusable against the hosts.                                                                                                                                                                                                                                     |
| Maintainability                  |       5 | **+** exceptional rationale comments, 18 framework self-test specs, generated coverage ledgers. **−** ~33 behaviour flags, 12–14 flags per npm command, 22 lifecycle flags read raw outside the zod schema, ~86-entry heuristic exemption list in the QA guard, CLAUDE.md is a 4 509-line log whose §5 "current state" is stale (says ~124 files / 52 tests), `.env.example` and `requirements-frd.md` (signup still "out of scope") stale, framework tests rewrite `docs/*.md` as a side effect.     |
| Scalability                      |       6 | Adding an endpoint = one definition; adding a validator = one line, applies everywhere (O(1) design scaling). Execution does not scale: a full API + UI pass is strictly serial and will grow linearly with every module.                                                                                                                                                                                                                                                                             |
| Security Testing                 |       5 | **+** headers, sensitive-data (with calibrated false-positive handling), JWT, auth probes, OTP kill-switch, real SMS-pumping finding. **−** injection/XSS gated out of every npm run, IDOR/BOLA and privilege escalation not wired, QA guard skips multipart `text` fields and raw bodies and is off outside `TEST_ENV=production`.                                                                                                                                                                   |
| **Overall Production Readiness** | **5.5** | A genuinely strong **validation core** and **defect-quality pipeline** sitting on an **operational layer that is not production-grade**: no CI that runs the real suites, no database verification, no authorization testing, serial-only execution, inconsistent data cleanup, and several correctness bugs in the tooling itself (§4, P0).                                                                                                                                                          |

### 3.1 Production-ready today (keep)

- The validation engine, validator registry, policy, and `describeEndpointCases` model.
- The single send chokepoint with default-deny endpoint + validator allowlists and the OTP/SMS kill-switch.
- Contract generation from the workbook/api-docs and the payload-audit + frontend-payload guards.
- The defect pipeline: run gate, candidate gate, cascade + systemic consolidation, product-scoped dedup,
  curl-in-ticket, developer guidance, owner routing, proof attachments, dry-run by script.
- Framework self-tests (`tests/framework`) — they are what makes the bench trustworthy.

### 3.2 Partially implemented

- Lifecycle/workflow coverage (12 modules) — present but assertions are shallow and cleanup inconsistent.
- UI deep sweeps — present, but feature flows depend on inline selectors, sleeps and retries; 4 blocked.
- Business-rule catalogue (`docs/business-rules.md`) and filing path — built; 18 rules still ⬜.
- Profiles/tags — mechanism exists, barely used (`@smoke` on 1 endpoint, `@regression` on none).
- Per-environment config — `.env.<TEST_ENV>` layering exists; only one `.env` is used.
- FR traceability — ids on definitions + a guard; not propagated to tests, reports or tickets.

### 3.3 Missing

- Real database validation (MySQL + MongoDB adapters, KPost repositories, per-step DB assertions).
- Authorization/RBAC/IDOR testing on real endpoints.
- A test-data ledger, guaranteed teardown, orphan reconciliation.
- An account pool enabling parallel workers.
- A CI pipeline that runs the real suites (self-hosted runner) with a baseline-aware gate.
- Run history, per-case records, stable test-case IDs, FR matrix in the report.
- Page/screen objects for UI modules; app `data-testid` hooks.

### 3.4 Should be redesigned

- **The execution interface** — 31 `cross-env` scripts with 12–14 flags each → typed named run profiles
  and one runner CLI.
- **"Finding = failed test"** — separate _bench health_ (must be green) from _product findings_ (reported,
  gated against a baseline of known open bugs).
- **Cleanup** — from "call cleanup at the end of the test body" to a fixture-owned ledger that always runs.
- **`TEST_ENV=production` semantics** — split into target kind (`live` vs `disposable`) and safety tier.

### 3.5 Should not be changed

The engine/validator/policy core, the executor chokepoint and its guards, contract generation, the
bug-filing pipeline, the framework self-tests, the module-owner routing. Rewriting any of these would
destroy the most valuable, hardest-won parts of the bench.

### 3.6 Findings by priority

**Critical (P0 — correctness/safety of the bench itself; fix first):**

1. **Systemic auto-resolve can close bugs it never re-verified.** The systemic branch checks
   `index.ranEndpoint` (endpoint ran) instead of whether the validator ran on it
   (`verify-resolve.ts:160`). A platform-wide auth/header ticket whose validator was _skipped_ on its
   endpoints closes as "ran and passed". This acts on the developers' live Bugzilla.
2. **Injection, XSS and rate-limit never run on `npm run kpost/kmail/admin`.** They are
   `profiles: PROFILE_SETS.SECURITY` (`['SECURITY','FULL']`); no script or `.env` sets
   `VALIDATION_PROFILE`, so the default `REGRESSION` applies — and the cases are filtered out
   _silently_, not reported as skipped. CLAUDE.md's "full matrix incl. injection/XSS" is not true today.
3. **`.env` arms live filing** (`BUGZILLA_DRY_RUN=false`). Only the npm scripts force dry-run; a bare
   `npx playwright test` or an IDE run files tickets.
4. **`npm run all` stops after the first suite with findings** (`&&` + non-zero exit), and every run
   overwrites `reports/REPORT.*`, so a multi-suite run's evidence is lost.

**High (P1):** KMail `requestSchema` override ignored; QA guard does not inspect multipart/raw bodies and
is disabled when `TEST_ENV≠production`; authorization untested; DB validation absent; cleanup not
guaranteed (orphans on failure); CI not running the real suites; lifecycle flags outside the schema.

**Medium (P2):** no account pool/parallelism; shallow `status<300` business assertions; UI sleeps/forced
clicks/inline selectors; no per-case report data, no history; stale docs (§5, `.env.example`,
`requirements-frd.md`); mock-template residue among product specs; phone-number masking.

**Low (P3):** factory duplication and dropped `note`; 32 lint warnings; visual baselines; framework tests
writing `docs/` during test runs; CLAUDE.md length.

---

## 4. Gap analysis

| Area                    | Current implementation                                                         | Expected production standard                                              | Gap                                      | Priority | Recommendation                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Bug auto-resolve        | Systemic tickets close when endpoints _ran_                                    | Close only when the exact (endpoint, validator) ran and passed            | False closes on real Bugzilla            | **P0**   | Use `ranPair` in the systemic branch; add a framework guard for "validator skipped on all own endpoints → keep"                         |
| Security profile        | injection/xss/rate-limit only in SECURITY/FULL; scripts use default REGRESSION | Documented run tiers actually execute their documented validators         | Security probes silently absent          | **P0**   | Named run profiles set the validation profile explicitly; profile-filtered cases reported as SKIPPED with reason                        |
| Filing default          | `.env` `BUGZILLA_DRY_RUN=false`                                                | Filing armed only by an explicit, named command                           | Accidental filing                        | **P0**   | `.env` dry-run true; `:file` commands the only arming path; preflight asserts it                                                        |
| Multi-suite run         | `all` = `a && b && c`; reports overwrite                                       | All suites run; one combined report                                       | Lost coverage + evidence                 | **P0**   | Runner continues on findings; per-run directory + merged report                                                                         |
| Request-schema override | KMail factory ignores it                                                       | All factories share one mapping                                           | Silent no-op                             | P1       | Single shared `buildDefinition()` used by all factories                                                                                 |
| QA-identifier guard     | Production-only; walks body/query/path                                         | Every request on every non-mock host; multipart + raw bodies              | Coverage holes in the key safety control | P1       | Enable on any real host; inspect multipart fields (parse `text` JSON) and raw strings                                                   |
| Authorization / RBAC    | Validators exist; wired to mock fixtures only                                  | Role matrix + IDOR/BOLA per tenant-scoped endpoint on the disposable DB   | ~0 coverage                              | P1       | Add `authorization` metadata to real definitions; enable authz validators under the disposable-DB tier using `victim`/member principals |
| Database validation     | Mock/none client, fictional schema                                             | Read-only MySQL + Mongo adapters, KPost repositories, per-step assertions | 0 real checks                            | P1       | Phase 6 — needs read-only DB credentials + schema from the owner                                                                        |
| Test-data cleanup       | In test body after hard asserts; errors swallowed                              | Fixture-owned ledger, always runs, failures reported                      | Orphans on failure; silent               | P1       | `testData.track(resource, deleter)` fixture + teardown + "cleanup failed" report section                                                |
| Orphan reconciliation   | Manual DB reset                                                                | Run-scoped naming + sweeper                                               | Accumulating junk                        | P2       | Prefix every created entity `QA-<runId>-…`; sweeper lists & deletes stale QA-prefixed entities                                          |
| Env/config              | 22 lifecycle flags raw `process.env`; `.env.example` stale                     | All config typed + documented; example complete                           | Hidden config, onboarding pain           | P1       | Move flags into zod schema; generate `.env.example` from schema                                                                         |
| Execution interface     | 31 long `cross-env` scripts                                                    | Named profiles + one CLI with suite/tier/tag/env/role/endpoint options    | Unusable selectivity                     | P1       | `config/run-profiles.ts` + `scripts/run.ts`                                                                                             |
| Tags                    | `@smoke` ×1, `@regression` ×0                                                  | Auto-derived taxonomy (type, module, tier, role, FR)                      | No smoke/sanity/regression selection     | P1       | Engine auto-tags; workflow specs declare tier                                                                                           |
| Test-case ID            | Title-based; random `validationId`                                             | Stable deterministic ID per case                                          | No traceability across runs              | P2       | `TC-<suite>-<endpointId>-<validator>` (+ hash for workflows)                                                                            |
| CI                      | Hosted runner, mock, stale env                                                 | Self-hosted LAN runner, real suites, dispatch inputs, baseline gate       | CI doesn't test KPost                    | P1       | Two workflows: hosted (check + framework) and self-hosted (bench)                                                                       |
| Quality gate            | Any blocking finding fails                                                     | Fails on bench faults and **new** findings; known open bugs reported      | Permanently red                          | P1       | Baseline = open bench-tagged Bugzilla bugs (already fetched for dedup)                                                                  |
| Parallelism             | `--workers=1` everywhere                                                       | Per-worker account sets; UI and API on disjoint accounts                  | Serial, slow                             | P2       | Account pool keyed by `parallelIndex`; needs more accounts from owner                                                                   |
| Business rules          | 4 mock rules; inline `status<300`                                              | Registered KPost rules asserting the response/state                       | ≈26 % verified                           | P1       | KPost rule registry; convert the 18 ⬜ + 12 🟡 in `docs/business-rules.md`                                                              |
| UI structure            | 2 page objects; 131 raw locators                                               | Screen/component objects; selectors in one place                          | Brittle, duplicated selectors            | P2       | Screen objects per module; shared components (modal, toast, bell menu, nav)                                                             |
| UI stability            | 18 sleeps, 8 forced clicks, retries 2                                          | Web-first waits; no forced clicks; retries only for proven infra flake    | Flake masking                            | P2       | Replace sleeps with state waits; quarantine list for flaky tests                                                                        |
| UI selectors            | No app `data-testid`                                                           | Stable test ids on key controls                                           | Fragile                                  | P2       | Ask the UI owner (Ayyappan) for `data-testid` on ~60 key controls                                                                       |
| UI blocked flows        | 4 NEEDS-CODEGEN                                                                | All assertable flows green                                                | Coverage gaps                            | P2       | One headed codegen session                                                                                                              |
| Visual regression       | No baselines                                                                   | Baselines committed, reviewed                                             | Inoperative                              | P3       | `ui:visual:update` once, commit                                                                                                         |
| Reporting               | One REPORT, overwritten; aggregates only                                       | Per-run folder, per-case JSONL, history index, FR matrix                  | No trend, weak traceability              | P2       | Phase 8                                                                                                                                 |
| Logging                 | Console only; run id per process                                               | Persisted JSONL log per run; one run id across shards                     | Hard post-mortem                         | P2       | `reports/runs/<runId>/log.jsonl`; run id passed via env                                                                                 |
| Masking                 | Keys/JWT/emails; not phones                                                    | All PII masked                                                            | PII in tickets                           | P2       | Add mobile-number/Aadhaar/PAN patterns                                                                                                  |
| Cross-module            | Implicit                                                                       | Explicit BR-X01/X02, NFR-R02 tests                                        | Untested differentiator                  | P2       | `tests/cross-module/`                                                                                                                   |
| Docs                    | CLAUDE.md 4.5k lines, §5 stale                                                 | Short map + decision records                                              | Onboarding cost                          | P3       | Split §8 into `docs/decisions/`; CLAUDE.md ≤ 400 lines                                                                                  |
| Template residue        | Mock users/companies specs among product specs                                 | Self-test fixtures clearly separated                                      | Misleading coverage                      | P3       | Move to `tests/framework` / `src/selftest-fixtures`                                                                                     |

---

## 5. Target production architecture

The target is an **evolution** of the current bench, not a rewrite. The core (§3.5) stays; the missing
operational layers are added around it.

```
                         ┌────────────────────── RUNNER (scripts/run.ts) ───────────────────────┐
 npm run bench -- …  ──► │ run profile (typed) → env + validation profile + tags + projects      │
                         │ target (testing | live) → safety tier                                 │
                         └───────────────┬───────────────────────────────────────────────────────┘
                                         ▼
 ┌──────────── Playwright projects ───────────────────────────────────────────────────────────────┐
 │ setup (per-worker account sessions from POOL) → api · workflows · e2e[3 browsers] · e2e-admin    │
 │ framework (no network)                                                                           │
 └───────────────┬─────────────────────────┬───────────────────────────────┬───────────────────────┘
                 ▼                         ▼                               ▼
      Validation Engine (as today)   Workflow layer (NEW)            UI layer
      definitions → policy →          src/flows/<module> reusable     screen objects + components
      executor (chokepoint:           steps; BR registry asserts;     + ui-checks/crawler (today)
      guards) → validators            DB assertions per step
                 │                         │                               │
                 └──────────┬──────────────┴───────────────┬───────────────┘
                            ▼                              ▼
             Test-Data layer (NEW)                  Database layer (NEW adapters)
             account pool · factories ·             MySQL (core, KMail) · Mongo (KMail, Admin)
             resource ledger → teardown →           read-only user · repositories per KPost entity
             orphan sweeper                         · named validations attached to steps
                            │
                            ▼
             Results → Reporting (per-run dir, per-case JSONL, history, FR matrix)
                     → Bug pipeline (as today; baseline-aware quality gate)
                     → CI (self-hosted runner) artifacts + step summary
```

Design rules the target keeps:

1. A request only ever leaves through `EndpointExecutor.send` (guards apply to everything).
2. Common logic exists once: validators, business rules, DB validations, screen checks are registered and
   _attached_, never re-implemented in a spec.
3. A spec states _what_ (endpoint set, workflow, screen); the framework owns _how_.
4. Anything created is tracked and removed by the framework, not by the test body.
5. A run never files unless the named command says so.
6. Bench health and product findings are reported separately.

---

## 6. Proposed folder structure

Keep the existing top-level layout. Add the missing folders, and move files only where the move removes
a real confusion. **(NEW)** = new, **(MOVE)** = relocated, the rest is unchanged.

```
kpost-testbench_v2/
├─ CLAUDE.md                        # the map (≤ 400 lines); history moves to docs/decisions (MOVE)
├─ config/                          # (NEW) non-secret, typed run configuration
│  ├─ targets.ts                    # testing | live → hosts, safety tier (replaces TEST_ENV overload)
│  └─ run-profiles.ts               # smoke, sanity, regression, security, deep, ui, all …
├─ contracts/  openapi/             # generated (unchanged)
├─ docs/
│  ├─ architecture/                 # (NEW) this audit, target architecture, flow maps
│  ├─ decisions/                    # (NEW) one record per past §8 entry
│  ├─ modules/                      # (MOVE) katchup-flow, kall-flow, kmail-flow, admin-flow …
│  ├─ generated/                    # (MOVE) COVERAGE, LIVE-ENDPOINTS, BLOCKED, PAYLOAD-AUDIT …
│  └─ COMMANDS.md  RUNBOOK.md  business-rules.md  requirements-frd.md
├─ scripts/
│  ├─ run.ts                        # (NEW) the one runner CLI
│  └─ contract/*.cjs                # (MOVE) existing converters
├─ src/
│  ├─ config/                       # env (all flags in the zod schema), auth, ownership, contracts
│  ├─ api/                          # unchanged; one shared buildDefinition() for all factories
│  ├─ validation-engine/            # unchanged (+ profile-filtered = SKIPPED)
│  ├─ validators/                   # unchanged (+ authorization wired to real endpoints)
│  ├─ business-rules/kpost/<module>/ # (NEW) registered KPost rules
│  ├─ database/
│  │  ├─ adapters/{mysql,mongo}.ts  # (NEW) read-only
│  │  ├─ repositories/kpost/…       # (NEW) katchup, kall, kmail, group, contacts, kdiary, admin
│  │  └─ validations/kpost/…        # (NEW) named, attachable
│  ├─ test-data/                    # (NEW)
│  │  ├─ account-pool.ts            # per-worker account sets
│  │  ├─ factories/                 # run-scoped unique names (QA-<runId>-…)
│  │  └─ ledger.ts  sweeper.ts      # track → teardown → report; orphan sweep
│  ├─ flows/<module>/               # (NEW) reusable multi-step workflows (send→recall, org build …)
│  ├─ ui/
│  │  ├─ screens/<module>/          # (NEW) screen objects (from inline selectors + support/katchup.ts)
│  │  ├─ components/                # (NEW) header, nav rail, ModalComponent, toast, bell menu
│  │  └─ checks/ crawler/ health/   # existing
│  ├─ bug-tracker/  reporting/      # existing (+ history, per-case JSONL, merged runs)
│  └─ selftest/                     # (MOVE) mock fixtures: users, companies, dictionary + their rules/DB
├─ tests/
│  ├─ framework/                    # bench self-tests (+ the mock-template specs, MOVE)
│  ├─ api/<suite>/<module>/         # engine contract specs
│  ├─ workflows/<module>/           # (MOVE) today's api/**/feature.spec.ts + lifecycle.spec.ts
│  ├─ cross-module/                 # (NEW) BR-X01/X02, NFR-R02, KDirectory launch
│  ├─ e2e/<module>/                 # (MOVE) grouped by module; sweeps under e2e/_sweeps
│  ├─ e2e-admin/
│  └─ setup/  teardown/             # (NEW teardown: ledger drain + sweeper)
├─ mock-server/
└─ .github/workflows/
   ├─ pr.yml                        # hosted: check + framework (no network)
   └─ bench.yml                     # self-hosted LAN: dispatch inputs + optional nightly
```

---

## 7. Test strategy

**Two axes:** _test type_ (what is checked) and _tier_ (how much, when). Tags carry both, auto-derived
where possible so no one hand-tags thousands of engine cases.

| Tier / tag    | Scope                                                                                                                       | Target duration | When                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------: | --------------------------- |
| `@smoke`      | each principal logs in; one read per module; UI shell + login; framework guards                                             |        < 10 min | every deploy, gate for rest |
| `@sanity`     | the critical path per module: send→recall, schedule→reschedule, compose→read, org-build create→delete, profile edit→restore |        < 30 min | after a deploy passes smoke |
| `@regression` | engine REGRESSION profile on every endpoint + every workflow + UI sweeps + feature flows                                    |           hours | on demand / nightly         |
| `@security`   | SECURITY profile (injection, XSS, rate limit) + auth probes + RBAC/IDOR + sensitive data + headers                          |            ~1 h | on demand; disposable DB    |
| `@deep`       | write-fuzz on `data` writes (disposable DB, reset after)                                                                    |           hours | on demand                   |

| Test type         | Where it lives                                        | How                                                                                          |
| ----------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| API contract      | `tests/api/<suite>/<module>`                          | `describeEndpointCases` — unchanged                                                          |
| Functional/BR     | `tests/workflows/<module>`                            | `src/flows` steps + registered business rules (assert the response/state, never `<300`)      |
| Database          | attached to workflow steps (`@db`)                    | read-only DB validation after each write step                                                |
| Integration       | `tests/workflows` (single module, multi-endpoint)     | flow steps across endpoints of one module                                                    |
| Cross-module      | `tests/cross-module`                                  | Katchup↔KMail receipts (BR-X01), account rules (BR-X02), dependent-service failure (NFR-R02) |
| UI                | `tests/e2e/<module>`                                  | screen objects; sweeps stay generic                                                          |
| E2E               | `tests/e2e/<module>` (`@e2e`)                         | act in UI → verify by API read-back → verify in DB                                           |
| Negative/boundary | engine request validators (auto) + workflow negatives | schema-driven probes (today) + rule negatives per workflow                                   |
| AuthN / AuthZ     | engine validators + `tests/workflows/security`        | auth probes (today) + role matrix / IDOR with `victim` & member principals                   |
| Session/token     | `tests/workflows/login`                               | today's login-flow + refresh, expiry, displacement                                           |
| File up/download  | `tests/workflows/attachments`                         | presigned upload → check → download → IDOR → delete                                          |
| Concurrency       | `tests/workflows/concurrency` (`@concurrency`)        | concurrent logins (known 500), parallel sends, double-submit                                 |
| Recovery          | `tests/cross-module` + UI network-resilience          | offline/timeout recovery, no silent data loss                                                |

Tag taxonomy (auto where possible): `@api|@workflow|@e2e|@ui|@db`, `@<suite>`, `@<module>`,
`@smoke|@sanity|@regression|@security|@deep`, `@role-<principal>`, `@FR-KU-005`, `@destructive`.

---

## 8. Validation strategy

The current engine already implements the requested model; the work is to extend it to the three
families that are wired only to mock fixtures today, and to remove the silent gaps.

1. **Keep:** one registry; validators declare `stage`, `profiles`, applicability; policy resolves per
   endpoint; endpoints compose via `skipValidators`, `expectedStatus`, `requestSchema`, toggles.
2. **Report every exclusion.** A profile-filtered validator is emitted as SKIPPED
   (`not in profile REGRESSION`), like production exclusions today — no silent disappearance.
3. **Presets.** Named validator presets per endpoint kind (`public-read`, `authed-read`, `data-write`,
   `upload`, `otp`) so a new endpoint picks one preset + overrides.
4. **Authorization.** Real definitions declare `authorization: { roles, tenantScoped,
privilegeEscalation }`; authz validators run in the `@security` tier on the disposable DB using
   `victim`/member principals; stay blocked on `live`.
5. **Business rules as registered validators.** `src/business-rules/kpost/<module>/<id>.rule.ts`, each
   with the FR/BR id, the step it constrains, and the response/state check. Workflows attach rules; a
   violation files via the existing `recordBusinessRuleViolation` path. `docs/business-rules.md` becomes
   a generated view of the registry (so "✅" is measured, not claimed).
6. **Database validations** — same shape as today's `database.<id>` validators, attached to endpoints
   _or_ workflow steps, run by the real adapters (Phase 6).
7. **Field-level checks** stay schema-driven (`common.*` + request fuzzers) — no per-endpoint code.

---

## 9. Test-data strategy

| Concern           | Target                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts          | An **account pool**: N account _sets_ (each set = the 3–6 personal + business accounts a worker needs); worker _i_ takes set _i_; UI and API use disjoint sets so no session is displaced. Pool size 1 = today's behaviour. |
| Identity safety   | Keep the explicit-value allowlist; the pool feeds it; the guard runs on every real host.                                                                                                                                    |
| Unique data       | Factories stamp `QA-<runId>-<worker>-<n>`; no ad-hoc `Date.now()`.                                                                                                                                                          |
| Dependencies      | Workflows declare dependencies (group needs members; Admin role needs employee + tier); `src/flows` build prerequisites.                                                                                                    |
| Setup/teardown    | A `testData` fixture: `track(resource, deleter)`; the fixture tears down in reverse order **after** the test, pass or fail; a failed cleanup is reported (not swallowed) in its own report section.                         |
| Orphans           | A sweeper (global teardown + on-demand command) lists QA-prefixed entities older than the run and deletes them; `@deep` runs end with a DB-reset reminder/hook.                                                             |
| Restore-type data | Profile/settings: snapshot → mutate → restore via the ledger.                                                                                                                                                               |
| Irreversible      | Signup, provisioning (`rolePosting`, `addingUserByAdmin`), deactivation: gated, disposable-DB only, recorded as needing reset.                                                                                              |
| DB transactions   | Not applicable black-box (the bench cannot wrap the app's transactions); isolation comes from run-scoped data + read-only DB checks.                                                                                        |
| Environments      | `config/targets.ts` holds per-target non-secret data; secrets and account ids stay in `.env.<target>`; `.env.example` generated from the schema.                                                                            |

---

## 10. Reporting strategy

Per run: `reports/runs/<runId>/` containing `REPORT.md`, `REPORT.json`, `cases.jsonl`, `log.jsonl`, and
Playwright HTML/JUnit; `reports/latest/` is a copy; `reports/history.json` appends one summary line per run.

Each **case record** (`cases.jsonl`) carries: run id, stable test-case id, suite, module, feature/FR ids,
test type, tier, environment/target, browser, endpoint, method, masked request, response status,
expected, actual, assertions, DB-validation result, duration, timestamp, owner, bug id + owner, failure
reason, stack, evidence paths (screenshot, video, trace, log slice), retry count, final status.

`REPORT.md` keeps today's two parts (execution health, bug report) and adds: bench-health verdict
(separate from product findings), new vs known findings vs baseline, cleanup failures, FR coverage
matrix, and the trend vs the previous run. A multi-suite run produces one merged report.

Traceability chain: **TC id → correlation id → request/response (curl) → DB validation → finding →
Bugzilla id → evidence files**.

---

## 11. Execution strategy

One runner, thin npm aliases for the common cases:

| Need               | Command                                                        |
| ------------------ | -------------------------------------------------------------- |
| Run all            | `npm run bench -- --profile all`                               |
| Smoke / regression | `npm run bench -- --profile smoke` · `--profile regression`    |
| API / UI / DB only | `--type api` · `--type ui` · `--type db`                       |
| One module         | `--module katchup`                                             |
| One endpoint       | `--endpoint kall-reschedule`                                   |
| One workflow       | `--workflow katchup/recall`                                    |
| By role            | `--role business-m`                                            |
| By tag             | `--tag @security`                                              |
| Failed tests       | `--last-failed` (Playwright native)                            |
| Target environment | `--target testing` / `--target live`                           |
| Parallel           | `--workers 4` (bounded by account-pool size; refused above it) |
| File bugs          | `--file` (the only way to arm filing)                          |
| Locally / in CI    | same command; CI passes inputs via `workflow_dispatch`         |

CI: `pr.yml` (GitHub-hosted: `check` + framework, no network — fast and always green or it's the bench's
fault) and `bench.yml` (self-hosted runner on the LAN that can reach the test hosts and Bugzilla;
`workflow_dispatch` inputs: profile, target, module, tag, file; optional nightly). Scheduling stays
optional, not the core. Gate: fail on bench faults and on **new** findings above the severity floor;
known open bugs are reported, not gating.

---

## 12. Implementation roadmap

Each phase is independently shippable, keeps `npm run check` and the framework guards green, and
records its intent/outcome in CLAUDE.md per the working agreement.

### Phase 1 — Foundation (correctness & safety of the bench)

- **Objective:** remove the P0/P1 defects in the bench itself and make the docs tell the truth.
- **Components:** systemic auto-resolve fix; explicit validation profile per command + profile-filtered
  = SKIPPED; `.env` dry-run default + preflight; `all` runs every suite; shared `buildDefinition()` (fixes
  KMail `requestSchema`); QA guard on any real host + multipart/raw bodies; lifecycle flags into zod;
  `.env.example` regenerated; CLAUDE.md §5 and `requirements-frd.md` corrected.
- **Files:** `src/bug-tracker/verify-resolve.ts`, `src/validation-engine/endpoint-cases.ts`,
  `src/validation-engine/qa-identifier-guard.ts`, `src/validation-engine/endpoint-executor.ts`,
  `src/api/definitions/{kpost,kmail,admin}/*-endpoint.ts`, `src/config/env.ts`, `package.json`,
  `.env.example`, `CLAUDE.md`, `docs/requirements-frd.md`, new guards in `tests/framework/`.
- **Dependencies:** none.
- **Risks:** turning on SECURITY validators in `kpost` raises the finding count — preview dry-run first.
- **Acceptance:** new framework guards for each fix pass; a dry `kpost` report lists injection/XSS cases
  (run or skipped-with-reason); `all` produces results for all three suites.

### Phase 2 — Core framework (execution & data plumbing)

- **Objective:** a usable execution interface and guaranteed cleanup.
- **Components:** `config/targets.ts`, `config/run-profiles.ts`, `scripts/run.ts`; tag taxonomy
  auto-derivation; stable TC ids; `testData` ledger fixture + teardown + cleanup-failure reporting;
  account-pool abstraction (size 1 initially); run-scoped naming; move mock-template specs to self-test.
- **Files:** `config/*`, `scripts/run.ts`, `src/test-data/*`, `src/fixtures/index.ts`,
  `src/validation-engine/endpoint-cases.ts`, `playwright.config.ts`, `tests/setup|teardown`.
- **Dependencies:** Phase 1.
- **Risks:** script rename breaks habits → keep old npm names as aliases for one release.
- **Acceptance:** every command in §11 works; a forced failure mid-workflow leaves no orphan (verified by
  read-back); cleanup failures appear in the report.

### Phase 3 — Centralized validators (extend to authz, rules, DB hooks)

- **Objective:** close the "wired only to mocks" gaps in the validator families.
- **Components:** KPost business-rule registry; `authorization` metadata on real definitions; validator
  presets; PII masking (mobile/Aadhaar/PAN); generated `business-rules.md`.
- **Files:** `src/business-rules/kpost/**`, `src/api/definitions/**`, `src/utils/masking.ts`,
  `src/validation-engine/validation-policy.ts`, `tests/framework/business-rules-coverage.spec.ts`.
- **Dependencies:** Phase 2 (tags/tiers).
- **Risks:** RBAC expectations must come from the owner/FRDs, not be guessed → confirm the role matrix first.
- **Acceptance:** each registered rule has an id, step and response check; authz validators run (not
  skip) on tenant-scoped endpoints in `@security` on the test DB.

### Phase 4 — API automation (depth)

- **Objective:** turn shallow lifecycle checks into rule assertions; migrate cleanup; RBAC/IDOR live on test DB.
- **Components:** `src/flows/<module>`; workflows moved to `tests/workflows`; the 18 ⬜ + 12 🟡 rules;
  FR tags toward 165; signup/OTP flows; attachment upload→IDOR→delete.
- **Files:** `tests/api/**/feature.spec.ts` → `tests/workflows/**`, `src/flows/**`.
- **Dependencies:** Phases 2–3.
- **Risks:** new assertions surface real defects → dry-run preview and per-class review before filing
  (the established "valid bugs only" discipline).
- **Acceptance:** no workflow asserts only `status < 300`; `business-rules.md` shows measured coverage;
  0 orphans after a failing run.

### Phase 5 — UI automation

- **Objective:** maintainable, deterministic UI tests.
- **Components:** screen objects + shared components; remove sleeps/forced clicks; codegen pass for the 4
  blocked flows; stronger ready selectors for verticals; visual baselines; Admin UI tuning; a
  `data-testid` request list for the UI owner.
- **Files:** `src/ui/screens/**`, `src/ui/components/**`, `tests/e2e/**`, `tests/e2e/support/*` (absorbed).
- **Dependencies:** Phase 2 (account pool for multi-account UI).
- **Risks:** selector churn on a test-id-less SPA → each migrated spec must stay green on live before the next.
- **Acceptance:** 0 `waitForTimeout`, 0 `force: true` outside documented exceptions; no raw selectors in
  feature specs; blocked flows green.

### Phase 6 — Database validation

- **Objective:** verify persistence, not just responses.
- **Components:** read-only `mysql2` + `mongodb` adapters; repositories for KPost entities; DB
  validations attached to workflow steps (message stored with subject, recall flag, kall id stable on
  reschedule, confidential recipient stored hidden, admin tier/variable/employee docs).
- **Files:** `src/database/adapters/*`, `src/database/repositories/kpost/**`,
  `src/database/validations/kpost/**`, `src/config/database.config.ts`, `package.json`.
- **Dependencies:** **owner:** read-only credentials for the testing MySQL + Mongo, network route, schema
  (table/collection names). Phases 3–4.
- **Risks:** a write-capable DB user is dangerous → require a read-only account and assert it at startup.
- **Acceptance:** each module's sanity workflow has ≥ 1 DB assertion that runs (not skips) on the test target.

### Phase 7 — End-to-end workflows

- **Objective:** UI → API → DB chains and cross-module rules.
- **Components:** `tests/cross-module` (BR-X01 receipt parity, BR-X02, NFR-R02 degrade, KDirectory launch);
  E2E flows (compose in UI → read-back via API → DB check).
- **Dependencies:** Phases 4–6.
- **Acceptance:** one E2E per core module green; cross-module rules asserted.

### Phase 8 — Reporting & observability

- **Objective:** traceable, historical reports.
- **Components:** per-run folder, `cases.jsonl`, `log.jsonl`, history index, merged multi-suite report,
  FR matrix, new-vs-known findings, single run id across shards.
- **Files:** `src/reporting/**`, `src/utils/logger.ts`, `merge.config.ts`.
- **Dependencies:** Phase 2 (TC ids, tags).
- **Acceptance:** any failed case can be followed TC id → request → DB result → bug → evidence from the report alone.

### Phase 9 — CI/CD integration

- **Objective:** CI that tests KPost.
- **Components:** `pr.yml` (hosted), `bench.yml` (self-hosted runner, dispatch inputs, optional nightly),
  baseline-aware gate, artifacts per run.
- **Dependencies:** **owner:** a self-hosted runner on the LAN + GitHub environment secrets. Phases 1, 2, 8.
- **Risks:** CI filing duplicates → shards stay dry; single merge-job filing (as today).
- **Acceptance:** a dispatched `smoke` on `testing` runs the real suites and publishes the report; PR
  workflow green in < 10 min.

### Phase 10 — Production hardening

- **Objective:** speed, stability, and maintainability at scale.
- **Components:** parallel runs with a real account pool; flaky-test quarantine with an expiry; framework
  tests stop writing `docs/` during test runs (generate via a command); CLAUDE.md split into map + decision
  records; runbook refresh; periodic orphan sweep.
- **Dependencies:** **owner:** enough accounts for N worker sets. All earlier phases.
- **Acceptance:** regression wall-clock reduced proportionally to pool size with no session-displacement
  skips; 0 quarantined tests past expiry.

---

## 13. Decisions needed from the owner before Phase 1

1. **DB access** — can the bench get a **read-only** user on the testing MySQL (core + KMail) and MongoDB
   (KMail + Admin), and the schema? (Phase 6 is blocked without it.)
2. **Accounts** — how many more QA account sets can be created for a parallel pool (Phase 10)?
3. **CI runner** — is a self-hosted runner on the LAN acceptable (Phase 9)?
4. **Findings in CI** — confirm the gate should fail on _new_ findings only, with known open bugs reported.
5. **`TEST_ENV=production`** — agree to split it into target (`testing`/`live`) and safety tier.
6. **RBAC matrix** — who confirms the expected role permissions (FRDs + owner)?
7. **`data-testid`** — will the UI owner add test ids to the key controls?
