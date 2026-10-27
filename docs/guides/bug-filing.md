# Automatic Bugzilla filing

Failures found by this bench become Bugzilla tickets automatically — **valid** tickets, **never duplicates**, and always on the desk of the developer who maintains that module.

Bugzilla has no delete, only resolve. A wrong ticket costs a person's attention permanently, so the design is conservative at every step: dry run by default, two validity gates before anything is filed, and a live dedupe search before every create.

> **Target instance:** `BUGZILLA_URL` (Bugzilla 5.2).

## Contents

1. [Who gets which bug](#1-who-gets-which-bug)
2. [The flow](#2-the-flow)
3. [Configuration](#3-configuration)
4. [What may become a ticket: the two gates](#4-what-may-become-a-ticket-the-two-gates)
5. [How duplicates are prevented](#5-how-duplicates-are-prevented)
6. [What a ticket looks like](#6-what-a-ticket-looks-like)
7. [Commands](#7-commands)
8. [CI](#8-ci)
9. [Verified against the live instance](#9-verified-against-the-live-instance)
10. [Operating it](#10-operating-it)

## 1. Who gets which bug

KPost is one product built from modules that are maintained in **separate repositories by different developers**. A defect is only useful when it reaches the person who owns that module, so ownership is declared once, in [`src/config/ownership.config.ts`](../../src/config/ownership.config.ts):

| Suite       | Module                | Repository              | Bugzilla product | Ticket goes to                               |
| ----------- | --------------------- | ----------------------- | ---------------- | -------------------------------------------- |
| `kpost-api` | KPost core API        | KPOST webservice        | `KPost API`      | **Jaganathan Murthy** (jagan@kpost.in)       |
| `admin-api` | Admin module API      | admin-module (own repo) | `KPost Admin`    | **Karan S** (karans@kpost.in)                |
| `kmail-api` | KMail module API      | kmail (own repo)        | `KMail API`      | **Jitendra Kumar** (jitendra@kpost.in)       |
| `kpost-ui`  | KPost React front end | KPOST_REACTJS_2023_V1   | `KPost UI`       | **Ayyappan Ashok** (ayyappan@kpostindia.com) |
| `admin-ui`  | Admin/HR-Setup SPA    | Admin_Module frontend   | `KPost Admin UI` | **Ayyappan Ashok** (ayyappan@kpostindia.com) |

How a defect finds its owner:

1. Every endpoint definition declares its `suite` (default `kpost-api`); UI failures are `kpost-ui` by definition.
2. The suite decides the **base URL** the test calls, and the **Bugzilla product** its defects go to.
3. The **component** comes from the endpoint's OpenAPI tag (or the UI screen name). For KPost API and Admin the components were created from those tags, so they match directly; KMail's differences are mapped explicitly.
4. The ticket is **assigned to the module's developer**, after the account is verified. If the account cannot be verified, the field is omitted and Bugzilla's component default owner takes it — the ticket is never lost over an assignment.

Two safeguards keep this honest: an unmapped area falls back to the module's own catch-all component (never another module's), and a framework test compares this table against the **live component defaults** on the instance, so drift on either side fails a run instead of silently misrouting tickets.

Adding a module is one entry in that file plus its base URL; adding an endpoint is one definition.

## 2. The flow

```
Playwright run
   │  validation reports (attachments)  +  failed browser tests
   ▼
RUN GATE ........... did this run actually run? (collapsed run → file nothing)
   ▼
Candidates ......... built only from evidence the run produced; each carries its module,
                     and therefore its product, component and owner
   ▼
CANDIDATE GATE ..... does each finding's own evidence support its claim?
   ▼
Merge .............. same fault on 3 browsers / 5 tests = ONE candidate
   ▼
Filer .............. live Bugzilla search per candidate, then:
                       open ticket        → left as is (no comment)
                       INVALID/WONTFIX/…  → skip forever
                       FIXED but back     → reopen
                       untagged match     → tag it (no comment)
                       nothing found      → create, assign, attach evidence
                       search failed      → file nothing
   ▼
reports/REPORT.json + console summary
```

Implementation: [`src/bug-tracker/`](../../src/bug-tracker), reporter in [`src/bug-tracker/filing/bugzilla-reporter.ts`](../../src/bug-tracker/filing/bugzilla-reporter.ts). Nothing in this path can fail a run or change its exit code.

## 3. Configuration

Environment-driven ([`.env.example`](../../.env.example), validated in [`src/config/env.ts`](../../src/config/env.ts)). With `BUGZILLA_URL` or `BUGZILLA_API_KEY` unset, the reporter says so in one line and files nothing.

| Variable                    | Default  | Purpose                                                                           |
| --------------------------- | -------- | --------------------------------------------------------------------------------- |
| `BUGZILLA_URL`              | —        | REST root, e.g. `http://192.168.0.50/rest`                                        |
| `BUGZILLA_API_KEY`          | —        | API key. Sent as the `api_key` query parameter (this instance ignores the header) |
| `BUGZILLA_DRY_RUN`          | `true`   | **Default is a dry run.** Set `false` to file for real                            |
| `BUGZILLA_MIN_SEVERITY`     | `MEDIUM` | Lowest severity that may become a ticket                                          |
| `BUGZILLA_MAX_FILE`         | `0`      | Staged rollout: file at most N per run (0 = no cap)                               |
| `BUGZILLA_FILE_UI_FAILURES` | `true`   | Also file browser test failures                                                   |

Products, components, versions and assignees are deliberately **not** environment variables — they belong to the module, and live in `ownership.config.ts` where they can be reviewed and tested.

The key is a secret: keep it in `.env` (git-ignored) or a CI secret. It is never logged, never written into a ticket, and never committed.

## 4. What may become a ticket: the two gates

### The run gate — is this run trustworthy?

A bench that cannot run must be loud, never clean. If every spec fails to import, the run finds zero defects, which looks exactly like a healthy API. [`assessRunValidity`](../../src/bug-tracker/gates/validity-gate.ts) files nothing when:

- errors occurred outside any test (specs failed to load, setup faulted),
- the run was interrupted or timed out,
- zero tests executed,
- fewer than half the collected tests produced a result (the run collapsed part-way).

### The candidate gate — does the evidence support the claim?

[`candidateRejection`](../../src/bug-tracker/gates/validity-gate.ts) drops a finding when:

- its severity is below `BUGZILLA_MIN_SEVERITY`,
- the evidence is an **infrastructure or bench fault** (`ECONNREFUSED`, timeouts, a closed browser, a framework error, a missing principal, the production guard),
- the endpoint **throttled our run** (429) — the server working correctly, not a defect. A _missing_ rate limit is the opposite case and still files,
- it **claims exposure or bypass but the server refused the request** (401/403),
- it **claims identifiers are enumerable but the response was 404** — nothing resolved,
- it carries no expected/actual evidence, so the ticket would not be actionable.

Only `FAILED` validations become candidates: a `WARNING` is not a defect, and a `SKIPPED` check means nothing was verified. Flaky tests (passed on retry) are not filed either.

Every rejection is printed and written to `reports/REPORT.json`. A gate nobody can see is a gate nobody can correct.

## 5. How duplicates are prevented

Each defect gets a **stable identity** — `KP-XXXXXX` (`BUGZILLA_TAG_PREFIX`, 6 hex digits), a hash of the endpoint, the check and the _normalised_ failure message. Normalising is what makes dedupe work: correlation IDs, generated e-mails, UUIDs, ports and durations change every run and would otherwise mint a new id each night ([`bug-fingerprint.ts`](../../src/bug-tracker/findings/bug-fingerprint.ts)).

The id is carried as `[KP-XXXXXX]` in the summary, and every run searches for it — in summaries and on whiteboards — before deciding:

| Found                                                 | Action                          | Why                                                           |
| ----------------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| An **open** ticket                                    | **Leave it as it is**           | Already tracked and still broken: no comment (owner, 27 Oct)  |
| Resolved `INVALID`/`WONTFIX`/`WORKSFORME`/`DUPLICATE` | **Skip forever**                | A human judged it; re-filing overrides that judgement nightly |
| Resolved `DELETED` (the tracker's soft delete)        | **Skip forever**                | A person removed it; the bench never brings it back           |
| `FIXED`, or `CLOSED` (re-test passed), and it is back | **Reopen** it as `REOPENED`     | A regression belongs on its ticket; never `CONFIRMED`         |
| An untagged **open** ticket for the same fault        | Add the tag, no comment         | Adopts tickets filed by a human or the previous bench         |
| Nothing                                               | Create, assign, attach evidence | Genuinely new                                                 |
| **The search failed**                                 | File nothing                    | A transient error must never mint a duplicate                 |

The same fault on several browsers or tests is merged into one ticket that records the count and lists the browsers.

## 6. What a ticket looks like

- **Summary:** `[KP-A1B2C3] POST /users: expected 400/422, got 500` — trimmed to 255 characters with the tag intact.
- **Assignee:** the module's developer (see §1).
- **Whiteboard:** `[cat:X][browser:Y][source:Z]` — the format the BUGZILLA-UI backend parses (`classification.ts`):
  - `[cat:]` one of `Functional`, `Security`, `Performance`, `Compatibility`, `Accessibility`. Any other value shows as Unclassified **and** drops out of every category filter.
  - `[browser:]` UI defects only, real browser names comma-joined without spaces (`chromium,webkit`). The `admin-ui` project is written `chromium` and mapped back to that project at re-verification.
  - `[source:]` `automation` for everything the bench files (engine, `bug:file-reviewed`, `file-approved`), `manual` for a bug a person writes with `npm run bug:file`. The tracker's Source filter, its "UI/API Automation" badge and the export's Test Type read only this tag in lists.
- **Description:** short, plain English, one layout for API and UI bugs (since 2026-10-27). Each label is at column 0, because the BUGZILLA-UI `DescriptionReport` and export parse these exact spellings and drop unlabelled text:

  ```
  Classification: response.status-code
  Category: Functional
  Endpoint: POST /v2/profile/updateProfileImage/      (Representative endpoint: on a platform-wide bug; none on a UI bug)
  Module: User Profile V2
  Severity: major / Priority: High

  Summary:            2-4 plain sentences: what is broken, why it matters, how often it failed
  Steps to reproduce: numbered steps in the product (API: log in → run the curl → compare)
  Expected:
  Actual:             (+ the API calls that failed while a UI screen loaded / the endpoints a platform-wide bug hits)
  Response body (HTTP 500):   only when Actual does not already quote it
  How to fix:         one sentence, when the check has guidance
  curl:               API only; the token is $KPOST_TOKEN
  Owner: / Environment: <host> / Run date: <UTC> / Correlation ID: / Filed by:
  ```

  Long blocks are cut at 2,000 characters; the attached evidence file has everything. The Summary is
  `BugCandidate.summary`, display only: the validity gate and known-false-positives keep reading
  `narrative` and `actual`, so the new wording cannot change what gets filed.

- **Attachment:** `KP-XXXXXX-evidence.txt` with unabridged expected/actual and every sub-check.
- Secrets and personal data are masked before anything is written.

| Our severity | Bugzilla severity | Priority |
| ------------ | ----------------- | -------- |
| CRITICAL     | `critical`        | Highest  |
| HIGH         | `major`           | High     |
| MEDIUM       | `minor`           | Normal   |
| LOW          | `trivial`         | Low      |
| INFO         | `trivial`         | Lowest   |

`blocker` and `enhancement` are never used. Category comes from the validator: authentication, authorization and security checks are `Security`, performance checks `Performance`, accessibility (axe) findings `Accessibility`, everything else `Functional`. The tracker shows `minor`+`Normal` as Minor and `trivial` as Trivial, and its severity filter also pins the paired priority — so never edit one of the pair alone.

## 7. Commands — the review-checkpoint workflow

The standing workflow is three commands per product (added 2026-10-11; step 3 is `bug:apply` since
2026-10-27, so the tests run once):

```bash
npm run product:kpost-api          # 1. dry run — decisions now MATCH what the live run will do
npm run report:filing              # 2. the plan in plain English: WILL CREATE / REOPEN / COMMENT /
                                   #    CLOSE, RE-CHECK BY HAND, NEEDS YOUR REVIEW (held),
                                   #    SUPPRESSED (judged non-defects)
npm run bug:apply                  # 3. files/reopens/comments/closes that plan, without re-running
```

`product:kpost-api:file` is the one-step alternative (run and file together). `bug:apply` refuses a
plan over 24 h old, from a run that failed the run gate, from a one-off run (not a `product:*`
command), or already applied.

**RE-CHECK BY HAND** lists the open bugs no run can ever close, each with why:

- filed by hand: its tag is a readable name (`[KP-GROUPADMINEXIT]`), not the bench's 6-hex code, so
  no single automated check covers it;
- a speed bug: one fast run does not prove it fixed;
- its title names no single endpoint/test, or no check the bench can recognise.

Re-run each one's steps by hand and close it in Bugzilla yourself. KDoc/KWord bugs are not listed (that
module is paused). A bug whose check merely did not run this time is
not listed either: a later run closes it. The same list is in REPORT.md under "Re-check by hand".

The checkpoint (step 2) exists because some false positives are SEMANTIC — only a human knows
"12345 is our seeded value" or "that field is inert metadata". When a WILL CREATE item is not a real
bug, record it in `src/bug-tracker/gates/known-false-positives.ts` (fingerprint + reason + judgedBy + date);
it is then suppressed on every run, visibly, instead of littering Bugzilla with INVALID tickets.

Findings the engine is not confident enough to auto-file (intermittent repros, one-off flow 500s,
aggregate error-response findings overlapping specific ones) are HELD as `needs-review` — never filed
by `:file` or `bug:apply`. After you review them:

```bash
npm run bug:file-reviewed -- KP-A082D1            # preview the approved item (dry)
npm run bug:file-reviewed -- KP-A082D1 --live     # file it, with the engine's own prepared ticket text
```

It refuses to create when ANY ticket already carries the tag (and tells you to reopen that id if the
finding is a regression), and only accepts entries the report holds as `needs-review`.

```bash
BUGZILLA_MAX_FILE=5 npm run product:kpost-api:file   # stage a rollout

npm run product:kpost-api      # one product at a time
npm run product:kpost-admin
npm run product:kmail-api
```

Every run writes `reports/REPORT.json` — its `bugs` object holds the accepted and rejected candidates (with reasons) and, when filing ran, what happened to each (including the assignee). The human-readable form is Part 2 of `reports/REPORT.md`.

## 8. CI

CI never files. The workflow runs only the quality gate (typecheck, lint, format); every test run is
one serial process on the QA machine, so each defect is filed exactly once, from the complete run,
by the `*:file` command the owner chose to run. `BUGZILLA_URL` / `BUGZILLA_API_KEY` live in that
machine's `.env` and nowhere else.

## 9. Verified against the live instance

Proven end to end against Bugzilla 5.2 on 2026-09-12 with one marked verification ticket:

| Step                | Result                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Run 1 — file        | **Created bug 102** in `KPost API`, auto-assigned, whiteboard `[cat:Functional]`, summary tagged `[KPV2-LIVE01]`, evidence attached |
| Run 2 — same defect | **Commented** on bug 102. Created 0 — no duplicate                                                                                  |
| Human triage        | Resolved **INVALID**                                                                                                                |
| Run 3 — same defect | **judged-skip**: "a human judged this not a defect". No write of any kind                                                           |

The product went from 101 to 102 bugs: one ticket for the whole exercise, and it is closed.

Two instance facts worth knowing:

- The API key authenticates **only as the `api_key` query parameter**. As a header the request is anonymous and searches return nothing — which would make every run file duplicates.
- It did **not** mint a `KPA-###` alias for the new bug (bugs 1–101 carry one). Nothing depends on the alias.

## 10. Operating it

- **Start in dry run.** Read `reports/REPORT.json`, confirm the tickets and their owners, then lift the flag — ideally with `BUGZILLA_MAX_FILE=5` first.
- **Prove dedupe on your own instance:** run `npm run product:kpost-api:file` twice. The second run must report `still-open`, never `created`.
- **To stop filing immediately:** unset `BUGZILLA_API_KEY`, or set `BUGZILLA_DRY_RUN=true`.
- **Rotate the API key** if it has ever been pasted into a chat, ticket or log.
- **A ticket that is not a defect:** resolve it `INVALID` (or `WONTFIX`). The bench never re-files it.
- **Auto-close safety:** a bug closes only when its own (endpoint, validator) check re-ran clean this
  run — the run itself is the live replay — and a wrong close self-corrects (the next reproduction
  reopens the same id). BOLA/ownership and other business-rule exploit tickets classify as
  non-verifiable and are NEVER auto-closed; they stay open for a by-hand exploit replay, and
  `report:filing` lists them under RE-CHECK BY HAND (§7).
- **The bench is QA's re-test** (owner, 2026-10-27), following the BUGZILLA-UI tracker's workflow: a
  passing check closes the bug as `CLOSED` ("re-test passed"; an open bug goes `RESOLVED/FIXED` with
  the note, then `CLOSED`). It also re-tests the `RESOLVED/FIXED` "ready for re-test" queue developers
  leave: a pass closes it, a failure reopens it, anything else leaves it for a person, without a note.
  Bugs in `PENDING_APPROVAL`, `AWAITING_REQUIREMENT` or `IN_REVIEW` wait on a person (PM decision,
  requirement document, team-lead review): a pass is only noted, and listed in `report:filing` under
  CHECK PASSES, WAITING ON A PERSON.
- **Ownership changes** (a developer hands a module over): edit `ownership.config.ts`, and update the component defaults in Bugzilla. The drift test fails until both agree.
