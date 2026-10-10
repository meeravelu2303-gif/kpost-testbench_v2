# Bench reference — KPost Test Bench v2

Moved verbatim out of `CLAUDE.md` on 2026-10-09 (original sections 1–7, 9 and 10). `CLAUDE.md` keeps
the short map and the standing rules; this file keeps the full detail. The decision log is in
`docs/DECISION-LOG.md`. Section numbers are the originals, so older references like "§6" still resolve.

## 1. What KPOST is

KPOST is a **unified communications platform** — messaging, calling and email under one account,
built by KPOST India Pvt. Ltd. Source of truth for this section: `D:\Kpost Documents` (BRD, PRD,
SRS, FSD, Full Suite FRD v2.0).

The business case: organisations stitch together separate chat, calling and email vendors, each with
its own login, data silo and support contract. KPOST replaces that with one suite, one login and
built-in traceability.

### The differentiators (the product's reason to exist)

| Differentiator                               | Module          | Why it matters                                                                                                                                               |
| -------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Subject line on every chat message**       | Katchup         | Slack, Teams, Zoom Team Chat and Google Chat have no subject on an individual message. A thread can be found, filtered and handed off without re-reading it. |
| **Read receipts with exact open date/time**  | Katchup + KMail | One accountability model across chat and mail.                                                                                                               |
| **Rich post-send control**                   | Katchup         | Edit, Recall, Recall & Repost, Note, Reminder, Transfer, Forward (with/without thread), Copy, Save, Text-to-Speech, Delete.                                  |
| **Scheduled + ad hoc calling in one module** | Kall            | One call log for both, rather than two tools.                                                                                                                |
| **External mail interoperability**           | KMail           | Open-with, external recipients, transfer/share to Gmail, Outlook, Yahoo.                                                                                     |

### Modules

| Module         | Role                                                                           | Bench suite              |
| -------------- | ------------------------------------------------------------------------------ | ------------------------ |
| Signup & Login | Registration, activation, authenticated access — the gate to everything else   | `kpost-api`              |
| Katchup        | Instant messaging: subject, attachments, group, message actions, read receipts | `kpost-api`              |
| Kall           | Voice/video: scheduling, rescheduling, direct calls, call log                  | `kpost-api`              |
| KMail          | Email: compose, read receipts, external interoperability                       | `kmail-api` (own repo)   |
| KDirectory     | Organisation directory: listing, search, profile, launch Katchup/Kall          | `kpost-api` + `kpost-ui` |
| Admin module   | Organisation / HR / product administration                                     | `admin-api` (own repo)   |
| KPost UI       | React front end over all of the above                                          | `kpost-ui`               |
| KDOC           | **Out of scope** per BRD §4.2 (no per-module FRD supplied)                     | —                        |

KDirectory moved **into scope** on 2026-09-16 when it gained its own FRD (`FR-KD-001..006`); it overlaps
the existing contacts/company reads + the verticals directory screen. KDOC remains out of scope.

## 2. Application flow (what the bench must exercise)

```
REGISTER ──► ACTIVATE ──► LOGIN (JWT) ──┬──► KATCHUP  (message lifecycle)
  FR-S01..05   FR-S06..08   FR-S09..12  ├──► KALL     (schedule / call / log)
  unique id    activation    session     └──► KMAIL    (compose / receipts / external)
  password     required      logout
  strength     before login
```

**Signup & Login.** A registration form validates every required field before submission and
rejects an identifier that already exists (BR-S02: enforced at submission, not deferred to
activation). Activation is a **separate mandatory step** — login before activation must fail
(BR-S01). Login issues a JWT; a failure message must not reveal whether the id or the password was
wrong (account-enumeration precaution). Logout terminates the session.

**Katchup message lifecycle.** Compose carries a **Subject** (for 1:1 and group alike, BR-K01),
optional attachments, Copy (visible) and Confidential Copy (hidden from other recipients,
NFR-SEC02). Every message records per-recipient open date/time. The action set then **splits by
role** (BR-K02): the sender gets Edit / Recall / Recall&Repost / Note / Reminder / Transfer /
Forward / Forward-with-thread / Copy / Save / TTS / Delete; the recipient gets Reply / Comment /
Clarify / Report Message / More Options. An edited message keeps a visible `Edited:` marker; a
recalled message disappears from the recipient's view entirely (BR-K03).

**Kall.** A scheduled call has title, date, start/end time and participants. Rescheduling updates
the status tag `Scheduled → Rescheduled` while keeping the original entry's identity (BR-C01).
Direct calling reaches the device's native contacts as well as KPOST contacts. The call log records
participants, role/team, duration and exact start/end timestamps.

**KMail.** Compose with recipients and attachments; per-mail read receipt (BR-M01, matching
Katchup); open-with another mail app, external non-KPOST recipients, and transfer/share to Gmail,
Outlook or Yahoo Mail.

**Cross-module rules.** Read receipts behave identically in Katchup and KMail (BR-X01). Account,
password and acceptable-use rules are platform-wide, not per module (BR-X02).

## 3. Platform architecture (and the risk it creates for testing)

Microservices — API Gateway, Eureka registry, JWT auth, per-domain services — **evolving out of a
legacy monolith (KpostV5)**. Three documented weaknesses shape how we read failures:

1. **Shared monolithic database** across services → a defect in one module can surface in another.
2. **Circular KMail ↔ Katchup dependency** → an outage in one has an elevated chance of breaking the
   other (SRS §4.2, BRD §8).
3. **Auth Service outside the service registry** → every module depends on it (NFR-R01).

**Consequence for this bench:** a cascading failure is plausible and expected. That is exactly why
bug filing has a validity gate (§6) — an infrastructure cascade must not become 50 tickets blaming
the API.

## 4. Requirement traceability

**Source of truth (2026-09-16): the six per-module FRDs** in `D:\Kpost Documents` (see §8), ≈165 FRs (incl. FR-GMSG Group Messaging)
across six modules. These supersede the old FullSuite FRD (55 FRs/4 modules). The `requirements` field
on each definition now carries the new `FR-xx-NNN` ids; the map lives in `docs/requirements-frd.md`.

| Module         |                                  FRs | Bench suite      | Scope note                                            |
| -------------- | -----------------------------------: | ---------------- | ----------------------------------------------------- |
| Signup & Login |                  32 (FR-SL-001..032) | `kpost-api`+`ui` | login built; signup (001–022) out-of-scope (OTP)      |
| Katchup        |                  57 (FR-KU-001..057) | `kpost-api`+`ui` | built bar Disappearing (017–024) + AI-assist + attach |
| Group          | 24 (FR-GC-001..008 / FR-GM-001..016) | `kpost-api`+`ui` | lifecycle green; min-one-admin BR (GM-014) to assert  |
| Kall           |                   9 (FR-KL-001..009) | `kpost-api`+`ui` | built (was FR-C01..C09)                               |
| KMail          |                  25 (FR-KM-001..025) | `kmail-api`+`ui` | built; single-recipient BR (KM-005) to assert         |
| KDirectory     |                   6 (FR-KD-001..006) | `kpost-api`+`ui` | NEW in scope; overlaps contacts/company reads         |
| KDOC           |                                    — | —                | out of scope (no FRD, BRD §4.2)                       |

Old→new id crosswalk (historic entries in §8 use the old scheme): Signup `FR-S01..S12`→`FR-SL-*`,
Katchup `FR-K01..K25`/`BR-K01..03`→`FR-KU-*`, Kall `FR-C01..C09`/`BR-C01`→`FR-KL-*`, KMail
`FR-M01..M09`/`BR-M01`→`FR-KM-*`.

Non-functional requirements that already map onto validators we run: JWT required on authenticated
operations (NFR-SEC01 → authentication validators), confidential-copy invisibility (NFR-SEC02 →
cross-resource access), password strength (NFR-SEC03 → request validators), auth availability
(NFR-R01), no silent data loss when a dependent service fails (NFR-R02), message latency (NFR-P01 →
the response-time budget, which is a functional check, not load testing).

**Mapping status (2026-09-16):** re-tagging to the new scheme is to-do item 3 in the §8 entry above;
`docs/requirements-frd.md` (item 2) is the measured FR→coverage ledger.

## 5. What the bench is today

Playwright + TypeScript (strict). 214 source files, 112 spec files, 6 contract scripts.

```
src/config/             env, api, auth, database, thresholds, ownership   ← all configuration
src/api/                client (pool, request builder, token provider) · registry · schemas · definitions
src/validation-engine/  engine · registry · context · policy · probe · production guard
src/validators/         49 centralized validators (auth, authz, request, response, security,
                        performance, concurrency, common)
src/business-rules/     endpoint-specific rules (licence limit, duplicates, blocked company)
src/database/           DB client (MySQL · mock · disabled) · per-suite pool · repositories ·
                        assertions · named DB validations
src/bug-tracker/        Bugzilla client · fingerprint · candidate · validity gate · filer
src/reporting/          validation reporter · bugzilla reporter · formatters
src/utils/              logging · JSON · masking · correlation · simultaneous dispatch
mock-server/            local stand-in for the KPost API (the framework runs with no environment)
contracts/              GENERATED from the Excel workbook
openapi/                GENERATED per product
```

**The central idea:** common validations exist **once**. An endpoint definition states only what is
specific to it; the engine applies every applicable validator automatically. Adding an endpoint is
one definition; adding a validator is one line in `src/validators/index.ts` and it applies to every
endpoint. Details: `docs/validation-framework.md`.

**Profiles:** `SMOKE` → `REGRESSION` (default) → `SECURITY` → `FULL`.

**Target: the LIVE application.** `TEST_ENV=production` activates three independent safety controls
— an endpoint allowlist (`productionSafe`), a validator allowlist (no request-mutating probe runs)
and the QA-identifier guard (no request may name a record we do not own). All three are default-deny
and none can be switched off by configuration, including by `ALLOW_DESTRUCTIVE_TESTS`. See §8 and
`tests/framework/live-safety.spec.ts`. **16 endpoints are OTP-gated and cannot run on live at all**
(`npm run contract:otp`).

**Concurrency layer.** Four probes cover the faults that need two requests inside the handler at
once — `concurrency.read-consistency`, `burst-resilience`, `duplicate-write`, `session-isolation`
(`src/validators/concurrency/`). They dispatch from a shared barrier (`src/utils/concurrency.ts`)
rather than from `Promise.all(map(...))`, and a burst whose requests left more than
`thresholds.concurrency.maxDispatchSkewMs` apart reports **INCONCLUSIVE, never PASSED** — a race
probe that quietly degrades into a sequential one is worse than none, because it looks green. All
four are blocked on live (§8, 2026-09-21).

**Database layer — MySQL, and one target per suite.** Three adapters behind one interface: MySQL
(`DB_HOST`/`DB_NAME`, via `mysql2/promise`), the mock store (`MOCK_API=true`), and disabled.
`DatabasePool.for(suite)` decides which a suite gets, because **they do not share a database**:

| Suite                    | Database              | Writes                                           |
| ------------------------ | --------------------- | ------------------------------------------------ |
| `kpost-api`, `kmail-api` | `KPOST_QA` (**test**) | permitted when `DB_ALLOW_WRITES=true`            |
| `admin-api`              | **LIVE production**   | **refused in code** — no env var can unlock them |

Disabled is still the honest default, and DB validations then report **SKIPPED rather than
passing** — a green persistence check that never queried anything is the most misleading result the
bench could produce. Identifiers are validated and backtick-quoted, values are bound as `?`
placeholders, `null` becomes `IS NULL`, and `WITH` is **not** a read (MySQL 8 allows a CTE to head a
`DELETE`). See §8 (2026-09-21, later) and `tests/framework/admin-db-safety.spec.ts`.

**Verified state:** `npm run check` clean; the framework project runs **134 pass, 6 skip** (the
skips need a configured API host or the mock). The module suites skip until their hosts are
configured. The MySQL connection itself is **not yet usable**: the server requires TLS and presents
a self-signed certificate, so it needs `DB_SSL_CA` — see §8.

## 6. Bug filing — routed to the developer who owns the module

| Suite       | Bugzilla product | Owner                                    |
| ----------- | ---------------- | ---------------------------------------- |
| `kpost-api` | KPost API        | Jaganathan Murthy (jagan@kpost.in)       |
| `admin-api` | KPost Admin      | Jaganathan Murthy                        |
| `kmail-api` | KMail API        | Jitendra Kumar (jitendra@kpost.in)       |
| `kpost-ui`  | KPost UI         | Ayyappan Ashok (ayyappan@kpostindia.com) |

Declared once in `src/config/ownership.config.ts`; a framework test compares it against the live
Bugzilla component defaults, so drift on either side fails a run. Dedupe is a live search on a
`[KPV2-XXXXXX]` summary tag: open → comment, INVALID/WONTFIX/WORKSFORME/DUPLICATE → never re-file,
FIXED-but-back → reopen, search failed → file nothing. **Dry run is the default.** Details:
`docs/bug-filing.md`.

**Standing filing rules (owner directive, 2026-10-07 — do not ask again, just follow these):**

- **Run everything, THEN file once.** Do not run a module, file its bugs, run another module, file
  again, repeating all day — that produces a steady drip of tickets and developers rightly ask why
  everything wasn't filed together. Finish gap-filling + the full test suite for a product first,
  **then** do one consolidated filing pass against Bugzilla.
- **Every reopen must be re-verified live first**, not assumed. A developer's FIXED/INVALID claim
  that doesn't survive replaying the exact original request is reopened with evidence; a bug that
  genuinely still fails on a fresh, isolated re-run is reopened; anything in between is investigated
  before touching its status. Reopening a bug that was actually already fixed (stale dedupe match,
  or a bench-side artifact masquerading as the same fault) is the single most-repeated mistake in
  this engagement — see the 2026-10-06/07 decision log entries for two concrete cases.
- **A root-cause bug that affects multiple tests/endpoints must say so explicitly in its
  description** — name the count and, where practical, list the affected tests/endpoints (e.g. "This
  affects 7 screens: Home, Katchup, Kall, …" or "Affects 3 endpoints — one shared fix resolves all of
  them"). A developer fixing one shared root cause needs to know its blast radius, not just the one
  symptom that happened to get filed.
- **Every bug description is plain, understandable English** — for KPost API, KMail API, KPost
  Admin and KPost UI alike, not just UI. State what's broken and the bottom line in a sentence a
  non-QA reader can follow, even when the template also carries a curl/evidence block for
  developers who want it.
- **Every bug touched (filed or reopened) carries the real date it was actually observed** — this is
  already automatic (`candidate.observedAt = new Date().toISOString()`, baked into both
  `buildDescription` and `buildReopenComment` in `src/bug-tracker/bug-builder.ts`), not something to
  do by hand each time.
- **File only what's genuinely valid, and never a duplicate.** Run the mandatory duplicate-check
  before any manual filing; trust the engine's own validity gate for automated runs, but still
  spot-check anything that smells like a bench artifact (a shared-session crash, a load-time module
  error, a timing race) before letting it reach Bugzilla — see §8's 2026-10-06 entries for what that
  looked like in practice.
- **A shared background component failing on every screen is ONE bug, not one per screen.** Before
  filing a UI finding, check whether the failure actually traces to a shared background
  component (a global widget, a socket connection, a third-party script) rather than the screen
  under test — `humanizeUiFailure()` and `KNOWN_BACKGROUND_WIDGETS` in `src/bug-tracker/
bug-candidate.ts` already catch the known cases (currently the RSS/news widget via
  `rss2json.com`) and collapse them into one ticket via `uiSystemicFingerprint()`; add a new entry
  there when a new shared-component pattern turns up instead of letting it re-fragment.
- **API status-code drift vs. a stale frontend is its own bug class.** The backend has changed many
  endpoints' response status codes over time without the frontend being updated to match. When a UI
  failure traces back to the app mishandling an API response, check what status code the API
  actually returns today against what the frontend's own error-handling expects, and file the
  mismatch explicitly (both halves — the endpoint, its current code, what the frontend assumes) —
  not as a generic "UI crashed" bug, since the real fix is reconciling the two sides, and it may not
  be obvious which one is "wrong".
- **Every full-suite run must end with EVERY existing open bug touched and dated today — not just
  whatever the run happened to re-exercise.** (Owner directive, 2026-10-07, repeated after being
  missed once — do not require it to be repeated again.) Running the suite is not the same as
  checking every bug: for API bugs `verify-resolve.ts` genuinely re-checks each one by its
  (endpoint, validator) pair, but UI bugs carry no "endpoint" field at all, so that mechanism
  silently checks **0** of them (`reports/REPORT.md`'s "## 3b. Auto-resolved" section always reads
  "Checked 0 open bench-filed bugs" for a UI run) — a bug only gets touched if the exact scenario
  that originally filed it happens to run again this pass and its fingerprint matches. After every
  full suite (any product), pull the live list of open bugs for that product/browser, compare
  `last_change_time` against today's date, and individually re-verify every one left untouched
  (target its specific spec file/scenario, or a standalone non-reporter script for UI) before
  considering the pass done — do not report a module "done" while any open bug's date is stale.
  When checking a _browser_ filter specifically, match Bugzilla's own semantics: `status_whiteboard`
  is a **substring** match, so a multi-browser tag like `[browser:chromium,firefox]` counts for
  both browsers — an exact-bracket match like `[browser:chromium]` undercounts (found 2026-10-07:
  undercounted 43 real chromium bugs as 39 this way).
- **Post-deploy re-verification flow (owner directive, 2026-10-07 — the standing flow, every time,
  not just this once):** when the owner names specific bug IDs to mark FIXED because a deploy is in
  progress or has landed, do **not** resolve anything until the owner explicitly confirms the deploy
  has finished. Once given the go-ahead:
  1. Live-verify EACH named bug individually (the same standalone-script method used on 2026-10-07 —
     never trust "it should be fixed now" without replaying the actual repro).
  2. If it genuinely no longer reproduces → `RESOLVED`/`FIXED`, with a comment describing exactly
     what was checked and what came back clean.
  3. If it still reproduces → leave it `CONFIRMED` (or reopen it if a developer had marked it
     fixed/invalid) with a comment describing exactly what was checked and what still failed — never
     silently mark something FIXED on request alone, and never go quiet on one that's still broken.
  4. **Every single bug touched this way gets today's date and a fresh, self-contained, plain-English
     comment, every time** — this is not optional and not a one-off. That comment is exactly what
     lands in the Excel export's **Last Comment** column (`src/lib/bugExport.ts` /
     `BugCommentInfo` in `backend/src/routes/bugs.ts`), which is the ONLY place developers read a
     bug's current status from when fixing bugs off the spreadsheet — so a vague, stale, or
     templated comment there directly costs a developer real time. Write it like the developer has
     never seen the ticket before and is reading only this one comment.

### The complete test-run → Bugzilla pipeline — production-grade workflow spec (owner directive, 2026-10-07; all 4 gaps closed same day once the live run finished)

The owner's goal: run ONE product-specific command and have the entire pipeline — test execution,
reporting, evidence collection, existing-bug re-verification, duplicate/invalid prevention, and
Bugzilla filing — happen automatically and consistently, every time, without depending on an
assistant to drive it by hand. First audited 2026-10-07 against the code as it stood (the four gaps
below were real then); all four were closed later the same day, once the live firefox run that was
protecting these files finished. Re-check this against the code before trusting it if it's been a
while, the same way any other part of this document should be.

**1. Product-wise test commands — CLOSED.** Every Bugzilla product now has a true "run everything"
command: `kpost:full` (already existed — FULL profile + write-fuzz + destructive, one shot),
`kmail:full` / `kmail:full:file` and `admin:full` / `admin:full:file` (added — same shape, previously
missing for these two products), and `ui:all` / `ui:all:file` (added — chains the 3-browser sweep
with `ui:admin`, the Admin UI project, so the UI product's own secondary surface is covered too).
`VALIDATION_PROFILE=FULL` is documented in `src/validation-engine/validation-policy.ts`
(`PROFILE_SETS`) as literally "everything" including every `SECURITY` check, so a `*:full` command
never needs a separate `*:security` run chained after it — that would just re-run a subset for no
reason. On top of the four per-product commands sits `product:kpost-api`, `product:kmail-api`,
`product:kpost-admin`, `product:kpost-ui` (one name per real Bugzilla product, each a thin alias onto
its `*:full`/`ui:all` command) and `product:all` / `product:all:file` (all four, chained). The older
`kpost:deep`, `kpost:security`, `admin:deep`, `kmail:deep`, `all`/`test:all` scripts are all still
present and untouched — these new ones are additive, not a replacement, so nothing already relied on
keeps working exactly as it did.

**2. Pipeline architecture — fully built, one coherent path.** `src/reporting/bugzilla-reporter.ts`
(`BugzillaReporter.publish()`) is the one real path every automated run takes:
candidates built (`candidatesFromReport` / `candidateFromUiFailure` /
`accessibilityCandidatesFromScreens` in `bug-candidate.ts`) → merged/consolidated
(`mergeCandidates`, `consolidateCascades`) → validity gate (`applyValidityGate` in
`validity-gate.ts`) → whole-run sanity gate (`assessRunValidity` — blocks ALL filing if the run
itself collapsed, was interrupted, or ran zero tests) → filed (`BugzillaFiler.file()` in
`bugzilla-filer.ts`, actual REST calls via `bugzilla-client.ts`) → existing-bug auto-resolve pass
(`autoResolve()` → `verify-resolve.ts`) → report rendered (`run-summary.ts` + `bug-report.ts` →
`reports/REPORT.md` / `.json`). A second, narrower path (`src/bug-tracker/gatekeeper.ts`) exists only
for hand-authored tickets via `tests/framework/manual-bug.spec.ts` — it is NOT part of the automated
pipeline above, so don't look there when tracing what an automated run actually does.

**3. Existing-bug re-verification on every run — CLOSED for both API and UI.**
`autoResolve()` fetches **every** currently-open bench-tagged bug for the product each run via
`client.openBenchBugs()`. API bugs resolve via `classifyResolve()` when their own
`(endpoint, validator)` pair genuinely ran and passed THIS run (`index.ranPair`/`failedPair` from
`buildRunIndex`) — unchanged, and still has its one real limit: an endpoint not exercised this run
stays `notVerified`, not touched. **UI bugs now have the same mechanism**: `classifyUiResolve()` +
`buildUiRunIndex()` (`verify-resolve.ts`, added 2026-10-07) match a UI bug back to the Playwright test
that originally filed it (parsed from the bug's own summary — `[tag] <original test title>` — with a
prefix match for a title Bugzilla's 255-char summary limit truncated) and resolve it only when that
exact test ran again this pass and passed CLEANLY (a `flaky` outcome — failed at least once, passed
on retry — counts as NOT clean, same caution as an intermittent API reproduction). `autoResolve()` now
adds the "KPost UI" product to its check list whenever any UI test ran this pass (previously it was
never added at all, since UI tests produce no `ValidationReport` the product list was built from).
A platform-wide/systemic UI ticket (no single originating test) still isn't covered — it correctly
falls through to "could not match a single originating test" — see
[[feedback_ui_bugs_no_auto_verify_mechanism]] for the original incident this closes, and
`tests/framework/verify-resolve.spec.ts`'s `'auto-resolve verification — UI'` block for the test
coverage (7 tests: clean pass, still-failing, flaky, not-run, reproduced, truncated-title prefix
match, skipped).

**4. New-bug creation flow — matches the owner's required sequence exactly.**
Test Failure → `candidatesFromReport`/`candidateFromUiFailure` (Analyze) → `validity-gate.ts`
`candidateRejection()` (Validate — rejects transient/infra/environment noise before it's even a
candidate, see point 5) → `BugzillaFiler.process()`'s live Bugzilla search (Check Existing + Duplicate
Check, see point 5's outcome table) → severity/category/systemic classification already baked into
the candidate (Classify Root Cause) → `uncertainNewDefect()` (see point 5 — holds back an uncertain
brand-new finding instead of auto-filing it) → only a candidate that survives all of the above reaches
`createBug()` (Confirm Valid → Create). Nothing is ever filed straight off a raw test failure.

**5. Duplicate / invalid / false-positive prevention — CLOSED (manual-review bucket added).**
Fingerprinting (`bug-fingerprint.ts`): API key = `endpointId|validatorName|normalizedMessage`;
systemic/platform-wide key drops the endpoint; UI key = `file|title|normalizedMessage`; UI-systemic =
a stable shared-cause key (`uiSystemicFingerprint`, see
[[project_kpost_ui_description_template_fixed_2026_10_07]]). Outcomes, from `BugzillaFiler.process()`:

| Existing ticket found?                                                 | Outcome                                        |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| Tag match, still OPEN                                                  | Comment only (never a new ticket)              |
| Tag match, closed INVALID/WONTFIX/WORKSFORME/DUPLICATE                 | `judged-skip` — never re-filed                 |
| Tag match, closed FIXED (but reproducing again)                        | Reopen + `buildReopenComment`                  |
| No tag match, but same `(endpoint, validator)` fault-key exists        | Comment + adopt the existing ticket's tag      |
| No tag/fault match, but an open ticket's summary phrase matches        | Adopt (`findOpenByPhrase` + `sameFault`)       |
| Nothing found at all, AND the reproduction was intermittent            | `needs-review` — held back, see below          |
| Nothing found at all, reproduction was reliable (or has none to score) | `createBug()`                                  |
| The dedupe search itself fails                                         | File NOTHING (`'failed'`) — never create blind |

Separately, `candidateRejection()` rejects, BEFORE a candidate is ever considered for filing:
anything below the severity floor, pure response-time/timeout findings, gateway 5xx or
no-response/timeout (transient upstream, not a defect), infra/bench faults (`BENCH_FAULT`:
ECONNREFUSED, browser-closed, setup faults, `ProductionSafetyError`), 429 throttling, an
exposure/enumeration claim contradicted by its own 401/403/404 evidence, and anything missing a
component or an expected/actual pair. `isLenientAcceptanceFalsePositive()` separately suppresses a
negative-input probe that got accepted (2xx) instead of crashed. Every rejection is recorded with its
reason and shown in the report (§5 "Findings NOT filed"). **The manual-review gap is closed**:
`uncertainNewDefect()` (`validity-gate.ts`, added 2026-10-07) sits at the one moment that is hard to
undo — minting a brand new ticket number — and holds back a candidate with NO existing ticket match
at all when its own reproduction gate scored it intermittent (`failures < attempts`). It deliberately
does NOT apply to anything that already matched an existing ticket (commenting/reopening something a
human already triaged is low-risk regardless of how the repro scored). Surfaced as the `needs-review`
`FilingDecision` and the report's new §3c (point 7).

**6. Bug description completeness — the three gaps CLOSED.** `bug-builder.ts` `buildDescription()`
now also writes: a `Severity: X / Priority: Y` text line (previously only set as real Bugzilla fields,
never narrated in the body); a `Preconditions:` line via the new `buildPreconditions()` helper
(API: "a valid, authenticated test account calling the endpoint below with a live session token";
UI: "Signed in with a valid test account, in {browsers}, on the {component} screen"); and the
Playwright trace.zip is now attached as proof (`proofFrom()` in `bugzilla-reporter.ts` recognises
Playwright's own `'trace'` attachment name, alongside the existing screenshot/video/a11y-evidence/
crash-evidence/crash-diagnosis names — `attachProof`'s existing 25MB size cap already handles an
oversized trace gracefully, skip-with-a-warning, same as it always did for an oversized video). Still
true as before: the Run date (`candidate.observedAt`) is always `new Date().toISOString()` at
runtime, **never hardcoded**.

**7. Report categories before filing — CLOSED (manual-review bucket now has its own section).**
`bug-report.ts`'s `buildBugReportMarkdown()` distinguishes, section by section: execution totals;
distinct defects (valid vs rejected, systemic breakdown); filed-by-developer (created / commented /
reopened / adopted / judged-skip / **needs-review** / failed / would-file counts); §3b auto-resolved
(resolved / confirmedFailing / notVerified / failed — covering "existing and fixed", "existing and
still reproducing", "existing but not exercised this run", now true for UI too per point 3); the new
**§3c "Needs manual review"** (added 2026-10-07 — one row per held-back brand-new finding, with the
reason, so a human can act on exactly what the gate wasn't confident enough to auto-file); a tickets
table; and §5 "Findings NOT filed" with each rejection's reason (covering invalid/environment and
automation/test-data).

**8. Dry-run safety gate — fully implemented, safe by default.** `BUGZILLA_DRY_RUN` defaults to
`true` (`src/config/env.ts`); every `*:file` npm script is what explicitly sets it `false` for a real
filing pass. `BUGZILLA_AUTO_RESOLVE` defaults to `true` but only actually writes to Bugzilla when
`dryRun` is false. `BUGZILLA_RESOLVE_ONLY` and `BUGZILLA_MAX_FILE` (`bugzilla.config.ts`) are
additional scope/safety knobs.

**9. Single command = complete pipeline — all four gaps closed 2026-10-07.** A person can now run
e.g. `npm run product:kpost-api:file` (or `product:kpost-ui:file`, `product:kmail-api:file`,
`product:kpost-admin:file`, or `product:all:file` for literally everything) and get: full test
execution for that product → report → evidence (incl. trace.zip) → existing-bug re-verification
(API AND UI, each within its one honest limit — an endpoint/test simply not exercised this run stays
`notVerified`, which is a true statement, not a gap) → dedupe → a manual-review hold for anything too
uncertain to auto-file → filing — with no manual steps and no assistant required in between. Fixed
this session: fused per-product commands (point 1), UI existing-bug re-verification (point 3), the
manual-review bucket (points 5, 7), and the three bug-template gaps (point 6). Verified: `tsc --noEmit`
clean on every file touched, `npm run framework` still at 178 passed / 5 pre-existing-and-unrelated
failures (same failures, same count, before and after), plus 7 new dedicated tests for the UI
auto-resolve logic.

## 7. Contracts — the Excel workbook is the source of truth

The swagger files were **deleted**: they disagreed with the workbook. `KPOST API (N).xlsx` now lives
**in the repository root** (currently `KPOST API (6).xlsx`); the converter picks the
highest-numbered copy, so a fresh checkout regenerates everything. Nothing invalid or duplicated is
converted. Details: `docs/api-contracts.md`.

|                               | KPost | KMail |   Total |
| ----------------------------- | ----: | ----: | ------: |
| Rows parsed                   |   306 |    76 | **382** |
| **Usable** (method + path)    |   266 |    71 | **337** |
| — with a request schema       |   165 |    44 | **209** |
| — with a response schema      |   119 |    26 | **145** |
| Excluded (dup/retired/legacy) |    40 |     5 |  **45** |

**How the method is decided**, in order — the first rule that applies wins:

1. the request cell states a method **and the payload agrees** (`GET METHOD` with no payload) —
   this outranks a Method column, because on KMail the column predates tokens while the
   `After Token Implemented` cell describes today's contract
2. a Method column
3. a stated method the payload contradicts — used, but flagged for confirmation
4. the owner's payload rule: **a documented payload means POST, no payload means GET**

**This API uses only POST and GET.** Confirmed by the owner and corroborated by the workbook: of
the 95 rows stating a method, 80 are POST and 15 GET — PUT, PATCH and DELETE appear nowhere. So an
`updateX` or `deleteX` endpoint with a payload is a POST, and the derivation is binary rather than
something to confirm.

| Source          | Count | What it means                                                                |
| --------------- | ----: | ---------------------------------------------------------------------------- |
| `method-column` |    71 | the tab has a Method column (KDIARY, V2 TESTED APIS, KMAILAPI)               |
| `request-note`  |    76 | the request cell says so, and it outranks the column when the payload agrees |
| `payload-rule`  |   190 | **derived**: a documented payload means POST, no payload means GET           |

**Yellow rows are unused and never added** (25 rows, including 2 that say so in words rather than
in colour). They stay in the contract files as `usable: false` so the decision is auditable, and
they are excluded from deduplication — a retired row that wins a tie-break hides the live endpoint
behind it, which is exactly what had happened to seven Kall and KMail endpoints.

Every endpoint records which rule applied (`methodSource`), what was displaced (`methodOverrode`)
and anything still ambiguous (`methodDoubts`); all three reach the OpenAPI as `x-method-*`.
**Nothing currently needs a method decision.**

Types: 13 enum groups → `contracts/kpost-types.json`, exposed typed via
`src/api/schemas/kpost-types.ts`, pinned by `tests/framework/types-contract.spec.ts`.

## 9. Plan

### Current focus (owner directive, 2026-10-07 — supersedes anything stale below until updated)

- **KDoc is OUT OF SCOPE for now.** KDoc documents are still under active development by the KPost
  team. Do not test `kword`/`kpresentation`/KDoc endpoints or screens in any run until the owner
  explicitly says the module is ready. Everything else proceeds normally in the meantime.
- **Performance and concurrency stay OUT OF SCOPE for now** (unrelated to KDoc — a separate,
  standing exclusion; see the shared-server safety protocol in the decision log). Functional,
  input-validation, security and database checks are all in scope.
- **Order of work**: finish the current KPost UI cross-browser sweep → fill every remaining gap in
  KPost API (all endpoints, all test types except performance/concurrency, KDoc excluded) → run the
  full KPost API suite end to end → **one** consolidated Bugzilla filing pass for whatever that run
  finds (see §6's filing cadence rule — not a round of filing after every sub-run).
- **Check: profile-image download token.** The frontend/UI team added a token requirement to the
  profile-image download API call. Any previously-filed bug about `downloadProfileImage` /
  `downloadFullProfileImage` (e.g. the 404-on-image-download findings reopened during the 2026-10-05
  KPost API run) needs to be re-verified against this change and have its Bugzilla status updated
  accordingly — resolved if the token fix actually closes the gap, left open with a fresh comment if
  it doesn't.

### Blocked on the repo owner

Methods are settled — **nothing needs a method decision**. 337 endpoints are usable. What remains
is genuinely missing data, all of it in `contracts/excel-gaps.csv`, one row per item, with
**FillCell** naming the cell:

1. **185 endpoints have no sample response, or no payload where the Method column says POST (P2).**
   The largest remaining gap, and what response assertions need.
2. **27 broken JSON samples (P3)** — the payload or response cell mixes prose in, or uses
   `0 or 1 or 2` style alternatives, so no schema can be inferred. The endpoint is still callable;
   only its schema is missing.
3. **21 row decisions (P4)** — duplicate or legacy rows where two document the same path, plus one
   row documenting two endpoints with a single payload (`KatchupAPI!Q3`).
4. **Credentials per environment** (`AUTH_PRINCIPALS`, `TEST_COMPANY_ID`) — without them every real
   endpoint answers 401 and the bench would report a credential problem as an API defect.
5. **Status codes and a public/token flag** in the workbook (not per-row in the gap CSV; see
   `contracts/excel-gaps.md`, section "not per-row").

After any new dump: `npm run contract:excel` (no path needed — it takes the newest workbook in the
repo) → `npm run contract:coverage` → `npm run contract:gaps`.

### The module-by-module to-do (owner's order, 2026-09-13)

API **and** screen, one module finished before the next starts. Signup is **out of scope**: the QA
accounts were created by hand, and both registration endpoints are OTP-gated on live anyway. The
per-endpoint status lives in `docs/LIVE-ENDPOINTS.md` (generated); this is the order and what each
step needs.

| #   | Module                                                                      | API endpoints (usable) | Screen                      | Documents cover it?         | Needs before it can finish                                                      |
| --- | --------------------------------------------------------------------------- | ---------------------: | --------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| 0   | Common (done)                                                               |                     33 | —                           | partly (reference data)     | 22 of its endpoints run on live; OTP and company ones are blocked, with reasons |
| 1   | **Login & session**                                                         |        8 (+1 business) | `/login`, header logout     | FR-S09..S12, NFR-SEC01      | nothing — the two PERSONAL accounts are enough                                  |
| 2   | **Profile** ✅ done                                                         |                     45 | `/userprofile`, `/settings` | **no** — workbook only      | a decision on which own-profile writes are acceptable on live; test images      |
| 3   | **Katchup**                                                                 |                     36 | `/katchup`                  | FR-K01..K25, BR-K01..K03    | **more PERSONAL accounts** for group, Cc and confidential-copy (NFR-SEC02)      |
| 4   | Contacts                                                                    |                     16 | inside Katchup/Kall         | no                          | the counterparty account                                                        |
| 5   | Group                                                                       |                     11 | inside Katchup              | FR-K06 only                 | **≥3 PERSONAL accounts** (a group with one member proves nothing)               |
| 6   | Kall                                                                        |                     20 | `/kall`                     | FR-C01..C09, BR-C01         | two accounts; calling itself is real-time and likely UI-only                    |
| 7   | KMail                                                                       |      71 + 8 (`kmail5`) | `/kmail`                    | FR-M01..M09, BR-M01         | KMail host confirmed; external recipients must be our own mailboxes             |
| 8   | KDiary (`dairySchedule`)                                                    |                     14 | —                           | no                          | —                                                                               |
| 9   | Settings (`generalSetting`)                                                 |                      7 | `/settings`                 | no                          | —                                                                               |
| 10  | Business & Admin                                                            |           13 + company | `/usermanagement`           | no                          | a business company with **three members**, one expendable                       |
| —   | KDOC (`kword`, `kpresentation`, `delete`)                                   |                     19 | `/kdoc`                     | **out of scope** (BRD §4.2) | —                                                                               |
| —   | Other (`redbus`, `knews`, `ecommerce`, `ai`, `aws`, `dashboard`, `metaDee`) |                     28 | various                     | no                          | owner to say whether in scope                                                   |
| —   | Signup                                                                      |                      5 | `/signup`                   | FR-S01..S08                 | **out of scope** — accounts already exist; OTP-gated on live                    |

**The documents only describe four modules** (Signup & Login, Katchup, Kall, KMail). Profile,
Contacts, Group, KDiary and Settings exist in the workbook and the UI but in none of the five
documents, so their tests are contract-driven and carry no FR ids. Worth knowing before anyone reads
"Profile: 0 requirements covered" as a gap in the tests.

#### Step 1 — Login & session: the plan

Scope on live, PERSONAL only:

- **API, engine-driven:** `fetchUserDetails` (the UI's step 1), `userLogin`, `generateJWTokens`,
  `getActiveSession`, `getLoginHistory` — the read-only contract validators the live allowlist
  permits.
- **API, flow tests** (hand-written, own account only): wrong password, unknown id, wrong user type,
  the enumeration rule (both failures answer alike), token claims, refresh token misuse, protected
  endpoints without/with a bad token, and **logout on a session opened for the test**, proving that
  token dies while the shared session survives.
- **Screen:** the real two-step `/login` (KPOST ID → password), taken from the UI source
  (`src/components/auth/Login.js`) rather than guessed: unknown id toast, wrong password message,
  successful login lands on `/home`, header logout returns to `/login`.

Deliberately not run on live: `userLogoutFromAllDevices` (would also end the owner's own manual
sessions on these accounts), `setAccessCode` (changes a credential), `adminUserLogin` (business).

Account-lockout precaution: **one** wrong-password attempt per account per run, always followed by a
successful login, and never in parallel. A bench that locks its own QA account stops every module.

Removed with signup: `signup.api.ts` (the five registration endpoints), `signup.spec.ts`,
`flow-rules.spec.ts` (registers an account) and `user-types.spec.ts` (needs business accounts that
do not exist on live; its PERSONAL cases move into the login flow tests). `fetchUserDetails` moves to
`login.api.ts`, since the login screen calls it.

### Next

5. Add **FR traceability**: tag each definition with the FR ids it exercises, and report coverage
   against the 55 FRs.
6. **Business rules from the FRD** — subject mandatory (FR-K02), confidential-copy invisibility
   (NFR-SEC02), edited/recalled marker behaviour (BR-K03), reschedule status tag (BR-C01).
   (BR-S01/BR-S02 go with signup, out of scope.)
7. **Admin has a partial contract after all** — 9 usable `/admin/*` endpoints are in the KPost
   contract (`addingUserByAdmin`, `resetPassword`, `holdOrRelease`, `createOrRemoveBackupAdmin`,
   `terminateUser`, `userManagementDetails/{companyID}`, `removeCompanyLogo`,
   `getBankAndCompanyDetails/{companyID}`, `displayNameSuggestion`), and they answer on `devapi2`,
   not on a separate host. The earlier "no contract at all" referred to `admin-api` as a separate
   product and was wrong about these rows.

   What Admin actually needs is **members to act on**: every one of those endpoints takes a
   `kpostID` belonging to somebody else in the company. With only a company admin, the sole
   available test is self-destruction — `terminateUser` on your own account kills the company, and
   it cannot be recreated through the API. So Admin waits on a business company with **three
   members**, one of them expendable (see the account plan).

8. **Finish turning the DB layer on.** The MySQL adapter is written, typechecked and covered by
   framework tests, and the KPOST_QA credentials are configured. Two things still block real
   assertions:

   - **The TLS certificate.** The server requires TLS (`--require_secure_transport=ON`) and presents
     a **self-signed** certificate, so every connection currently fails with
     `HANDSHAKE_SSL_ERROR: self-signed certificate in certificate chain`. Obtain the server's CA and
     point `DB_SSL_CA` at the PEM — supplying a CA switches verification on by itself. The fallback,
     `DB_SSL_REJECT_UNAUTHORIZED=false`, keeps the traffic encrypted but stops authenticating the
     server; on a public host that means the credentials could be read by anything positioned in
     between, so it is a decision for the owner rather than a default the bench should take.
   - **The table and column names** behind the endpoints under test. The validations in
     `src/database/validations/` were written against the mock's shape (`users`, `companies`,
     `createdAt`, `deletedAt`) and need remapping to the real KPOST_QA schema before they assert
     anything true — a validation pointed at a table that does not exist fails as a query error,
     which is loud, but a column that exists under a _different meaning_ fails silently.

   Once connected, the endpoints worth wiring first are the ones whose response cannot prove
   persistence: the Katchup send lifecycle (did the message row land, with the Subject BR-K01
   requires?), profile writes, and anything with a soft delete — where "200 OK" and "the row is
   still active" are entirely compatible.

   **Admin is a separate question.** Its database is live, so it stays read-only whatever else is
   configured, and no `ADMIN_DB_*` connection has been supplied. Admin DB validations will report
   SKIPPED until one is — which is the correct state, not a gap to close in a hurry.

9. **Declare `concurrency.identityPaths` on the read endpoints.** The concurrency probes are
   registered and run, but two of their four checks are inert without it: `read-consistency`'s
   identity comparison reports SKIPPED, and `session-isolation` does not apply at all. The path is
   whatever field names the caller in each response (`data.kpostID`, `data.companyID`). This is a
   one-line addition per endpoint and it is what turns the probes from "did the responses differ?"
   into "was one caller served another's record?" — the finding that actually matters.

   `concurrency.singleWriteWins` likewise needs setting on the writes that must not duplicate; a
   company or a group name are the obvious first candidates, and the owner should confirm which
   writes are genuinely unique-constrained rather than the bench guessing.

### UI bench (prerequisites gathered, not started)

Needs: a reachable environment on a **secure context** (a bare-IP HTTP origin renders a blank page),
login unblocked, a **pool** of QA accounts (one active session per account caps parallelism), and
`data-testid` hooks (only ~64 exist across 333 components). Planned shape: a screen registry plus
centralized UI validators, mirroring the API engine.

## 10. Conventions

- **Excel wins** over any spec file. Contracts are generated; never hand-edit `contracts/` or the
  generated `openapi/*.openapi.json`.
- **Never invent a contract; derive only by a stated rule.** No invented `required`, no fabricated
  status codes. HTTP methods follow the owner’s payload rule (payload = POST, none = GET) and
  every one records where it came from, so a derived method is never mistaken for a documented one.
  Anything the rule cannot settle is recorded as a gap, not guessed.
- **A bench that cannot run must be loud, never clean.** Zero findings from a collapsed run is a
  false clean, so the run gate blocks filing.
- **A payload is safety-critical, never cosmetic.** An endpoint's request must carry every field the
  documented _example_ sends (checked against the generated contract), because a missing field files a
  false bug and — on the shared monolithic DB (§3) — a wrong/incomplete WRITE persists bad data that a
  DIFFERENT endpoint later reads, so the fault surfaces elsewhere. Never guess a value: send what the
  authoritative frontend client sends (the workbook example is secondary and may be stale — `recall`).
  `tests/framework/payload-audit.spec.ts` enforces this: every payload gap must be sent or recorded
  with a reason (runtime/lifecycle-supplied, or a deliberate frontend-authoritative omission).
- **Secrets** come from the environment only, and are masked in logs, reports and tickets.
- **A check that could not run says so.** SKIPPED with a reason, never PASSED. This applies to a DB
  validation with no database, a session-isolation probe with one principal, and a concurrency burst
  whose requests did not overlap. Each of those could be made to "pass" trivially, and each would
  then certify coverage that does not exist — which is worse than a visible gap, because a visible
  gap gets fixed.
- **SQL binds values and validates identifiers.** Table and column names cannot be parameterized, so
  they are matched against a strict pattern and quoted; everything else is a bound parameter. Direct
  SQL writes are refused unless `DB_ALLOW_WRITES=true`, separately from `ALLOW_DESTRUCTIVE_TESTS`,
  because a SQL write bypasses the application's validation, permissions and audit trail.
- `npm run check` (typecheck + lint + format) must pass before anything is considered done.
- Tests describe **which** endpoint is tested; the engine owns **how**.
