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

**Mapped so far:** every Signup & Login endpoint carries the FRD ids it exercises (`requirements`
on the definition). Katchup, Kall and KMail are still unmapped.

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
| 2   | **Profile**                                                                 |                     45 | `/userprofile`, `/settings` | **no** — workbook only      | a decision on which own-profile writes are acceptable on live; test images      |
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
- **Secrets** come from the environment only, and are masked in logs, reports and tickets.
- `npm run check` (typecheck + lint + format) must pass before anything is considered done.
- Tests describe **which** endpoint is tested; the engine owns **how**.
