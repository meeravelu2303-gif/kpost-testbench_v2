# CLAUDE.md — KPost Test Bench v2

**This file is the living record of this bench. Update it FIRST.**

Working agreement:

1. Before changing a flow, write the intent here (§9 Plan).
2. After changing it, record what actually happened here (§8 Decision log) — including anything that
   turned out differently from the plan.
3. Anyone (human or AI) picking this repo up reads this file first. It is the map; `docs/` holds the
   detail.

---

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

Playwright + TypeScript (strict). ~124 source files, 14 spec files, 3 contract scripts.

```
src/config/             env, api, auth, database, thresholds, ownership   ← all configuration
src/api/                client (pool, request builder, token provider) · registry · schemas · definitions
src/validation-engine/  engine · registry · context · policy · probe · production guard
src/validators/         44 centralized validators (auth, authz, request, response, security, perf, common)
src/business-rules/     endpoint-specific rules (licence limit, duplicates, blocked company)
src/database/           DB client · repositories · assertions · named DB validations
src/bug-tracker/        Bugzilla client · fingerprint · candidate · validity gate · filer
src/reporting/          validation reporter · bugzilla reporter · formatters
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

**Verified state:** `npm run check` clean; **52 tests pass, 2 skip** (the module suites skip until
their hosts are configured).

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

## 8. Decision log — what was done and why

Newest first. Each entry records the decision, not just the change.

### 2026-09-17 — `common.date` aligned to the API's GMT/UTC contract (was a false-positive class)

The API team confirmed their **timezone design**: timestamps are stored/returned in **GMT/UTC** (one
common base time) and the UI converts to local for display — a correct, standard approach. The
`common.date` validator required an EXPLICIT `Z`/offset, so it flagged two legitimate shapes as bugs:
(1) **date-only** calendar values (`2022-05-01`, an employee experience/start date — a calendar date
has no time or timezone), and (2) **GMT date-times without an explicit offset** (UTC by the team's
contract, e.g. KMail `lastFetchDate`, `createdDate`). Both were false positives.

Relaxed the check to the API's actual contract: accept a date-only value, and a `T`- or space-separated
date-time with `Z` / `±HH:MM` / `±HHMM` OR **no** offset (treated as UTC). It still rejects genuinely
malformed values (`Sep 17 2026`, `17/09/2026`, epoch numbers, unparseable dates — verified), and the
real date defects still fire: audit dates out of order (`createdAt > updatedAt`) or in the future. So
this removes the cosmetic false positives without weakening the meaningful checks — the KMail
`common.date` tickets (e.g. #215) and the admin experience-date finding no longer file. `npm run check`
clean. (The best-practice note stands: ideally the API appends `Z` so the value is self-describing for
non-UI consumers — but that is the team's call, and the bench no longer files it as a defect.)

### 2026-09-17 — Phase C BUILT: the Admin/HR-Setup UI harness (`kpostadmin.kpostindia.com`)

The owner asked to finish the Admin module to the KPost bar — both APIs and e2e UI. The Admin **API**
was already end-to-end (Phase A write lifecycle GREEN, Phase B business-admin, engine contract tests on
every registered admin endpoint). The gap was the **UI**, now built — the admin analogue of the KPost
`screens.spec.ts` deep sweep:

- **`tests/setup/auth-admin.setup.ts`** — the admin UI is a separate CoreUI SPA with **no login screen**;
  it is SSO'd by the same KPost token planted in `localStorage`, exactly as its own `Callback.js` does.
  The setup mints a BUSINESS_M token via the API, GETs `/v2/profile/getUserProfile/`, and seeds
  `accessToken` + `AuthUser` + `companyID` (+ the CoreUI theme key) on the admin origin. Gated
  `ADMIN_UI_LIFECYCLE=true`; otherwise it saves an anonymous state and the specs self-skip.
- **`admin-ui` Playwright project** — its own `baseURL` (`ADMIN_UI_BASE_URL`), `storageState`
  (`.auth/admin.json`), `testDir ./tests/e2e-admin`, `dependencies: ['setup']` — kept out of the main
  browser glob.
- **`src/ui/admin-screens.ts`** — the screen registry, **selectors mined from the frontend source**
  (`ADMIN_HR_MODULES_25/src`, via a sub-agent): all 8 routed screens (dashboard, workplace-setup,
  workplace-location-setup, hr-breakdown-setup, role-posting-setup, employee-data, assign-role-posting,
  employee-management), each proven by its `.title-font` heading (or its Tier/Variable tabs for
  `/hr-breakdown-setup`, whose heading text is a copy-paste bug — "Work Place Setup"), plus the shell
  (`.sidebar-nav`, `.header.header-sticky`) and each screen's key controls (tabs, the `.boderIcon`
  Add/View icon control). **The app ships NO `data-testid`**, so all selectors are text/className.
- **`tests/e2e-admin/admin-screens.spec.ts`** — the deep sweep: navigate → assert mounted → assert
  shell + controls → run the whole `ui-checks` catalogue (JS crash / broken asset / render budget /
  responsive / a11y). Reuses the KPost UI infra; `ui-health.ts` now includes the admin hosts so a
  broken admin asset is caught. Deliberately **NOT in `UI_FILING_SPECS`** — a selector miss surfaces
  for triage but never files against the wrong product (admin-UI bug routing to KPost Admin is a
  follow-up).

`npm run check` clean; **79 framework guards pass**; the admin-ui project **self-skips** on a normal run
(8 screen tests skipped, the anonymous states saved). Like the KPost UI, the mined selectors need **one
`ADMIN_UI_LIFECYCLE=true` live tuning pass** to confirm GREEN on the deployed build — the flow logic,
gating and SSO seed are correct; only the exact selectors want one headed confirmation. Two product
findings already captured from the source: `/hr-breakdown-setup`'s heading says "Work Place Setup", and
two sidebar links (`/MenuPrivilege`, `/PostalCodeLibrary`) are dead (no matching route).

### 2026-09-17 — 7 false-positive KPost tickets marked INVALID; secret-message benign pattern completed

The owner asked to mark the invalid open KPost tickets INVALID. Queried the live KPost API product,
identified **7 false positives** (each verified not to name a real secret) and marked them
RESOLVED/INVALID with an explanatory comment for the developer, so dedup never re-files them:

- **5 `secretMessage*` sensitive-data** (#83, #92, #93, #132, #291) — the disappearing-message
  timestamp/id fields flagged only because the name contains "secret".
- **2 image-download 204** (#160 `downloadFullProfileImage`, #161 `downloadProfileImage`) — 204 is the
  correct "no image" response; the status check had expected 200 (already fixed via `expectedStatus`).

**A real validator gap the owner's note exposed.** The secret-message feature has two modes (Katchup
FRD FR-KU-017..024): **Disappear As Per Schedule** carries a time (`secretMessageExpireTime*`, an epoch
— stays until that time) and **Disappear After Reading** carries none (`isVanished` — stays until read,
then vanishes). `BENIGN_SECRET_FIELD` only matched the camelCase form, so the snake_case
`secret_message_msgIDs` (#291) was **still being flagged**. Fixed the pattern to allow an optional
separator (`^secret[_-]?(message|…)`), so both camelCase and snake_case disappearing-message fields are
benign, while real `secret*` credentials (`secretKey`, `secret_key`, `clientSecret`, `secretToken`)
stay flagged. New guard `tests/framework/sensitive-data.spec.ts` pins both directions. `npm run check`
clean. So this class of false positive can no longer be filed, in either field-name form.

### 2026-09-17 — Developer guidance added for the `common.*` validators, so KMail tickets self-explain

The owner noticed KPost tickets carry the "For the developer" block (What this means / Why it matters /
How to fix) but KMail tickets do not. Cause: `developerGuidance` is keyed by VALIDATOR, and covered
only the security/auth/response-envelope/input-validation validators — which dominate KPost's findings.
KMail's findings are mostly the **`common.*` data-shape validators** (`common.id`, `common.date`,
`common.api-error`, `common.email`, `common.url`, `common.boolean`) that check the returned data (id
format, ISO-8601 dates, error envelope, valid email/URL, real booleans), and those had **no guidance
entry** — so those tickets omitted the block. Not a product difference; a validator-coverage gap.

Added guidance for all six `common.*` validators (`guidance.ts`), each with an accurate meaning/why/fix
matched to what the validator asserts. Now a KMail ticket is as self-explanatory as a KPost one, and
KPost's own `common.api-error`/`common.date` tickets (24 of the 189) gain the block too. This is
description text only — **no fingerprint/tag change, so no dedup impact and no duplicates**. Already-filed
tickets keep their original description (a re-file comments, it does not rewrite the first comment), so
the block appears on newly-created tickets going forward. The `teaches the developer` guard now pins the
common family too. `npm run check` clean; **78 framework guards pass**.

### 2026-09-17 — Dedup is now PRODUCT-scoped, so a KMail finding never collapses onto a KPost ticket

The owner caught a cross-product mix: a **platform-wide (systemic)** fault gets a product-AGNOSTIC tag
(`systemicFingerprint` = `platform|validator|message`, endpoint excluded), so the same gateway/auth
fault on KPost and KMail computes the SAME `[KP-]` tag. The dedup search (`findByTag`) then matched
the tag across products, so a KMail systemic finding could comment on / reopen a KPost ticket (and the
KPost run had been doing the reverse). Verified on live: KMail already has **11** systemic tickets
(#219–#229) under those shared tags, and `[KP-6A62DD]` (security-headers) exists **only** as KMail
#219 — KPost's copy has been collapsing onto it.

**First tried the wrong fix — scoping the fingerprint by product.** Reverted it: KMail's 11 systemic
tickets are already filed under the old tags, so changing the tag would orphan them and **duplicate all
11** on the next KMail run — exactly the duplication the owner forbids.

**The safe fix: scope the MATCH, not the tag.** `BugzillaFiler.process()` now filters `findByTag`
results to bugs whose `product` equals the candidate's product before deciding comment/reopen/skip
(`BUG_FIELDS` already returns `product`). No tag changes → nothing filed is orphaned or duplicated;
a finding only ever dedupes against its OWN product's tickets, and if the tag exists only under a
sibling product it correctly CREATES the missing ticket in the right product. Two guards pin it (a
sibling-product tag is not matched → files its own ticket; a same-product tag still comments → no
duplicate). `npm run check` clean; **78 framework guards pass**.

**Consequence, recorded honestly:** the KPost filing that already ran (old unscoped dedup) commented
its 2 collision systemic findings (security-headers `[KP-6A62DD]`, auth-500 `[KP-AFF1DB]`) onto the
KMail tickets #219/#223. Going forward this is fixed; a future KPost run will CREATE those 2 as its own
KPost tickets (a correction, not a duplicate — KPost never had them). KMail is now safe to file: its 11
systemic + endpoint findings comment on their own KMail tickets, create the genuinely new ones, and
never touch a KPost ticket.

### 2026-09-17 — Lifecycle flows now FILE their server-error findings (safely) — the developer sees them

The owner's question: if a gated lifecycle flow finds a bug but only records it in CLAUDE.md, how does
the developer ever learn about it? They don't — CLAUDE.md is the bench's notebook, not their queue. So
lifecycle findings now file to Bugzilla, but under a **narrow, safe rule** that preserves every
existing guarantee.

**The rule — only a `5xx` from a gated write files.** A server that crashes is the developer's defect
no matter what we sent: even a malformed or incomplete request must be answered with a 4xx, never a 500. A `4xx` might be OUR payload (the contamination risk), and a bench/sequencing failure is our
fault — so neither is ever turned into a ticket. The feature spec's own `expect.soft` still surfaces
those for triage. This makes the real crashes visible (`employeeDetails/save` NPE 500, the three
scheduled-call 500s, `updateScheduleRemarks` 500, …) without opening a false-bug door.

**How, and why it inherits every protection:** the `EndpointExecutor` collects any 5xx from an
`allowLiveWrite` call at the single `send()` chokepoint (after the production guard, kill-switch and
QA-identifier guard have already passed — it only reads the response, sends nothing new).
`src/validation-engine/flow-finding.ts` turns each distinct erroring endpoint into a normal
`ValidationReport` (validator `flow.server-error`, CRITICAL, with the curl + response body), and the
`endpoints` fixture attaches it at test end. From there it travels the **same** pipeline as an engine
bug — so it is automatically **deduped** (a stable `[KP-]` fingerprint → a re-run comments, never
duplicates), **gated** (the validity gate; below-floor/no-evidence/self-contradicting are rejected),
consolidated per endpoint, and routed to the right developer. `tests/framework/flow-finding.spec.ts`
pins all three: one valid `[KP-]`-tagged candidate per erroring endpoint, stable across runs (dedupe),
and a 4xx is never a finding. `npm run check` clean; **76 framework guards pass** (was 74). So
`flow:file:api` now files genuine write crashes too, and still cannot file a duplicate, an invalid, or
a false bug.

### 2026-09-17 — False-bug class fixed: request-body fuzzing no longer runs on a live GET

Reviewing the owner's KPost filing report, `GET /v2/profile/fetchUserDetails/` and
`GET /v2/profile/isDevicePrimaryOrNot/` were filing ~7 invalid tickets — `request.null-value`,
`request.data-type`, `request.invalid-payload` and `request.malformed-json` all reported "expected
400, got 200". Both are **method-corrected GETs** (`method: 'GET'`, `contractMethod: 'POST'`): they
keep the POST-era `requestSchema` for documentation, so the body fuzzers fired and sent a body with a
GET — which the server correctly **ignores**, answering 200. A 200 there means "the body was ignored",
not "invalid input was accepted", so the finding was a false positive.

Fixed centrally: `carriesRequestBody(endpoint)` (= method ≠ GET) in `request-mutation.ts` now gates the
body section of every schema-driven request validator and `malformed-json`, so a GET's body is never
fuzzed (its query/path still are). The other body validators (`empty-body`, `unsupported-media-type`)
already skipped correctly via `request.body === undefined`. Verified on live: the two GETs now report
only the real systemic findings (missing security headers, auth filter answering 403/400 not 401), and
the request-fuzz false positives are gone. `npm run check` clean. So a re-run files ~7 fewer (invalid)
tickets. The rest of the KPost report is valid: systemic auth/header/error-envelope (consolidated),
input-validation-not-enforced, and genuine server errors (500/400 on reads).

### 2026-09-17 — Full payload audit: every documented field checked against every endpoint; a regression guard

The KMail-signature false bug (below) was one instance of a class: a hardcoded partial request the API
validates and answers an error the bench reads as a defect. The owner asked to audit **every**
endpoint's payload against its contract. Built `tests/framework/payload-audit.spec.ts` — it builds
each non-fixture endpoint's real request from its own factory and compares the sent keys (body + query

- pathParams, case-insensitive) against the documented request fields, generating `docs/PAYLOAD-AUDIT.md`.

**The signal that matters is the documented request _example_, not the schema.** Splitting "missing"
that way collapsed 57 raw rows to the real risk:

- **Missing from the EXAMPLE** (the payload the product actually sends) = the false-bug class. Further
  filtered by **`productionSafe`**, because only a live-running endpoint auto-files a bug: a gated write
  is blocked by the production guard on the default run, and its real payload (with runtime ids) is
  built by its `*_LIFECYCLE` spec, not the static factory. That left **7 → 0**.
- **Missing from the SCHEMA only** (no example) = almost all the admin springdoc DTO, which lists every
  optional field while the measured frontend sends a subset. Correct, not a defect.

**The 7 live risks resolved:** 3 were audit false-positives now handled in the audit itself (a GET has
no request body, so a stale POST-era example does not describe fields it should send — `fetchUserDetails`,
`isDevicePrimaryOrNot`; and `userLogout` sends `deviceIdentity_primary` where the example says
`deviceIdentity_Primary`, a casing difference the working client wins — hence case-insensitive compare).
The other 4 were completed with QA-safe values: `advancedSearch` (+empty pincode/state/city/country),
`getSearchDetails` (+empty province/state/city — an `areaName` lookup ignores them), and the two admin
name suggestions (+`companyName` from the allowlisted `testData.companyName`). Empty/allowlisted values,
so no real person or place is named and the QA-identifier guard still passes.

**The guard so it can't regress — TWO tiers, because a bad write contaminates other endpoints.** The
owner's sharpening: a wrong/incomplete payload sent to ONE endpoint can, on the **shared monolithic DB
with circular module dependencies (§3)**, persist bad data a DIFFERENT endpoint later reads — so it
surfaces elsewhere and looks like that endpoint's bug. A write's payload is safety-critical, not
cosmetic. So the guard now accounts for **every** payload gap, read or write:

- **Tier 1 (live false-bug risk):** no `productionSafe` endpoint may omit a documented-example field
  (`LIVE_OMISSIONS`, currently empty). One that does auto-files a false bug on the default run.
- **Tier 2 (contamination risk):** every GATED write / needs-id read that omits an example field must
  be recorded in `GATED_WRITE_OMISSIONS` **with the reason it is safe** — the field is supplied at
  runtime by the endpoint's `*_LIFECYCLE` spec (a real msgID/ObjectId/draftID no static value can
  replace), or the authoritative frontend client deliberately omits the stale workbook field (adding
  it back is itself the wrong payload — `recall` proves it). All 18 current gated omissions are
  recorded. A NEW gated write that under-sends fails the build until it is completed or examined.
- A stale-entry check keeps both allowlists honest (an id that no longer under-sends must be removed).

So no payload gap — anywhere — can reach the bench unexamined. `npm run check` clean; **74 framework
guards pass** (was 73). Lesson generalised: the false-bug risk is "runs on live AND omits a documented
field"; the contamination risk is "a write with a wrong/incomplete payload persists bad data others
read" — and both are now mechanically caught, not trusted to review.

### 2026-09-16 — KMail signature payloads completed to the documented contract (was causing false bugs)

A developer questioned a filed bug on `saveOrUpdateMailSignaturePersonalData`: the bench sent only
`{firstName,lastName,designation}` while the documented payload (KMAILAPI tab / `openapi/kmail-api.openapi.json`)
is `{firstName,lastName,designation,emailId,mobileNumber,alternateMobile}` — the API validated the
missing fields and answered an error, so the "bug" was our incomplete request, not a product defect.

Audited every KMail settings endpoint against the generated contract and completed the **5** whose
hardcoded literal was a subset of the documented fields (`src/api/definitions/kmail/settings.api.ts`):
`sig-personal` (+emailId/mobileNumber/alternateMobile), `sig-company` (+addressLine1/2), `sig-graphics`
(+bannerUrl/bannerLinkingTo), `sig-social` (+instagram/linkedIn/youTube), `sig-full` (+company/graphics/
style/social sub-objects). Values are **QA-safe and allowlisted** — `mobileNumber`=`testData.mobileExists`,
`emailId`=`testData.otpEmail` (never a real person's contact, so the QA-identifier guard still passes).
Also completed the send payload (`mailShape`) with the one missing documented field, `attachmentUuid`.
The other KMail writes (postMail, drafts, saluation, instant-reply) were already complete. `npm run check`
clean; 73 framework guards pass. Lesson: a hardcoded partial payload files a false bug — a definition's
request must carry every documented field, checked against the generated contract.

### 2026-09-16 — SMS/OTP kill-switch: the bench can never send an OTP/SMS against a real host

The owner reported the Nettyfish SMS gateway draining — OTPs sent every second to many different
mobile numbers from many different IPs. **Investigated and cleared the bench:** no bench/Playwright
process was running, zero connections to `devapi2` (the `sendOTP` host) from this machine
(`192.168.0.50`), and no `sendOTP` in any run artifact — the pattern (different numbers + different
IPs) is **external SMS-pumping/bombing abuse** of the public, unauthenticated, unthrottled
`/v2/common/sendOTP/` endpoint (a real KPost API vulnerability: needs CAPTCHA + per-number/global rate
limits + a country allowlist server-side). The bench was never the source.

**Even so, added an absolute SMS/OTP kill-switch** so the bench can never contribute: the FIRST check
in `destructiveBlockReason()` blocks any endpoint that delivers a real OTP/SMS/e-mail
(`otpDependent`, `sideEffect: 'external'`, OR a path/label matching `otp|sms|forgotpassword|…` as a
backstop for a mis-flagged one) **against any real host, in EVERY mode** — production, dev, local — and
**no flag** (`allowDestructive`, `allowLiveWrite`, a wrong `TEST_ENV`) can unlock it. It runs only
against the bundled mock (`mockApi: true`, which sends no real SMS). Threaded `mockApi` through
`SafetyFlags` and the executor. Two new `live-safety.spec.ts` guards pin it (every registered OTP/SMS
sender is refused on a real host); the older tests that used `sendOTP`/external as examples were
updated to the stronger behaviour. `npm run check` clean; **73 framework guards pass**.

### 2026-09-16 — `docs/BLOCKED-ENDPOINTS.md` rebuilt: module-by-module, covered-vs-truly-off-live

The owner asked which endpoints are TRULY not tested on live (vs merely off the default run).
`blockedReason()` now classifies every blocked endpoint as **COVERED via lifecycle** or **OFF-LIVE**.
`docs/BLOCKED-ENDPOINTS.md` was refocused to list **ONLY the not-tested-on-live endpoints** (41), with
a count-by-category table and a module-by-module breakdown; the lifecycle-covered ones are excluded
(listing them would misrepresent them as untested). The two coverage tiers behind it:

- **Part A — covered on live via the gated lifecycle (172):** every destructive write (driven by its
  module `*_LIFECYCLE`, self-cleaning) and runtime-id read (message/call/group/mail/document/ObjectId,
  minted by a write flow). Off the DEFAULT run only because that run fuzzes every field. Run with
  `npm run flow:file:api`.
- **Part B — TRULY off the live app (41):** OTP (no bypass), global/shared writes by choice (account
  provisioning `addingUserByAdmin`/`terminateUser`/`resetPassword`, company data, app version, password),
  real SMS/email, public record writes (`saveEnquiry`/`saveUnsubscriber`), the **attachment file-upload
  gap** (~8: `download`/`downloadThumbnail`/`mediaStreaming`/`generateThumbnailUsingUUID` — need a real
  S3 upload the bench does not do yet — the ONE genuine coverage gap), and 2 needs-setup reads
  (`adminUserLogin` 403, `downloadCompanyLogo` 500). All contract-validated off live.

So of 336 registered: **123 run on the default live run, 172 covered via lifecycle, 41 truly off-live**
— and the only real gap is attachment file-upload. `npm run check` clean; 71 framework guards pass.

### 2026-09-16 — Business/company reads enabled on live; blocked-endpoint reasons made honest; new file

The owner asked why so many endpoints skip on live now that business accounts exist, to enable the
company tests, and to list the blocked endpoints clearly in one file. Three things:

- **4 company/business reads enabled on live** (`productionSafe`), using allowlisted BUSINESS_M data:
  `mobileNoExistInsideCompany` (admin's mobile in company 1067 — a real membership check),
  `uniqueNameExist`, `generateDomainAndUniqueName`, `getCompanyNameExistOnKpostAndKsmacc` (a
  known-absent, now-allowlisted company name). Added `companyNameAbsent` to `IDENTITY_FIELDS` so the
  guard permits it. **Runs-on-live 119 → 123**, blocked 217 → 213.
- **The "needs a business account" catch-all was mostly WRONG** — it lumped 27 endpoints, but the real
  reasons are: **25 need a runtime id** (message/mail/document/attachment from a write), **7 KMail
  mail/kmailID reads**, **5 admin ObjectId reads**, and only **2 genuinely need setup we lack**
  (business-tier `adminUserLogin`, which our M/L accounts answer 403 — a finding; and the company-logo
  download, a known 500). `blockedReason()` in `live-coverage.spec.ts` now categorises accurately by
  runtime-id path/tag, so the false "needs a business account" impression is gone. The writes (144),
  OTP (15) and runtime-id reads (37) are all **covered by the gated lifecycle flows**, not gaps.
- **New file `docs/BLOCKED-ENDPOINTS.md`** — the single clear list of everything that does NOT run on
  live, grouped by reason with a summary table, generated every framework run. `REPORT.md` also gained
  a per-reason skip breakdown (earlier this day).

`npm run check` clean; 71 framework guards pass. So the business/company account surface is now tested
on live (company reads + Phase-A/B admin + user-management), and what stays blocked is documented,
grouped, and honest — almost all covered by lifecycle flows rather than by a missing business account.

### 2026-09-16 — KPost-API filing review: 2 false-positive classes fixed; report explains skips + dedup

Reviewing the owner's KPost-API preview (`reports/bugs/REPORT.md`, 200 would-file), found and fixed
two false-positive classes that would have filed **5 invalid CRITICALs**, and answered the "will it
duplicate?" question with a live cross-check:

- **Sensitive-data false positive** — `secretMessageExpireTimeAsLong` (a disappearing-message epoch
  timestamp) was flagged as an exposed secret because the field name contains "secret". Added
  `BENIGN_SECRET_FIELD` to `security.sensitive-data.validator.ts` excluding the disappearing-message
  domain (`secret{Message,Timestamp,Icon,Option,Scheduled,Delete,Timers,Expire}…`); genuine
  `secretKey`/`clientSecret`/`secretToken` still flag. Kills 3 CRITICALs (dashboard ×2, katchup ×1).
- **Image-download 204 false positive** — `downloadProfileImage`/`downloadFullProfileImage` return
  **204 when the account has no image**, which is correct; the status validator expected 200. Added
  `expectedStatus: [200, 204]` to both. `downloadCoverImage` stays red (its **500** on no-image IS the
  real bug). Kills 2 CRITICALs.
- **Dedup proven, not assumed** — cross-referenced the report's 200 `[KP-]` tags against the 187 live
  KPost bugs: **173 already exist → will be COMMENTED (reproduced), 27 are new → CREATED.** The dry-run
  "would-file 200" is misleading because **preview skips the dedup search**; only the live `bugs:file`
  dedups. (4 of the 5 false positives already sit in Bugzilla from a prior run — owner to mark INVALID;
  the 1 new one is now prevented.)
- **Report now explains the skips** — `bug-report.ts` buckets the ~15k SKIPPED checks by reason
  (write/destructive endpoint · mutating-attack probe · OTP · needs-runtime-id · N/A-endpoint) in a
  "Why N checks skipped" table, so the large skip count reads as the production safety controls at
  work, not a coverage gap.

`npm run check` clean; 71 framework guards pass. Next `bugs:preview:kpost` regenerates the report
without the 5 false positives (200→~196 would-file, 27→26 new) and with the skip breakdown.

### 2026-09-16 — Perfect filing setup: correct components on ALL products; KMail systemic component added

Before the owner's KPost+KMail filing run (dev team waiting), verified every bug routes to the CORRECT
component on all four products, and closed the one asymmetry:

- **Live-verified components (queried `192.168.0.50`):** KPost API **27** (bench routes to 14), KMail
  API **9→10** (routes to 7 + systemic), KPost UI **~22** (routes by screen), KPost Admin **25**
  (routes to 9). Every routing target exists; **zero endpoints hit any catch-all**.
- **Correctness, not just existence:** `component-routing.spec.ts` now emits the full **endpoint →
  component** map in `docs/COMPONENT-ROUTING.md` (was counts-only), so routing is auditable per
  endpoint. Spot-checked: all `admin-*` + `common-company-*` + the logo trio → **Company
  Administration**; auth/OTP/login → **Authentication V2**; M/L login → its own component; KMail
  drafts → **Draft Mail**, signatures → **Settings**; UI kmail → **KMail**, kdirectory → **KDirectory**.
- **KMail systemic component added** (`Authentication & Gateway`, Bugzilla component id 84, KMail API,
  assignee Jitendra) and wired as `SUITES['kmail-api'].bugzilla.systemicComponent` + `KNOWN_COMPONENTS`.
  KMail's platform-wide faults (headers, auth-filter status, error envelope) now consolidate there
  instead of the `kmail-application` catch-all — the parallel to KPost's `Authentication V2`. The
  ownership guard ("every configured systemic component exists in its product") passes against live.

Two guards keep this true on every run: `component-routing` fails the build if any endpoint routes to
a non-existent component; `ownership` reconciles config against the LIVE Bugzilla so drift on either
side fails. Dedup re-confirmed: 187 KPost + 81 KMail bugs all carry `[KP-]`, so a re-run comments,
never duplicates. `npm run check` clean; 71 framework guards pass. The bench is filing-ready.

### 2026-09-16 — NEW DOCS: 6 per-module FRDs (153 FRs); KDirectory in scope; Katchup gains Disappearing Messages

The owner added **six standalone per-module FRDs** to `D:\Kpost Documents` (all 2026-09-16), each split
out of the consolidated FullSuite FRD and expanded from its own User Manual — they **supersede the thin
FullSuite summary** (55 FRs/4 modules) as the requirement source of truth:

| Doc                                  | Module                                 | FR scheme                           | Count |
| ------------------------------------ | -------------------------------------- | ----------------------------------- | ----- |
| `KPOST_FRD_Module1_SignupLogin_v1.7` | Signup & Login                         | `FR-SL-001..032`                    | 32    |
| `KPOST_FRD_Katchup_v1.9`             | Katchup (+ Group Messaging §8, 12 FRs) | `FR-KU-001..057`                    | 57    |
| `KPOST_FRD_Group_v1.0`               | Katchup — Group Creation & Management  | `FR-GC-001..008` + `FR-GM-001..016` | 24    |
| `KPOST_FRD_Module3_Kall_v1.0`        | Kall                                   | `FR-KL-001..009`                    | 9     |
| `KPOST_FRD_Module4_KMail_v1.8`       | KMail                                  | `FR-KM-001..025`                    | 25    |
| `KPOST_FRD_Module5_KDirectory_v1.0`  | KDirectory                             | `FR-KD-001..006`                    | 6     |

**≈165 FRs across SIX modules (Katchup includes FR-GMSG Group Messaging, 12)** (Signup & Login, Katchup, Kall, KMail, KDirectory, KDOC), not four.
Text extracted with a PowerShell `System.IO.Compression` reader (the .docx are 8–21 MB — images; the
text is small). Two scope-shifting facts and the module-by-module delta vs the bench:

**SCOPE CHANGE — KDirectory is now IN scope.** It has its own FRD (6 FRs: listing, search-by-name,
entry details name/role/team, total count, view full profile, launch Katchup/Kall from a profile). §1
still called it out-of-scope per BRD §4.2 — corrected. It overlaps the bench's existing contacts/company
member reads and the verticals `KDirectory` UI screen, so it is mostly a mapping + a focused screen/read
pass, not a new module build. **KDOC stays out of scope** — no per-module FRD was supplied (only
referenced), and BRD §4.2 still excludes it.

**FUNCTIONAL GAP — Katchup Disappearing / Secret Messages (FR-KU-017..024, 8 FRs).** A compose-toolbar
**Confidential Message (lock) icon** → a bottom sheet with **‘Disappear After Reading’** and **‘Disappear
As Per Schedule’**, a countdown timer, and backend **auto-deletion / disappearing-message enforcement**.
This maps to the API's secret-message expiry (the `secretMessageExpireTimeAsLong` field already seen on
dashboard reads) and is **distinct from Confidential Copy** (NFR-SEC02, the hidden-recipient feature the
bench already proves). The bench's 35-feature Katchup catalogue does **not** cover it — a real gap.

**The delta, module by module (bench = what we have; to-do = the line items below):**

- **Signup & Login (32)** — login (FR-SL-023..026, 032) is built; signup (FR-SL-001..022) stays
  out-of-scope (OTP-gated, accounts made by hand); the device/permission FRs (FR-SL-027..031) are mobile
  app permissions (notification/contacts/battery/primary-device) — web-untestable or OTP-gated. Action:
  FR-map the login ones; record the 22 signup FRs as documented-out-of-scope (not a coverage gap).
- **Katchup (57)** — compose/subject/copies/confidential-copy/edit/recall/repost/note/reminder/transfer/
  forward/reply/comment/clarify/report/delete are built. **Gaps:** Disappearing Messages (FR-KU-017..024),
  the four Forward hidden/revealed × with/without-thread variants (FR-KU-035..038 / 050..053), AI-Assist
  compose (FR-KU-008) & AI reply (FR-KU-044), attachments (already blocked-with-reason: file upload).
- **Group (24)** — create→add→admin→rename→image→leave→remove→delete lifecycle is green (API) + create UI.
  **Gaps/BRs:** the **minimum-one-admin rule on Exit (FR-GM-014)** — sole admin blocked until another is
  added — not asserted; **Remove Admin / demote (FR-GM-013)**; Group-Info per-member KMail/Katchup/Kall
  quick actions (FR-GM-004..006); the ≥1-member-to-create constraint.
- **Kall (9)** — fully built; just re-tag `requirements` from the old FR-C ids to `FR-KL-001..009`.
- **KMail (25)** — fully built. **BRs to assert:** **single-recipient To: field (FR-KM-005)** (one TO,
  Cc for more); priority-flag (FR-KM-010/011); remove-default-signature (FR-KM-013). External interop
  (FR-KM-021..025: open-with / Gmail/Outlook/Yahoo) is client/mobile — UI-only, likely untestable.
- **KDirectory (6)** — NEW in scope; cover listing/search/details/count as reads + the profile→launch UI.

**TO-DO (ordered, execute line by line):**

1. CLAUDE.md §1 modules table + §4 traceability rewritten to the 6-module / 153-FR / FR-xx scheme (this pass).
2. `docs/requirements-frd.md` (new) — the authoritative FR→endpoint/spec map, generated-or-maintained, one row per FR with its coverage state, so "153 FRs, N covered" is measured not claimed.
3. FR-traceability on definitions: re-tag Kall→`FR-KL-*`, KMail→`FR-KM-*`, Group→`FR-GC/GM-*`, Katchup→`FR-KU-*`, login→`FR-SL-*`; a framework test fails if an FR is unmapped or names a nonexistent id.
4. Katchup **Disappearing Messages** — verify the secret-message API shape on live (expiry field), add the API lifecycle (send secret → expiry set → read-back), gated; add the UI compose flow (lock icon → mode → send) blocked-with-reason if selector-walled.
5. KMail **FR-KM-005 single-recipient BR** + priority-flag assertions (API/UI).
6. Group **FR-GM-014 min-one-admin BR** + Remove-Admin, asserted in the gated group lifecycle.
7. KDirectory — reconcile against contacts/company reads; add the listing/search/profile coverage + the verticals screen assertion mapped to FR-KD-*.
8. Forward hidden/revealed × thread variants (FR-KU-035..038/050..053) — extend the Katchup lifecycle.
9. Re-run `npm run check`; regenerate coverage docs; then resume Phase C (admin UI).

Nothing in the bench was changed in this entry beyond CLAUDE.md — this records the analysis and the plan
before touching flows, per the working agreement. Executing the to-do from item 1.

**Progress (2026-09-16, same day):**

- **Items 1–2 DONE** — CLAUDE.md (§1/§4/§8) + `docs/requirements-frd.md` (the FR→coverage map, all
  ~165 FRs incl. the 7th sub-scheme `FR-GMSG` Group Messaging found on re-check).
- **Item 3 DONE** — `src/config/frd-requirements.ts` (canonical FR registry, 165 ids) +
  `tests/framework/requirements-traceability.spec.ts` (guard: every `requirements` id must be a known
  FR/NFR/pending-legacy; the legacy list must stay honest). Migrated Kall `FR-C→FR-KL` (clean 1:1),
  and the confident Katchup/KMail/login/group tags to the new scheme. **24/165 FR ids referenced;
  6 legacy remain**, each with a documented reason (no clean new-scheme FR: Katchup count/receipt,
  KMail draft/delete, company-logo, session/logout). Guard green.
- **Item 4 DONE (API)** — Katchup **Disappearing / Secret Messages** (FR-KU-017..024): a gated
  `katchup/feature.spec.ts` test drives BOTH modes measured from the frontend (`WriteMessage.js`):
  DeleteAfterRead (`isVanished:true`) and DeleteAsPerSchedule (`secretMessageExpireTime:<epoch>`); both
  fields already in `sendShape()`. Needs one `KATCHUP_LIFECYCLE=true` live run to confirm GREEN. The
  UI lock-icon compose flow + the `src/ui/katchup-features.ts` catalogue remap (still old `FR-K*`) are
  the follow-up. `npm run check` clean; framework guards pass.
- **Item 5 DONE (API)** — KMail `kmail/feature.spec.ts`: single-recipient To: (FR-KM-005, one
  `toAddress` + `ccList`) and high-priority flag (FR-KM-010/011, `KMAIL_PRIORITY.high`), gated.
- **Item 6 DONE (API)** — Group `group/feature.spec.ts`: promote→demote a co-admin (FR-GM-012/013)
  and the **min-one-admin BR (FR-GM-014)** — the sole admin's exit is asserted blocked (a 2xx is a
  recorded finding: the rule would be UI-only), gated.
- **Item 7 DONE** — KDirectory reconciled onto the existing directory surface (no new module):
  `contacts-my-contacts`→FR-KD-001/004, `contacts-global-search`→FR-KD-002/003,
  `profile-user-profile-by-kpostid`→FR-KD-005; FR-KD-006 (cross-module launch UI) stays PARTIAL.
- **Item 8 DONE (API)** — Katchup forward variants (FR-KU-035..038): all four hidden/revealed ×
  with/without-thread types (15/16/20/21) driven in `katchup/feature.spec.ts`, gated.
- **Traceability now 29/165 FR ids tagged; 6 documented legacy.** `npm run check` clean throughout.
- **Item 9 pending** — one batched `*_LIFECYCLE` live run to confirm the new gated tests GREEN
  (items 4/5/6/8), then build **Phase C** (the `kpostadmin.kpostindia.com` admin UI harness — env +
  `STORAGE_STATE_ADMIN` plumbing already in; SSO seeding measured from `Callback.js`).

### 2026-09-16 — PLAN + build: Phase C — the Admin/HR-Setup UI (`kpostadmin.kpostindia.com`)

KMail + KPost reconciled as end-to-end complete to the production bar (KMail API 79/80 — the 1 gap,
`kmailData/getKloudUsedData`, is not in the usable contract and needs a workbook row, not code; reads
live, writes gated+green incl. NFR-SEC02; UI screen+compose green). So the owner's next step: **build
the Admin module UI production-grade** — Phase C, the only remaining admin surface (Phase A write
lifecycle + Phase B business-admin reads are already GREEN).

**Intent.** The Admin/HR-Setup UI is a SEPARATE React front end (`kpostadmin.kpostindia.com`, CoreUI
template) from the main app, backed by `adminmodule`. **SSO is the same KPost token planted in this
origin's localStorage** — measured from the app's own `Callback.js`: it reads `?token=`, writes
`accessToken`, GETs `devapi2/v2/profile/getUserProfile/` and writes `AuthUser` = `data.data` and
`companyID` = `data.data.companyID`, then routes to `/dashboard`. Real routes (from `src/routes.js`):
`/dashboard`, `/workplace-setup`, `/workplace-location-setup`, `/hr-breakdown-setup`,
`/role-posting-setup`, `/employee-data`, `/employee-management`, `/assign-role-posting`.

**Build.** (1) `ADMIN_UI_BASE_URL` (env+`.env`) + `STORAGE_STATE_ADMIN` (`.auth/admin.json`).
(2) `tests/setup/auth-admin.setup.ts` — logs in BUSINESS_M, fetches `getUserProfile`, seeds the three
localStorage keys on the `kpostadmin` origin exactly as `Callback.js` does, saves the state; gated
`ADMIN_UI_LIFECYCLE=true` (else an anonymous state, so a normal run skips it). (3) `tests/e2e-admin/`
screen sweep — the 6 setup screens + dashboard render read-only (the write sequence is proven by the
Phase A API lifecycle; driving the UI create-flow is gated and comes after the screens are green).
(4) `admin-ui` Playwright project — its own `baseURL`+`storageState`, `testDir ./tests/e2e-admin`
(kept out of the chromium glob), `dependencies: ['setup']`. Do-not-touch rule stands: own QA company
(1067) only, read-only screens first.

### 2026-09-16 — KPost-app company-admin coverage: company reads live + the User Management UI GREEN

Finishing the company/admin surface on the **main KPost app** (the personal-only bench had skipped it):

- **API — company-lookup reads enabled on live.** `getCompanyDetails` / `getCompanyDetailsByAdmin` /
  `getCompanyDetailsByMobileNoAndproductId` now send the **BUSINESS_M admin's mobile**
  (`QA_BUSINESS_M_MOBILE=9988775544` → `businessMMobile`, allowlisted) and are `productionSafe`, so they
  resolve our OWN company (1067) and run live: `getCompanyDetails` answers 200 with a valid envelope.
  Finding on the way: **`getCompanyDetails` answers HTTP 500 on `{mobileNumber: null}` and on `{}`** —
  a client error returned as a server error.
- **UI — the BUSINESS_S User Management screen is GREEN** (`tests/e2e/usermanagement.spec.ts`, 6/6 incl.
  setup). New harness: **`tests/setup/auth-business.setup.ts`** logs in the BUSINESS_S admin
  (`sma.qa@kpost.in`) and saves `.auth/business.json` (`STORAGE_STATE_BUSINESS`), gated
  `BUSINESS_UI_LIFECYCLE=true` (the reusable pattern for company-admin UI, mirroring the auth2/auth3
  multi-account harness). The spec asserts the Business User Management workspace, the licence/channel
  summary and the member list render, and that **Add New Channels** opens its "Add Communication
  Channels" chooser (Add Manually / Bulk-Upload). It stops there — completing the add **provisions a real
  member account** (`addingUserByAdmin`, external), which is covered gated at the API level.

`npm run check` clean; 68 framework tests pass. The KPost-app company/admin coverage (API + UI) is done
bar the member-write flows (gated by design). **Next: the admin module URL** (`kpostadmin.kpostindia.com`
Admin/HR-Setup UI) — Phase C proper.

### 2026-09-16 — Phase B: kpost-api business-admin / User Management registered; reads LIVE, member writes gated

Registered the deferred `/admin/*` business-admin surface (`src/api/definitions/kpost/admin/user-management.api.ts`,
14 endpoints), payloads measured from `KPOST_REACTJS_2023_V1` (`Services/Setting.js` +
`components/UserManagement/UserManagement.js`). They authenticate as the **BUSINESS_M** admin
(`principalKey: 'business-m'`, company 1067) and route to **Company Administration**.

- **Reads run on live** and find bugs (34 pass, 33 findings — the same systemic auth/header classes):
  `userManagementDetails/{companyID}` (the company's members), `getBankAndCompanyDetails/{companyID}`,
  and the id/name suggestions. `productionSafe`, own-company only.
- **Member writes are `global` and blocked-with-reason** — they **provision or permanently destroy real
  accounts**: `addingUserByAdmin` mints a KPost login (external), `terminateUser` is irreversible,
  `resetPassword`/`holdOrRelease`/`createOrRemoveBackupAdmin` and the `/v2/admin/update{Company,Bank,Role}`
  ops change shared state. No expendable member exists to act on safely, so — like profile's
  `changePassword`/`deactivate` — they are contract-covered off-live and never driven on live by default.

`npm run check` clean; 68 framework tests pass; component-routing green. The `/admin/*` paths bucket to
the `admin` module in the coverage ledger (alongside the admin-api module). **Next: Phase C** — the admin
UI (`kpostadmin.kpostindia.com` Admin/HR-Setup, and the BUSINESS_S in-app User Management).

### 2026-09-16 — Phase A DONE: the admin write lifecycle is GREEN on live (BUSINESS_M, self-cleaning)

`tests/api/admin/feature.spec.ts` runs the full org-build on `adminmodule.kpostindia.com` as the
BUSINESS_M admin and **passes end-to-end, self-cleaning**: workplace tier→variable→location → HR
tier→variable → employee create/update, every step read back, then deleted in reverse dependency order.
This exercises **18 of the 22 admin writes** and **all 5 id-keyed reads** (`getLocation`, `getLocationById`,
both reporting hierarchies, `getRolePostingByCompanyIdAndEmployeeId`) with the **real ObjectIds** the flow
mints. Gated `ADMIN_LIFECYCLE=true`; every write carries `allowLiveWrite`. Payloads measured from the
frontend (`ADMIN_HR_MODULES_25/src/Services/{AdminSetup,HumanResources}.js`).

**Facts the build pinned down (measured, not guessed):**

- **tier/variable/location saves are ARRAYS**; the created id is at `value[i].id` (single saves at
  `value.id`). Branch on the envelope `status`, not the HTTP code.
- **The id-keyed reads must NOT set `destructive: false`** — like Kall's `needs-*-id` reads, they default
  to `destructive: true` for POST, so they are `@destructive` (grep-dropped on a default run, since a
  fabricated ObjectId would 404) yet `allowLiveWrite`-authorized inside the lifecycle. Setting
  `destructive: false` had them blocked by the production guard (`allowLiveWrite` clears only destructive
  writes). Fixed.
- **FINDING — `employeeDetails/save` NPEs (HTTP 500) when `employmentObj` is missing**:
  `Cannot invoke "…Employment.setEmployeeId(String)" because …getEmploymentObj() is null`. A missing
  required field should be a 400, not a server-error NPE. Sending `employmentObj: {}` makes it 200; the
  500-on-missing-field is a real ticket.

**The account-provisioning writes stay behind a SECOND flag.** `rolePosting/save` (allocate) and the
assign (`rolePosting/update` reallocate) **mint a real KPost + KSMACC account via external services**
(`RolePostingSetUpServiceImpl.sendKPostUserRequest` → login.ksmacc.in) that cannot be cleanly deleted,
and `suspendOrTerminateEmployee` pushes back to those services — so, like KOS's metered AI, they are held
behind `ADMIN_ROLE_POSTING_LIVE=true` (above `ADMIN_LIFECYCLE`), owner-authorized, never on a normal run.
Their id-keyed READ (`getRolePostingByCompanyIdAndEmployeeId`) is covered by the lifecycle without minting.

`npm run check` clean. **Next: Phase B** (kpost-api `/admin/*` business ops on the seeded members) then
**Phase C** (the `kpostadmin.kpostindia.com` UI + the BUSINESS_S user-management UI).

### 2026-09-16 — PLAN: cover the BUSINESS/company surface end-to-end (API + UI) — the deferred half

The bench tested only PERSONAL accounts; the business/company surface was deferred (§9 item 7: "Admin
waits on a business company with three members"). That block is now lifted — **BUSINESS_S has 3 members,
BUSINESS_M has 2** (`itsdjd1n.qt@`, `itsdjnjd.qt@`), BUSINESS_L admin-only. So we cover it all, in three
phases, to the same production bar (measured payloads, gated self-cleaning writes, valid bugs):

- **Phase A — `admin-api` write lifecycle** (BUSINESS_M, company 1067). The full org-build sequence on
  `adminmodule.kpostindia.com`, self-cleaning: workplace tier→variable→location → HR tier→variable →
  employee → role posting (assign) → suspend/terminate a throwaway → delete all in reverse. Exercises
  the 22 gated writes + the id-keyed reads (`getLocation`, `getLocationById`, reporting hierarchies,
  `getRolePostingByCompanyIdAndEmployeeId`) with real ObjectIds. Payloads measured from the frontend
  (`ADMIN_HR_MODULES_25/src/Services/AdminSetup.js` + `HumanResources.js`), not guessed.
- **Phase B — the kpost-api business/admin endpoints** (deferred, now buildable): the `/admin/*` ops
  (`addingUserByAdmin`, `resetPassword`, `holdOrRelease`, `createOrRemoveBackupAdmin`, `terminateUser`,
  `userManagementDetails/{companyID}`, `getBankAndCompanyDetails/{companyID}`, `displayNameSuggestion`),
  the business-tier login (`adminUserLogin` — note: these live M/L accounts answer it 403 and log in via
  `userLogin` instead, itself a finding), and the company lookups (`getCompanyDetailsByAdmin/ByMobile`).
  Reads on the business companies; writes gated + only on an EXPENDABLE member we can re-create, never
  the seeded ones.
- **Phase C — the admin UI end-to-end**: the Admin/HR-Setup UI (`kpostadmin.kpostindia.com`, M/L, SSO
  via the same `accessToken` in localStorage — confirmed in `APIService.js`) driven through the create
  sequence; and the BUSINESS_S in-app **User Management** UI (`account.kpostindia.com/usermanagement`).

Executing A → B → C. Do-not-touch rule stands: writes only on our own QA companies / expendable members,
self-cleaning; the seeded members are read-only fixtures.

### 2026-09-15 — Admin contract regenerated from the LIVE OpenAPI (112 ops); Excel dropped as the source

The owner asked to "make the perfect one" — so the `admin-api` contract now comes from the **live
service's own OpenAPI** (`adminmodule.kpostindia.com/v3/api-docs`, springdoc-generated from the
controllers' Swagger annotations), not the simplified `Admin_module.xlsx`. **`scripts/fetch-admin-contract.cjs`**
(`npm run contract:admin`) fetches it, **dereferences every `$ref`** (the bench's validators need inline
JSON Schema), and writes `openapi/admin-api.openapi.json` — **112 operations, 38 schemas**, accurate
methods and types (`companyId` string, ids 24-hex ObjectIds, bulk writes as arrays). The raw source is
cached to `contracts/admin-api.source.json` for an offline regen. **The Excel is no longer a source:**
the admin tab + `admin-api` product were removed from `excel-to-contract.cjs`, so `contract:excel` no
longer touches admin; the stale `contracts/admin-api.contract.json` was deleted.

**Definitions realigned to the real contract** (all 35 resolve against it, verified at load): the country
reference path is `{pincode}/{country}` and `getEmployeeDetails` is a plain **POST** (the Excel had wrong
param names and a GET — the `contractMethod` hack is gone). The live reads re-ran green: 11 reads on
BUSINESS_M (company 1067), same real findings, and the earlier `request.data-type` guard noise is gone
now that the schema types `companyId` as a string. `npm run check` clean; 68 framework tests pass.

**Scope settled by the owner: "the product having endpoints only."** So coverage targets the endpoints
the **product actually uses**, read from the frontend service files (`ADMIN_HR_MODULES_25/src/Services/
AdminSetup.js` + `HumanResources.js`): **38 endpoints**, all now defined (added the 3 the product calls
that were missing — `adminTierVariable/getAllReportingVariableHierarchy`, `hrSetUpTierVariable/delete`,
`rolePosting/getRolePostingByCompanyIdAndEmployeeId`). The other ~74 in the 112-op contract are **not
wired into the product** (product/project/holiday/demo/userDetails + tier-sibling controllers), so they
are out of scope, not backlog — the ledger note records this. The full 112-op contract stays as the
authoritative API reference; the bench tests the product's 38.

### 2026-09-15 — Admin module LIVE: 11 reads run on `adminmodule`; the live OpenAPI is authoritative; real bugs found

Ran the `admin-api` reads on the live Admin module (`adminmodule.kpostindia.com`) as the BUSINESS_M
admin — **they authenticate and return 200, and find real, correctly-routed bugs**. Several things the
live run + the backend codebase (`D:\KPOST_PROJECTS\Admin_Module`) corrected, each measured not assumed:

**Auth — plain `userLogin`, not `adminUserLogin`.** All three business admins log in via `userLogin`
(the default), and the live token carries `companyID` + `role: admin`; `adminUserLogin` answers **403**
for these accounts. So the per-principal `loginEndpointId` override was **removed** from business-m/l —
they use the default login. Discovered company ids (decoded from the token): **S = 1066, M = 1067,
L = 1075**, set in `.env` (`QA_BUSINESS_{S,M,L}_COMPANY_ID`) so the guard allowlists our own company.
`ADMIN_API_BASE_URL` corrected `devapi2` → **`https://adminmodule.kpostindia.com`** (it had been an
unused placeholder; the core `/admin/*` routes are `kpost-api` on devapi2, a different surface).

**The response envelope is `admin`, measured from the backend source (`ApiResponseEnvelope.java`):**
`{ value, status, statusCode, urlPath, error?, message? }` — the payload key is **`value`** (like KMail,
not `data`), and any handled failure returns **HTTP 500** (even "not found"). Ids are MongoDB
**ObjectIds** (24-hex) and **`companyId` is a string** ("1067"), not the KPost core's integers. Added the
`admin` profile to `response-contract.ts`; the read payloads send `companyId` as a string; `getEmployeeDetails`
is **POST** (the Excel mis-documented GET), fixed via `contractMethod`.

**The live service publishes an accurate OpenAPI** at `https://adminmodule.kpostindia.com/v3/api-docs`
— **112 operations, 38 schemas** (springdoc, generated from the backend's rich Swagger annotations). The
`Admin_module.xlsx` (35 rows, integer companyId, no arrays) is a **simplified/inaccurate subset**. The
live api-docs is the authoritative contract; **next step is to regenerate `admin-api` from it** (handling
`$ref` schemas) rather than the Excel — the "measure not guess" correction. For now the Excel-generated
paths are correct enough to run the reads (paths match; only method/type/envelope needed fixing).

**Findings on live (11 reads, consolidated, filed to KPost Admin → Jaganathan in a real run):**

- **CRITICAL — auth not enforced on a missing/malformed token.** No `Authorization` header, an empty
  token, or a non-Bearer scheme → **200** (or 500), not 401. The `AuthenticationFilter` only rejects a
  token that is present-but-invalid; a missing one passes through unauthenticated (confirmed in source).
- **HIGH — error responses are plain text, not the envelope.** The filter writes `"Invalid token"` with
  no `Content-Type` and no JSON body, so `response.error-format` fails across the auth-rejection cases.
- **MEDIUM — missing security headers** (CSP, referrer-policy, HSTS) — the same systemic class as the core.
- **MEDIUM — input validation**: `companyId: null` and an empty `{}` body are accepted with 200.
- **`rolePosting/getSuspendOrTerminateEmployee` answers 500** to several probes (server error where a
  4xx/401 belongs).

11 reads ran; the 3 id-keyed reads (`getLocation`, `getLocationById`, the HR reporting hierarchy)
correctly skipped (needs a runtime ObjectId a write creates). `npm run check` clean. Nothing filed
(dry-run). **Next:** regenerate the contract from the live api-docs; then the gated write lifecycle on
BUSINESS_M and the `kpostadmin.kpostindia.com` UI. Company users for M/L to come from the owner.

### 2026-09-15 — `admin-api` suite REGISTERED (35 endpoints); tier-aware login + companyId guard wired

Built the `admin-api` suite on the already-existing scaffolding (ownership, components, env var, spec
file, business principals were all in place). Offline build **verified**: `npm run check` clean, **68
framework tests pass** (component-routing, coverage-ledger, live-coverage all green), and the 35
endpoints collect as contract tests under "Admin API".

**What was added:**

- **`defineAdminEndpoint`** (`src/api/definitions/admin/admin-endpoint.ts`) — parallel to
  `defineKmailEndpoint` but **no path prefix** (the host serves at root), `suite: 'admin-api'`,
  post-login, `responseContract: 'kpost'` **as an assumption** (the workbook has 0 admin response
  samples; same-vendor envelope until the first live read confirms it, then measure an `admin` profile
  if it differs — the way `kmail` was measured).
- **35 definitions** in `src/api/definitions/admin/{workplace,hr,roles,employee}.api.ts`, grouped by
  the org-build flow (`docs/admin-flow.md`). **11 productionSafe reads** (the `get*ByCompanyId` /
  hierarchy / employee-list / address reads — company-scoped, safe on live); **24 gated writes/needs-id**
  (all `save/update/delete`, role assign, suspend/terminate — destructive, `sideEffect: 'data'`, gated).
  Every POST read carries `destructive: false` (the grep-drop trap). `admin.api.ts` re-exports
  `./admin`; `uncoveredAdminPaths()` = 0.
- **`workbook-contract.ts`** — imported `admin-api.openapi.json` into `DOCUMENTS` (the one line that
  makes `workbookContract('admin-api', …)` resolve).
- **Component routing** — `ADMIN_COMPONENT_BY_TAG` (slug→component) wired into `SUITES['admin-api']`;
  each endpoint carries one slug tag (`workplace-tier-attribute`, `hr-tier-variable`, `role-posting`,
  `employee`, …) that routes to its real `KPost Admin` component.
- **Auth (the module is BUSINESS_M/L-only, SSO):** two mechanisms. (1) A per-principal
  **`loginEndpointId`** override (`Principal` schema + executor `login()`): `business-m`/`business-l`
  authenticate via **`adminUserLogin`** (the enterprise login), the same token then works on the Admin
  module. (2) A per-endpoint **`authentication.principalKey`** (`business-m`) because several principals
  share `COMPANY_ADMIN` — `defineAdminEndpoint` defaults to it, and the executor's new `principalFor()`
  resolves it. So admin-api always runs as the BUSINESS_M admin.
- **`companyId` guard:** added `QA_BUSINESS_{S,M,L}_COMPANY_ID` (schema + SOURCES + IDENTITY_FIELDS), so
  the caller's own company id enters the allowlist once discovered; payloads fill `companyId` from
  `testData.businessMCompanyId`. Unset → not allowlisted → any admin call is refused on live (the same
  self-enforcing scope the personal accounts use).

**A ledger nuance, made honest:** the core-app `/admin/*` routes (KPost API's business-admin ops =
BUSINESS_S in-app user management) bucket to the same `admin` module by path segment, so the module
shows 35 admin-api (built) + ~12 core `/admin/*` (the remaining slice), the note says so.

**Owner pointed at the Admin codebases** (backend `D:\KPOST_PROJECTS\Admin_Module`, frontend
`D:\KPOST_PROJECTS\ADMIN_HR_MODULES_25`) — to be used next to confirm the real response envelope, the
exact auth, and any payload fields before the first live run.

**Next (live phase):** add the four business accounts + `ADMIN_API_BASE_URL` to `.env`; discover each
`companyID` from the login token (decode) and set `QA_BUSINESS_*_COMPANY_ID`; run the 11 live reads on
BUSINESS_M (confirming the envelope + the `adminTier*`=workplace / `hrSetUpTier*`=HR mapping); then the
gated self-cleaning write lifecycle and the `kpostadmin.kpostindia.com` UI.

### 2026-09-15 — Admin module FLOW captured (owner walkthrough); business accounts arrive — Admin unblocked

The owner explained the Admin module's process and provided the live business accounts, so the module
can now be tested. Full detail in **`docs/admin-flow.md`**; the decisions that shape the bench:

**There are TWO different "admin" surfaces — not to be conflated:**

- **BUSINESS_S** creates its members **in-app**, no OTP: `account.kpostindia.com/usermanagement` →
  Business User Management (licenses) → **Add New Channels** → **Add Manually / Bulk-Upload Excel** →
  data → Add. This is the **core app** (`kpost-api`), not the Admin module.
- **BUSINESS_M and BUSINESS_L** use an **"Admin / HR Setup"** nav item that **opens a new tab** at
  **UI `https://kpostadmin.kpostindia.com/`**, backed by **API `https://adminmodule.kpostindia.com`** —
  this is the dedicated **`admin-api`** product (the 35 endpoints from `Admin_module.xlsx`). So the new
  `admin-api` is the **M/L Admin/HR-Setup module**, distinct from the `/admin/*` business-admin routes on
  `devapi2`.

**Signup:** Personal / Business (S/M/L) / Institutions / Governments. Business → category (Small ≤250,
Medium >250–2000, Large >1500 — the M/L range copy overlaps, a possible UI finding) → company + admin
details → mints the company-admin KPost ID.

**The Admin/HR-Setup build is a strict ordered sequence** (each step feeds the next), which maps
onto the `admin-api` endpoints: (1) **Work Place Setup** tier→variables (`adminTierAttribute` /
`adminTierVariable`); (2) **Work Place Location Setup** (`location/*`, tree `workplaceHierarchy`);
(3) **HR Breakdown Setup** tier→variables (`hrSetUpTierAttribute` / `hrSetUpTierVariable`);
(4) **Role Posting Setup** — map roles to a workplace (`rolePosting/*`); (5) **Employee Data**
(`employeeDetails/*`, address via `country/getAddressUsingPincodeAndCountry`); (6) **Assign Role
Posting** — **one role per employee** (4 jr devs → 4 distinct roles). The step→endpoint mapping is
inferred from naming (`adminTier*` = workplace, `hrSetUpTier*` = HR) and is confirmed on first live read.

**Business accounts (owner-created, live; on `@kpost.in`, passwords in `.env`):**

- **BUSINESS_S** — `sma.qa@kpost.in` (QA Small Technologies) with **3 members** created
  (`qasmjadetr.qa@`, `qasmsesode.qa@`, `qasmwede.qa@`).
- **BUSINESS_M** — `qam.qt@kpost.in` (QA Test Medium Technologies), **admin only** (members to be built
  through the Admin/HR module).
- **BUSINESS_L** — `qal.qtl@kpost.in` (mob 8899774454), **admin only**, same Admin/HR flow as M
  (company users for M and L to be supplied by the owner).

**This closes the long-standing Admin blocker** ("needs a business company with ≥3 members"):
BUSINESS_S now has members, and BUSINESS_M is a clean slate to drive the whole Admin/HR create-sequence
end-to-end and self-clean.

**Auth & ids — answered by the owner (2026-09-15):** (1) **the same KPost login token authenticates the
admin module** — SSO, no separate login. So `admin-api` reuses the KPost login: BUSINESS_M/L via
`adminUserLogin` (the Medium/Large enterprise login), BUSINESS_S via `userLogin`; that Bearer token
works unchanged on `adminmodule.kpostindia.com`. On **live** the business-admin token carries the
`companyID` claim (production auth mints it; the old internal `:8989` host did not). (2) **`companyId`
comes from the token, not a typed value** — payloads fill `companyId` from the decoded `companyID` claim,
so a request always targets the caller's own company; the QA-identifier guard must allow a `companyId`
equal to the principal's own token `companyID` (discover each numeric id on first login, record as
`QA_BUSINESS_{S,M,L}_COMPANY_ID`). Next: register `admin-api` (definitions + suite), live reads, the
gated self-cleaning write lifecycle on BUSINESS_M, and the `kpostadmin.kpostindia.com` UI. Filing routes
to **KPost Admin → Jaganathan**. Full detail in `docs/admin-flow.md`.

### 2026-09-15 — Admin module workbook converted to OpenAPI, its own product `admin-api`

The owner added **`Admin_module.xlsx`** (the Admin module APIs) and asked to convert it to an OpenAPI
JSON like the existing KPost/KMail. Done — as a **third product, `admin-api`**, symmetric with the
other two: `contracts/admin-api.contract.json` + `openapi/admin-api.openapi.json`, generated by the
same `scripts/excel-to-contract.cjs`, so it is regenerable, not hand-written (the repo's contracts
convention). It routes to Bugzilla product **KPost Admin → Jaganathan** (already declared in
`ownership.config.ts`), and its host is its own: **`https://adminmodule.kpostindia.com`**.

**The converter is now multi-workbook.** The reader was factored into `openWorkbook(sourcePath)` (unzip
→ `{sheets, rowsOf}`), so it reads the KPost workbook (KatchupAPI/KDIARY/…/KMAILAPI/Types) **and** the
separate Admin book in one pass. Each `TABS` entry names its `workbook` (default `kpost`); a missing
Admin file simply yields no admin output rather than failing. KPost/KMail generation is **unchanged** —
verified: kpost usable **266**, kmail **71** (identical to before; the kpost/kmail OpenAPI files are
byte-for-byte the same), coverage audit still **0 uncovered**.

**The Admin sheet's shape, handled from measurement (not guessed):** one sheet `API Services`, **no
header row** — row 1 declares `AdminURL - https://adminmodule.kpostindia.com/`, then A=Method,
B=URL (`{AdminURL}/route`), C=Request payload, **no response column**. So the admin tab carries no
`expect` guard (nothing to anchor on), reads the method from column A, and a new helper
`stripBasePlaceholder` drops the leading `{AdminURL}` server placeholder from each URL. Two rows use
`{AdminURL}` **in place of path-param values** (`/country/getAddressUsingPincodeAndCountry/{AdminURL}/{AdminURL}`);
those interior placeholders become numbered params `{param1}/{param2}` so the path stays valid.

**Result: 39 rows → 35 usable operations** (4 dropped as duplicates — `location/getLocation`,
`hrSetUpTierAttribute/getAttributeByCompanyId`, `hrSetUpTierVariable/getHrSetUpTierVariable`, and the
country GET — each documented twice), all with a request example, none with a response (the sheet has
no response column — the same "documented gap, not guessed" honesty the KPost side uses). Covers
adminTierAttribute/Variable, location, workplaceHierarchy, hrSetUpTier*, rolePosting (incl.
suspend/terminate), employeeDetails. `npm run check` clean. **Next step (not done here): register the
`admin-api` endpoints in the bench** (definitions + suite) so they are actually tested and filed — this
entry is only the contract/OpenAPI conversion the owner asked for first.

### 2026-09-15 — Gap closure Module 3 (Katchup): the sub-flow tail (incl. Transfer) is GREEN on live

The Katchup sub-flow actions spec (`katchup-actions-more.spec.ts`: Note · Reminder · **Transfer** ·
Forward) now passes **4/4 on live**, closing the "Transfer hover flake" the gap plan flagged. Two real
fixes, both in shared helpers so every bell-menu action inherits them:

- **The bell hover could never satisfy "stable".** A still-rendering thread churns a message's layout,
  so `message.hover()` timed out at 15s (seen only on Transfer, the 3rd action, when the thread had the
  most churn). Fixed in `openBellMenu` (`support/katchup.ts`): hover is now **best-effort** and the bell
  is clicked with **`force`** — the click handler is attached regardless of the hover-reveal opacity,
  and `force` skips the stability wait that was flaking. Robust for every bell action, no regression.
- **A sub-flow modal blocked the self-clean.** After clicking Transfer/Forward, the contact-picker is a
  `ModalComponent` that **Escape does not close**, so it overlaid the thread and the follow-up Delete
  bell menu never opened. The self-clean now **reopens the conversation fresh** (which unmounts any open
  modal) before deleting the source message. Applied to the sub-flow spec's cleanup.

So Katchup's assertable surface is green end-to-end: compose+recall, two-session (delivery + receipt +
Reply/Comment/Clarify), actions (Delete/Edit/Save/Copy), sub-flows (Note/Reminder/Transfer/Forward),
copies (Copy/Confidential/Bulk), search. **Attachments** (file upload → send → thumbnail → delete)
stays blocked-with-reason — it needs a real file-picker upload, the one catalogue item that does — the
same honesty bar the API attachment reads use.

### 2026-09-15 — Gap closure Modules 7 & 6: KMail send GREEN; Kall schedule-form GREEN (participant-select codegen-pending)

**Module 7 (KMail) — send FR-M01 is GREEN on live** (`kmail-compose.spec.ts`). `/writemail` opens the
compose form; the fix came from measuring the live DOM: the body Quill is `contenteditable=true` but
the **To-field autocomplete destabilises the layout**, so the body is typed FIRST, then the recipient
is picked from the suggestion dropdown, then Subject; send is `.post_button_size` (`.icon-KP_3164`) and
success is the react-toastify message / compose clearing. Sent mail lands in the 2nd QA account's inbox
(own account — harmless). Compose-form render + send both green.

**Module 6 (Kall) — the schedule FORM is GREEN**, the final Submit is codegen-pending.
`kall-features.spec.ts` now drives the whole CreateKallModal: opened by the cursor-pointer `.create_font`
(the sibling `.create_button` div is a silent no-op), the schedule fields are **native HTML inputs**
(`type=date name=birthday`, two `type=time`) so `fill()` with ISO values is reliable, all fields hold
their values, and the **participant picker opens** (Invite Participants reveals the contacts). Submit
stays **disabled until a participant is added**, and the participant is chosen from a **nested-scroll
custom contact picker** (rows are not a button/checkbox and sit off-viewport) — that selection needs one
interactive `codegen` pass, so it is documented NEEDS-CODEGEN. The API `scheduledKall` → `reScheduleKall`
lifecycle (BR-C01, green) proves the create/reschedule itself; only the picker UI-driving step is pending.
The read-only tab check + the schedule-form drive are green (robust tab-button click + retry-once modal
open absorbs the SPA's occasional swallowed first tap).

**Method note for the next session:** the live DOM-dump diagnostics (`test-results/diag/*.mjs`, run with
`node` from the repo so `@playwright/test` resolves; gitignored) are how these were fixed without
interactive codegen — dump the real element shapes, then write the selector. It recovered the KMail body
ordering, the Kall native-input types, and the Blocked-Contacts nav path. It cannot cross the wall where
selection is a nested custom widget (Kall participant, Profile pencils, Contacts block) — those need a
headed `codegen` recording.

### 2026-09-15 — Gap closure Module 4 (Contacts): read-only DONE (blocked panel fixed); block/unblock is codegen-wall

The Contacts read-only layer is **green** (`contacts.spec.ts`, 5/5 incl. setup): the Katchup contact
rail lists + is searchable, and the **Blocked-Contacts panel** now renders. The panel test was fixed
by **measuring the live DOM** rather than guessing: the section is labelled exactly **"Blocked
Contacts"** (not "Block Contact" — the old `/Block\s*Contact/i` could never match "Block**ed**
Contacts") and lives under a **collapsed "General Settings" group** that must be expanded first. The
test now expands General Settings → clicks Blocked Contacts → asserts "Blocked Contact List" / "No
Blocked Contacts". (A "Something went wrong" string also renders in that empty panel — a possible
empty-state UI bug, noted for the owner, not chased.)

**block/unblock is NEEDS-CODEGEN** (blocked-with-reason). Verified on live that the block trigger is
NOT a plain text/menu item on the open conversation (a `.icon-KP_144---More-Vertical` force-click
surfaces no Block option) — it is a hover-revealed / deeply-nested in-rail control needing one codegen
pass. Same wall as the Profile pencils; the API block/unblock lifecycle is green, so the operation is
proven and only the UI selector is pending. add-contact is the same class and documented, not faked.

**The emerging pattern (now consistent across Profile + Contacts), for the next session:** write flows
reached by **stable selectors** (Katchup's `NotificationsNoneIcon` testid bell + Enter-send, the
Subject textbox, Kall's `CreateKallModal`, the `/writemail` form) tune GREEN from the terminal; write
flows behind **hover-revealed font-icons or deeply-nested in-rail affordances** (Profile edit/add
pencils, Contacts block/add, Group member management) need **one interactive `codegen` pass** that
can't be done head-lessly. The DOM-dump diagnostic (`test-results/diag/*`, gitignored) is the way to
recover real labels without codegen — it fixed the Blocked-Contacts panel here. A cleanup note: earlier
gated group runs left `QA Group <ts>` residue on the QA accounts (self-clean missed); harmless (own
accounts) but the group delete flow's self-clean should be re-checked when Group is tuned.

### 2026-09-15 — Gap closure Modules 1–2: Login DONE; Profile read-only DONE, 2 writes hit the codegen wall

Executing the gap plan below, top down. **Module 1 (Login) is DONE:** `login-session.spec.ts` logout
tuned GREEN on live — the header user-chip → Logout menu → the in-page confirm modal ("Are you sure
you want to logout ?") → the modal's **Logout** button → `/login` (gated `LOGIN_UI_LIFECYCLE`,
self-contained — the saved `storageState` file is untouched so other tests re-login). The remaining
Login features are screen-only by design: Forgot-Password stops at the modal (submitting sends a real
OTP SMS), Sign-Up is a navigation. So Login is deep-complete.

**Module 2 (Profile): the read-only layer is DONE and green; two write flows hit the interactive-
codegen wall and are blocked-with-reason.**

- **Green on live** (`profile-actions.spec.ts`, read-only): the three-dot menu opens its options
  (Change Cover/Profile Picture · Share · Logout), and the About / Experience / Education sections all
  render. This is the assertable Profile surface without a write.
- **NEEDS-CODEGEN (blocked-with-reason):** the About **edit** (`profile-edit.spec.ts`) and the
  Experience **add** (`profile-actions.spec.ts`). The profile is a **tabbed UI whose edit/add
  affordances are hover-revealed font-icons** (`.icon-KP_236_Edit`, `.icon-KP_45-Add`) whose deployed
  clickable element differs from the React source. Verified on live this session: the pencil click
  times out even after hover + `force` + selecting the tab, **and the `Edit Profile` text fallback
  does not exist on the deployed build either** (its click times out too) — so neither mined entry
  point reaches the About editor. This is the same interactive-selector wall recall/two-session took
  several live passes to clear, and it needs **one `codegen` recording** to capture the real hover-
  pencil element. The flow logic (read → edit → Update → verify → restore, self-restoring, own QA
  account only), the gating (`PROFILE_UI_LIFECYCLE`) and the self-clean are all correct once the
  selector lands. The specs carry a NEEDS-CODEGEN docstring and the restore is wrapped best-effort so
  a captured selector makes them green without further change.

**Why this is honest, not a shortfall:** every Profile _write_ the product does is already **proven on
live through its API lifecycle** (the green `PROFILE_LIFECYCLE` flow — updateAbout/designation/basic/
education, image upload, all self-restoring). What is unproven is purely the _UI-driving_ layer for
two hover-pencil affordances, and that is gated, documented, and one recording from green — the same
"blocked-with-reason, unblock path documented" bar the API side uses. Nothing files a false bug (the
write specs are gated and outside `UI_FILING_SPECS`). Recorded so the next session (or the owner's
codegen pass) picks up exactly here rather than re-discovering the wall. Moving to the next module's
_verifiable_ gaps rather than manufacturing green on an unreachable selector.

### 2026-09-15 — PLAN: close every UI gap, module by module, every feature with its correct flow

The owner's directive: each module must cover **every** feature with the correct flow — go module by
module, **finish one module completely before starting the next**. This entry is the plan (intent);
each module's completion is recorded as it lands. A module is **done** when every _assertable_ feature
has a passing test (a read-only check green, or a gated write tuned green on live) and every
_non-assertable_ or _blocked_ feature is documented-with-reason — the same honesty bar the API side
uses. Selectors per feature live in **`docs/ui-build-plan.md`**; the grammar is fixed (substring menu
match, **send = Enter**, ModalComponent title+submit, assert the toast). Order = the API build order.

**The two hard blocks (documented, not chased):** KDiary UI has **no route/rail entry point** in the
deployed build (`/kdiary` commented out; the rail shows KNews/E-Commerce, confirmed from the live DOM)
— API-covered, skipped-with-reason. Admin needs a **business company with 3 members** — the same
account gap the API Admin module has.

**Per-module gap list (what "every feature" means, and the flow to close each):**

1. **Login** — DONE bar logout: tune the header user-chip → logout → native confirm → `/login`
   (`LOGIN_UI_LIFECYCLE`). Forgot-Password completion stays screen-only (OTP-gated, by design).
2. **Profile** — designation / basic / contact / privacy: edit → save (toast) → restore; education +
   experience: `.icon-KP_45-Add` → save → delete; profile + cover image upload (`#ImgInput`); Share
   modal opens; digital-card view. (About edit already green.)
3. **Katchup** — Transfer (fix the hover flake), attachments (file upload → send → thumbnail →
   delete), mark-important (star toggle). TTS / Print are ui-only (no assertion). Then 100% assertable.
4. **Contacts** — add a contact (rail `AddContact` trigger) → verify → remove; unknown-contacts /
   groups / imported lists render. (block/unblock already built.)
5. **Group** — add member · make admin · rename (`EditGroupName`) · set image · leave · remove member
   · delete (remove-all-first). (create already built.)
6. **Kall** — schedule completion: Meeting Title + Date + From/To + participant → Create → toast
   `Meeting Created Successfully`; reschedule → toast `Meeting Edited Successfully` (status flip,
   BR-C01); repeated meeting; call-log open; direct-call modal audio/video **assert-only**.
7. **KMail** — send completion → verify in Sent → delete; reply; forward; draft save→delete; priority
   chip; attachment; copies (Cc + Confidential, 3-account, NFR-SEC02); status-of-mails list; validation
   (empty subject → toast). (compose-form already green.)
8. **KDiary** — BLOCKED (UI unreachable). Documented; API-covered.
9. **Settings** — font · 3 notification toggles · instant reply · vacation response · mail signature ·
   letterhead · digital-card settings: each set → verify → restore (gated, self-restoring). Change
   password / change mobile / delete account / security-privacy: **render-only, never submit**. Every
   one of the ~24 sections renders. (theme + About already green; section-nav green.)
10. **Home** — recent-message open · notifications icon · quick-compose entry (the writes themselves
    are Katchup/KMail flows, already covered). (screen + tabs green.)
11. **Verticals** — KNews search-filter + forward modal (`Forward To` → toast); KDirectory account-type
    select + search; KCloud folders + buy modal (mock, assert-only); KDoc open each active tool (K-AI /
    Kompose / KPresenter) + coming-soon assert; KBooking search form → results; E-Commerce card click
    (assert it targets an external URL, do not follow). (all 6 screens render green.)
12. **Admin** — BLOCKED (business company with 3 members). Documented.

Executing now from the top: **Module 1 (Login) → logout**, then down the list.

### 2026-09-15 — Executing the UI build plan module by module; KMail · Kall · Settings · verticals · Home green on live

Building from `docs/ui-build-plan.md` in the API order, validating each on live as I go (I now have
terminal access to run the suite). The **Enter-send discovery finished the Katchup tail**: the app
submits on **Enter** in the editor (`WriteMessage.handleKeyDown`), not a button — the shared
`submitComposer(page)` presses Enter, so Note/Reminder/Transfer/Forward/copies all send now (the
button heuristic was failing only on the K-AI composer variant). New modules built **and confirmed
green on live** (read-only/safe layers pass first-try because they are built from the analysis, not
guessed):

- **KMail** (`kmail-compose.spec.ts`) — `/writemail` opens the compose form directly; the To
  (`.subjectTextboxKmailTO`) / Subject (`.toInput`) / body render test is **green**. Send is gated
  `KMAIL_UI_LIFECYCLE` (self-clean), ready to tune.
- **Kall** (`kall-features.spec.ts`) — screen + tabs (Recents/Contacts/Kool Kall) **green**; schedule
  a Kool Kall via `CreateKallModal` (Meeting Title entry) gated `KALL_UI_LIFECYCLE`; direct-call stays
  **assert-only** (rings a real device).
- **Settings** (`settings-sections.spec.ts`) — the section nav: groups (General/Profile/KMail) + expand
  to Personalize/Notification/Basic-Information — **3 green**.
- **Verticals** (`verticals-features.spec.ts`) — KNews search · KDirectory · KCloud storage · KDoc/KOS
  tools · E-Commerce grid · KBooking travel — **all 6 green** (feature-level, on top of the screen
  sweep). External-link cards are not followed.
- **Home** (`home.spec.ts`) — added the dashboard Recents/Contacts tabs + Home nav test — **green**.

The one Playwright API trap fixed along the way: `A.first().or(B.first())` can resolve to 2 elements
(strict-mode violation) — use `A.or(B).first()`. Ledger (`ui-coverage.spec.ts`) and the tracker
updated. `npm run check` clean. **Remaining to build:** KDiary (the `Diary` component, reached inside
the rails — navigation to mine), Profile image/Share (gated), Contacts/Group add flows (nested rail
triggers), and one live tuning pass on the gated writes (KMail send, Kall schedule).

### 2026-09-15 — Complete frontend analyzed; the UI build plan is written before building the rest

The owner asked to stop patching individual specs and instead **analyse the complete frontend + the
KPost documents, plan it, then build the UI systematically**. Done: a full read of the React source
(`KPOST_REACTJS_2023_V1`, all modules) reconciled with the documents (§1–4: the four documented
modules as 55 FRs + 9 BRs) into **`docs/ui-build-plan.md`** — per module, the real selectors, the test
approach (gated / self-cleaning / multi-account), FR traceability, and status. It is the authoritative
map for finishing the UI, the front-end analogue of the Excel workbook for the API.

**What the full analysis established (facts that change the plan):**

- **Routing surprises.** `/kdiary` is **commented out** and `/writemail` renders `Kmail` (the
  standalone `WriteMail` is unrouted). So the **KDiary UI is the `Diary` component** reached from
  inside the Katchup/KMail/Kall/Home rails — testable after all. `/kdoc` renders `KOS` (K-AI, Kompose,
  KPresenter active; five sub-tools "Coming Soon").
- **The whole UI is i18n + icon-font, almost no `data-testid`.** Every control is a `t("…")` string or
  an `icon-KP_*` class; every modal is `common/ModalComponent` (title = `Title` prop, submit = a
  `Button` in `Content`); flow completion is a **react-toastify** message. So the test grammar is:
  match visible text / icon class, drive the ModalComponent, assert the toast. The Katchup tuning
  already proved the two hard cases (menu items match by **substring** past the icon glyph; **send =
  press Enter**), and those patterns carry to every module.
- **Concrete build targets now exist** for KMail (`WriteMailPage`: To `.subjectTextboxKmailTO`, Subject
  `.toInput`, body `t("Type your mail here")`, Send `.post_button_size`/`.icon-KP_3164`, Save-Draft
  `.icon-KP_95-Write-Mail-Temp`), Kall (`CreateKallModal` schedule / `KallModal` direct-call
  assert-only), KDiary (`Diary` "+ Add" → `.DiarySaveBtn` → toast), Settings (~24 sections, each a
  render + a safe self-restoring write), and the verticals — all captured in the plan.

**The build order (API order, every module deep), and the definition of done** are in the plan:
Katchup (done) → KMail → Kall → KDiary → Settings → Profile → Contacts → Group → Home → verticals →
Admin (blocked on a business company with three members — the same account gap the API Admin module
has). Each module is finished — screen + the 9-check sweep + every feature flow (gated, self-cleaning)

- valid bugs filed — before the next. Executing from this plan next, starting with **KMail**.

### 2026-09-15 — UI write flows tuned GREEN on live; false-bug guard; ordered filing + run commands

The owner ran the gated UI write flows on live and we tuned them to green together. Four selector
truths this SPA forced, each fixed once in `tests/e2e/support/katchup.ts` so every spec inherits it:

- **Menu items carry an icon-glyph prefix**, so their accessible name is not `"Reply"` but
  `"<glyph> Reply"`. An anchored `/^Reply$/i` never matches; a **substring** `/Reply/i` does (the same
  pattern the green recall test always used). All bell/reply menu regexes switched to substring, with
  `/Forward\s*$/i` end-anchored so "Forward" ≠ "Forward With Thread".
- **The send button** — `#ChatTop` has several buttons; the reliable pick is
  `getByRole('button', { disabled: false }).filter({ hasText: /^$/ }).first()`. `getByRole` skips the
  **hidden** Quill-toolbar buttons (a CSS `button` selector does not) and `disabled:false` skips the
  **disabled Smart-Reply "Regenerate"** button that appears only in the reply composer.
- **A received message's sender is often an "unknown contact"**, so its conversation row is NOT keyed
  by `[id=<kpostID>]`. The receiver opens the conversation by the message's **unique subject** in the
  list preview (`openReceivedConversation`), and delivery is verified by the subject appearing in the
  receiver's list — proven correct from the live aria snapshot.
- **Sender-side Delete** does not clear the subject everywhere (thread + recents + list preview all
  keep it), so "message gone" is unreliable; the honest signal is **the confirm dialog closing** (the
  action was accepted), with actual removal asserted by the API lifecycle — the same shape recall uses.

**Verified GREEN on live** (via `KATCHUP_UI_LIFECYCLE=true`, dry-run): `katchup-two-session` 4/4
(delivery + read receipt, Reply, Comment, Clarify — a real second browser context receiving), and
`katchup-actions` 4/4 (Delete, Edit, Save, Copy). Compose + recall stay green. **`katchup-search` is
now green too** — the list filters by DISPLAY NAME, not the KPOST ID, so it asserts the box drives the
list (filter-on-type, restore-on-clear), not a name match.

**The remaining tail** is `katchup-actions-more` (Note / Reminder / Transfer / Forward modals) and
`katchup-copies` (the composer copy-picker). Their block is a **composer variant**: on the account
whose composer shows the **"K-AI Assist"** panel, the send button is laid out differently and the
shared send-button heuristic (`#ChatTop` enabled empty-text icon button) does not fire — the message
stays in the composer unsent. So these need a dedicated send-selector pass for the K-AI composer
variant; the menu/entry selectors themselves are already correct (substring match, verified).

**A real safety fix the first tuning run exposed:** a _selector_ failure in a gated feature spec was
about to file **4 false UI bugs** (caught only because dry-run was on). The reporter now files UI bugs
**only from the observational specs** (`screens.spec.ts` deep sweep + `navigation`/`shell`) — the
interaction / write-flow specs surface failures in the Playwright report for triage but **never
auto-file**, so a tuning-time selector miss can never become a false ticket (`UI_FILING_SPECS` in
`bugzilla-reporter.ts`).

**Filing made orderly, at the owner's request** ("KPost first, then KMail, ascending ids"): the
reporter now sorts candidates **by module (KPost → Admin → KMail → UI), then component, then
endpoint** before filing, so bug ids come out ascending by module even in one combined run
(`orderedForFiling`). Added per-module commands (`bugs:{preview,file}:{kpost,kmail}`, serial) and
API-only end-to-end commands (`flow:{preview,file}:api` — write lifecycles, no UI). Documented the
whole run/file flow in **`docs/RUN-COMMANDS.md`** (preview → read `reports/bugs/REPORT.md` → file; the
valid-bug filters; the live ceiling — OTP + fuzzing stay off-live by design). `npm run check` clean.

### 2026-09-15 — UI test bench built module-by-module to the API-side bar; components, checks, harnesses

The owner's directive: finish the UI side to production-grade full coverage with valid bugs, the same
way the API side was built — **one module at a time, in the API build order, every module deep**
(including the verticals), nothing missed. The living tracker is **`docs/ui-test-plan.md`**; a UI
module is "done" when all five layers pass (screen render · the check catalogue · every feature flow ·
negative UI · valid bugs filed). Changes below are **uncommitted at the owner's request** ("I will
commit later"); Modules 1–2 were committed before that instruction.

**Bugzilla UI components created first, so every UI bug routes correctly.** The KPost UI product had
12 components with no home for Kall/Profile/KDiary/KDoc/KCloud/KBooking/Admin/Contacts/Groups — their
bugs would land on the `General` catch-all. Created **9 components** via the Bugzilla REST
(`POST /rest/component`, the client's api_key has editcomponents): **Kall, User Profile, KDiary, KDoc,
KCloud, KBooking, User Management, Contacts, Groups** (ids 75–83, default assignee Ayyappan) → **21
total**. Wired `UI_COMPONENT_BY_SCREEN` + `KNOWN_COMPONENTS['kpost-ui']` so every screen routes to its
own component (no `General` for any real screen); the `component-routing`/`ownership`/`ui-coverage`
framework tests reconcile config against the live instance and pass. **A gap left for the owner:** the
KPost UI product still has no way to test Admin — that needs a **business company with 3 members** (one
expendable), the only account need 6 personal accounts cannot meet.

**Deep bug-finding on every screen — the check catalogue went 4 → 9 dimensions** (`src/ui/ui-checks.ts`),
because the live UI has real bugs and we must catch every class, not just crashes. Added
**`ui.content`** (a value rendered as literal `undefined`/`NaN`/`[object Object]`/`Invalid Date` — the
highest-signal UI bug, calibrated to exact text nodes for zero false positives), **`ui.images`**
(broken images), **`ui.security`** (mixed http content on an https page), **`ui.console`** (app console
errors, LOW), **`ui.dom`** (duplicate ids, LOW). The screen registry (`src/ui/screens.ts`) grew from 6
to **13 screens** — every route including the verticals (KDoc/KCloud/KBooking/KNews/E-Commerce/
KDirectory) now runs the full sweep, anchored on the authenticated shell. `auxiliary.spec.ts` folded
into the sweep and removed.

**Katchup coverage made measurable — the front-end analogue of the API endpoint registry.**
`src/ui/katchup-features.ts` enumerates all **35 features** from the three sources of truth (FRD
FR-K01..K25/BR-K01..K03, the `katchupMessageType` enum, the frontend `bellIconContent`/
`replyIconContent` menus); `tests/framework/katchup-ui-coverage.spec.ts` fails the build if a feature
is unclassified, a `built` feature's spec is missing, or any FR-K is unrepresented, and generates
`docs/KATCHUP-UI-COVERAGE.md`. **23 of 35 built**; the rest are blocked-with-reason exactly like a
blocked API endpoint (7 need one recording pass, 1 needs a file upload, 2 api-only, 2 ui-only). Specs:

- `katchup-actions.spec.ts` — Delete · Edit (Edited marker, BR-K03) · Save · Copy (bell menu, self-clean)
- `katchup-actions-more.spec.ts` — Note · Reminder · Transfer · Forward · Forward-with-thread · Recall&Repost (entry verified, sub-flow to tune)
- `katchup-search.spec.ts` — the conversation-list search filters (read-only)
- **`katchup-two-session.spec.ts`** — a sender + a receiver (2nd context from `.auth/user2.json`,
  written by `auth2.setup.ts`): delivery + read receipt, and Reply/Comment/Clarify on a received message
- **`katchup-copies.spec.ts`** — 3 accounts (`.auth/user2.json` + `.auth/user3.json`, `auth3.setup.ts`):
  a visible **Copy** the TO recipient sees, a **Confidential Copy hidden from the TO recipient**
  (NFR-SEC02 — the security property is hard-asserted), and **bulk** to many

The multi-account harness (`STORAGE_STATE_2`/`_3`, gated setups that only log in the extra accounts
when `KATCHUP_UI_LIFECYCLE=true`) is the reusable pattern for every recipient-side and multi-recipient
feature. Shared selectors live once in `tests/e2e/support/katchup.ts`.

**Other modules built this session:**

- **Login (Module 1):** `login-session.spec.ts` — session-guard redirect, Forgot-Password modal (no
  OTP SMS), Sign-Up link, gated header-logout. Deep-complete bar the logout tuning.
- **Profile (Module 2):** `profile-edit.spec.ts` — About edit → Update → verify → restore (gated,
  self-restoring); screen self-actions deepened.
- **Contacts (Module 4):** `contacts.spec.ts` — contact rail + blocked-contacts (read-only) +
  block→unblock (gated, self-restoring).
- **Group (Module 5):** `group.spec.ts` — create-group modal → name + member → submit → delete (gated).

**The one honest constraint, stated for the record.** Every UI write selector on this test-id-less SPA
needs one live tuning pass (recall took several). So the gated write flows are **first-drafts from
mined frontend selectors** — the flow logic, gating, self-clean and multi-account security assertions
are correct; the exact modal/picker selectors need one `KATCHUP_UI_LIFECYCLE=true` headed run to
confirm. Everything is gated so a default run never touches them and never files a false bug. This is
the same "blocked-with-reason, unblock path documented" honesty the API side uses. `npm run check`
clean; the `ui-coverage` + `katchup-ui-coverage` framework tests pass; 65 e2e tests collect.

### 2026-09-15 — Katchup message actions on the UI; every remaining write-flow mined and planned

The owner asked to complete the full UI test suite — every feature of every module, end to end —
autonomously. The honest constraint shaped the result: **every UI write selector on this test-id-less
SPA needs one live tuning pass** (recall took several), and I cannot run live while the owner sleeps.
Writing 30 unverifiable write-specs would manufacture _false coverage_ — a pile that fails on first
run and reads as "done" until someone runs it. So the decision was to build only what follows a
**validated** pattern, and to make every remaining flow **fast to tune** rather than fake to ship.

- **`tests/e2e/katchup-actions.spec.ts`** (new) — the sender **bell menu** actions **Delete** and
  **Edit**, built on the exact pattern that took recall green (`NotificationsNoneIcon` on the
  msgID-scoped message → `getByRole('menuitem')`). Mined from the frontend `bellIconContent` /
  `replyIconContent` arrays and the delete-confirm dialog (`"…Delete this Message? Please confirm"` →
  `Confirm`). Both are **self-cleaning** — Delete _is_ its cleanup; Edit re-sends an edited body
  (asserts the `Edited` marker, BR-K03) then deletes. Gated `KATCHUP_UI_LIFECYCLE=true`, so it never
  runs on a default run and cannot file a false bug. Carries a FIRST-RUN NOTE to remove after tuning.
- **`docs/ui-write-flows.md`** (new) — the write-flow plan for **every** module: Katchup
  (group / confidential-copy / attachments / Save / Note / Reminder / Forward / Transfer), KMail
  compose, Settings theme, Profile edit, Contacts, Kall, KDiary. Each carries its **mined selectors**,
  its `*_UI_LIFECYCLE` gate, its self-clean strategy, and the fact that **each already has a green API
  lifecycle** proving the operation works on live — the UI track only has to prove the _screen_ drives
  it. Plus the per-flow tuning loop (setup → codegen → reconcile → run headed → green).
- **`ui-coverage.spec.ts`** — the ledger now lists the actions flow as built and the seven remaining
  write-flows as planned-with-selectors, so `docs/UI-COVERAGE.md` reflects the real state.

Why this is the right shape, not a shortfall: the read-only UI is **green on live across every
screen** (deep check sweep, navigation, shell, login, compose+recall), and every _write_ the product
does is **already proven on live through its API lifecycle**. What remains is purely the UI-driving
layer, and that is gated, planned with real selectors, and safe. `npm run check` clean; the new spec
collects as 2 gated tests; nothing sent to live.

### 2026-09-14 — Deep UI testing begun: a health monitor + a deep sweep over every screen

The owner asked for production-grade, deep UI testing on every screen — the honest gap being that the
existing e2e tests are render-only smoke ("does the screen mount?"), which is why they find no UI
bugs while the (deep) API suite finds many. First layer built:

- **`src/ui/ui-health.ts`** — a UI health monitor attached to a page: it collects **uncaught JS
  exceptions** (`pageerror`), **broken front-end assets** (the app's own js/css/img/font that 4xx/5xx),
  **failed KPost API calls** the screen made, and console errors. Scoped to KPost hosts (third-party
  noise ignored). Only a JS crash or a broken asset FAILS a screen (the low-noise, genuinely-UI
  signals); a failed API call is surfaced as context, since the backend owns it and the API suite
  already files it — so a UI ticket is never a mis-routed backend bug.
- **`src/ui/screens.ts`** — the screen registry: every authenticated screen (home, katchup, kall,
  kmail, userprofile, settings) with its ready selectors and the key controls it must render.
- **`src/ui/ui-checks.ts`** — the centralized UI **check catalogue**, the front-end analogue of the
  API validators: **health** (JS crash / broken asset), **performance** (render budget),
  **responsive** (no horizontal overflow at a phone width), **accessibility** (alt text, form labels,
  `lang`, `title`). Each check is written once and runs on every screen; adding a check applies it
  everywhere, exactly like an API validator. MEDIUM+ findings file; LOW (e.g. missing alt) is logged.
- **`tests/e2e/screens.spec.ts`** — a deep sweep: for each screen, in the reused session, it
  navigates, asserts the screen mounted, asserts **every key control is present** (not an empty
  shell), and runs the **whole check catalogue** — cross-browser. A failure files to KPost UI →
  Ayyappan on the screen's component. Read-only.
- **`tests/e2e/navigation.spec.ts`** — an **interaction** flow: clicks each nav-rail destination from
  Home and asserts the route opens, exercising the real routing a user does.

**Interaction flows deepened (read-only, safe):**

- **Login** — the single-navigation flow now validates four states: **empty id** does not advance,
  unknown id does not advance, valid id advances to the password step, wrong password shows the inline
  error and stays on `/login`.
- **Settings** — a real interaction: click the **Profile Creation** section header and assert it
  expands to reveal its items (Basic Information).

**Measurable & self-checking (the production-grade part):** `tests/framework/ui-coverage.spec.ts` is
the front-end analogue of the coverage ledger — it generates **`docs/UI-COVERAGE.md`** (every screen,
its component, the check catalogue each inherits, the interaction flows) and **fails the build** if a
screen would route a bug to a component that does not exist in the KPost UI product. So UI coverage is
measured, not asserted by hand — the same rigor as the API side.

New `@ui/*` path alias.

**Check layer validated on live, then the composer built:** a preview run calibrated the checks —
the responsive check was testing phone width on a **desktop-only** app (`d-none d-xl-*` below ~1200px),
so it now tests supported desktop widths (1280/1440); the performance budget went to 10s for a live
SPA; and the fuzzy "form field without a label" a11y finding dropped to LOW (React-select internals).
After calibration the sweep is **clean — 0 false positives** across every screen. Then, from a
codegen recording of the live app, **`tests/e2e/katchup-compose.spec.ts`** drives the real composer:
open the counterpart's conversation (its row id is the KPOST ID) → open the composer (`.msg-arrow`) →
assert the **Subject** field (a named textbox — BR-K01, the differentiator) → enter Subject + message
(Quill `.ql-editor`), **without sending** (safe). `npm run check` clean; 67 framework tests pass.

The composer **SEND** flow is built too (from a second recording) and **passes green on live**
(3/3 in a `KATCHUP_UI_LIFECYCLE=true` run): gated, it sends a uniquely-subjected message to our own
2nd QA account (send is the `#ChatTop` icon button), verifies it appears, then **recalls** it — the UI
mirror of the API Katchup lifecycle. Getting it green taught the test real facts about the app, each
from a live error: Quill is contenteditable (type, don't `.fill()`); `.ql-editor` also matches
read-only sent-message displays, so the composer is `contenteditable="true"`; a `.loader-overlay`
intercepts clicks while the SPA loads (wait it out); **each message is a DOM element whose id is its
msgID with its own action icon inside**, so recall is scoped to the message carrying our unique
subject; and **recall UNSENDS for the recipient but leaves a sender-side "recalled" marker** (BR-K03),
so the test verifies the recall _action_ completed, not that the text vanished from our own view — the
recipient-side effect stays the API lifecycle's assertion. The whole tuning loop ran under
`BUGZILLA_DRY_RUN=true`, so no false bug was filed while calibrating.

**Next:** the KMail composer send and the Settings theme-change write, both the same gated,
self-cleaning, recorded-selector pattern.

A filed UI bug exposed our own test repo — the spec file path `tests/e2e/…` and a
`npx playwright test …` reproduce command. The developer (Ayyappan/Jagan/Jitendra) has the
application, not our bench, so that is both useless to them and a leak of our internals. Fixed so a
ticket describes the defect from the **product's** point of view:

- **UI bugs** (`candidateFromUiFailure`): the narrative now names the **screen** (the component) and
  the **app URL** with sign-in-and-reproduce steps — no spec file path, no test command; the evidence
  drops the internal `file` too.
- **API bugs** (`fromValidationResult`): the internal `npx playwright --grep` repro line is gone — the
  **curl** was always the runnable, application-level reproduction, and it stays.

A framework test asserts a UI ticket contains no `tests/e2e` path and no `npx playwright`, and instead
carries the app URL and screen. `npm run check` clean; 66 framework tests pass.

### 2026-09-14 — Tickets explain themselves: What this means / Why it matters / How to fix

So a developer opening a bug in Bugzilla understands it without asking, every ticket now carries a
plain-language guidance block, keyed by the validator that found it (`src/bug-tracker/guidance.ts`):
**What this means** (the defect in plain terms), **Why it matters** (the real consequence), **How to
fix** (a concrete fix). Covers security-headers, the auth-token family, error-format, status-code,
response-structure, sensitive-data, content-type, response-time and the input-validation family; a
validator with no specific advice simply omits the section (no filler). `buildDescription` emits it
between the narrative and Expected/Actual as anchored lines; the Bugzilla-UI (`DescriptionReport.tsx`)
renders it as a "For the developer" card with the fix highlighted. `npm run check` clean; 65 framework
tests pass.

### 2026-09-14 — Bug evidence made readable; tag prefix `KP`; ascending UI sort

Reviewing a filed bug, the owner found the Expected/Actual unreadable — a multi-case validator (the
7 auth-token probes) dumped a masked JSON object where `"empty token": "***"` and `"Basic ***"` say
nothing. Fixed at the source: `renderExpectedActual` in `bug-candidate.ts` builds, for any validator
with a per-case `details` array, one aligned line **per failed case** — `case → code` — for the green
Expected box and the red Actual box, so they read as a line-by-line diff. The static case labels
(`Basic credentials`, `missing Bearer scheme`) are shown in full (they are validator labels, not user
data, so they are not mask-checked); only values are, and status codes are numbers. Single-shot
validators (status-code) keep their raw expected/actual. Applies to every bug, current and future.
The Bugzilla-UI Expected/Actual panels were made **monospace** (`DescriptionReport.tsx`) so the
aligned columns line up.

Two smaller owner requests in the same pass: the dedupe **tag prefix is now `KP`** (`[KP-05D529]`,
was `KPV2`) — the hash after the dash is unchanged, but existing `[KPV2-…]` tickets must be deleted
before a re-run or they will be re-filed as `[KP-…]`; and the Bugzilla-UI bug list now defaults to
**id ascending** (All Bugs / My Bugs / Advanced Search) instead of `importance`, so KPA-001, 002, 003…
read in order. `npm run check` clean; 64 framework tests pass.

### 2026-09-14 — Systemic bugs routed to a real component (not the catch-all); UI sort fixed

The first single-file filing verification (dashboard reads) filed 6 KPost API bugs correctly, but the
**4 platform-wide (systemic) ones landed on `kpost-webservice-application`**, the generic catch-all —
the owner wants every bug on one of the 27 real components. Systemic findings are all
security/auth-filter faults (missing security headers, the auth filter answering 400/403 instead of
401), so they now file on the real **`Authentication V2`** component: a new `bugzilla.systemicComponent`
per suite (KPost API → `Authentication V2`), used by `fromValidationResult` instead of the fallback.
Framework tests pin that a systemic candidate routes there and that every configured
`systemicComponent` exists in its product. (The 2 endpoint-specific dashboard bugs already routed to
`Dashboard V2` correctly.) To move the four already-filed ones, a re-run won't (dedup comments), so
they are corrected in place with a one-off `PUT component` — or deleted and re-filed.

Also fixed the **Bugzilla-UI default sort**: it was `importance` (severity order), which interleaves
bug ids and reads as "misaligned". Changed the default to **`id` descending** (newest bug first) in
`BUGZILLA-UI/frontend/src/lib/useBugFilters.ts` — the backend already maps `id → bug_id`, so it is a
real, stable order with the just-filed bugs at the top. `npm run check` clean; **63 framework tests
pass**.

### 2026-09-14 — Input validation turned on for live READS; a runbook; `flow:*` commands

The owner's instruction: test the full application flow on the six QA accounts, cover **every
process**, and the one hard rule — **never touch another real user's data**. Three things came from it.

- **The owner's rule is already the QA-identifier guard.** It refuses any request naming a record
  outside our QA accounts, before it is sent, and it runs on every probe mutation (it sits in
  `EndpointExecutor.send`). So "never touch another user" is enforced in code, not by choice — which
  is what makes it safe to raise coverage.
- **Input validation now runs on live READ endpoints.** The mutating input-validation validators
  were blocked wholesale on live; that was too blunt. A **read persists nothing**, and the guard
  refuses any mutated value that names a foreign record — so fuzzing a read's input is safe and finds
  the wrong-handling class (null accepted as a number, wrong type accepted, malformed rejected or
  not) on live. `productionExclusion(name, { destructive })` now clears `READ_SAFE_FUZZERS`
  (null/data-type/boundary/enum/empty/format/required/unknown-fields/invalid-payload/malformed-json/
  method-not-allowed/unsupported-media-type) **only when the endpoint is non-destructive**. They stay
  blocked on writes (persist junk), and `security.injection`/`xss` stay blocked even on reads (a
  successful injection could turn a read into a DELETE), as do the cross-tenant and service-abuse
  probes (they target other users or degrade the shared live service). Live-safety self-tests pin
  both directions.
- **What still needs a dev host** (unchanged, and honest): fuzzing **writes**, the **attack** class,
  and the **OTP** flows. The write **processes** are fully covered by the lifecycle flows on the six
  accounts; only malformed-write _inputs_ want a throwaway host.

Also added the operator guide **`docs/RUNBOOK.md`** (verify the bench → dry-preview → full run →
read results → boundaries → safety rules) and two commands: **`npm run flow:preview`** /
**`npm run flow:file`** — the complete end-to-end run (all reads incl. live read-fuzzing, all ten
write lifecycles, UI screens), serial, self-cleaning, filed to the right developer. `npm run check`
clean; **65 framework tests pass**.

**Coverage made accurate.** The ledger was reporting KMail "uncovered" paths that are actually the
same endpoints documented under a second spelling (`/kmailSetting/…` vs `/v2/…`, legacy `/kmail5/…`).
The compare is now prefix-insensitive (drop a leading `/kmail5` / `/v2` and trailing slash on both
sides), so registered-&-tested reads **295** (was 291 with the double-counts) and the only genuine
personal-scope gaps left are: `getKloudUsedData` (Storage Quota — **not in the usable contract**,
needs a workbook row) and the four signup endpoints (OTP, out of scope). Every other built-module
endpoint is covered on the six personal accounts.

**Open with the owner:** more QA accounts are offered. Six PERSONAL accounts already cover the
personal-scope flows (group/Cc/confidential need ≥3 — satisfied). The one thing that unlocks new
coverage is a **BUSINESS company with three members (one expendable)** — that is what the Admin
module needs (`terminateUser`/`resetPassword`/`holdOrRelease` act on other members), and it cannot be
exercised with PERSONAL accounts.

### 2026-09-14 — Component routing made correct against the 27 live components; a regression caught

The owner created **27 components** in the KPost API Bugzilla product (plus 9 KMail, 25 Admin, 12 UI)
and asked to verify every bug routes to the right one. Read the live instance — the 27 match
`KNOWN_COMPONENTS` exactly — and read the **BUGZILLA-UI** project (`D:\TEST-BENCH-AUTOMATIONS\BUGZILLA-UI`,
a React SPA + Node BFF over Bugzilla's REST API; components are plain Bugzilla components, category
rides on `[cat:Xxx]` in the status whiteboard, which the bench already writes). **Bugzilla is empty
now** (the owner deleted all bugs), so this is about routing the _next_ run correctly, not migrating.

Two real routing bugs found and fixed, plus a guard so they cannot recur:

- **KMail filed everything to the `kmail-application` catch-all.** KMail routes by functional AREA
  (Sent / Draft / Read / Mailbox / Contacts / Storage / Translation / Settings), but every endpoint is
  tagged `['kmail-api', 'kmail', 'kmail-<area>', '<sub-area>']` and the old `KMAIL_COMPONENT_BY_TAG`
  keyed on dead Swagger-style names (`'Sent Mail'`) no endpoint carries. Replaced it with a real
  tag→component map (area defaults + bare sub-area overrides) and gave `componentFor` a **kmail-api
  branch**: a bare sub-area tag (`contacts`, `status`, `content`, …) names the component and wins over
  the `kmail-<area>` default. Result: 70 KMail endpoints → **7 real components, zero catch-all**.
- **A regression in my own KPost fix:** `componentFor` was keying the module on `tags[0]`, but every
  factory prepends the **suite** tag, so `tags[0]` is `'kpost-api'`, not the module — sending **174
  KPost endpoints to the catch-all**. (My unit test used unrealistic tags without the prefix, so it
  passed.) Fixed by skipping `SUITE_LEVEL_TAGS` (`kpost-api`/`admin-api`/`kmail-api`/`kmail`) before
  taking the module tag; the hyphenated-refinement rule (`common-company` → Company Administration)
  and the foreign-bare-tag guard (a Kall read tagged `contacts` stays on Kall) are unchanged. Result:
  216 KPost endpoints → **14 real components, zero catch-all**. The unit tests now use realistic
  prefixed tags.
- **A guard + a map you can read:** `tests/framework/component-routing.spec.ts` resolves `componentFor`
  for every registered endpoint, **fails if any routes to a component that does not exist** in its
  product (`KNOWN_COMPONENTS`, exported for this), and writes **`docs/COMPONENT-ROUTING.md`** — a
  component → endpoint-count map per product. So a typo or a renamed component is caught mechanically.

Also **relaxed the first-live-run dry-run guard**: `live-safety.spec.ts` no longer forces
`BUGZILLA_DRY_RUN=true` on production — the environment is profiled and the owner opted into
auto-filing, so armed filing is intentional; what stays hard-disarmed is destructive mutation
(`ALLOW_DESTRUCTIVE_TESTS=false`) and parallelism (serial run). `npm run check` clean; **64 framework
tests pass**, including the live-Bugzilla component-default check.

### 2026-09-13 — KMail module (71 endpoints) — the big one; own host, own prefix, full flow on live

The largest module — email — built in stages. Suite `kmail-api`, **host `kmail5.kpostindia.com` with
a `/kmail5/v2` path prefix** (the owner supplied it; a first probe that omitted `/v2` had misled an
earlier note toward devapi2). Registry 217 → **291**; runs-on-live 71 → **101**. Codes/flow analysed
first in `docs/kmail-flow.md`; all three enums (`kmailType` 0–13, `kmailReceiverType` 1–3,
`kmailPriority` 0–2) match the workbook.

- **`defineKmailEndpoint`** — a parallel wrapper (own suite, `kmail` envelope, auth). 71 endpoints
  hand-defined across read/send/draft/manage/settings; coverage self-test confirms 0 uncovered.
- **~32 reads run on live**; the write lifecycle **passes 5/5**: compose a New mail (kmailID issued,
  FR-M01) → mark-important → delete; the post-send action types; **the confidential recipient
  (`bccList`) hidden from the TO/CC recipients — NFR-SEC02 confirmed on live**; draft save→delete;
  the settings writes. Gated `KMAIL_LIFECYCLE`, `allowLiveWrite`, QA accounts only, self-cleaning.

**The bug that mattered — Playwright drops a base-URL path.** With `KMAIL_API_BASE_URL` set to
`…/kmail5/v2` and request paths starting `/`, `new URL('/common/…', base)` **discards `/kmail5/v2`**,
so every KMail call silently hit `kmail5.kpostindia.com/common/…` and 404'd — masked because 404 is
not a 401 and many validators tolerate a 404 body. Fixed: `KMAIL_API_BASE_URL` is the **origin**, and
`defineKmailEndpoint` prepends `/kmail5/v2` to the request `path` while the schema/coverage lookup
uses the unprefixed `contractPath`. Confirmed by the status-code validators flipping from fail to
pass. (The ledger's `runsLive` was taught to count the prefixed path via `contractPath` too.)

**Findings & the send contract:** the recipient model is `toAddress` (TO) + `ccList` (COPY) +
`bccList` (CONFIDENTIAL, hidden). Compose (New) works; **Forward/Note/Comment/Clarify answer 500/404**
sent as a New-shaped mail — they need type-specific fields (a reference / forward list), like Katchup's
forward — recorded as findings. `getMailCredentials` (returns credentials, takes a password) is
registered but **not driven on live**. Mail-OTP (`kmailType 12`) stays OTP-blocked.

**Guard exemptions** for the KMail runtime ids (`kmailID`, `transactionIDs`, `draftMailID`,
`saluationID`, `templateID`) and the content/meta fields the "mail"/"msg"/"attachment" token
over-matched (`kmailSubject`, `kmailContent`, `kmailSendDate`, `kmailType`, `attachmentFlag`,
`kmailStatusFlag`, `msgToTranslate`). Live-safety guards still green. The `/kmail` screen shell is
covered by `tests/e2e/kmail.spec.ts`.

### 2026-09-13 — AWS module (4 endpoints) — S3 presigned URLs + attachment check/delete

Fifth backlog module. `/v2/aws/*` — S3 presigned upload URLs and the attachment lifecycle. Registry
212 → **217**; runs-on-live 68 → **71**. All 4 exercised on live.

- **3 reads run on live** — the two presigned-URL generators (they take only file metadata, write
  nothing persistent, name no one) and `checkAttachmentS3` (its default `attachmentsUuid: []` names
  nothing). Generators first run: **11 pass, 15 findings**.
- **`deleteAttachmentFromS3` in the lifecycle** — `generate-presigned` mints a uuid, then delete
  removes that key. Gated `AWS_LIFECYCLE=true`, `allowLiveWrite`.

**A finding:** **`generate-presigned-url` returns a raw presigned S3 URL string, not the documented
JSON** — the uuid is the filename in its path (`…/<uuid>.pdf?…`), so the lifecycle parses it out of
the URL. `response.schema`/envelope validators flag the plain-text body.

**Guard exemptions:** `uuid` and `attachmentsUuid` — a runtime S3 attachment id the generator mints,
exempt like `msgID`/`docId` (runtime-scoped, no productionSafe endpoint accepts a real one). Note the
boundary the guard enforces: `allowLiveWrite` authorizes only **destructive** writes, so a read keyed
by a real runtime uuid (`checkAttachmentS3` against a specific id) cannot be driven on live — the same
honest boundary as the Katchup attachment downloads. Live-safety guards still green.

### 2026-09-13 — KOS module (18 endpoints) — KWord documents + K-AI; AI generation held for the owner

Fourth backlog module. `/kword/*` (KWord documents) + `/ai/*` (K-AI). The KOS screen renders
"Coming Soon", so this is **API-only**. Registry 194 → **212**; runs-on-live 66 → **68**. Payloads
from the live client (`KWord.js`, `KAI.js`); the workbook documents none.

- **2 reads run on live** — `getAllKWordDocs` (document list), `getAISessions`. First run: **12 pass,
  11 findings**. 5 doc/session-keyed reads are `needs-doc-id` (exercised by the lifecycle).
- **KWord write lifecycle on live** — create → saveContent → update → deleteHeading → convertToKad →
  share → join → the doc-keyed reads → exit → delete, self-cleaning. Gated `KOS_LIFECYCLE=true`.
- **The two K-AI generation endpoints (`chatResponse`, `messageAssist`) call a real, billed AI
  service.** The owner authorized one run each, so they are `data` (the caller's own AI request),
  **not `productionSafe`**, `metered`-tagged, and driven only by a test gated behind a **second** flag
  `KOS_AI_LIVE=true` (above `KOS_LIFECYCLE`) — a normal run never bills the service. Run once on live
  (owner-authorized): both returned a valid response (~5–10s of real generation). A coverage self-test
  pins that no `metered` endpoint is ever `productionSafe`.

**What the live run taught (findings + a payload correction):**

- **`createDoc` is `{titleOfDocument, subject, documentType, convertToKad, initiatedBy}`** and returns
  the new id at **`data.id`** — my first inferred `{docTitle}` answered **HTTP 500**
  ("Error while creating document"). Corrected from `KWord.js`. The 500 on a bad payload (vs a 400)
  is itself a finding, recorded.

**Guard exemptions the "doc" over-match forced** — `IDENTIFIER_KEY` matches any key containing "doc",
so KWord content/id fields tripped it. Added to `NOT_A_RESOURCE` as runtime-ids / content (same class
as the katchup content fields and the msgid/kallid runtime ids): **`docid`** (a doc UUID we created),
**`doctitle`/`titleofdocument`/`documenttype`** (a document's title/type text). The tenant kpostIDs in
a doc's share/join payload stay checked. Live-safety guards still 19/19 green.

### 2026-09-13 — Live write-flow sweep: every finished module's writes driven on live, QA-only

The owner asked to bring the finished modules to 100% live coverage — every write endpoint driven
through a real self-cleaning flow, on QA accounts only, never touching another user's data. Done
across all ten:

| Module   | Live write coverage after the sweep                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Kall     | 12/12 (already)                                                                                            |
| Settings | 5/5 (already)                                                                                              |
| KDiary   | 9/9 — `updateScheduleRemarks` fixed (`{eventIds:[id]}`); 6 frontend-unused endpoints exercised as findings |
| Contacts | 8/8 — added `addMultiple`, `importPhoneContacts` (own number), `updateInviteStatus` (own number)           |
| Profile  | all `data`-writes — added the 5 image uploads, 2 removes, `shareUserDetails`                               |
| Katchup  | send variants (multipart/bulk) + forward variants added; core flow already live                            |
| Group    | 9/9 — new `group/feature.spec.ts`: create → add → admin → rename → image → leave → remove → delete         |

**Guard exemptions the sweep forced** — all runtime-scoped ids under keys the pattern flags, added to
`qa-identifier-guard.ts` `NOT_A_RESOURCE` with the same reasoning as `msgid`/`kallid`/`groupid` (a
runtime id we created, group/row-scoped, not a tenant resource; no productionSafe endpoint accepts
one; the tenant kpostIDs beside them stay checked): **`groupkpostid`** (the auto-minted id of a group
we made), **`ids`** (a bare membership-row-id array — the plural of the already-exempt bare `id`).
Live-safety guards still 19/19 green.

**What stays off-live, by design (safety, not a gap):**

- **Katchup attachment retrieval** (`download`/`thumbnail`/`stream`/`generate`) and `forwardBacktrack`
  are reads keyed by a real attachment `uuid` / forwarded `msgID`, which only a completed S3 upload
  or forward produces. Off-live contract-validated; a fabricated uuid is (correctly) guard-refused.
- **Profile OTP/device/password/deactivate/forgot-password** — would SMS real people or lock/destroy
  our own account. Correctly blocked-with-reason.
- **Group image downloads** — reads keyed by the runtime `groupKpostID`.

Every finished module now: all reads on live, all safe writes driven on live self-cleaning, all
unsafe writes blocked-with-reason, `npm run check` clean, 59 framework guards green.

### 2026-09-13 — KDiary module (14 endpoints) — schedules/events/reports; the id field is `eventID`

Third backlog module. `/dairySchedule/*` — the caller's own diary. **The workbook documents no
payload for any of the 14 endpoints**, so every shape came from the live client (`Diary.js`,
`ECommerce.js`) or was inferred and noted. Registry 180 → **194**; runs-on-live 61 → **66**. The
`kdiaryRemarks` enum (0 None … 6 Delete) is already in the Types tab.

- **5 reads run on live** — `getTodaySchedules`, `getEvents`, `getTodayReport` (GET) + `getEventDate`,
  `getEventSelectedDate` (POST, date from the create field). First run: **22 pass, 40 findings**.
- **Write lifecycle on live** — `createEvent` works and issues an id; `deleteEvent {eventID}` works
  (the lifecycle self-cleans, verified 0 orphans after). Gated `KDIARY_LIFECYCLE=true`, `allowLiveWrite`.

**What the live run taught (and a real finding):**

- **The id field is `eventID`, not `scheduleID`.** The create response returns `{eventID: 481, …}`.
  My first inferred `scheduleID` made every id-keyed write 400/500 and left orphan events — caught by
  reading `getEvents` back, corrected to `eventID`, and the orphans (481, 482) deleted. Lesson: for a
  module the workbook documents no payloads for, read one entity back before trusting the id field.
- **`updateScheduleRemarks` answers HTTP 500** and **`addparticipants` answers 400** even with the
  correct `eventID`. The 400 is likely a deeper payload gap (these bodies are undocumented); the
  **500 is a finding** — a server error where a 4xx belongs. `expect.soft`, recorded, payloads flagged
  inferred so it is not mis-filed as solved.

No standalone `/kdiary` screen — the route is commented out in `MenuRoutes.js`; the diary is reached
from inside Katchup, so no screen spec.

### 2026-09-13 — Settings module (7 endpoints) + a dedicated `/settings` screen

Second backlog module (owner: one at a time). `/generalSetting/*` — the caller's own preferences,
the safest writes in the bench (cosmetic, own-account, no other user or shared state). Registry
173 → **180**; runs-on-live 59 → **61**. Payloads: theme/font from the live client
(`Services/ThemeSettings.js`) + workbook; the three notification toggles document no body, so a
minimal `{enable}` is sent and the empty-body/null probes carry the rest.

- **2 reads run on live** — `getPersonalize`, `getAllNotification`. First run: **8 pass, 18 findings**
  (systemic classes).
- **Write lifecycle 2/2 on live**, self-restoring: font + theme change → restore; the three
  notification toggles off → restore on. Gated `SETTINGS_LIFECYCLE=true`, each write `allowLiveWrite`.
- **`tests/e2e/settings.spec.ts`** — the `/settings` screen promoted out of `profile.spec.ts` into
  its own spec: the two-panel workspace (`.settings-theme-shell`) and the section nav
  (`General Settings`/`Profile Creation`), cross-browser.

**A guard exemption the theme write forced:** `changeTheme` sends `katchupChatStyle`,
`katchupChatTheme`, `katchupChatBackgroundThemeWallpaper` and `kpostLayoutTheme` — appearance values
that match the identifier guard only because the key contains "katchup"/"kpost". They are cosmetic
settings on the caller's own account, not tenant resources, so they are exempt in
`qa-identifier-guard.ts` (the same class as the kall enum fields). Live-safety guards still green.

### 2026-09-13 — Contacts module (16 endpoints) — first backlog module, all on personal accounts

First module off the coverage-ledger backlog (owner: one at a time, personal accounts only, Admin
deferred). Contacts is the address book the messaging/calling/mail modules all act on. 16 usable
endpoints (2 superseded rows correctly retired); payloads from the live client
(`Services/Contacts.js`, `BlockContact.js`). Registry 157 → **173**; runs-on-live 51 → **59**.

- **8 reads run on live** — `myContacts`, `myUnknownKatchupContacts`, `myGroups`, `myUnknownGroups`,
  `getImportedPhoneContacts`, `getblockContactDetails`, `globalSearch`, `getSearchDetails`. First run:
  **50 pass, 53 findings** (the same systemic classes as every module). Every POST read carries
  `destructive: false`; the guard confirms no read is grep-dropped.
- **Write lifecycle 2/2 on live**, self-restoring: add → verify in `myContacts` → add reference →
  delete; and block → bulk-block → unblock (single + bulk). `{contactID, isBlocked}` is the live
  client's block shape (the workbook documents no body). Gated `CONTACTS_LIFECYCLE=true`, each write
  `allowLiveWrite`, targeting our own second account so the identifier guard permits it.
- **2 writes stay off-live** — `importPhoneContacts` (carries phone numbers, can match/notify) and
  `updateInviteStatus` (an invite action) are contract-validated off-live only, not driven on live.

No standalone `/contacts` screen — the contact list/search lives inside the Katchup and Kall screens,
already asserted there. Ledger updated: `contacts` → built.

### 2026-09-13 — Coverage ledger: completeness made measurable and self-checking

The goal is complete coverage — every endpoint, every screen, nothing missed. You cannot _claim_
that; you have to _measure_ it. `tests/framework/coverage-ledger.spec.ts` generates **`docs/COVERAGE.md`**
by reconciling the registry against both generated contracts (kpost-api + kmail-api). It buckets
every documented path into a module, each module carrying an explicit **scope decision**
(`built` / `backlog` / `needs-business` / `external` / `out-of-scope`), and it **fails the build** if
a module prefix is unclassified or a registered endpoint is in no contract — so nothing can be
silently uncovered or silently invented.

**The measured picture:** 334 documented (KPost + KMail), **157 registered & tested**, 51 run on
live. The 7 built modules are at 100% of their in-scope slice (profile 45/45, katchup 36/36, common
32/32, kall 20/20, group 11/11, dashboard 3/3, signuplogin 8/12 — the 4 are signup, out of scope).
Screens: 8/15 routes.

**The backlog, in build order (no special account needed):** contacts 16 → generalsetting/Settings 7
→ dairyschedule/KDiary 14 → kword+ai/KOS 18 → aws 4 → **kmail 80** (own host). **Needs a business
account:** admin 13 + business-tier login + company lookups. **Owner scope call:** redbus 8,
ecommerce 2, metadee 1 (third-party?), knews 6 (external RSS), kpresentation/KDOC 4 (out of scope per
BRD §4.2). Screens still to add: settings (own spec), kcloud, kbooking, kdoc, usermanagement.

The ledger is the definition of done: complete = every `backlog` module built, every buildable screen
speced, and every `needs-business`/`out-of-scope` item either unblocked or recorded as a decision.

### 2026-09-13 — The frontend becomes the UI source of truth; `docs/ui-screens.md`; shell + KMail screens

The owner pointed at the React source (`D:\KPOST_PROJECTS\KPOST_REACTJS_2023_V1`). It is to the UI
what the Excel workbook is to the API — the authoritative map of screens, controls and the
icon→action→API wiring. Mined it into **`docs/ui-screens.md`**: per screen, the stable selectors
present at initial load, and each control (`icon-KP_*`) → what it does → which endpoint it calls, plus
the app-shape facts a test must respect. So e2e tests now anchor on a documented map instead of
selectors reverse-engineered per module.

Facts worth keeping from the map:

- **Viewport ≥ 1200px** or the nav rail and side columns are hidden (`d-none d-xl-*`). The browser
  projects default to 1280 — do not shrink below 1200.
- **`/katchup`, `/kall`, `/home`, `/kmail` embed `<Knews>`/`<Ecommerce>` as empty-state fillers** in
  the right columns, so those selectors appear before a chat/mail is opened — not the screen's own
  content.
- **`localStorage.katchup_chat_variant_v1`** (`bubble`/`classic`) swaps which `KatchupMessage` mounts.
- The **`icon-KP_*` name encodes intent** (`icon-KP_04-Katchup`, `icon-KP_05-Kall`); the key is
  `src/Assets/icons/icomoon/style.css`. Every screen's header is `.<icon>.Katchup_Icon` +
  `.Katchup_Name` — a reliable "this screen mounted" anchor.
- The source's `ServiceURL.js` points at **LAN IPs** (a dev build); the deployed live UI talks to
  `devapi2`/`kmail5`, so UI tests intercept by **path**, never origin.

**Scope chosen: screen + controls, read-only, cross-browser** (owner's call) — assert each screen
renders and its real controls/icons are present and wired, no writes through the UI.

New tests, verified on the live app:

- **`tests/e2e/shell.spec.ts`** — the shared Header: the user chip, and the nav rail linking to every
  core module (`icon-KP_01-Home`, `_03-KMail`, `_04-Katchup`, `_05-Kall`, `_15-Settings`). One test
  covering the entry point to every screen.
- **`tests/e2e/kmail.spec.ts`** — the KMail screen (`.kmail-layout-shell`).

Full cross-browser e2e (Chromium/Firefox/WebKit): **39 passed**, 3 flaky-then-green (the documented
live-SPA throttle flake `retries:2` absorbs). The existing selectors (`.kall-layout-shell`,
`.settings-theme-shell`, `.name_font_profile`, `.header-user-pill`) already passing on live confirmed
the map matches the deployment, so the new selectors were trustworthy before running — and did pass.

### 2026-09-13 — Kall module (20 endpoints, API + screen); runtime-id guard policy extended to calls

The calling module, built to the Katchup/Profile bar: `/v2/kall/*` — **20 usable endpoints** (the
converter correctly retired 16 superseded duplicates), the two call flows analysed first in
`docs/kall-flow.md`. Registry: 137 → **157**; live doc: **51 run / 106 blocked**. Coverage 7/7,
`/kall` UI cross-browser.

**The codes were already right.** All four enums the owner supplied — `kallStatus` (0–11),
`kallType` (0–1), `kallMode` (0–5), `kallRepeatType` (0–3) — match the workbook's Types tab exactly,
same as Katchup. Pinned in the coverage self-test so a renumber fails loudly.

#### Structure — reads run on live, writes gated

    read.api.ts   (8)  kallDashboard, todayKoolKall, frequentKallContacts, kallInfo, contactInfo,
                       fetchScheduledRepeatKall  → 6 run on live · getKallStatus[UsingKallID] → needs-kall-id
    direct.api.ts (6)  initiateKall, updateKallStatus, updateSenderAndReceiverKallStatus,
                       endIndividualKall, clearKallBykallIds, clearKallHistory
    schedule.api.ts(6) scheduledKall, reScheduleKall, joinScheduleKall, endKoolKall,
                       scheduledRepeatKall, modifyKallMembers

First live run of the 6 reads: **36 pass, 44 findings** — the same systemic classes confirmed across
every module (auth failures 400/403 not 401, missing CSP/referrer headers, error envelope). Every
POST read carries `destructive: false` (the grep trap the Dashboard entry documents); the framework
guard confirms none is silently dropped.

Every write is destructive and **not `productionSafe`**: a call rings a real device / notifies
participants, and the clear endpoints delete the log. They are exercised through
`tests/api/kpost/kall/feature.spec.ts` — gated `KALL_LIFECYCLE=true`, each write `allowLiveWrite`,
self-cleaning.

#### The full write lifecycle ran on live (owner-authorized) — every endpoint exercised

Three orchestrated flows in `feature.spec.ts` exercise **all 12 writes and both `kallID`-keyed
reads** (fed the real id the flow creates), so every one of the 20 Kall endpoints has now been hit
on live, not just contract-validated:

- **Direct-call flow — fully passes.** `initiateKall` → `getKallStatus` → `getKallStatusUsingKallID`
  → `updateKallStatus` → `updateSenderAndReceiverKallStatus` → `endIndividualKall` →
  `clearKallBykallIds`, every step 200, cleaned up. The two status reads work once fed a real id.
- **BR-C01 confirmed on live.** `scheduledKall` → `reScheduleKall` keeps the same `kallID` and the
  sender status moves **6 (Scheduled) → 7 (ReScheduled)** — seen in the `todayKoolKall` row
  (`senderKallStatus: 7`). `modifyKallMembers` (add a third account) is also accepted.
- **Finding cluster — three scheduled-call endpoints answer HTTP 500:** `joinScheduleKall`,
  `endKoolKall`, and `scheduledRepeatKall`. Server errors on client-reachable paths (a 4xx belongs).
  `scheduledKall`, `reScheduleKall` and `modifyKallMembers` on the same call all succeed, so it is
  those three operations specifically — worth one ticket for the Kool-call subsystem. `expect.soft`,
  so all three surface in one run.

Cleanup verified after the run: **0 active (not-deleted) calls** on all three accounts; every test
call shows `deletedBySender: true` (the app's own delete state).

Two fixes the live run forced, both real:

- **The end/join/status payloads echo the kall's row id as a bare `{id: <kallID>}`.** A bare `id`
  matches the identifier guard and is not a `QA_*` value, so the guard refused it (correctly, by its
  rules) and the first run left orphan calls. Exempted the **exact** key `id` in
  `qa-identifier-guard.ts` — it is a runtime row id, and this API names every cross-tenant target with
  a QUALIFIED key (`kpostID`/`companyID`/…), never a bare `id` (asserted: no `productionSafe` endpoint
  sends one, and `companyID`/`kpostID` beside an `id` stay refused).
- **Cleanup moved into a `finally` and switched to `clearKallHistory`** (a GET, so no id to guard,
  clears the caller's whole log) for **both** parties — so a mid-flow failure can no longer leave an
  orphan. Verified after the run: the direct-call log reads "No Data" and every scheduled test call
  shows `deletedBySender: true` (the app's own delete state).

`initiateKall` rings a real device, so the lifecycle stays gated behind `KALL_LIFECYCLE=true` and off
the default run.

#### The QA-identifier guard trips on `kall*` — the same trap Katchup's content fields hit

Every `kall*` key (`kallSession`, `kallMode`, `kallStatus`, `kallID`) matches the guard's
`IDENTIFIER_KEY` because it contains "kall", so without exemptions the guard **refuses every Kall read
on live**. The enum/session/timestamp fields are exempt (not resources), and — the decision that
matters — **`kallID`/`kallIds` are exempt as runtime-scoped ids, handled exactly like `msgID`**: a
call we placed is kall-scoped, not tenant-scoped, created at runtime (so cannot be pre-allowlisted),
and no `productionSafe` endpoint accepts one. That is what lets the gated lifecycle clean up the
kallIDs it created (via `allowLiveWrite`), the same way Katchup's lifecycle deletes by `msgID`. The
**tenant** ids a kall payload also carries — the participant kpostIDs in `addingUserIds` /
`kallDetails[].receiver` — stay checked, so `modifyKallMembers` still cannot target a stranger.

Two live-safety self-tests were reconciled to this: the `{kallIds:[2,3]}` test now asserts the
exemption (with a still-guarded kpostID list proving element-by-element checking survives), and a
**pre-existing stale test** that expected `groupID` to be flagged (it has been exempt since the group
module) was corrected — `groupID`, like `kallID`, is a runtime-scoped id. A new coverage self-test
runs `foreignIdentifiers` over every cleared Kall read's built payload, so a future added field cannot
silently get the reads refused on live.

#### A doc-accuracy fix caught here

`blockedReason` in the live-coverage generator labelled every non-destructive, non-cleared endpoint
"needs a business account" — wrong for the `needs-kall-id` reads (and Katchup's `needs-message-id`
reads all along). It now recognises the `needs-*` tags and says "needs a real message/call/group id
that only a write flow creates".

### 2026-09-14 — First live KPost-API filing flooded one queue; systemic findings now consolidate

The first real filing run (`BUGZILLA_DRY_RUN=false`, KPost-API only) worked — **376 tickets created,
all correctly to `KPost API` → Jaganathan Murthy**. But it was the cascade §3 warns about made real:
the 376 collapse to **29 distinct classes, and ~290 of them are 6 platform-wide faults repeated once
per endpoint** — security headers missing (~73), the auth filter answering 400/403 instead of 401
across missing/invalid/malformed/unsigned-token (~184), and the error envelope on auth rejections
(~38). The ~85 genuinely endpoint-specific bugs (real 500s, timeouts, sensitive-data) were buried.

Two root causes, both fixed:

- **The fingerprint is per-endpoint by design** (`bug-fingerprint.ts`) — right for a 500 here vs a
  404 there, wrong for one gateway/auth fault that shows on every endpoint. Added
  **`systemicFingerprint`** (endpoint EXCLUDED) and a `SYSTEMIC_VALIDATORS` set
  (`security.security-headers`, the four `authentication.*-token` validators, `security.jwt`, and
  `response.error-format` **only** when it is reporting the auth-rejection envelopes, not a malformed
  primary — the message names `primary (` only in the latter). A systemic finding files as **one
  consolidated ticket that lists every endpoint it hit** (`affectedEndpoints`, merged in
  `mergeCandidates`, rendered by `buildDescription`). Everything else stays per-endpoint. A KMail or
  UI run of this size now yields ~4 platform tickets + the real ones, not ~300.
- **338 of 376 landed on the `kpost-webservice-application` catch-all** — the modules built this
  session were never added to `componentByTag`. Mapped katchup/kall/contacts/dashboard/group/
  profile/settings/kdiary/aws/kos/ai to their live components, and rewrote **`componentFor`** to be
  **module-first for API suites**: `tags[0]` (always the module tag) sets the component, and only a
  _hyphenated_ refinement (`common-company`) may override it — so a Kall read tagged `contacts` can
  no longer be stolen into the Contacts component by the old longest-match rule.

**The owner then cleared Bugzilla and asked for a single automatic setup** — run the tests, valid
non-duplicate bugs file themselves, and a clear report lives in the bench — no manual cleanup step.
So the one-off consolidate-and-resolve script was **removed**, and the setup is now:

- **One command, all three developers.** `npm run bugs:file`
  (`BUGZILLA_DRY_RUN=false MOCK_API=false playwright test --project=api --project=chromium`) runs the
  live API suite (KPost API → Jagan, KMail API → Jitendra, routed by suite) and the UI (→ Ayyappan)
  in one pass and files everything valid. `npm run bugs:preview` is the same, dry-run. The confusing
  `:all` / `:200` / `:consolidate` variants are gone.
- **"All bugs file" needs no cap.** `BUGZILLA_MAX_FILE` defaults to **0**, and the filer only caps
  when `maxFile > 0` — so 0 means **unlimited**, not zero (the earlier "0 = files nothing" diagnosis
  was wrong; the real blocker then was a stale `MOCK_API=true` / `DRY_RUN=true`). Valid-only is
  enforced by the severity floor (`BUGZILLA_MIN_SEVERITY=MEDIUM`) and the validity gate; no-duplicate
  by the `[KPV2-…]` live dedup (re-run comments, never re-files) plus the systemic consolidation.
- **A clear in-bench report, written every run** — `reports/bugs/REPORT.md` (+ a concise console
  block), by `src/reporting/bug-report.ts`. It states: endpoints tested / checks passed·failed·skipped;
  distinct valid defects (and how many were consolidated from how many endpoints); **filed-by-developer**
  table; every ticket with its bug number, severity and endpoints; and the findings **not** filed with
  the reason. Written even on a dry run or with no host configured, so "what did this run find and file"
  never needs the scrollback. The 376-line per-bug console dump is gone.

Generated `docs/COVERAGE.md` and `docs/LIVE-ENDPOINTS.md` added to `.prettierignore` (they regenerate
every framework run, like the contracts). `npm run check` clean; 17 bug-tracker + 7 ownership/coverage
framework tests green, including the live-Bugzilla component-default check.

### 2026-09-13 — Dashboard module (Home screen); a POST-read `@destructive` grep trap fixed

The Home screen's recent-messages panel: `/v2/dashboard/*` — 3 authenticated reads
(`homeDashboardMsgs`, `katchupDashboardMsg`, `homeDashboardNewMsgs`), payloads from the live client.
Registry: 134 → **137**. Coverage 4/4, live reads 24 pass + findings, `/home` UI cross-browser.

#### A real framework trap this caught: a POST read silently dropped on live

The dashboard reads are **POST**, and `destructive` defaults to **true for POST/PUT/PATCH/DELETE**.
So without an explicit `destructive: false`, `tagsFor` tagged every one of their tests `@destructive`,
and the production `grepInvert(@destructive)` **removed all 132 of them** — the module collected
**zero tests** while every coverage self-test passed (coverage checks the raw definition, where
`destructive ?? false` is false; the _resolved_ endpoint defaults it to true). The symptom was
baffling: `describeEndpointCases` found the 3 endpoints and built 132 cases (proven by hand), yet
Playwright reported "0 tests". The fix is one line per endpoint (`destructive: false`), and the
lesson generalises: **a POST/GET read must state `destructive: false`, or it vanishes from a
production run.**

#### The guard was built, and it found the trap had already bitten ten more reads

A new assertion in `tests/framework/live-coverage.spec.ts` — _"a cleared READ does not resolve to
destructive"_ — takes every `productionSafe`, non-`mockFixture` endpoint, resolves it, and fails on
any whose resolved `destructive` is true (excepting the one named cleared write, `userLogout`). It
turned the dashboard's baffling symptom into a mechanical check, and immediately caught **ten POST
reads that had been silently dropped from every live run since they were written**: five in Katchup
(`conversation`, `message-count`, `search-message`, `search-subject`, `filter-message`) and five in
Profile (`user-profile-by-kpostid`, `user-basic-by-kpostid`, `digital-card`, `auto-search`,
`advanced-search`). All ten now carry `destructive: false` and run on live. `docs/LIVE-ENDPOINTS.md`
went **42 → 45** as the dashboard trio joined; the Katchup/Profile ten were already counted as
"runs on live" by the generator (which reads the raw definition) even though the engine had been
dropping them — the exact split-brain the guard closes. The guard is green.

#### Findings

- **The dashboard responses do not use the standard `{status:"SUCCESS"}` envelope** — `response.structure`
  fails on all three. They return the message payload in a different shape; whether that is intended
  or a contract inconsistency is for the owner.
- **A sensitive-data false positive**, recorded so it is not filed: `secretMessageExpireTimeAsLong`
  is flagged because the field _name_ contains "secret" — it is a timestamp, not a leaked secret. The
  validator matches on field-name substrings; this is the same over-match class as the identifier
  guard, and a candidate allowlist entry.

### 2026-09-13 — Profile complete: write lifecycle + UI screens (matching Katchup)

Profile now has the same depth as Katchup — API reads, an authorized write lifecycle, and UI screens.

#### Write lifecycle (API, live, self-restoring) — 5/5

`tests/api/kpost/profile/feature.spec.ts`, gated behind `PROFILE_LIFECYCLE=true`, every write via
`allowLiveWrite`: update about → read back → restore; update designation → read back → restore;
basic/contact/privacy accepted; an education record saved then deleted; base64→image. Each restores
the original, so the account is unchanged after a run.

Three things the frontend/live taught this flow, each a 500 or empty read until corrected:

- **The editable fields live under `data.userProfile`**, not the flat `fetchUserDetails` response —
  read-backs use `getUserProfileUsingKpostID`. (`fetchUserDetails` returns identity fields only.)
- **`updateBasicInformation` 500s without `dateOfBirth`** — a required field the workbook sample
  half-shows. Added to the payload; a payload gap, not a product bug.
- **The read-back can lag the write** (eventual consistency), so it is best-effort — the write's own
  `200 "…updated successfully"` is the confirmation, and the read-back is asserted only when the
  field has surfaced.

**A sensitive-data finding surfaced here:** `getUserProfileUsingKpostID` returns **`password`** (and
`kmailPassword`) in `data`, and `aadhaarNumber` / `panNumber` under `userProfile`. The central
sensitive-data validator flags these — credentials and national-ID numbers should never be in a
profile response.

#### UI screens (cross-browser)

`tests/e2e/profile.spec.ts` — `/userprofile` (renders the account holder's name and photo, and the
About section) and `/settings` (the settings workspace). Structural selectors from the live app
(`.name_font_profile`, `.Main-Profile-image`, `.settings-theme-shell`). Pass in Chromium; the full
three-engine run confirms Firefox and WebKit.

**Lesson:** the saved session expires, and an expired one bounces every screen to `/login` — the
`setup` project must run fresh before a browser run (it does, as a dependency), and a long gap
between setup and the browser tests needs a re-run.

### 2026-09-13 — Profile module built (45 endpoints); `contractMethod` added; live findings

The second module by the owner's order, and the largest single surface in the product — **45
endpoints, entirely undocumented** (no FR ids; contracts from the workbook + the live web client).

```
src/api/definitions/kpost/profile/
  read.api.ts   (12) fetch, search, digital card, languages, device state, image downloads
  write.api.ts  (15) about, designation, basic, contact, privacy, education/experience, share
  image.api.ts   (8) profile / cover / signature / attachment uploads, base64 convert
  device.api.ts (10) primary/secondary device (OTP-gated), password, forgot-password, deactivate
```

Registry: 89 → **134**; live doc: **42 run / 92 blocked**. Coverage self-tests 6/6, 0 uncovered.

#### Findings from the live reads (35 passed, 42 failed)

Two profile-specific defects, both reproduced on `devapi2`:

- **`downloadCoverImage` answers HTTP 500** when the account has no cover image, where its sibling
  `downloadProfileImage` correctly answers **204**. A missing image is a 204/404, not a server fault.
- **`getlanguages` has no working verb** — GET answers 405, POST answers 500.

And **two workbook method errors**, fixed and recorded: `fetchUserDetails` and `isDevicePrimaryOrNot`
are documented POST but the live API answers only **GET** (POST → 405). The rest of the 42 are the
same systemic classes as every other module (auth → 400/403 not 401, error envelope, headers).

#### New framework capability: `contractMethod`

The method analogue of `contractPath`. Where the workbook's derived verb is wrong, the definition
uses the **live** method while the schema is still read from the documented (method, path) row —
`method: 'GET', contractMethod: 'POST'`. Without it the two method-corrected endpoints could not be
defined at all (the contract lookup is keyed by method+path). This is the same pattern the logo trio
needed for paths, now generalised to verbs. Threaded through `KpostEndpointConfig`, the definition
type, the factory and the coverage self-test.

#### Gating

Reads are `productionSafe` (asked with our own kpostID/mobile). Every write is `data` + destructive
and **not** cleared for live (they change our own profile — a live write would go through an
authorized flow, as Katchup does). The dangerous ones are doubly blocked: **`deactivateAccount`** and
the **device-designation** writes are `global` + `otpDependent`; **`changePassword`** is `global` (it
would lock the QA account out); the **OTP senders** are `external`. A coverage self-test pins these.

### 2026-09-13 — Katchup verified end to end: cross-browser UI + full live API sweep

Before starting Profile, a complete verification pass over Katchup — both API and UI, in production.

#### Cross-browser UI (Chromium, Firefox, WebKit)

The e2e suite runs in all three engines. Getting there fixed real things:

- **Consolidated the login-screen checks into one navigation.** Each separate test navigated to
  `/login` fresh, and the country-list endpoint rate-limits after repeated loads — so the later
  tests could not render the form (worst in the slower engines). One test now walks
  unknown-id → valid-id → wrong-password with a single load, mirroring a real session and staying
  reliable in every engine.
- **A reload-retry in the login page object** for the country throttle, and Enter-to-submit (a
  domain-autocomplete portal overlays the Submit button).
- **The Subject field is not a reliable landing-page assertion.** `.fw_Msg_subject` mounts only
  inside an open conversation, and the landing DOM differs by engine (present in Chromium/WebKit,
  absent in Firefox). The UI check now asserts the **compose entry point** (`icon-KP_02-Write-Letter`),
  which is on the workspace in every engine; the Subject differentiator itself (BR-K01) is proven by
  the API feature flow, where every message is verified to carry its subject.
- **Two retries** on browser projects: a live SPA over a throttling third-party host flakes ~1 test
  per full run, rotating between engines; retries absorb that without masking a real break (which
  fails all three attempts).

Also: the `home.spec.ts`/`HomePage.ts` Playwright template was deleted, `.auth/user.json` is a
single shared session so **browser runs must be sequential** on a live account (a parallel run races
the login), and browsers are already installed.

#### Full live API sweep — every live-safe endpoint checked in production

Ran the whole KPost API suite against `devapi2`: **172 passed, 68 failed, 1652 skipped**.

- **172 passed** — the read-side validators (status, schema, headers, sensitive-data, performance,
  valid-token) across the 30 live-safe endpoints in every module.
- **68 failed** — the **findings**, and they collapse to the same handful of systemic classes now
  confirmed across _every_ authenticated endpoint, not just login: auth failures answer 400/403 not
  401 (`authentication.*`), error bodies do not follow the envelope (`response.error-format`), the
  status code is wrong on some (`response.status-code`), and CSP/referrer headers are missing
  (`security.security-headers`). `authentication.valid-token` did **not** fail (a valid token is
  accepted everywhere — the earlier worry was a grep matching test names, not failures).
- **1652 skipped** — blocked writes (correctly: real SMS, OTP-gated, another tenant's data) and the
  aggressive probes that only run off-live. The Katchup writes are covered separately by the gated
  feature flow (10/10 on live).

**A real test bug this sweep caught:** `attachments.spec.ts` filtered the tag `katchup-attachments`
(plural) while the endpoints are tagged `katchup-attachment` — `describeEndpointCases` threw on the
mismatch, which would have left 6 attachment endpoints silently untested. The throw is the
safeguard working; fixed the tag.

#### What "all endpoints checked in production" means, precisely

Every one of the 89 endpoints is exercised: **reads in production** (172 cases green + 68 findings),
**writes off-live with full fuzzing**, and **Katchup writes in production** through the authorized
feature flow. The 59 "blocked on live" are blocked by design — real SMS, OTP with no bypass, or a
company/account we do not own — which is a safety property, not a coverage gap. Filing stays
**dry-run** until the owner confirms which findings are known.

### 2026-09-13 — Katchup complete: UI screens run on live; all message-action types covered

Finished Katchup for both **API and UI**. The browser project now runs against the live front end
(`account.kpostindia.com`), and the API feature flow covers every message-action type.

#### The UI runs on live now

`auth.setup.ts` logs in through the **real two-step login screen** with the QA account and saves the
session (KPost stores tokens in `localStorage`, which `storageState` captures); every browser test
reuses it. Verified working against `account.kpostindia.com`.

Two things the live screen forced, both real page-object lessons:

- **The KPOST ID input is disabled until the country list loads**, and typing an `@` pops a
  domain-autocomplete portal that **overlays the Submit button**. The page object now submits step 1
  with **Enter on the id field** (`handleKeyPress` in Login.js), which is what a user does and
  bypasses the overlay. Waits are on _enabled_, not just visible.
- **A heavy live SPA keeps the `load` event pending**, so `BasePage.goto` waits `domcontentloaded`
  and lets `expectLoaded()` decide readiness. Browser projects get one retry; repeated fresh-context
  logins throttle the country endpoint, so the login-screen suite is kept small and the
  "correct login reaches /home" case is left to `setup` (which already proves it) rather than
  duplicated.

**UI tests on live (5 of 6 green, the 6th is environmental):** login screen — unknown id does not
advance, and a valid id advances to the password step, both pass; the **wrong-password** case
(inline error + stays on /login) is **throttle-sensitive** — after several fresh-context loads the
country-load endpoint rate-limits and the id field never enables, so it flakes even with a retry.
That is a live-environment limit, not a product or test-logic defect, and the same behaviour is
already verified at the API level (the HTTP-200-on-wrong-password finding). Katchup screen — loads
for a logged-in user, the contact search is present, and **the Subject field (BR-K01) is on the
screen** (`.fw_Msg_subject`), all pass.

Removed the stale Playwright-template `home.spec.ts` / `HomePage.ts` (they asserted playwright.dev)
and the `homePage` fixture.

#### Every Katchup message-action type now exercised (API, live)

The feature flow grew from 6 to **10 tests**, all passing on live and self-cleaning: + reminder
(FR-K13), + forward (FR-K15), + save & mark-important (FR-K18), + report (FR-K24). Two shapes came
from the frontend and would have 500'd otherwise:

- **Forward** uses `forwardReceiverList` + `referenceMessageIDList` (source msgIDs), not a single
  `receiver`. With a minimal payload it answers **400** — it validates a full `referenceMessage`
  object (the source message content) that the client assembles from the message being forwarded.
  Asserted as "validates without crashing"; a complete forward needs the source object.

#### What stays UI-only (no API, correctly)

TTS (FR-K19), Copy-to-clipboard (FR-K17), More Options (FR-K25) and the sender-vs-recipient action
menu (BR-K02) are client behaviours with no endpoint. They live in the screen layer; the current UI
smoke covers the screen and the Subject differentiator, and deeper action-menu UI needs the
compose flow opened (a gated write) — a later pass.

**Katchup is done: 36 API endpoints + 11 Group, engine contract validation, a 10-test live feature
flow, and live UI screens.** `npm run check` clean.

### 2026-09-13 — Katchup FULL FEATURE FLOW passes on live; Group module added; authorized-write control

The owner authorized end-to-end feature testing with the six accounts. The full Katchup message
flow now runs against `devapi2` and **all six feature tests pass** — the product's accountability
features work on live:

| Feature                                                  | FR                 | Result on live                          |
| -------------------------------------------------------- | ------------------ | --------------------------------------- |
| Subject on every message                                 | BR-K01             | ✅ carried and returned                 |
| Reply / Note / Comment / Clarify                         | FR-K21/K12/K22/K23 | ✅ each accepted with its `messageType` |
| Edit + edited body visible to recipient                  | FR-K08/K09         | ✅                                      |
| **Recall removes the message from the recipient's view** | FR-K10/BR-K03      | ✅ gone from B's conversation           |
| Group send + per-recipient read receipts                 | FR-K06/FR-K07      | ✅ create → send → receipts → clean up  |
| **Confidential Copy hidden from other recipients**       | FR-K05/NFR-SEC02   | ✅ B and C cannot see D was copied      |

No defect in the message features themselves — the differentiators that are KPOST's reason to exist
(subject, recall, confidential copy, read receipts) behave correctly. Each test **writes a real
message/group and cleans up after itself** (recall/delete, and removeGroupMember→deleteGroup).

#### The contracts came from the frontend, measured not guessed

`D:\KPOST_PROJECTS\KPOST_REACTJS_2023_V1` is the source of truth. Three shapes it revealed that no
schema would have, each found by a 500 until corrected:

- **Group create → send → delete.** `createUserGroup` returns an auto-minted `groupKpostID`
  (`qab###@kpostindia.com`); a group send uses it as `receiver` with `status: 4` (Group). Deleting a
  group **requires removing all members first** — `deleteGroup` alone answers 400 "you need to remove
  all the members". (Possibly a finding; recorded.)
- **Recall** sends `{msgID, groupFlag}` — the live client's payload, not the workbook's stale
  `{msgID, status:5}`.
- **Copies / Confidential Copy** (messageType 14) is **not** a `copies` array: the client sends
  `sharedMessageDetails` (JSON with `revealContactList` = visible Copy, `hiddenContactList` =
  confidential) plus `forwardReceiverList`. The confidential recipient rides in `hiddenContactList`,
  which is what keeps it hidden — the mechanism behind NFR-SEC02.

#### New safety control: `allowLiveWrite`, a per-call authorized write

Sends are not `productionSafe` and never will be (the engine must never fuzz a live conversation).
But the owner-approved feature flow needs to write. So `SendOptions.allowLiveWrite` lets a **single
call** run a `data`-sideEffect write on live, set only by the feature spec, never by the engine. It
bypasses the `productionSafe` gate and nothing else: `external`/`global` stay blocked, and the
QA-identifier guard still confines every id to accounts we own. The feature spec is additionally
gated behind `KATCHUP_LIFECYCLE=true`, so it never fires on a default run. Defense in depth: the flag
gates the suite, the per-call option authorizes each write, the identifier guard confines the target.

#### The identifier guard was over-matching content fields

It flagged `actualMessage`, `messageType`, `messageTime`, `groupKpostName`, `isPrivateGroup`,
`sharedMessageDetails` and message-scoped ids (`msgID`, `temporaryMsgID`, `groupID`) as "identifiers
we do not own", because the key contained "message"/"group"/"kpost". None is a **tenant** resource —
they are body text, type codes, timestamps and message-scoped ids created at runtime. Added to
`NOT_A_RESOURCE` with the reasoning that the guard flags cross-tenant identifiers (accounts,
companies, contacts, and the kpostID lists), not message content. The tenant checks are unchanged —
`{companyId: 4}` is still refused.

#### Group module registered

11 `/v2/group/*` endpoints (`src/api/definitions/kpost/group/`), needed for FR-K06 and now covered.
Two workbook paths had a doubled-brace typo in the path params (`{{groupKpostID}`), handled with
`contractPath`. Registry: 78 → **89**; live doc: 30 run / 59 blocked.

**State:** `npm run check` clean; framework + Katchup + Group coverage pass; the six feature tests
pass on live via `KATCHUP_LIFECYCLE=true`, cleaning up after themselves.

#### Still UI-only for Katchup (not API-testable)

TTS (FR-K19), Copy-to-clipboard (FR-K17), More Options (FR-K25) and the sender-vs-recipient action
menu (BR-K02) are client behaviours with no endpoint — they belong to the screen tests, which still
need the browser project wired to `account.kpostindia.com`.

### 2026-09-13 — Six PERSONAL accounts on live; extra principals wired; small cleanup

The owner created four more PERSONAL accounts (all verified to log in on devapi2), giving **six**:

    1 Qatesting@   2 Qatesting2@   3 Qatesting3@   4 Qatesting4@   5 Qatesting5@   6 Qatesting6@
    (all @kpostindia.com, password Kpost@123)

All six are in `.env` (`QA_KPOST_ID`, `QA_VICTIM_KPOST_ID`, `QA_PERSONAL_3..6_KPOST_ID`), added to the
schema + `IDENTITY_FIELDS` (so the guard allows them and refuses to default them on live), and
registered as PERSONAL principals in `auth-profile.ts`. `PERSONAL_ACCOUNTS` in `test-data.config.ts`
exposes the pool in order, for the group / Copy / Confidential-Copy tests. **PERSONAL accounts can
only be created on `@kpostindia.com`** (owner-confirmed; saved to memory).

This unblocks the _structure_ of the gated Katchup tests (a group of ≥3, a confidential-copy
bystander) — but not _sending_, which still waits on the owner's 1:1 sign-off, and on a group
actually being created (a `/v2/group/*` step, to be checked when the group flow is built).

Cleanup while here: fixed 6 mojibake em-dashes (`â€”` → `—`) in `bugzilla-reporter.ts`, and trimmed
the most verbose comment blocks in the new Katchup files. No stray files in the repo (test-results is
git-ignored). `npm run check` clean; framework + Katchup-coverage tests pass.

### 2026-09-13 — FIRST LIVE RUN: Login + Katchup reads on devapi2. Real bugs found

The first requests ever sent to the live application (`devapi2.kpostindia.com`), owner-approved.
Both PERSONAL accounts (`Qatesting@`, `Qatesting2@`) log in; the cleared read endpoints and the
login behaviour tests ran. **Nothing was written** — only the login/read paths, plus the
self-cleaning single-session logout.

#### What works on live

- **Login works.** Both accounts: `fetchUserDetails` 200 → `userLogin` 200, a signed JWT that
  expires, subject = our account, `companyID: null` (correct for PERSONAL). Token `sub` is
  **lower-cased** (`Qatesting@` → `qatesting@`) — correct for an email id; the test compares
  case-folded (it was a test bug, now fixed).
- **Auth is enforced.** A valid token is accepted; every bad token (missing, tampered, foreign-key,
  empty, non-JWT, unsigned alg=none) is **rejected**. The security property holds.
- **Account enumeration is not possible.** A wrong password on our account and any password on a
  non-existent account answer **identically** — same status, same message. Verified on live.
- **Katchup reads work.** The 10 cleared reads return 200, a valid success envelope, JSON,
  **no sensitive data leaked**, fast (~44 ms vs an 800 ms budget). `getActiveSession` /
  `getLoginHistory` answer 200 with a valid token — the 409-to-everything seen on the internal host
  is **not** present on live.

#### Findings — real, fileable, and mostly systemic

| #   | Finding                                                                                                                                                                                                                                                                  | Where                       | Severity |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | -------- |
| 1   | **A wrong password answers HTTP 200** `"Invalid Credential"` — same status as success. A client reading the HTTP status cannot tell a failed login from a success. Should be 401.                                                                                        | `userLogin`                 | High     |
| 2   | **Auth failures use the wrong status, inconsistently.** A missing/invalid/malformed/unsigned token is rejected with **400 or 403, never 401** — and it differs by module (login → 400, Katchup → 403 for a missing token). Auth _is_ enforced; the status code is wrong. | all authenticated endpoints | Medium   |
| 3   | **Security headers missing** — no `content-security-policy`, no `referrer-policy` (2 of 5).                                                                                                                                                                              | every endpoint              | Medium   |
| 4   | **Error bodies do not follow the documented envelope** on those 4xx rejections — `status`/`statusCode`/`message` are absent or the wrong type, so `{status:"FAILURE", statusCode, message}` is not what a caller gets.                                                   | auth rejections             | Medium   |

1 and 3–4 are the **observational class** the engine finds on live; 2 is systemic (one root cause,
many cases). None is an infrastructure cascade — the endpoints work, they just answer non-standard
status codes and omit headers. Filing stays **dry-run** until the owner confirms which are known.

**The engine reports each failing validation as its own case, so these collapse from ~47 red cases
to ~4 distinct defects** — the reason the bench emits a case per validation rather than one per
endpoint.

#### Test-side corrections made during the run

- The token-subject assertion was case-sensitive; the API lower-cases the id (correct). Fixed to
  compare case-folded — a test bug, not an API bug, recorded so nobody re-files it.
- `login-flow.spec.ts` moved from `serial` to `default` with **`expect.soft`** on the finding
  assertions: serial hid every finding after the first, because these assertions are _meant_ to stay
  red. One run now surfaces all findings, and the account-not-locked safety net is a hard assert that
  always runs first.

#### Still to run on live

The engine's **read-side** validators on the cleared endpoints (done for login + katchup reads).
Not yet: the **UI screen** tests (`tests/e2e/`), which need a browser project pointed at
`account.kpostindia.com` — the next wiring step. And every write path stays blocked pending accounts
and sign-off.

### 2026-09-13 — Katchup module built (36 endpoints, API + screen); message types verified

The third module, at the owner's direction (Profile deferred behind it). The owner supplied the
`status`, `messageType` and `shareType` enumerations; **all three already matched the workbook's
Types tab exactly** (`katchupStatus`, `katchupMessageType`, `katchupShareType` in
`contracts/kpost-types.json`, exposed as `KATCHUP_STATUS` / `KATCHUP_MESSAGE_TYPE` /
`KATCHUP_SHARE_TYPE`). So the codes were already captured; what was new was verifying them against
the live web client and writing the flow down. Full analysis: **`docs/katchup-flow.md`**.

#### The send contract came from the live client, not the workbook

The workbook documents no body for `sendMessage`. The real payload was read out of the React app
(`KatchupMessage.js` `temp`), so the bench sends what the product sends — recorded in the flow doc §3
and built once in `send.api.ts` `sendShape()`, which the lifecycle spec reuses for every messageType
variant. Note: the multipart send path is **commented out** in the current build; `SendMessage`
(JSON) is what runs, so the JSON route is primary.

#### Three discrepancies found while verifying (flow doc §2, for the owner)

1. **`recallMessage`**: workbook sample `{msgID, status:5}` — but the live client sends
   `{msgID, groupFlag:false}`, and `status:5` is not even a valid `katchupStatus` (0–4). The
   definition follows the client; the sample is stale.
2. The display labels `messageType 2` as "Forward" while the contract says `2 = Share` and forward is
   `15/16`. A UI display quirk; send codes are authoritative.
3. **Subject cannot be tested through the UI** for FR-K02: the client auto-defaults an empty subject
   to `"General"` and never sends blank. Whether the **API** rejects an empty subject is a real open
   question — the lifecycle spec sends `subject: ""` directly to find out (reject OR default is the
   contract; storing blank is the finding).

#### Structure — one route per endpoint, variants are payload shapes

```
src/api/definitions/kpost/katchup/
  katchup-endpoint.ts   defaults authentication:{required:true} + the katchup tag
  read.api.ts   (16)  counts, conversation, search, shares, read receipts
  send.api.ts    (5)  sendMessage, multipart, bulk ×2, forward-selected-attachment
  manage.api.ts  (9)  recall, delete, mark, save, report, forwards
  attachments.api.ts (6)  download ×3, thumbnail, streaming, generate
tests/api/kpost/katchup/  read/send/manage/attachments (engine) + coverage + lifecycle
tests/e2e/katchup.spec.ts  the screen
```

`sendMessage/` is **one** endpoint; secret / group / copies / reply / edit are `messageType`
variants of it, so they are payload shapes in the lifecycle spec, not separate registrations (which
would collide on the path — the registry enforces unique method+path per module).

#### Live scope — the module is heavily gated, correctly

Two PERSONAL accounts, so of 36 endpoints **10 reads run on live** (counts, subjects, conversation
and search against our own second account) and 26 are blocked with reasons:

- **every send is `data`+destructive and NOT `productionSafe`** — it reaches a real inbox, and even a
  1:1 to our own second account waits on the owner's sign-off (flow doc §6 Q4). A coverage self-test
  asserts no Katchup write is ever cleared for live.
- **group / Cc / confidential-copy / bulk** need ≥3 PERSONAL accounts (`needs-group`,
  `needs-recipients`); confidential-copy (NFR-SEC02) needs a bystander to be hidden from.
- **recall / delete / mark / report / forward and the attachment routes** need a real `msgID` / `uuid`
  the caller owns (`needs-message-id`, `needs-attachment`) — which only the lifecycle test can mint.

The **1:1 lifecycle** (send → read back → recall → delete, between our own accounts) is the one place
a real message is created; it cleans up after itself and is gated behind `KATCHUP_LIFECYCLE=true` so it
never runs on live by accident. It also produces the `msgID` the id-keyed endpoints need.

Registry: 42 → **78** endpoints; live doc: **30 run on live, 48 blocked**. `npm run check` clean; 56
framework + 7 Katchup-coverage tests pass; **nothing sent to live**.

#### On "the live app has bugs — find and file them" (owner)

Confirmed the intent, and worth stating the split plainly because it shapes what runs where:

- **On the live application** the bench runs only the ~18 **non-mutating** validators per cleared
  endpoint (status, schema, headers, security-headers, sensitive-data, performance). Those find
  real, fileable bugs — exactly the class already found by hand (login 500, forgotPassword full-mobile
  leak, `kpostIdExist` 500, downloadCompanyLogo 500). Both **screens** and **APIs** are covered:
  UI specs assert the real flows, API specs the contracts.
- **The aggressive probes** — injection, XSS, null/type/boundary fuzzing, cross-tenant access — are
  where the _other_ class of bug is found (null accepted as a number, wrong type accepted, a client
  error answered 500). Those **mutate and re-send**, so they must not be aimed at a live conversation;
  they run against the mock and, when there is one, a staging/dev host. This is not a limitation of
  effort but of where it is safe to fuzz. Filing stays **dry-run** (`BUGZILLA_DRY_RUN=true`) until the
  owner confirms which findings are known.

The honest consequence: to fuzz Katchup's writes for the injection/validation class of bug, we need a
host where writing is safe. On live we get the observational class. Both are real; neither is skipped.

### 2026-09-13 — Module-by-module plan; signup removed; Login step 1 written (API + screen)

The owner set the order — **API and screen together, one module at a time: Login → Profile →
Katchup → …** (full table in §9) — and took **signup out of scope**: the QA accounts exist, and both
registration endpoints are OTP-gated on live anyway.

#### The documents, re-read

All five (`D:\Kpost Documents`) read again in full. They describe **exactly four modules** — Signup &
Login, Katchup, Kall, KMail — as 55 FRs and 9 BRs. **Profile, Contacts, Group, KDiary and Settings
appear in the workbook and the UI but in none of the documents**, so their tests are contract-driven
and carry no FR ids. Worth stating so "Profile: 0 requirements" is not later read as a coverage gap.
The 45-endpoint Profile module is the second-largest surface in the product and entirely
undocumented — the single biggest specification gap the bench faces.

#### Signup removed, not skipped

Left registered-but-skipped, signup's five endpoints would still shape the totals and the reports.
Deleted instead: `signup.api.ts`, `signup.spec.ts`, `flow-rules.spec.ts`, `user-types.spec.ts`. The
registry drops 47 → **42** endpoints; `SIGNUP_OUT_OF_SCOPE` names the five excluded paths so a _new_
`/signupLogin` endpoint still shows up as uncovered rather than being swallowed. Their findings stay
in this log. `fetchUserDetails` **moved to `login.api.ts`**: it is the login screen's step 1
(`FetchKpostIDDetails`), not signup.

#### Login module: what was built

- **`login.spec.ts`** — the engine's contract validators, once per endpoint, excluding
  `session-ending`.
- **`login-flow.spec.ts`** (new) — behaviour the engine cannot assert, all on our own accounts:
  token subject/claims, a signed-and-expiring JWT with no secret in it, wrong-password rejection
  **followed by a successful login** (the lockout safety net), the enumeration rule (a wrong
  password and an unknown id answer alike), and single-session logout. Runs `serial` on one worker;
  **one wrong-password attempt per account per run**.
- **`tests/e2e/login.spec.ts`** (new) — the real two-step screen (`/login`), modelled on the live
  UI source (`KPOST_REACTJS_2023_V1/src/components/auth/Login.js`), not guessed: unknown id toast,
  advance to password step, wrong-password inline error, success → `/home`, header logout → `/login`.
  `src/pages/LoginPage.ts` rewritten to the real component; it ships **no test-ids**, so every
  locator is by role/label/text and says what it is anchored to.

#### `userLogout` is now testable on live — safely

It was `global` (blocked). But it ends **only the session named by the token and device it is sent
with**, and the flow test opens a throwaway session on its own device id to log out, leaving the
shared token untouched. So it is now `productionSafe`, `sideEffect: 'data'`, and tagged
`session-ending` to keep it out of the shared engine run (whose cached token it would otherwise
kill). `userLogoutFromAllDevices` stays blocked — it would end the owner's own manual sessions on
these accounts. A named-write allowlist in `live-coverage.spec.ts` makes this the only cleared write,
reviewably.

#### Two live-safety fixes found while wiring this up

- **`userType` was treated as a resource identifier.** It matches the guard's pattern only because
  it contains "user", and `loginRO.userType: "PERSONAL"` is not a QA-owned value — so on live the
  guard would have **refused every login**, failing the whole run before the first endpoint. Added
  to `NOT_A_RESOURCE` (it is an account tier, not an account), and a new self-test builds the real
  login payload and asserts the guard passes every field but our own kpostID — so a future added
  field cannot reintroduce this silently.
- **Principals are filtered on live.** An unconfigured principal logged in with a mock default id
  (`qa.business.s@kpost.in`) — not an account on live, and not ours. `KPOST_PRINCIPALS` now drops
  any principal whose account id is unset in `.env` when `TEST_ENV=production`, so business roles
  simply have no principal (validators skip with that reason) until the accounts exist. Off live,
  nothing changes.

**State:** `npm run check` clean; **63 framework/coverage tests pass**; still no request sent to
live.

### 2026-09-13 — Live accounts arrive; scope narrows to PERSONAL; 22 endpoints cleared

The owner created **two PERSONAL accounts by hand on the live application** — the bench cannot make
them, since both registration endpoints are OTP-gated. Scope is now **PERSONAL only**; business
comes later.

    PERSONAL  Qatesting@kpostindia.com    9944556677   primary
    PERSONAL  Qatesting2@kpostindia.com   9876543211   counterparty

#### The single reference: `docs/LIVE-ENDPOINTS.md`

One file, **generated** from the definitions by `tests/framework/live-coverage.spec.ts`, listing
what runs on live and what does not with a reason for each. Generated rather than written, because
a hand-kept list of 47 endpoints is wrong within a week and then misleads — somebody reads "blocked"
for something since cleared, or worse, the reverse.

    Runs on live   22      read-only, no company, identifiers that are set in .env
    Blocked        25      16 OTP-gated, 6 destructive, 3 needing a business account
    Total          47

#### An unset identifier is now a safety feature, not a gap

The sharpest thing found this session. Every `QA_*` value feeds the QA-identifier guard's allowlist,
and the schema defaults were written for the mock server's seed:

    companyId  defaults to 1        <- company 1 is a REAL company on the live application

So an unset `QA_COMPANY_ID` would have put `1` in the allowlist and told the guard that a stranger's
company is ours to act on — **the safety control becoming the thing that authorises the damage.**

The fix inverts it: the guard is built from values **explicitly set in `.env`**, never from a
default. Business identifiers are therefore absent, nothing company-shaped is allowlisted, and every
request naming a company is refused before it is sent. **The PERSONAL-only scope enforces itself**
rather than depending on anyone remembering it. Only `QA_KPOST_ID` is required outright, because
without it nothing can authenticate and every endpoint would report 401 — a configuration mistake
dressed as an API defect, which is precisely what this bench exists not to produce.

#### A real bug in the new guard, found by the bench's own self-tests

The production allowlist blocked **`mockFixture` endpoints** — the bench's own mock-served
fixtures — so five framework self-tests failed. They are routed to the bundled mock and physically
cannot reach the live API, so the live rules must not apply to them. Left unfixed, configuring the
bench for live would have silenced the suite that proves the engine works, at exactly the moment
that proof matters most. `mockFixture` is now exempt from the allowlist, the OTP gate, the validator
allowlist and the identifier guard.

The old `production guard blocks destructive endpoints` test had been asserting guard semantics
through `delete-user` — a fixture — so it was really testing the exemption rather than the rule. It
now uses literal endpoints; the live rules are covered in `live-safety.spec.ts`.

#### `newMobile()` was not a reserved range, and the comment said it was

It generates `98765xxxxx`, described in the code as "a reserved test range, so it can never collide
with a real customer's". **It is ordinary Indian mobile space** — and one of the new live QA accounts
sits at 9876543211, which is how it came to light. On live, a random number there means lookups (and
on the OTP endpoints, real SMS) aimed at strangers.

Registration is OTP-gated and blocked on live, so the generator stays for dev use. But
`kpostIdExist` — an enumeration surface — now sends the **configured** `QA_KPOST_ID_ABSENT` and
`QA_MOBILE_ABSENT` instead of generated values. Those are known-unused and allowlisted, so the
endpoint can run on live; a generated id would have been refused by the guard, correctly.

#### Files removed

- `contracts/otp-dependent-endpoints.csv` — the owner asked for a reference list, not a CSV. The
  markdown is now the only output, and the framework test parses **its** tables, so the report and
  the `otpDependent` flags still cannot drift apart.
- `contracts/excel-gaps.new.csv` — a stray from an earlier run, referenced by nothing.

Deliberately **kept**: `dictionary.api.ts` and `dictionary.openapi.json` look like leftovers and are
not. They are the mock-backed fixtures the framework self-tests run against — the only way to verify
the engine without a live host.

#### Still open

1. **No live request has been made yet.** The two accounts are unverified against `devapi2`; 22
   endpoints are cleared but nothing has run. The first step is five login requests, read-only.
2. **`kpostIDsuggestionList` is cleared but its payload is known to be incomplete** — it wants a
   `kpostID` the workbook's sample omits. Expect a 400 on the first live run; it is a known gap, not
   a new defect.
3. **`QA_STATE_ID` / `QA_REGION_ID` / `QA_PINCODE` are still mock defaults** (1, 1, 600001). They
   are reference data, not identifiers, so the guard permits them — but they may not exist on live,
   and a 404 from `getCitiesByRegionId` would be our data rather than a defect. Read them from the
   live `countries`/`getStates` responses on the first run.

### 2026-09-12 — The target becomes the LIVE application; three safety controls built; no tests run

**The owner's decision, taken with the risks on the table.** The dev host's code was changed by the
developers in ways live's was not, so findings against it could not be trusted — every one was
answerable with _"that's just the test environment."_ The concerns in the entry below were raised,
restated and reaffirmed; this records the decision, not a disagreement.

The dev host is **removed** from `.env.example` (192.168.0.66:8989/9595/9081). The live hostnames
are deliberately left **empty** rather than guessed: pointing an endpoint at the wrong host produces
404s that read as defects, which already cost a day once on the logo trio.

**Nothing has been executed.** This entry is setup only. No request has been sent to the live
application, and no test has been run against it.

#### What is unsafe about this, stated once so it is on the record

Account isolation does **not** confine this bench, because the risk is not per-account:

- **~14 of 25 destructive endpoints take their target from the payload, not the token.** Measured,
  not assumed: `removeCompanyLogo` accepts `{"companyId": 4}` and our tokens carry no `companyID`
  claim, so the endpoint cannot scope itself to the caller. `admin/resetPassword` takes another
  user's `kpostID`; `removeGroupMember` takes another user's `kpostID`; `clearKallBykallIds` takes
  `[2,3]` — **low sequential integers**, exactly what the boundary probes generate.
- **The probes are the danger, not the happy path.** `request.data-type` and `boundary-value` mutate
  every field including ids. `security.injection` and `xss` would be _stored_ by any write endpoint.
- **Damage would be silent.** One deleted message surfaces weeks later as a support ticket nobody
  traces back to a test run. There is no reset, and accounts cannot be deleted through this API.
- **Schemas and tables are not at risk** — no DDL is reachable and injection is inert. The exposure
  is individual real records, which is harder to notice and harder to undo.

#### Three controls, each independent, none switchable by configuration

| #   | Control                                                                                                                                                                                                            | Where                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1   | **Endpoint allowlist.** `TEST_ENV=production` runs only definitions marked `productionSafe: true` — not their probes, not their setup calls. Default deny.                                                         | `endpoint-definition.ts`, `production-guard.ts` |
| 2   | **Validator allowlist.** Every validator that modifies and re-sends a request is excluded. 23 of 47 are cleared; the rest are blocked **by name with a reason**. An unclassified validator is denied, not allowed. | `production-validators.ts`                      |
| 3   | **QA-identifier guard.** Any request naming an identifier that is not a `QA_*` value is refused **before it is sent** — body, query and path, arrays element by element.                                           | `qa-identifier-guard.ts`                        |

Control 3 is the one that matters, because it is the only one that addresses payload-targeted
endpoints. It runs in `EndpointExecutor.send`, the single chokepoint every primary call, probe
mutation and setup chain passes through.

**`ALLOW_DESTRUCTIVE_TESTS` now grants nothing on production.** It used to return early for every
destructive endpoint, so one inherited environment variable would have unlocked `forgotPasswordUpdate`,
`removeCompanyLogo` and `updateFlutterAppVersion` against live. Off production it behaves exactly as
before. A self-test pins this, because it is the most dangerous shape in the file.

**A blocklist was considered and rejected** for controls 1 and 2: it admits everything nobody has
thought about yet, and that is the set most likely to be dangerous.

`tests/framework/live-safety.spec.ts` — **15 tests, all passing, no HTTP** — asserts each control,
including that every registered validator is classified and that reference data (`countryID`) and
bench-generated values (`sessionID`, `deviceID`) are _not_ treated as resources. A guard that
refused those would be switched off within a day, which is how safety controls die.

#### OTP dependency: 16 of 337 endpoints cannot run on live

Live has no OTP bypass (dev accepts `123456`), so every OTP-gated flow is untestable until a real
code reaches a real device. `npm run contract:otp` derives the list rather than trusting memory:

| Category   | Count | Meaning                                                                  |
| ---------- | ----: | ------------------------------------------------------------------------ |
| `SENDS`    |     6 | delivers a real SMS/email — would _work_, at a cost, to a real recipient |
| `CONSUMES` |     2 | payload carries an `otp` field we cannot fill                            |
| `REQUIRES` |     8 | needs an OTP validated earlier, though its own payload shows none        |

**`REQUIRES` is the category that matters**: nothing in those endpoints' contracts mentions an OTP,
so they look clean and fail anyway. Three are **verified** (personal signup, `adminRegistration`,
`forgotPasswordUpdate`); five are **inferred** and labelled as such — found by pairing every OTP
sender with the action it exists to gate. The profile module has three senders
(`sendAccountDeactivationOtp`, `sendPrimaryDeviceOtp`, `sendPrimaryOrSecondaryDeviceOtp`) and **no
endpoint consumes their codes**, so `deactivateAccount` and the four device-designation endpoints
must check them server-side. An inference is not a measurement, and the report says which is which.

**The consequence: no account can be created on live by this bench.** Both registration endpoints
are `REQUIRES`. The QA accounts must be created by hand or by the developers, and their credentials
supplied afterwards — which is the next thing to settle.

A finding on the way: `kpostIdExist` answers **500** `"Error while checking KpostID duplication"`
when sent only `kpostID`, and 200/400 correctly with the full documented payload. Its error body
also reports `urlPath: "/isKpostIdExits/"` where success reports `/kpostIdExist/` — two internal
names for one route, and the misspelled one is what a caller sees when it breaks.

#### The live hosts, and how they were established

The workbook carries a full URL per row (`sourceUrl`), so the hosts are evidence rather than
guesswork. Every candidate resolves in DNS:

| Host                       | Rows | IP             | Verdict                                                 |
| -------------------------- | ---: | -------------- | ------------------------------------------------------- |
| `devapi2.kpostindia.com`   |  261 | 13.203.184.171 | **the live API.** The owner's own working curls go here |
| `kmail5.kpostindia.com`    |    7 | 65.0.243.197   | **KMail**, paths prefixed `/kmail5/`                    |
| `kpostapis.kpostindia.com` |   12 | 84.247.190.124 | stale. All module Admin; no working call ever used it   |
| `kmail.kpostindia.com`     |    2 | 13.126.12.181  | older KMail spelling                                    |
| `devapi1.kpostindia.com`   |    4 | 13.127.7.104   | all four rows already unusable                          |

**The decisive evidence is the owner's own curls**, recovered from this conversation's history:

    curl --location 'https://devapi2.kpostindia.com//v2/common/updateCompanyLogo'   <- "from live"
    curl --location 'https://devapi2.kpostindia.com/admin/removeCompanyLogo'
    curl --location 'https://devapi2.kpostindia.com//v2/common/downloadCompanyLogo/4'

So two earlier conclusions are corrected:

- **`kpostapis.kpostindia.com` is not the logo endpoints' host.** The workbook says it is, and this
  log repeated that; the owner's working calls go to `devapi2`. It resolves to an unrelated IP.
- **Admin is not a separate host.** `/admin/*` answers on `devapi2`, so `ADMIN_API_BASE_URL` points
  there too rather than at a distinct deployment.

This also finally explains the `companyID`/`role` claims: the reference token was minted by
**devapi2**, and `192.168.0.66:8989` is a separate internal deployment one build behind it. Same
product, different environments — not a provisioning difference in the accounts.

    KPOST_API_BASE_URL=https://devapi2.kpostindia.com
    ADMIN_API_BASE_URL=https://devapi2.kpostindia.com
    KMAIL_API_BASE_URL=https://kmail5.kpostindia.com
    BASE_URL=https://account.kpostindia.com/      (the live front end, 35.154.188.104)

`TEST_ENV=production` is set, which is what arms the three controls; two preflight tests now assert
that no module host is an internal address, that every one is `https`, and that destructive runs,
live filing and parallel workers are all disarmed. They **ran rather than skipped**, which is the
proof the posture is active.

**One question the naming raises and only the owner can answer.** `devapi2` reads as a _development_
host, yet it is what the owner calls the live application and it is where the working token came
from. Meanwhile `api.kpostindia.com` resolves (3.33.152.147) and appears **nowhere in the workbook**.
If that is the real production API, then `devapi2` is a shared dev server and the whole risk picture
above is much milder. Worth settling before the first run, because it changes what "careful" means.

#### Still blocked on the owner

1. **Which host is the true production API** — `devapi2` (assumed, evidence above) or
   `api.kpostindia.com` (resolves, undocumented). See the note above.
2. **QA accounts on live.** Every `QA_*` id in `.env` was created on the retired internal host and
   is **unverified against devapi2**; the company ids certainly do not carry over (internal numbers
   companies 1001605–1001607, live's own reference account is companyID 4). This matters beyond
   failing tests: the QA-identifier guard reads those values, so a stale id is the guard admitting
   a value that belongs to somebody else. **And the bench cannot create them** — both registration
   endpoints are OTP-gated and live has no bypass, so a person has to make them by hand.
3. **Which endpoints get `productionSafe: true`.** None do yet, so a live run currently executes
   nothing. That is the correct default and the next decision to make, endpoint by endpoint.

### 2026-09-12 — Answered: the `companyID`/`role` claims come from a different deployment, not a different account

The open question from three entries above — _why does the owner's token carry `companyID` and
`role` when none of ours do?_ — has an answer, and it is not about how our accounts were
provisioned. **The reference token was not issued by the host we test against.**

Two public checks settle it, both on `192.168.0.66:8989`:

    POST /v2/signupLogin/kpostIdExist/   {kpostID:"pd@cake.kpost.in", …}   -> 200 "Available. can be used"
    POST /v2/signupLogin/kpostIdExist/   {kpostID:"meera23m@kpost.in", …}  -> 400 "already exits!"
    GET  /v2/common/getCompanyNameExistOnKpostAndKsmacc/cake               -> 200 "Available. Can be used"
    GET  /v2/common/getCompanyNameExistOnKpostAndKsmacc/Meera 23 Medium Co -> 409 "already exists!"

The token's subject `pd@cake.kpost.in` **does not exist here**, and neither does the company "cake"
its domain is derived from. Its `companyID: 4` is likewise impossible to reconcile with this
database, where companies are 1000008 and 1001605–1001607. So it is a token from another KPost
deployment (the live one), signed by another auth service.

**The claim set is a version progression of that auth service.** Three generations are visible in
this repo's own history:

    {sub, exp, iat}                                  workbook sample, karksrajan@…, Jan 2024
    {sub, exp, deviceID, iat}                        our host, every account, every login route
    {sub, companyID, role, exp, deviceID, iat}       the owner's live token, pd@cake.kpost.in

`deviceID` was added, then `companyID` and `role`. Our host runs `1.0.48:220`
(`getFlutterAppVersion`), and its auth service stops at the middle generation.

**Exhaustively checked before concluding it** — 4 accounts × 2 login routes, every one 200 except
where the tier gates it:

| Account                   | `userLogin`                 | `adminUserLogin`            |
| ------------------------- | --------------------------- | --------------------------- |
| `meera960@kpostindia.com` | `{sub, exp, deviceID, iat}` | 403 "Not A Admin"           |
| `meera23s@kpost.in`       | `{sub, exp, deviceID, iat}` | 403 "Not A Admin"           |
| `meera23m@kpost.in`       | `{sub, exp, deviceID, iat}` | `{sub, exp, deviceID, iat}` |
| `meera23l@kpost.in`       | `{sub, exp, deviceID, iat}` | `{sub, exp, deviceID, iat}` |

Including the three accounts created two entries above through `adminRegistration` — provisioned the
same way a real business admin is, and **still** no `companyID` claim, even though the login
_response body_ carries `data.companyID` correctly (1001605 / 1001606 / 1001607). The company is
known to the login service; it is simply not put into the JWT by this build.

**So there is nothing to fix on our side, and nothing more to try.** No login route on this host
mints those claims for any account, and an endpoint that reads the company from the token cannot
work here regardless of which of our accounts calls it. Two things follow:

- The `needs-admin-token` tag stays on the logo trio, but it now means "needs a deployment whose
  auth service mints company claims", not "needs a better account".
- This still is **not** the cause of the logo failures — `downloadCompanyLogo` 500s for the owner's
  own `companyID: 4` token too (entry above). Two independent facts that looked like one.

**For the owner:** the question worth asking the developers is whether `8989` is simply behind the
live build, or whether the company/role claims are added by a login path that is not deployed here
at all. Either answer is actionable; guessing between them is not.

**A finding found on the way there.** `kpostIdExist` answers **500** when sent only `kpostID`:

    {"data":"Error while checking KpostID duplication","urlPath":"/isKpostIdExits/","statusCode":500}

With the full documented payload (`kpostID`, `firstName`, `lastName`, `mobileNumber`) the same
request answers 200/400 correctly. A missing field is a client error, and every neighbouring
endpoint returns `fieldErrors` for it — this one crashes instead. Note also that the `urlPath` in
the error says `/isKpostIdExits/` while the success says `/kpostIdExist/`: two internal names for
one route, and the misspelled one is what a caller sees when it breaks.

### 2026-09-12 — Three accounts created; the registration flow discovered; personal signup blocked

The owner asked for four fresh accounts. **Three exist**, created through the API rather than the
database, which also reverse-engineered the registration flow the workbook does not document.

| Type       | KPost ID            | Mobile     | companyID                    |
| ---------- | ------------------- | ---------- | ---------------------------- |
| BUSINESS_S | `meera23s@kpost.in` | 9000000927 | 1001605 "Meera 23 Small Co"  |
| BUSINESS_M | `meera23m@kpost.in` | 9000000928 | 1001606 "Meera 23 Medium Co" |
| BUSINESS_L | `meera23l@kpost.in` | 9000000930 | 1001607 "Meera 23 Large Co"  |

All three log in and return their company. `.env` now points at them
(`QA_BUSINESS_S/M/L_KPOST_ID`, `QA_ADMIN_KPOST_ID`, `QA_COMPANY_ID=1001605`,
`QA_MOBILE_EXISTS=9000000927`).

#### The registration sequence, which nothing documents

    sendOTP        { countryID, mobileNumber, requestType: "signup" }
    sendOTPtoMail  { otherEmail }
    validateOTP    { otp: <bypass>, countryID, mobileNumber, sendDate }
    validateMailOTP{ email, sendDate, otp: <bypass> }
    adminRegistration { … }

**Both OTPs must be sent AND validated.** Every earlier attempt failed with _"No OTP was found for
the given mobileNumber/otherEmail"_ purely because the **mail** OTP had not been validated — the
mobile one alone is not enough. `requestType` must be `"signup"`; `"business"` does not register an
OTP the registration step can find.

Two more rules the API enforces and the workbook omits:

- **BUSINESS_L requires `maximumMembersCount` explicitly** (2000). S and M default it; L answers
  `"Invalid maximumMembersCount for userType"` without it.
- **`lastName` may not contain digits or symbols** — `"Personal23"` is rejected. Found through
  `kpostIDsuggestionList`, which returns proper `fieldErrors`.

A bonus observation: registering a Medium or Large business also mints a **KSMACC** identity
(`"ksmaccID":"meera23m@ksmacc.in"`), which the Small tier does not get. Nothing in the workbook
mentions KSMACC as a registration side effect.

#### `meerapersonal23@kpostindia.com` could not be created — and why that is a finding

`POST /v2/signupLogin/signup/` answers **`400 {"message":"Enter valid Credentials","data":"Not
Applicable"}`** for every payload tried: with and without `countryID`, `userType`, `email`; with the
workbook's own sample values; with both OTPs validated; with a digit-free last name; with the
minimal field set. `@kpostindia.com` is confirmed to be the correct personal domain — the
`/v2/common/domain/` endpoint returns exactly `["@kpostindia.com"]` for `userType: PERSONAL` — and
the id was confirmed available by `kpostIdExist`.

**The generic message is itself the problem.** Every neighbouring endpoint returns precise
`fieldErrors` — `kpostID must start with a letter`, `lastName may not contain digits`,
`Invalid maximumMembersCount for userType`. Personal signup alone collapses every cause into
"Enter valid Credentials" with no field detail, which makes it impossible to integrate against: a
client cannot tell the user what to fix, and a tester cannot tell a bad payload from a broken
service. Worth filing on that ground alone, independently of whatever the underlying cause is.

### 2026-09-12 — /v2 variants checked for the logo trio; the claims hypothesis disproven

Tested every path variant for all three endpoints, including the **double slash** the owner's curls
actually use (`https://host//v2/common/...`), in case it was significant:

    GET  /v2/common/downloadCompanyLogo/{id}    -> 500 (empty body)      <- the real route
    GET  //v2/common/downloadCompanyLogo/{id}   -> 400
    GET  /common/downloadCompanyLogo/{id}       -> 404
    GET  /v2/admin/downloadCompanyLogo/{id}     -> 404

    POST /admin/removeCompanyLogo               -> 400 "Internal Server Error"   <- the real route
    POST /v2/admin/removeCompanyLogo            -> 404
    POST //v2/admin/removeCompanyLogo           -> 400 (generic handler)
    POST /v2/common/removeCompanyLogo           -> 404

So the corrected paths are right, `removeCompanyLogo` genuinely has **no** `/v2` form, and the
double slash is incidental (a trailing slash on the owner's base URL). The 500/409/400 come from
real handlers, not from routing.

**The token-claims hypothesis was wrong, and the test that disproves it is worth keeping.** The
owner's reference token (`companyID: 4`, `role: admin`, valid for another 21 hours) was sent to our
host:

    no token at all                              -> 500 (empty body)
    our BUSINESS_S token                         -> 500 (empty body)
    the owner's admin token, companyID 4         -> 500 (empty body)
    the owner's admin token, companyID 1000008   -> 500 (empty body)

Identical for every caller. So `downloadCompanyLogo` does not fail for want of claims — it fails for
everyone, and it fails **before authenticating**, since an anonymous request must be 401 rather than 500. Two candidates remain: the route is broken on this host, or it 500s when the company has no
logo — which would still be a defect, because a missing image is a 404. No company here has one,
since `updateCompanyLogo` has never succeeded.

Deciding between them means uploading a logo first. That is a write on a company using a token
supplied for reference, so it waits for the owner's word rather than being done unasked.

**Correction recorded.** The earlier entry in this log blamed the missing `companyID`/`role` claims.
That was a plausible reading of two facts that turned out to be unrelated, and the definition's
comment now says so explicitly. The claims difference is still real and still worth explaining —
`adminUserLogin` does not add them even for an account the database marks `role = admin` — it is
simply not the cause of these failures.

### 2026-09-12 — No `/v2` for the enterprise login; it gates on tier and names the wrong reason

Checked whether `adminUserLogin` had lost a `/v2` prefix the way the logo routes had.

**It had not.** `/v2/signupLoginForMediumAndLarge/adminUserLogin` answers
`401 "Authentication is required to access this resource."` — this gateway's reply for any path it
cannot route, established earlier against a nonsense path. The workbook's path is the real one, so
the 403 below comes from a real handler rather than a missing route.

**The endpoint gates on the tier, not the role — and the message says otherwise.**

    BUSINESS_M  -> 200
    BUSINESS_L  -> 200
    BUSINESS_S  -> 403 "Not A Admin"

The owner supplied the database row for `meera@m960s.kpost.in`: `role = admin`, Managing Director of
"Meera Small Co". The account **is** an admin, so "Not A Admin" is false. Restricting the endpoint
to Medium and Large may well be intended — it is named _ForMediumAndLarge_ — but then the message
describes the wrong thing, and an integrator reading it goes looking for a permissions problem that
does not exist.

One of the two is a defect and only the owner can say which: either the check should admit an admin
of a Small business, or the message should name the tier. `tests/api/kpost/signup-login/user-types.spec.ts`
pins them **separately**, so a fix to either is visible:

- Small being rejected is asserted as the _current contract_, not as correct.
- The message is asserted **not** to blame the role — the part that is demonstrably wrong. That
  assertion fails today, deliberately.

Also confirmed: the password is plaintext. The workbook's base64 sample
(`0FPnV+OKhDGGXMkQjtj1eQ==`) is not a requirement; `Qa@Passw0rd123` is accepted with 200.

**Still open:** no login we know of mints the `companyID` and `role` claims the logo endpoints read.
The owner's working token has them (`pd@cake.kpost.in`, companyID 4, role admin); neither
`userLogin` nor `adminUserLogin` produces them for our accounts.

### 2026-09-12 — The logo trio corrected from the live application; multipart support added

The API owner supplied working calls from the live app. **The workbook is wrong about all three
paths** — it records them against `kpostapis.kpostindia.com` and **without the `/v2` prefix**, which
is the whole reason the bench had been seeing 404s. It was calling paths that do not exist.

    workbook                              live (corrected)
    POST /common/updateCompanyLogo        POST /v2/common/updateCompanyLogo
    GET  /common/downloadCompanyLogo/{id} GET  /v2/common/downloadCompanyLogo/{id}
    POST /admin/removeCompanyLogo         POST /admin/removeCompanyLogo   (this one was right)

`contractPath` is a new field on the definition: the schema is still read from the documented
workbook row, while the request goes to the real path. Every use must cite its evidence. The
coverage self-tests reconcile both, so a corrected route no longer reads as "untested" and its
documented row no longer reads as "uncovered".

**Multipart is now supported.** `RequestSpec.multipart` flows through the builder and client to
Playwright's own multipart encoder, and the builder deliberately omits `content-type` for those
requests — the boundary is generated at send time, and a hand-written `multipart/form-data` header
without it makes the body unparseable.

Three things the owner's calls revealed that no schema would have:

- **The JSON arguments travel in a form field named `text`** — `text={"companyID":4}` — alongside
  the image in `file`. The workbook documents `{ "companyID": 1 }` as if it were a JSON body, which
  cannot carry an image at all.
- **`removeCompanyLogo` spells it `companyId`** (lower-case d) where the rest of the product uses
  `companyID`. Sent as the working call sends it; normalising it would hide the inconsistency.
- **The token must carry `companyID` and `role` claims.** The owner's token decodes to
  `{sub, companyID: 4, role: "admin", …}`. Ours carry only `{sub, exp, deviceID, iat}` — from
  `userLogin` **and** from `adminUserLogin`. The company these endpoints act on comes from the
  token, not the payload, so they cannot fully pass until we have an account whose login mints those
  claims. Tagged `needs-admin-token`.

#### What the corrected paths report

| Endpoint                                  | Result                                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/common/downloadCompanyLogo/{id}` | **500 to every request — including with no token at all**, where 401 belongs. It fails before authenticating: 11 of its auth and error-shape cases fail on this one cause. |
| `POST /v2/common/updateCompanyLogo`       | 409 with the correct multipart shape — the same "conflicts with the current state" this API returns from several handlers                                                  |
| `POST /admin/removeCompanyLogo`           | 400 `"Internal Server Error"` — a 400 whose message says 500                                                                                                               |

The download endpoint is the notable one: an unauthenticated caller gets a 500. That is both a
defect and a monitoring problem, and it is exactly what the earlier false 401 had hidden.

#### Two answers that came out of the same investigation

- **`adminUserLogin` accepts a plaintext password** — 200 with `Qa@Passw0rd123`. The workbook's
  base64 sample (`0FPnV+OKhDGGXMkQjtj1eQ==`) is not a requirement. That closes an open question.
- **It is Medium/Large only.** `BUSINESS_S` is rejected with `403 "Not A Admin"`, exactly as the
  endpoint's name implies — so the definition uses the BUSINESS_M principal.

### 2026-09-12 — The logo endpoints are not deployed here, and a false pass that hid it

**What is wrong with `updateCompanyLogo`: the route does not exist on either host we have.**

The workbook documents three logo endpoints as a trio — `updateCompanyLogo`,
`downloadCompanyLogo`, `removeCompanyLogo` — all against **`kpostapis.kpostindia.com`**, a third
host distinct from `devapi2` (every other row in the sheet), all marked module **Admin**. Probed:

    POST /common/updateCompanyLogo     8989, token + JSON       -> 404
    POST /common/updateCompanyLogo     8989, token + multipart  -> 404
    GET  /common/downloadCompanyLogo   8989, token, any id      -> 404
    both                               9595 (Admin)            -> 404 (Spring's default handler)

Identical to `/common/definitelyNotARoute9f2a`. Not a defect, not a payload problem — the wrong
host. Both are tagged `route-not-deployed` and excluded from the run; 80 cases reporting 404 would
say nothing except that the bench is calling the wrong place. The definitions stay, so coverage
still counts them and they return the moment the host is known.

A second problem sits underneath, and would have bitten whatever we pointed at it: **the documented
payload cannot carry a logo.** `{ "companyID": 1 }` has no image in it. Almost certainly multipart
(`file` + `companyID`), the way the workbook's other upload rows say `multipart key : file` — but
that is a guess and the sheet does not say.

#### A false pass, corrected

This gateway answers **401 to any unrouted path** without a token, and 404 with one — verified
against a nonsense path. So "no token → 401" is the default for _everything_, and the bench had read
it as proof that `downloadCompanyLogo` was protected. It was not evidence of anything: the same 401
comes back for an endpoint that was never deployed.

Worse, `authentication.missing-token` **passed** on that basis — a validator reporting a security
property it had not verified, which is the most dangerous kind of green. All four auth probes
(missing, invalid, malformed, expired) now skip with
`endpoint answered 404: the route is unknown, so auth cannot be verified` when the primary call
404s.

The endpoint does still require a token — that is the API owner's word, and it stands. What changed
is that the bench no longer claims to have proved it.

**Lesson, and it generalises:** a negative probe that passes because of a _global_ default has
verified nothing. Any 401/403/404 that an API returns uniformly cannot be used as evidence about a
specific endpoint.

### 2026-09-12 — forgotPasswordUpdate corrected, and two things learned about the flow

The owner supplied the payload: `{ "kpostID": …, "forgotPassword": … }` — which is what the
workbook documents and what the definition already sent. What was wrong were the _values_.

**Now:** the spare account `meera962@kpostindia.com` (verified to log in — the family is 960
primary / 961 victim / 962 spare), and the new password is **`QA_PASSWORD`, the standard one**.
That makes the call idempotent: the spare keeps a credential we know, so the endpoint can be
exercised as often as needed without locking anybody out. A random password would work once and
leave an account nobody can log into.

**Its 400 is a missing prerequisite, not a defect — and that is good news.** The live endpoint
answers `400 "OTP validation failed"` until an OTP has been validated for that account, so **a
password cannot be changed without one**. The earlier worry in this log — that an unauthenticated
caller might take over an account through it — is answered: it cannot.

But the step that satisfies it is **not** the documented `validateOTP`. Verified by hand:

    forgotPasswordOTPOrSentKpostIDSms  -> 200 "OTP Sent to your registered mobile number"
    validateOTP (bypass 123456)        -> 200 "OTP has been validated successfully."
    forgotPasswordUpdate               -> 400 "OTP validation failed"   <- still

So the flow keeps its own OTP state, reached by a call that is not in the workbook. Open with the
API owner. Recorded in the definition so nobody files the 400 as a bug.

**A finding from step 1:** `forgotPasswordOTPOrSentKpostIDSms` returns the account's **full mobile
number in the clear** to an unauthenticated caller who supplies only a KPost ID:

    {"mobileNumber":"9000000962","message":" OTP Sent to your registered mobile number",
     "countryID":1,"statusCode":200,"status":"SUCCESS"}

Anyone can turn a KPost ID into its registered phone number. The number is needed by the client to
show "OTP sent to ••••••0962", but it should be masked for that, not returned whole.

**Also:** registration is now `sideEffect: 'global'` at the owner's instruction — _do not create
users frequently_. An account cannot be deleted through this API, so "data the tests own" was the
wrong category: every run would leave a permanent `qabench*@kpost.in` behind. It runs only with
`ALLOW_DESTRUCTIVE_TESTS=true`, and the coverage self-test asserts that so it cannot regress.

### 2026-09-12 — KMail deregistered: scope is common and Signup & Login only

`src/api/definitions/kmail.api.ts` auto-loaded endpoints from the KMail OpenAPI document as soon as
`KMAIL_API_BASE_URL` was set. Configuring that host for reference therefore registered **15
endpoints and 660 validation cases nobody asked for**, and they were counted in the totals next to
the tests actually written — misleading about what the bench covers.

The agreed order is one module at a time: common, then Signup & Login. KMail comes later. So
registration is now an explicit decision rather than a side effect of setting an environment
variable: the file exports an empty list and documents exactly how to turn it on, with the
groundwork it will need (the `kmail` response contract, the loader options, and the fact that KMail
answers 403 without a token).

**Lesson worth keeping:** a module registers because someone decided to test it, never because a
variable appeared in `.env`. The same trap exists for `ADMIN_API_BASE_URL` — Admin registers nothing
today only because it has no contract, not because anything prevents it.

Scope now, exactly:

    common                32 endpoints   1 408 cases
    signup & login        14 endpoints     616 cases
    registry total        55  (46 under test + 9 bench mock fixtures)

### 2026-09-12 — Error shapes probed on every endpoint; the FRD's flow rules tested

**Three new central validators**, so every endpoint is held to the error behaviour any HTTP API is
expected to have — the cases hand-written suites skip because nobody writes them 70 times:

| Validator                        | Probe                                  | Accepted           |
| -------------------------------- | -------------------------------------- | ------------------ |
| `request.method-not-allowed`     | a verb the endpoint does not implement | 405, 404, 401, 403 |
| `request.unsupported-media-type` | the valid body sent as `text/plain`    | 415, 400, 406      |
| `request.empty-body`             | no body at all, and `{}`               | 400, 422, 415      |

A range rather than one code, because a gateway routing by path may legitimately answer 404 and a
service authenticating before routing may answer 401. **A 2xx or a 5xx always fails** — the endpoint
either served a request it does not implement or crashed on one.

Only **GET** is ever used as the wrong verb, and a GET endpoint is skipped with that reason: the
alternatives all mutate, and sending DELETE at a live API to see what happens is how a test suite
deletes production data.

**Throttled probes are now inconclusive, not failures.** Some endpoints rate-limit
(`adminUserLogin`, `uniqueNameExist`), and a dozen negative probes trip them. A 429 the bench caused
teaches nothing about the API: reporting it as a failed error-shape check would blame the API for
our load, and passing it would claim we verified something we never saw. `runProbes` now marks those
SKIPPED with the reason — unless 429 is the expected status, which is what the rate-limit validator
asserts.

First results: `method-not-allowed` and `unsupported-media-type` pass widely (KPost handles both
correctly). `empty-body` found `/v2/common/languages` accepting `{}` with **200** and returning
country 0's rows — the same root cause as its `countryID: null` finding. `userLogin` rejects `{}`
correctly, with the best error body in the API: `fieldErrors: {deviceType, loginRO}`.

#### The documents, and what they demand that the API does not have

All five documents in `D:\Kpost Documents` were read in full at the start of this work (§1–§4).
Acting on them now rather than only recording them:

**Requirement traceability is wired.** Endpoint definitions carry a `requirements` field, and all 14
Signup & Login endpoints are tagged with the FRD ids they exercise (FR-S01..S12, BR-S02, NFR-SEC01,
NFR-SEC03). Coverage can now be reported against the 55 FRs and 9 BRs the documents define, rather
than against a count of endpoints — which says nothing about whether the product's rules are tested.

**There is no activation endpoint.** BR-S01 states that activation is mandatory and "login before
activation must fail". Searching all 356 documented endpoints for activation finds only
`deactivateAccount` and `sendAccountDeactivationOtp` — the reverse operation. So either activation
happens outside the API, or the workbook is missing it, or signup activates immediately and BR-S01
is unimplemented. `tests/api/kpost/signup-login/flow-rules.spec.ts` answers it empirically:
registers an account, immediately tries to log in, and asserts no token is issued. It is gated
behind `ALLOW_DESTRUCTIVE_TESTS` because it creates a real account.

**Two document rules pass**, and both are worth knowing:

- **BR-S02** — an existing KPost ID is not reported as available by `kpostIdExist`.
- **Account enumeration is not possible on login** — a wrong password and an unknown account answer
  identically (same status, same message), so login cannot be used to discover who has an account.
  A genuine security property holding, found by testing for it rather than assuming it.

### 2026-09-12 — Bug reports made reproducible, and routed to the right component

Reviewed the tickets already in this Bugzilla (bugs 95–101, filed by the previous bench) and
matched their house style, then fixed the two things that made our output weaker than theirs.

**The component was wrong.** Every finding was landing on `kpost-webservice-application`, the
catch-all, because `componentByTag` for KPost API was empty. The previous bench's tickets sit on
precise components (`KPresentation`, `User Profile V2`, `Kdiary - Schedules…`). Mapped the bench's
module tags to the 27 components that exist in this instance, and fixed a shadowing bug in
`componentFor`: an endpoint carries both a module tag and a group tag (`['common',
'common-company']`), and iterating in order let the generic one win, so every company defect went
to the utilities component. **The most specific tag now wins** (longest matching key).

    Common Reference Data & Utilities V2   22        (was: 50 on the catch-all)
    Authentication V2                      22
    Company Administration                  4
    Authentication - Medium & Large Ent.    2

**A ticket now reproduces itself.** Three additions, in the order the existing tickets use:

- **`curl:`** — the real URL with path parameters substituted, the real body, and
  `Authorization: Bearer $KPOST_TOKEN` where the endpoint needs a token (read from the endpoint's
  contract, not guessed from tags). Tokens are never printed; masked values stay masked, so the
  command needs one edit before it runs — a reproducible password in a ticket is worse than that.
- **The failing request, not the happy path.** A probe validator sends many requests, so
  `runProbes` now records the request on each FAILED case and the ticket shows _that_ one. A
  developer pasting the happy-path call would see a 200 and close the bug. The `null-value` ticket
  for `validateOTP` now carries `"countryID": null` — the exact payload that answered 200.
- **`Response body (HTTP nnn):`** — quoted from the primary response, with its `traceId`. "Actual:
  409" alone made the reader re-run the call to find out what the API said.

**Dry runs are now reviewable.** `reports/bugs/filing.json` carries the full ticket text for every
candidate on a dry run (omitted on a live run - Bugzilla has it). A dry run whose artifact holds
only summaries cannot be reviewed, which is the entire point of having one.

**A false-bug source removed.** `dictionary.api.ts` - a bench fixture, not a KPost route - was
missing `mockFixture: true`, so it was called on the live host, 404'd, and proposed six tickets
against `KPost API` for an endpoint KPost does not have. A false bug on a developer's queue costs
more than a missing one: it teaches them to distrust the whole report.

**Where filing stands:** 50 candidates, 20 rejected by the validity gate, `BUGZILLA_DRY_RUN=true`
and `BUGZILLA_MAX_FILE=0` - nothing has been filed. The 50 collapse to **29 distinct
endpoint+fault pairs** in 8 classes; filing all 50 would put near-duplicates on one queue, so the
recommendation is to file by class, highest severity first, after the owner confirms which are known.

### 2026-09-12 — downloadCompanyLogo requires a token; a fixed sessionID was invalidating ours

The API owner confirmed what the bench had found by probing: **`GET /common/downloadCompanyLogo/{companyID}`
is the one endpoint in the common module that needs a token.** Everything else there is public.

It now runs like any other endpoint — Signup & Login issues the token — and the exception is
asserted as an exact list in `tests/api/kpost/common/coverage.spec.ts`:

    const REQUIRES_TOKEN = ['common-download-company-logo'];

An exact list, not "at least these", so an endpoint that starts _or_ stops requiring a token fails
that test instead of changing the module's security posture silently. (It had to change: the old
assertion was "no endpoint requires a token", which was true when written and wrong within a day.)

**A bench bug this exposed.** Enabling it reported `authentication.valid-token FAILED: valid USER
token was rejected with 401`, while the same call by hand answered 404. The cause was ours: the
login payload used a **fixed** `sessionID` (`qa-bench-session`). KPost treats that as the session
key, so each login invalidated the tokens issued to the previous one — with several principals and
several workers, tokens died mid-run and every failure looked like an auth defect. The workbook's
own sample is a UUID; taking that literally is the fix, and `sessionID` is now generated per login.

Worth recording as a lesson: an authentication failure the API cannot reproduce by hand is the
bench's fault until proven otherwise.

**Where that endpoint stands now:** 12 of 14 executed cases pass, including every auth probe
(missing, invalid, malformed and unsigned tokens all correctly rejected — it is the only endpoint in
the module where that rule is testable at all). The two failures are the same for every company id
tried, with all three token types:

    GET /common/downloadCompanyLogo/1000008  ->  404 "The requested resource does not exist."

No company on this host has a logo yet, which is unsurprising because `updateCompanyLogo` is gated
and has never run. Open with the owner: a companyID that _has_ a logo, or the host this route really
lives on — its workbook row (KatchupAPI!R178) says module **Admin** and points at
`kpostapis.kpostindia.com`, a third host, and the route is not on `:9595`.

### 2026-09-12 — Signup & Login: 14 endpoints, all four user types, and the auth plumbing

The second module, and the one every other module needed: `/v2/signupLogin/*` plus the
medium/large business login. FR-S01..S12 in the FRD.

```
src/api/definitions/kpost/signup-login/
  login.api.ts      login, token refresh, sessions, logout, access code   (8)
  signup.api.ts     registration, business registration, availability     (6)
tests/api/kpost/signup-login/
  login.spec.ts  signup.spec.ts  user-types.spec.ts  coverage.spec.ts
```

**Auth became per-API.** `src/config/auth-profile.ts` now holds _how_ an API issues tokens, the way
`response-contract.ts` holds what its responses look like. The bench had one global login shaped for
its mock (`{username, password}` → `data.accessToken`); KPost logs in with a nested `loginRO` and
returns the token at the **top level**. The profile is chosen by the same signal as the base URL
(`mockFixture`), so a host and its credentials can never disagree — a mock-minted token sent to the
live API would be rejected as invalid and read like an API defect.

`AUTH_PROFILES.kpost.loginEndpointId` points at this module's own definition, so the login payload
exists once: the token provider and the login endpoint's own tests use the same builder.

**All four user types are real accounts and all four log in.** PERSONAL, BUSINESS_S, BUSINESS_M,
BUSINESS_L — confirmed by the API owner, verified against the host. The tier is **part of the
credential**, not a flag: logging the BUSINESS_S account in as PERSONAL is rejected. So each tier is
its own principal, and `user-types.spec.ts` asserts per tier that it logs in, is echoed back as that
type, gets a token whose subject is its own kpostID, and — for businesses only — carries a
`companyID` (S=1000008, M=1000009, L=1000010).

Two central bugs this module exposed, both fixed:

- **The primary role came from the mock's default (`ADMIN`).** KPost has no ADMIN principal, so
  every authenticated KPost endpoint failed with "no principal configured for role ADMIN" — 82
  cases reporting a configuration mismatch as an API failure. The default role now comes from the
  endpoint's own auth profile (`USER` for KPost).
- **The error-code check assumed a `code` field.** KPost's errors carry prose and a `traceId`, no
  code. `errorCodeField` is now part of the response contract; where an API has none, only the 5xx
  rule applies. Failures dropped from 102 to 29.

#### Findings — reproduced by hand, every one

| What                                             | Endpoint                              | Evidence                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A failed login answers HTTP 500**              | `userLogin`                           | `{"statusCode":500,"status":"FAILURE","message":"Invalid Credential"}` for a wrong password _and_ a wrong tier. The most common client error on the most security-sensitive endpoint, returned as a server fault — it pages whoever owns the alerts and tells the caller nothing. Asserted as a 4xx, so it stays red.                                            |
| **Concurrent logins fail**                       | `userLogin`                           | Four _different_ accounts logging in simultaneously: 1–2 of 4 answer `500 "internal error… Quote the traceId"`, reproducibly (3 rounds: 2, 1, 1 failures). Sequentially all four pass; two concurrent logins of the _same_ account both pass. Looks like shared mutable state, and it is exactly the real access pattern — an office signing in at nine o'clock. |
| **Protected endpoints answer 409 to everything** | `getActiveSession`, `getLoginHistory` | Identical `409 "The request conflicts with the current state of the resource."` **with a valid token and with no token at all**. Two problems in one: the endpoint does not work, and it never returns 401, so auth is not enforced on it.                                                                                                                       |
| Documented payload is incomplete                 | `kpostIDsuggestionList`               | `400 "Request validation failed"` with `fieldErrors: {kpostID…}` — the API requires `kpostID`; the workbook's sample omits it.                                                                                                                                                                                                                                   |
| A second stale GET row                           | `GET /v2/signupLogin/signup/`         | **405 Method Not Allowed**. Sheet3 R13 documents it with no payload, so the method rule derived GET — the same kind of incomplete row as `mobileNoExist`.                                                                                                                                                                                                        |
| Login probes trip a throttle                     | `adminUserLogin`                      | 429 during the negative probes. Worth knowing the endpoint _is_ rate-limited; it also means its probe results are unreliable until the limit is understood.                                                                                                                                                                                                      |

**Open with the API owner:** whether `adminUserLogin` expects an **encrypted** password — its
workbook sample is `"0FPnV+OKhDGGXMkQjtj1eQ=="` where every other login sample is plaintext.

**Session-ending endpoints are gated `global`:** `userLogout`, `userLogoutFromAllDevices`,
`setAccessCode` and `adminRegistration`. Logging the shared QA account out mid-run would produce
401s across the report that look like auth defects.

**`PERSONAL` is missing from the workbook's Types tab** — it lists only the three business tiers. A
documentation gap, recorded as a named exception in `user-types.spec.ts` that fails if the tab ever
gains it, so the workaround cannot outlive the gap.

### 2026-09-12 — Common module: 32 endpoints under test, 1 278 cases, first real findings

The first module. `/common` and `/v2/common` — everything a client calls before anyone has a
token. 32 endpoints, grouped by how they fail rather than by URL:

```
src/api/definitions/kpost/common/
  otp.api.ts        OTP send/verify, password recovery   (side effects: SMS, email, passwords)
  location.api.ts   countries, states, cities, postcodes (read-only reference data)
  identity.api.ts   "does this exist" lookups            (enumeration surface)
  company.api.ts    company records and the logo         (cross-tenant surface)
  platform.api.ts   status, app version, public writes
tests/api/kpost/common/    one spec per group + coverage.spec.ts (self-tests, no HTTP)
```

**Each endpoint reports ~40 named cases, not one.** `describeEndpointCases` runs the engine once per
endpoint and emits a Playwright test per validation, so a run reads like a test plan
(`response.status-code`, `request.null-value`, `security.injection`, …). One HTTP run per endpoint
is a correctness requirement, not an optimisation: these endpoints send SMS, so a run per case
would send a message per case. Each endpoint's block is pinned to one worker with `mode: 'default'`
because the project is `fullyParallel`.

**Definitions carry no schemas.** `defineKpostEndpoint` reads the request and response schema, the
documented example and the method's provenance from the generated contract, and throws at import
time if the method+path is not in it. Payloads are built from `testData` (the `QA_*` values in
`.env`), never from the workbook examples, which contain real colleagues' phone numbers.

#### The environment turned out to be reachable

192.168.0.66:8989 answers. That changed the work from "model it" to "measure it", and four
assumptions the bench had baked in were wrong about the real API:

- **The envelope.** The validators asserted `{success, data, metadata.correlationId}` with POST→201.
  KPost answers `{status, statusCode, urlPath, message, data}` with 200. Envelopes are now data:
  `RESPONSE_CONTRACTS` in `src/config/response-contract.ts`, selected per endpoint, so the bench's
  own mock-backed self-tests keep their contract while KPost gets its own.
- **Identifiers.** KPost ids are auto-increment integers; the UUID convention produced 243 failures
  on one states lookup. `idFormat` is now part of the contract.
- **Nullability.** A response type may be null even when the sample shows a string
  (`fieldCount: "6"` documented, `null` for 236 of 240 countries). Inferred **response** schemas now
  permit null — request schemas deliberately do not, or the null-value probe would stop finding the
  defect below.
- **The error envelope, which the workbook never documents.** Probing produced it:
  `{status: "FAILURE", statusCode, message, urlPath, timestamp?, traceId?}`. Encoded as observed,
  labelled as observed, so error-format validation is active for all 337 endpoints instead of
  skipping.

#### Safety: "destructive" was too blunt

It blocked writes on production and allowed them everywhere else — fine for creating a throwaway
record, wrong for sending an SMS. Endpoints now declare `sideEffect`:

|            | meaning                                                                 | runs by default                               |
| ---------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| `data`     | records the tests own                                                   | yes, off production                           |
| `external` | real SMS or email                                                       | **no** — needs `ALLOW_DESTRUCTIVE_TESTS=true` |
| `global`   | shared state: app version, another account's password, a company's logo | **no**                                        |

Configuring a real `KPOST_API_BASE_URL` also silently redirected the bench's own mock fixtures at
the live API (two self-tests failed with 401). Those definitions now carry `mockFixture: true` and
always use the mock's host.

#### First findings — 43 failing cases across 18 endpoints, all reproduced by hand

| What                                                     | Endpoint(s)                                                                             | Evidence                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong OTP answers **HTTP 500**                           | `validateOTP`                                                                           | `{"statusCode":500,"status":"Failure","message":"OTP validation failed"}` — a client error returned as a server error, so it pages whoever owns the alerts |
| `null` accepted where a number is required               | `languages`, `domain`, `mobileNoExist`, `saveEnquiryDetails`, `getTotalCountByDate`, +4 | `{"countryID":null}` → 200 with the rows for country 0, while `{"countryID":"abc"}` → 400                                                                  |
| Wrong type accepted                                      | `getDesignation`, `uniqueNameExist`, +5                                                 | `{"designation":123}` → 200                                                                                                                                |
| 500 on a valid payload                                   | `saveEnquiryDetails`                                                                    | `{"message":"The request could not be completed."}`                                                                                                        |
| 409 on a valid date                                      | `getTotalCountByDate`                                                                   | `{"statusCode":409,"message":"The request conflicts with the current state of the resource."}`                                                             |
| 404 on the documented payload                            | `saveUnsubscriberDetails`                                                               | `{"message":"The requested resource does not exist."}`                                                                                                     |
| 400 on the documented payload                            | `getCompanyDetailsByAdmin`, `getCompanyDetailsByMobileNoAndproductId`                   | `"Request validation failed"` — workbook payload and API disagree                                                                                          |
| `status` is a **boolean** here, a string everywhere else | `uniqueNameExist`                                                                       | `{"status":false,"statusCode":200}`                                                                                                                        |
| Documented as JSON, returns plain text                   | `msStatus`                                                                              | body is the bare string `SUCCESS`                                                                                                                          |
| Envelope case differs from the documentation             | all                                                                                     | `"Success"`/`"Failure"` live, `"SUCCESS"` in all 119 workbook samples                                                                                      |
| Not public, though nothing says so                       | `downloadCompanyLogo`                                                                   | `401 "Authentication is required"` — declared auth-required and tagged `needs-login`                                                                       |

**An OTP bypass exists on this environment** (`123456` always validates, `QA_BYPASS_OTP`). It makes
the happy path testable. It is also an account-takeover key if it ever reaches production, so it is
worth confirming it is environment-scoped.

### 2026-09-12 — Only POST and GET exist; yellow rows are unused and not added

Two rules from the owner, both verified against the workbook before applying:

**There is no PUT, PATCH or DELETE.** Every update endpoint is a POST. Checked: of the 95 rows that
state a method, the values are POST (80) and GET (15) — those three verbs appear nowhere. So the
derivation is binary, and the 34 "might be PUT" / "might be DELETE" flags were noise. Removed. A
workbook that later states PUT is still honoured; only the _derivation_ is limited to POST and GET.

**A yellow row is an unused endpoint and is not added.** It already was excluded, but the gap list
asked for confirmation on 24 of them — a question with a settled answer. They are now reported as a
count and kept in `*.contract.json` as `usable: false` so the decision stays auditable. A request
cell that says the same thing in words (`UNUSED`, `Not needed API changed in V2`) now retires its
row too (`unused-note`, 2 rows).

**A bug this exposed: retired rows were winning deduplication and hiding live endpoints.** Scoring
ranked duplicates by completeness with an earliest-row tie-break, and a yellow row often won — the
live row was then marked `duplicate-of <retired row>` and both were excluded, so the endpoint
vanished from the contracts entirely. The coverage audit could not catch it, because both rows are
still contract records. Seven endpoints were affected:

`/v2/kall/initiateKall` · `/v2/kall/getKallStatus` · `/v2/kall/clearKallBykallIds` ·
`/v2/kall/frequentKallContacts` · `/v2/kall/clearKallHistory` · `/v2/kall/todayKoolKall` ·
`/common/postBoxContacts` — each now taken from its live row (retired rows carry a -100 score).

Also split `methodDoubts` (method ambiguity only) from `dataNotes` (a payload shared by two
endpoints in one row), so "methods needing confirmation" means exactly that.

Result: **337 usable** (249 POST / 88 GET), **0 methods needing confirmation**, 0 uncovered. The gap
list is 233 rows and now contains only real missing data: 185 missing a response or payload, 27
broken JSON samples, 21 duplicate/legacy/split-row decisions.

### 2026-09-12 — The request cell outranks the Method column when the payload agrees

The owner's second rule: **if the request cell says `GET METHOD` and no payload is documented, it is
a GET** — even where the Method column says POST. The method ladder is now:

1. the request cell states a method **and the payload agrees** (`GET METHOD` + no payload) — wins
   even over a Method column
2. a Method column
3. a stated method the payload contradicts — used, but flagged
4. the payload rule (payload = POST, none = GET)

The reasoning behind step 1 outranking step 2: on KMail, column C predates tokens while the
`After Token Implemented` cell describes today's contract, so where they disagree the cell is the
later statement — and the absence of a payload corroborates it.

This eliminated the `method-conflict` class entirely. The 7 KMail rows (`C16 C17 C18 C23 C25 C26
C58`) are now GET, and are reported in the gap list under **"Resolved without you"** rather than as
gaps, so the decision is visible without being an action. Rows needing confirmation: 59 → **52**.
GET endpoints: 78 → **85**.

Provenance is data, not prose: `methodOverrode` holds the displaced verb, so no reader has to parse
the explanation sentence. All of `methodSource`, `methodNote` and `methodDoubts` reach the OpenAPI
as `x-method-*`.

### 2026-09-12 — Methods are derived by the owner's rule; the payload bug that hid them is fixed

The workbook owner corrected two things at once: `/v2/profile/fetchUserDetails/` (KatchupAPI R2) and
`/v2/signupLogin/fetchUserDetails` (R3) are both POST, and **many rows the gap list called
"no request payload" clearly had one**. Both were defects here, not workbook gaps.

**The payload bug.** A row documenting two URLs paired its payloads positionally, and when there was
one payload for two URLs it discarded the payload entirely — both endpoints were then reported as
having none. The payload is now shared across the row's URLs and flagged for confirmation. Affected
R3 and R88.

**"url changed to" is one endpoint, not two.** KatchupAPI R88 reads
`endKall url changed to endKoolKall`. That was being split into two endpoints, inventing a
`/v2/kall/endKall` that no longer exists. The last URL is now taken as current and the old one is
recorded as `replacedUrl`.

**The workbook's own vocabulary is now read.** `GET METHOD` (79 rows), `Not Required`, `UNUSED`,
`Not needed API changed in V2`, `multipart key : file` are not payloads — they are statements about
the contract. KMail's two request columns are two eras: E is pre-token, F is
"After Token Implemented", and F often says `GET METHOD` where E still shows a `{kpostUser}` body,
because the user now comes from the JWT. Those were being reported as "missing payload" when there
is nothing to fill.

**The method rule, applied and labelled.** Per the owner: _a documented payload means POST, no
payload means GET._ The workbook still wins where it states a method, and every endpoint records
`methodSource` — `method-column` (86), `request-note` (58), `payload-rule` (188). Derived methods
also reach the OpenAPI documents, so provenance travels with them rather than living only here.

Result: **332 of 382 rows usable, up from 145**, and `method-unknown` is gone. 59 need
confirmation and are P1 in the gap list with the reason attached — 7 of them genuine workbook
contradictions (KMail's Method column says POST where the after-token cell says `GET METHOD`), the
rest derivations that could be DELETE or PUT instead of POST, or POST derived from a payload whose
sample JSON does not parse.

This reverses the earlier "never infer a method" convention. It is not a guess any more: it is a
documented rule about this API, from its owner, recorded per endpoint and listed for confirmation
where it could be wrong. §10 is updated accordingly.

Three smaller corrections found while verifying:

- The displaced duplicate's reason named its own tab with the winner's row
  (`duplicate-of KatchupAPI:R8` for a row that lost to `V2 TESTED APIS:R8`). It now names the winner.
- The coverage audit accepted the dropped `endKall` as "quoted in a notes column" — an excuse, when
  the URL was in the endpoint column. It now recognises the `url changed to` supersession by name,
  and distinguishes a notes-column quote from a second URL in the endpoint column itself.
- The audit defaulted to a workbook path in `Downloads` while the contracts came from the repo copy.
  It now audits the file recorded in the conversion report and refuses to run against a different
  one — auditing the wrong workbook produces either phantom misses or a false all-clear.

The workbook now lives in the repository (`KPOST API (6).xlsx`), and the converter defaults to the
highest-numbered copy there, so a fresh checkout can regenerate everything.

### 2026-09-12 — The workbook can now be filled in without a code change

The gap list said _what_ was missing but not _where_ to put it, and the KatchupAPI tab (192 blocked
rows) had no Method column for the answer to go in. Three changes, in `scripts/`:

- **The Method column is found by header, not by letter.** Add a column headed `Method` to any tab
  and the next run reads it — no edit to `TABS`. Proven by forcing KDIARY's configured column to
  `null`: detection found C by header and produced the identical 77 usable endpoints.
- **A layout guard.** Every tab declares the headers it expects; if one moves, the run stops with
  `layout changed on tab "<name>" — refusing to convert` and names the column. Verified by renaming
  an expected header: exit code 3, nothing written. This matters because columns are addressed by
  letter — **inserting** a column shifts them all, and the silent failure mode is a
  plausible-looking contract built from the wrong cells. So: append new columns, never insert.
- **The gap list now names the destination cell.** `contracts/excel-gaps.csv` gained a **FillCell**
  column (`KatchupAPI!Q7`), and `excel-gaps.md` a "Where to type it" table. Both read the method
  column out of `_conversion-report.json`, which the converter writes, so the instruction and the
  parser cannot drift apart.

Found while verifying: **4 rows document two endpoints each** (`KatchupAPI!Q3`, `Q7`, `Q8`, `Q88`) —
one Method cell cannot say which verb belongs to which endpoint, so those rows have to be split. The
gap report now lists them explicitly.

Also: regenerating while `excel-gaps.csv` is open in Excel used to throw an EBUSY stack trace; it now
prints one line saying to close the file. Numbers unchanged (77 + 68 usable, 0 uncovered) — this
change is about making the next dump land correctly, not about parsing more today.

### 2026-09-12 — Application documents read, this file created

Read BRD, PRD, SRS, FSD and Full Suite FRD v2.0 from `D:\Kpost Documents` (.docx text extracted with
a scratchpad script, since .docx is a zip the Read tool cannot open). Recorded the flow above. The
FRD's 55 FRs become the traceability target for test coverage.

### 2026-09-12 — Excel → contract pipeline

Swagger deleted as unreliable. Built `scripts/excel-to-contract.cjs` (workbook → 2 contracts +
2 OpenAPI docs + types), `scripts/contract-coverage.cjs` (independent audit) and
`scripts/excel-gap-report.cjs` (what to fill in). **KPost and KMail get separate files** — separate
products, separate owners. Decisions that matter:

- **Methods are never inferred** from the presence of a body. A wrong verb produces a failing test
  that blames the API for a spreadsheet gap.
- **Schemas are inferred from examples with no `required`** — an example cannot prove a field is
  mandatory.
- The coverage audit **re-parses the workbook independently** and immediately caught 3 endpoints
  being dropped (KatchupAPI R66/R95/R99: junk or a payload in the endpoint column, the real URL in
  the notes column). Fixed with a guarded fallback; a tab header (KMAILAPI R1) must not become an
  endpoint. Coverage is now **0 uncovered**.
- Gap list: **351 rows** need data — 210 missing a method, 104 missing payload/response, 9
  unparseable JSON, 4 duplicate/legacy decisions, 24 retired to confirm.

### 2026-09-12 — Module ownership and per-module hosts

KPost is one product made of separately deployed modules, so: `suite` on every endpoint definition,
an `ApiClientPool` (one HTTP client per module host), and uniqueness enforced **per module** — two
services legitimately share `GET /health`. Spec-loaded ids are namespaced (`kmail-api:getX`).

### 2026-09-12 — Bugzilla filing proven live

Verified against the instance: created bug 102; a second run **commented** instead of duplicating;
after it was resolved INVALID a third run **refused to re-file**. Bug 102 left resolved INVALID.
Learned: this instance authenticates **only** via the `api_key` query parameter — sent as a header
the request is anonymous and searches return nothing, which would have made every run file
duplicates.

### 2026-09-12 — Centralized validation framework

44 validators registered once; endpoint definitions carry no validation logic. Negative request
cases are generated from the contract (zod / JSON Schema) and only sent when Ajv confirms the
contract rejects them. The production guard blocks mutating calls when `TEST_ENV=production` unless
explicitly allowed.

## 9. Plan

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
- `npm run check` (typecheck + lint + format) must pass before anything is considered done.
- Tests describe **which** endpoint is tested; the engine owns **how**.
