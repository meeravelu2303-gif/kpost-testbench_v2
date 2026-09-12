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

| Module           | Role                                                                           | Bench suite            |
| ---------------- | ------------------------------------------------------------------------------ | ---------------------- |
| Signup & Login   | Registration, activation, authenticated access — the gate to everything else   | `kpost-api`            |
| Katchup          | Instant messaging: subject, attachments, group, message actions, read receipts | `kpost-api`            |
| Kall             | Voice/video: scheduling, rescheduling, direct calls, call log                  | `kpost-api`            |
| KMail            | Email: compose, read receipts, external interoperability                       | `kmail-api` (own repo) |
| Admin module     | Organisation / HR / product administration                                     | `admin-api` (own repo) |
| KPost UI         | React front end over all of the above                                          | `kpost-ui`             |
| KDirectory, KDOC | **Out of scope** per BRD §4.2 and PRD §3.2                                     | —                      |

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

The FRD v2.0 defines **55 functional requirements and 9 business rules**:

| Module         |             FRs | BRs | Bench suite |
| -------------- | --------------: | --: | ----------- |
| Signup & Login | 12 (FR-S01–S12) |   2 | `kpost-api` |
| Katchup        | 25 (FR-K01–K25) |   3 | `kpost-api` |
| Kall           |  9 (FR-C01–C09) |   1 | `kpost-api` |
| KMail          |  9 (FR-M01–M09) |   1 | `kmail-api` |
| Cross-module   |               — |   2 | both        |

Non-functional requirements that already map onto validators we run: JWT required on authenticated
operations (NFR-SEC01 → authentication validators), confidential-copy invisibility (NFR-SEC02 →
cross-resource access), password strength (NFR-SEC03 → request validators), auth availability
(NFR-R01), no silent data loss when a dependent service fails (NFR-R02), message latency (NFR-P01 →
the response-time budget, which is a functional check, not load testing).

**Not yet mapped:** FR-level traceability from each requirement to a specific test. Planned in §9.

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

### Next

4. Turn usable contract rows into **endpoint definitions with request factories**, module by module,
   starting with Signup & Login (the gate to everything), then Katchup.
5. Add **FR traceability**: tag each definition with the FR ids it exercises, and report coverage
   against the 55 FRs.
6. **Business rules from the FRD** — activation-before-login (BR-S01), identifier uniqueness
   (BR-S02), subject mandatory (FR-K02), confidential-copy invisibility (NFR-SEC02),
   edited/recalled marker behaviour (BR-K03), reschedule status tag (BR-C01).
7. **Admin module has no contract at all** (absent from the workbook, swagger deleted) — it needs a
   contract before it can be tested.

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
- **Secrets** come from the environment only, and are masked in logs, reports and tickets.
- `npm run check` (typecheck + lint + format) must pass before anything is considered done.
- Tests describe **which** endpoint is tested; the engine owns **how**.
