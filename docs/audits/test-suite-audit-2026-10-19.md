# Test-suite audit — inventory, gaps, production-grade plan (2026-10-19)

**Scope.** The whole bench at `feat/rtm-annotations` @ `f83ea04`: `tests/`, `src/`, `contracts/`, `openapi/`,
`.github/workflows/`, `playwright.config.ts`, `package.json`.

**Method.** Measured from the code, not from the bench's own docs. A static analyser parsed every spec, endpoint
definition, validator, contract and FRD row (string-aware comment stripping; Prettier-wrapped `expect\n.soft(`
handled; helper-built endpoint definitions such as KMail's `getRead(...)` resolved). **No Playwright was run**
(CLAUDE.md §5.1). Where a figure can only come from a live run (engine check counts, pass rates), it is quoted from
the bench's generated ledgers and marked _(ledger)_. Static parsing cross-checked against `grep`: test
declarations within 2 of 1,024; endpoints 356 vs the registry's 357.

**Corrections to the earlier chat summary.** "~1,650 tests" was wrong: it counted 634 in-body `test.skip(...)`
calls. The true figure is **1,022 declared tests**. Generated ledgers (`docs/generated/*`) date from 2026-10-12,
five days behind HEAD.

---

## 0. Headline findings

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Severity |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **The ~50 validators that decide "this is a bug" are not unit-tested.** No self-test calls any validator's `check()` with a crafted response. Only `sensitive-data`'s `findingFor` and the concurrency support helpers are exercised directly. Every other verdict is trusted on the strength of live runs, and wrong verdicts file real Bugzilla tickets.                                                                                                            | Critical |
| 2   | **Several validator families have nothing to bite on.** Contracts carry **zero** `required`, `maxLength`, `minLength`, `enum`, `format` or `pattern` constraints (164 KPost request schemas, 0 with `required`), so `request.required-fields`, `boundary-value`, `enum` and `format` are near-inert. **0** definitions declare `authorization.roles`/`tenantScoped` or `security.rateLimit`, so the 5 authorization validators and `security.rate-limit` never apply. | High     |
| 3   | **Response schemas are "types only, every field optional + nullable"** (`sample-schema.ts`). A response that drops every documented field still passes `response.schema`. Only type drift is caught.                                                                                                                                                                                                                                                                  | High     |
| 4   | **CI runs no tests.** `.github/workflows/playwright.yml` runs `check` + `lint:tags` only. The 327 offline self-tests (stubbed `fetch`, local HTTP server, DB-guarded skips) could run on every PR and don't.                                                                                                                                                                                                                                                          | High     |
| 5   | **No code-coverage instrumentation anywhere.** No c8/nyc/Istanbul in the bench; the application source (`D:\KPOST_PROJECTS`, referenced by CLAUDE.md) is **not present on this machine**, and this checkout has **no `node_modules`**, so it cannot run as-is.                                                                                                                                                                                                        | Medium   |
| 6   | **Account-security flows exist only as permanent skips:** `changePassword`, `deactivateAccount`, primary/secondary device switch, admin `resetPassword`/`terminateUser`/`addingUserByAdmin`, UI New-Password complexity. ~29 `test.skip(true, …)` placeholders.                                                                                                                                                                                                       | High     |
| 7   | **Brute-force / lockout / OTP-throttling are untested by design** (rule §5.7, one wrong password per run). Nothing proves the server throttles a password or OTP guesser.                                                                                                                                                                                                                                                                                             | High     |
| 8   | **Strong areas:** IDOR/BOLA specs with owner controls and DB evidence; attachment byte integrity (SHA-256); negative-input fuzzing by type/null/empty/malformed JSON/unknown fields/injection/XSS; a mature filing pipeline with 39 offline tests in `bug-tracker.spec.ts`.                                                                                                                                                                                           | —        |

---

## 1. Inventory and count

### 1.1 By test type

| Type                                | What it is here                                                                                                                  | Spec files |                                       Declared tests |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------: | ---------------------------------------------------: |
| **Unit** (bench self-tests)         | `tests/framework/*` + `@framework` wiring tests inside `tests/api/**/coverage.spec.ts`. No HTTP. Tests the **bench**, not KPost. |    36 + 15 |                                   242 + 85 = **327** |
| **Unit** (KPost application)        | None in this repo. The app's own repos were not available to inspect.                                                            |          0 |                                                    0 |
| **Integration** (API flows)         | `feature` / `*-workflow` / `lifecycle` specs: multi-step journeys, self-cleaning, 12 files also assert DB rows                   |         48 |                                              **222** |
| **API / Contract**: hand-written    | per-endpoint functional specs + smoke                                                                                            |         26 |                                               **50** |
| **API / Contract**: engine          | 31 wrapper specs call `describeEndpointCases()`, which emits one test per endpoint × applicable validator                        |         31 | ~22,300 checks _(ledger, 2026-10-11; 169 endpoints)_ |
| **Security** (API)                  | `tests/api/kpost/security/*`: BOLA/IDOR/PII, cross-company                                                                       |         16 |                                               **30** |
| **Security** (UI)                   | `*-security.spec.ts`, token, stored-XSS render, child-safety                                                                     |         14 |                                               **18** |
| **Concurrency** (API)               | `tests/api/kpost/concurrency` (owner-excluded, `@concurrency` grep-inverted)                                                     |          1 |                                                    7 |
| **UI / E2E**: functional            | per-module flows, multi-session (`newContext`) where needed                                                                      |        110 |                                              **261** |
| **UI**: screen sweep / smoke        | `screens-batch1..4`, `screens-business/public`, `crawl`, `shell`, `smoke`, responsive                                            |         15 |                                                   38 |
| **UI**: accessibility               | axe per screen + per dynamic state, keyboard navigation                                                                          |         12 |                                                   28 |
| **UI**: resilience / error-handling | `page.route` fault injection (`*-api-handling`, `resilience`, `network-resilience`, `*-breakage`)                                |         11 |                                                   23 |
| **UI**: performance / visual / i18n | `performance-single-user`, `monitoring-smoke`; `visual*`; `i18n-switch`                                                          |  2 / 2 / 1 |                                            3 / 2 / 2 |
| **Admin UI**                        | `tests/e2e-admin`                                                                                                                |          5 |                                                   11 |
| **Total**                           |                                                                                                                                  |    **353** |                                            **1,022** |

Of the 695 tests that touch a live system, **341 (49%) sit in `*_LIFECYCLE`-gated files**. Every product command
turns those flags on (`scripts/run-level.mjs` `RUN_FLAGS`), except `KOS_LIFECYCLE` (owner exclusion). They are
real coverage on a product run, but **absent from any ad-hoc `playwright test`** with default env.

### 1.2 API coverage by module (hand-written tests that send HTTP)

| Module            | Endpoints defined | Live-safe (default run) | Hand-written HTTP tests | of which negative¹ | Flow tests |       DB-asserting files | Coverage                                                   |
| ----------------- | ----------------: | ----------------------: | ----------------------: | -----------------: | ---------: | -----------------------: | ---------------------------------------------------------- |
| KMail             |                71 |                      16 |                      54 |               35 % |         45 |                        3 | 🟢 Heavy                                                   |
| Katchup           |                36 |                       9 |                      49 |               27 % |         46 |                        2 | 🟢 Heavy                                                   |
| Signup/Login      |                13 |                       8 |                      39 |               59 % |         24 |                        3 | 🟢 Heavy                                                   |
| Profile           |                47 |                      13 |                      35 |               46 % |         29 |                        2 | 🟡 Good; 9 OTP + 6 device endpoints never driven           |
| Security (cross)  |                 — |                       — |                      30 |               97 % |          — | (DB evidence in 9 files) | 🟢 Strong                                                  |
| Common            |                33 |                      22 |                      22 |               23 % |         18 |                        0 | 🟡 Mostly reads                                            |
| Contacts          |                16 |                       8 |                      14 |               50 % |         14 |                        1 | 🟡                                                         |
| Kall              |                23 |                       6 |                      13 |               38 % |         13 |                        0 | 🟠 No DB assertions; connected call untestable (WebRTC)    |
| Settings          |                 7 |                       2 |                       8 |                0 % |          8 |                        1 | 🟠 No negative tests                                       |
| Admin (Admin API) |                38 |                       9 |                       7 |               71 % |          5 |                        0 | 🟠 38 endpoints, 7 hand tests; 22 destructive              |
| Group             |                13 |                   **0** |                       6 |               67 % |          5 |                        0 | 🟠 Nothing on the default live run                         |
| KDiary            |                14 |                       4 |                       5 |               20 % |          4 |                        0 | 🟠 Thin                                                    |
| AWS (S3)          |                 4 |                       3 |                       5 |               40 % |          1 |                        0 | 🟡                                                         |
| Dashboard         |                 3 |                       2 |                       3 |               33 % |          3 |                        0 | 🟡                                                         |
| KBooking          |                 5 |                       3 |                       2 |               50 % |          2 |                        0 | 🔴 `blockTicket` never runs; 4 real endpoints undocumented |
| Core `/admin/*`   |                12 |                       4 |                       1 |                0 % |          1 |                        0 | 🔴 All 8 writes are `global`, so blocked                   |
| KOS / KWord       |                21 |                       2 |                       4 |                  — |          4 |                        0 | ⚪ Owner-excluded                                          |

¹ Classified by test title (reject / invalid / denied / stranger / 4xx / expired / malformed / XSS …).

**Endpoints named in no hand-written spec**, so only the generic sweep touches them (16 of 356):
`/rolePosting/update`, `/rolePosting/delete`, `/rolePosting/suspendOrTerminateEmployee` (Admin);
`/v2/admin/updateRole`, `/admin/createKpostIDAndDesignationSuggestion`, `/admin/displayNameSuggestion`;
`/v2/common/downloadProfileImage/{kpostID}`; `/kmailSetting/deleteLetterHead`; all six profile **device** OTP/
primary/secondary endpoints; two `/kword/*`. The other 340 are named in at least one hand-written spec. That is
an upper bound on depth: being a step in someone else's flow is not the same as having your own rule asserted.

### 1.3 UI coverage by module

| Module                                                    | Spec files | Tests | Negative | Fault-injection (`route`) | Multi-session | Notes                                                                  |
| --------------------------------------------------------- | ---------: | ----: | -------: | ------------------------: | ------------: | ---------------------------------------------------------------------- |
| Katchup                                                   |         32 |    71 |     32 % |                        14 |             4 | 🟢 Deepest: compose, forward, recall, receipts, secret message, drafts |
| Signup/Login                                              |         22 |    60 |     48 % |                        11 |             0 | 🟢 Validation-heavy; OTP-gated steps skip on live                      |
| KMail                                                     |         17 |    46 |     26 % |                         2 |             7 | 🟢 Two-session read receipts; stored-XSS render                        |
| Settings                                                  |         20 |    36 |     44 % |                         2 |             0 | 🟡 Change-password step 2 is a permanent skip                          |
| Profile                                                   |         10 |    24 |     33 % |                         2 |             0 | 🟡                                                                     |
| Home                                                      |          9 |    22 |     50 % |                         6 |             0 | 🟢 Best resilience coverage                                            |
| Contacts                                                  |          6 |    18 |     39 % |                         1 |             0 | 🟡                                                                     |
| Group                                                     |          7 |    11 |     27 % |                     **0** |             1 | 🟠 No error-path UI tests                                              |
| Kall                                                      |          6 |    11 |     27 % |                     **0** |             0 | 🟠 No error-path UI tests; no connected call                           |
| Admin UI                                                  |          5 |    11 |     64 % |                         0 |             0 | 🟠 Mostly "screen is alive" checks                                     |
| UserMgmt (business)                                       |          3 |     6 |     33 % |                         0 |             0 | 🔴 The only business-tier screen                                       |
| KDirectory / KDiary / KBooking / KCloud / KNews / KPoster |   1–2 each |   1–8 |        — |                         0 |             0 | 🔴 Launch/load only                                                    |

### 1.4 Bench source: what the self-tests cover

| `src/` area                                    |   LOC |                        Files directly imported by self-tests | Assessment                                                                  |
| ---------------------------------------------- | ----: | -----------------------------------------------------------: | --------------------------------------------------------------------------- |
| `bug-tracker` (filing, gate, dedupe)           | 3,839 |                                                       8 / 11 | 🟢 Strong, with an offline Bugzilla stub                                    |
| `config`                                       | 2,611 |                                                      11 / 14 | 🟢 Ownership drift, env template, QATEST mode                               |
| `validation-engine`                            | 3,037 |                                                       9 / 16 | 🟡 Wiring, policy and production guard; **not** verdict logic               |
| `reporting`                                    | 2,069 |                                                        3 / 5 | 🟡 run-summary, status-comment                                              |
| `ui` (screens, checks, diagnostics)            | 2,457 |                                                        4 / 9 | 🟡 Coverage ledgers; the 9 `ui.*` checks are untested                       |
| **`validators/*` (8 families, 50 validators)** | 3,234 | 3 / 58 (registry index, concurrency support, sensitive-data) | 🔴 See finding 1                                                            |
| `database` (client, repositories, validations) | 1,768 |                                                       3 / 13 | 🔴 SQL-builder safety is tested; repositories and named validations are not |
| `pages` (page objects)                         | 1,277 |                                                        0 / 6 | 🔴 Exercised only by live UI runs                                           |
| `business-rules`                               |    62 |                                                        0 / 2 | ⚪ Registry is empty on purpose; rules live in `feature.spec.ts`            |

---

## 2. Quality and coverage gap analysis

### 2.1 Happy path vs negative scenarios

| Layer                       | Happy path                                                              | Negative / edge                                                                                                                                                                                                                                                                                          | Verdict                                                                                               |
| --------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| API engine (every endpoint) | `status-code`, `content-type`, `structure`, types-only `schema`         | Effective: `data-type`, `null-value`, `empty-value`, `malformed-json`, `unknown-fields`, `invalid-payload`, injection (5 payloads), XSS (3 payloads), auth (missing/invalid/malformed/expired token). **Inert:** `required-fields`, `boundary-value`, `enum`, `format` (no constraints in any contract). | 🟡 Wide but shallow: catches crashes and type confusion, not rule violations                          |
| API hand-written            | 222 flow tests assert end-state (DB rows, recipient view, byte digests) | 34 % of flow titles are negative; security specs 97 %                                                                                                                                                                                                                                                    | 🟢 Good where it exists                                                                               |
| API authorization           | Owner control present in 10 of 16 security specs                        | Stranger-vs-owner IDOR on Katchup, Kall, KDiary, KWord, profile records, cross-company Admin                                                                                                                                                                                                             | 🟢 Hand-written layer is solid. 🔴 Engine layer is inert (0 endpoints declare roles or tenant scope). |
| Account security            | Login, session, edited-token expiry                                     | **Not tested:** password change, reset single-use, deactivate, device switch, lockout, OTP brute-force or replay, genuine-expiry refusal (RTM-SEC02 waits for a token to age)                                                                                                                            | 🔴                                                                                                    |
| UI functional               | 261 tests; Katchup, KMail and Signup are deep                           | 38 % negative by title                                                                                                                                                                                                                                                                                   | 🟡                                                                                                    |
| UI error-handling           | —                                                                       | 42 `page.route` injections in 19 files; **zero** for Group, Kall, Admin UI, UserManagement                                                                                                                                                                                                               | 🟠 Ad hoc, not per-screen                                                                             |
| UI cross-cutting            | 21-screen sweep × 9 `ui.*` checks; axe in 15 files                      | Visual: 2 screenshot assertions. Viewport: 10 sites. i18n: 2 tests.                                                                                                                                                                                                                                      | 🟠                                                                                                    |

### 2.2 Assertion quality and hygiene (measured)

| Metric                                      |            API |     UI | Reading                                                                                                                     |
| ------------------------------------------- | -------------: | -----: | --------------------------------------------------------------------------------------------------------------------------- |
| `expect` calls                              |          1,089 |  1,105 |                                                                                                                             |
| …of which `expect.soft`                     | **353 (32 %)** |     25 | 72 tests assert **only** softly. Intentional (findings are filed, the run continues), but a soft-only test never fails red. |
| In-body conditional `test.skip`             |            235 |    387 | 206 tests carry at least one runtime skip; see the skip ledger for reasons                                                  |
| Permanent `test.skip(true, …)` placeholders |            ~26 |      2 | Account-security and admin-provisioning flows (finding 6)                                                                   |
| `waitForTimeout` (fixed sleeps)             |              0 | **48** | Worst: `e2e-admin/admin-dead-screens` (9), `interactions` (4), `*-accessibility` (2–3 each)                                 |
| `force: true` clicks                        |              0 |     18 | Hides overlap/visibility defects                                                                                            |
| `mode: 'serial'` files                      |              9 |      0 | One failing step silently skips the rest of the chain (already hit three times, per `api-coverage-depth.md`)                |
| Explicit 4xx/5xx status assertions          |             15 |      — | Most status judgement is delegated to the engine                                                                            |
| Requirement annotations                     |             79 |     91 | 170 links across 47 files                                                                                                   |

Tests flagged as "no inline expect" (24) were spot-checked. The smoke tests, axe scans and repeat-attach tests
assert through helpers (`screenLoads`, `scanCurrentPage`, `attachAndSend`), so they are not empty.

### 2.3 Code-coverage tooling

| Tool                                          | Status                                                                                                                                                                | Consequence                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Istanbul / c8 / nyc for the bench             | ❌ Not in `package.json` / `playwright.config.ts`                                                                                                                     | Untested bench code is found only by import scans like §1.4 |
| JaCoCo for the KPost / KMail / Admin backends | ❌ Not visible: app source absent locally                                                                                                                             | No way to see which controllers or services a run reaches   |
| Istanbul for the React front end              | ❌ Same                                                                                                                                                               | No way to see which components the UI suite exercises       |
| Proxy ledgers the bench does have             | ✅ `coverage.md` (352/446 documented endpoints registered), `live-endpoints.md` (122 live + 193 lifecycle), RTM (92/142 requirements = 65 %), skip ledger (536 sites) | Good black-box metrics; dated 2026-10-12                    |

### 2.4 Requirements traceability (FRD rows parsed: 143 of the doc's 165; the `FR-GMSG` id style is not parsed)

| FRD status   | Rows | Linked by a full `requirement` annotation | Partial only | **No annotation** |
| ------------ | ---: | ----------------------------------------: | -----------: | ----------------: |
| COVERED      |  103 |                                        82 |            8 |            **13** |
| PARTIAL      |    7 |                                         3 |            0 |                 4 |
| GAP          |    1 |                                         0 |            0 |     1 (FR-KD-004) |
| OUT-OF-SCOPE |   32 |                                         — |            — |                 — |

**Marked COVERED in `requirements-frd.md` with no test linked to it:** FR-KU-026, 034, 046, 050–053;
FR-GC-002, 003, 007, 008; FR-GM-009; FR-KL-009. Either link the asserting test or downgrade the claim.
Weakest in-scope modules: Group Create (4 of 8 unlinked), Signup/Login (4 of 9).

### 2.5 Critical workflows with no automated assertion

| Workflow                                                                             | Why it is critical                    | Current state                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| Password change / reset / single-use reset link                                      | Account takeover                      | Permanent skip (no spare account with a known password)                           |
| Login brute-force lockout, OTP guessing / resend throttling                          | Credential stuffing, SMS-pumping cost | Deliberately never probed                                                         |
| Account deactivation, primary/secondary device switch                                | Session hijack, lock-out              | Permanent skip (OTP + session-destroyer)                                          |
| Admin member provisioning: add, terminate, reset password, hold/release, update role | Privileged, irreversible              | Contract-validated off-live only; 3 role-posting writes have no hand-written spec |
| Connected Kall (media, in-call controls)                                             | Core product                          | WebRTC-limited; only ringing / scheduling                                         |
| Group operations on the default run                                                  | Core product                          | 0 live-safe endpoints; lifecycle-only                                             |
| KBooking seat hold → book → cancel                                                   | Money                                 | `blockTicket` waits on authorization; 4 endpoints undocumented                    |
| Full first-use journey (register → chat → call → mail)                               | Release confidence                    | RTM Journeys 0 % (partial)                                                        |

---

## 3. Production-grade recommendations (prioritized)

### P0: trust the oracle before adding more tests

| #   | Gap                            | Concrete change in this codebase                                                                                                                                                                                                                                                                                                                                                                                                                                | Effort           |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | Validators unverified          | Add `tests/framework/validators/<family>.spec.ts`. Build `ValidationContext` fixtures from **captured** exchanges (the reports already store request/response pairs). For each validator assert a known-good → PASSED, a known-bad → FAILED, and no-response → SKIPPED. Start with the validators that file the most bugs: `status-code`, `schema`, `data-type`, `null-value`, `empty-value`, `security-headers`, `information-disclosure`, `injection`, `xss`. | 3–4 days         |
| 2   | Self-tests never run in CI     | Add a job to `playwright.yml`: `npx playwright test --project=framework --workers=1` with `BUGZILLA_DRY_RUN=true` and no secrets. Already CI-safe: the `_*.local.spec.ts` probes skip on `!database.enabled`, the one live Bugzilla call in `ownership.spec.ts` skips without `BUGZILLA_URL`/`API_KEY`, `bug-tracker.spec.ts` stubs `fetch`, and `raw-body.spec.ts` uses its own local HTTP server.                                                             | 0.5 day          |
| 3   | Inert validator families       | Either (a) declare constraints where the frontend enforces them (`requestSchema` with `required`/`maxLength` traced to the React form validation, the same "no guess, cite the source" rule `defineUndocumentedKpostEndpoint` uses), or (b) mark those validators `notApplicable` for KPost/KMail so the ledger stops implying coverage. Do the same for `authorization.*` and `rate-limit` (see #6 and #7).                                                    | 2 days + ongoing |
| 4   | Response schema too permissive | Add a "required-by-evidence" layer: fields present in **every** captured live response of an endpoint across N runs become required in the response check (still never invented). Report a dropped field as a contract-drift bug class.                                                                                                                                                                                                                         | 2 days           |

### P1: close the high-risk functional and security gaps

| #   | Gap                           | Concrete change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Effort           |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 5   | Account-security placeholders | Provision a dedicated spare QA account (`provision-test-accounts.cjs`) with a known password. Then turn the `test.skip(true, …)` placeholders in `settings-change-password.spec.ts` and `profile/device-workflow.spec.ts` into real flows: change → login with the new password → change back, under `TEST_DB_MODE`.                                                                                                                                                                                                                                                                                                                                                                  | 2 days + owner   |
| 6   | Brute force / OTP abuse       | One scheduled, isolated spec against a **throwaway** account (never in a product run): N wrong passwords → expect 429 or lockout; N OTP resends → expect throttling. Set `security.rateLimit` on `signup-login-*` and OTP-sender definitions so `security.rate-limit` actually runs under `TEST_DB_MODE` + `OTP_TEST_GATEWAY`.                                                                                                                                                                                                                                                                                                                                                        | 1.5 days + owner |
| 7   | Engine authorization inert    | KPost is ownership-based, so add `authorization.tenantScoped: true` only to the `/admin/*` and Admin-API definitions (company-scoped) with the 242/1034 business principals. That turns `cross-resource-access` on for the company-scoped surface. Keep the hand-written IDOR specs for personal objects. Review the 6 security specs where no owner control was found by keyword scan (`admin-bank-company-cross-company`, `katchup-attachment-idor`, `katchup-idor-regression-2026-10-03`, `katchup-object-authorization`, `kword-object-authorization`, `object-authorization`): confirm each proves the owner's identical call succeeds (CLAUDE.md §7), and add it where missing. | 1.5 days         |
| 8   | Missing security checks       | Extend `apiConfig.securityHeaders` and `ui.security`: CORS (`Access-Control-Allow-Origin` never `*` with credentials; foreign `Origin` reflected?), cookie flags (`Secure`/`HttpOnly`/`SameSite`), CSP quality (no `unsafe-inline`/`*`), `frame-ancestors`. Add upload abuse to the presigned-attachment flow: wrong extension vs magic bytes, SVG with script, oversize. Add `npm audit --omit=dev` to CI.                                                                                                                                                                                                                                                                           | 2 days           |
| 9   | UI error-handling ad hoc      | Promote fault injection into the screen sweep as a 10th `ui.*` check: for each screen's primary data call, inject 500 / timeout / 401 / empty list and assert no error boundary, a visible message, and a retry path. This removes the zero-coverage holes in Group, Kall, Admin UI and UserManagement in one change (`src/ui/ui-checks.ts` + `tests/e2e/support/screen-sweep.ts`).                                                                                                                                                                                                                                                                                                   | 2–3 days         |
| 10  | Traceability claims unbacked  | Link or downgrade the 13 COVERED-but-unlinked FRD rows. Teach the RTM parser the `FR-GMSG-*` ids. Make `lint:tags` **fail** (not warn) when a row says COVERED and no test links it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 0.5 day          |

### P2: robustness and maintainability

| #   | Gap                               | Concrete change                                                                                                                                                                                                                                                                                                                | Effort            |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| 11  | 48 fixed sleeps, 18 forced clicks | Replace with `expect.poll` / locator auto-wait. Start with `admin-dead-screens`, `interactions` and the axe specs (scan after `settleFrames`, not after `waitForTimeout(1200)`). Add the ESLint `playwright/no-wait-for-timeout` rule as an error.                                                                             | 1–2 days          |
| 12  | 9 serial-mode chains              | Split independent assertions into their own tests, or switch to `test.step` inside one test so later steps still report.                                                                                                                                                                                                       | 1 day             |
| 13  | Soft-only tests                   | For the 72 soft-only tests, add one hard terminal assertion ("the flow reached its end state") so a broken flow is red, not just a filed finding.                                                                                                                                                                              | 1 day             |
| 14  | Bench mutation testing            | Run Stryker on `src/bug-tracker` (validity gate, fingerprint, `reopenByFault`) and, after #1, on `src/validators`. A surviving mutant in the gate is a future mass false filing.                                                                                                                                               | 1 day setup       |
| 15  | Application code coverage         | With the developers: JaCoCo agent on the test-deployment JVMs (`-javaagent:jacocoagent.jar=output=tcpserver`) and an Istanbul-instrumented React build on `test.kpostindia.com`. Dump after each product run; publish per-module line/branch coverage next to `REPORT.md`. This is the only way to find dead-zone controllers. | 2 days + dev team |
| 16  | Business-tier UI and journeys     | Add more business screens to `BUSINESS_SCREENS`; build the RTM-E2E01 register → Katchup → Kall → KMail journey under `SIGNUP_UI_LIFECYCLE`.                                                                                                                                                                                    | 3 days            |
| 17  | Reproducibility                   | Check in a static-audit script (the one behind this report) as `npm run audit:tests`, so these numbers regenerate with the ledgers instead of going stale.                                                                                                                                                                     | 0.5 day           |

### Deliberately not recommended

Load/soak, concurrency and KDoc/KWord testing stay out, per the owner directives restated 2026-10-10. Per-request
performance validators already run on every FULL profile.

---

## Appendix: raw measurements

- Endpoints: 356 (GET 83, POST 273). Flagged `productionSafe` 111 (the ledger's 122 includes `allowLiveRead`
  needs-id reads). Marked destructive 181. Declaring DB validations: 6. Declaring `requirements`: 62. Declaring
  `authorization`: 0. Declaring `security.rateLimit`: 0.
- OpenAPI constraints across all three products: `maxLength` 0, `minLength` 0, `enum` 0, `pattern` 0; `format` 37
  (Admin only); `required` 78 (none on a KPost request body).
- Security headers checked: `x-content-type-options`, `x-frame-options`, `content-security-policy` (any value),
  `referrer-policy`, `cache-control: no-store`, HSTS on https. Not checked: CORS, cookie flags, CSP quality.
- Test tags in titles: `@ui` 374, `@framework` 131, `@api` 107, `@security` 36, `@katchup` 18, `@kmail` 12.
