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

KPost is one product built from modules that are maintained in **separate repositories by different developers**. A defect is only useful when it reaches the person who owns that module, so ownership is declared once, in [`src/config/ownership.config.ts`](../src/config/ownership.config.ts):

| Suite       | Module                | Repository              | Bugzilla product | Ticket goes to                               |
| ----------- | --------------------- | ----------------------- | ---------------- | -------------------------------------------- |
| `kpost-api` | KPost core API        | KPOST webservice        | `KPost API`      | **Jaganathan Murthy** (jagan@kpost.in)       |
| `admin-api` | Admin module API      | admin-module (own repo) | `KPost Admin`    | **Jaganathan Murthy** (jagan@kpost.in)       |
| `kmail-api` | KMail module API      | kmail (own repo)        | `KMail API`      | **Jitendra Kumar** (jitendra@kpost.in)       |
| `kpost-ui`  | KPost React front end | KPOST_REACTJS_2023_V1   | `KPost UI`       | **Ayyappan Ashok** (ayyappan@kpostindia.com) |

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
                       open ticket        → comment
                       INVALID/WONTFIX/…  → skip forever
                       FIXED but back     → reopen
                       untagged match     → comment + adopt
                       nothing found      → create, assign, attach evidence
                       search failed      → file nothing
   ▼
reports/REPORT.json + console summary
```

Implementation: [`src/bug-tracker/`](../src/bug-tracker/), reporter in [`src/reporting/bugzilla-reporter.ts`](../src/reporting/bugzilla-reporter.ts). Nothing in this path can fail a run or change its exit code.

## 3. Configuration

Environment-driven ([`.env.example`](../.env.example), validated in [`src/config/env.ts`](../src/config/env.ts)). With `BUGZILLA_URL` or `BUGZILLA_API_KEY` unset, the reporter says so in one line and files nothing.

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

A bench that cannot run must be loud, never clean. If every spec fails to import, the run finds zero defects, which looks exactly like a healthy API. [`assessRunValidity`](../src/bug-tracker/validity-gate.ts) files nothing when:

- errors occurred outside any test (specs failed to load, setup faulted),
- the run was interrupted or timed out,
- zero tests executed,
- fewer than half the collected tests produced a result (the run collapsed part-way).

### The candidate gate — does the evidence support the claim?

[`candidateRejection`](../src/bug-tracker/validity-gate.ts) drops a finding when:

- its severity is below `BUGZILLA_MIN_SEVERITY`,
- the evidence is an **infrastructure or bench fault** (`ECONNREFUSED`, timeouts, a closed browser, a framework error, a missing principal, the production guard),
- the endpoint **throttled our run** (429) — the server working correctly, not a defect. A _missing_ rate limit is the opposite case and still files,
- it **claims exposure or bypass but the server refused the request** (401/403),
- it **claims identifiers are enumerable but the response was 404** — nothing resolved,
- it carries no expected/actual evidence, so the ticket would not be actionable.

Only `FAILED` validations become candidates: a `WARNING` is not a defect, and a `SKIPPED` check means nothing was verified. Flaky tests (passed on retry) are not filed either.

Every rejection is printed and written to `reports/REPORT.json`. A gate nobody can see is a gate nobody can correct.

## 5. How duplicates are prevented

Each defect gets a **stable identity** — `KPV2-XXXXXX`, a hash of the endpoint, the check and the _normalised_ failure message. Normalising is what makes dedupe work: correlation IDs, generated e-mails, UUIDs, ports and durations change every run and would otherwise mint a new id each night ([`bug-fingerprint.ts`](../src/bug-tracker/bug-fingerprint.ts)).

The id is carried as `[KPV2-XXXXXX]` in the summary, and every run searches for it — in summaries and on whiteboards — before deciding:

| Found                                                 | Action                          | Why                                                           |
| ----------------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| An **open** ticket                                    | Comment "reproduced"            | The team already tracks it                                    |
| Resolved `INVALID`/`WONTFIX`/`WORKSFORME`/`DUPLICATE` | **Skip forever**                | A human judged it; re-filing overrides that judgement nightly |
| Resolved otherwise (e.g. `FIXED`)                     | **Reopen** the original         | A regression belongs on its ticket                            |
| An untagged **open** ticket for the same fault        | Comment + tag it                | Adopts tickets filed by a human or the previous bench         |
| Nothing                                               | Create, assign, attach evidence | Genuinely new                                                 |
| **The search failed**                                 | File nothing                    | A transient error must never mint a duplicate                 |

The same fault on several browsers or tests is merged into one ticket that records the count and lists the browsers.

## 6. What a ticket looks like

- **Summary:** `[KPV2-A1B2C3] POST /users: expected 400/422, got 500` — trimmed to 255 characters with the tag intact.
- **Assignee:** the module's developer (see §1).
- **Whiteboard:** `[cat:Security]`, plus `[browser:chromium,webkit]` for UI defects — the format the BUGZILLA-UI backend parses.
- **Description:** line-anchored (`Classification:`, `Category:`, `Representative endpoint:`, `Module:`, `Expected:`, `Actual:`, `Repro:`, `Owner:`, `Environment:`, `Run date:`) so the Bug Tracker UI renders a structured report. Includes the **correlation ID** for tracing the request in application logs.
- **Attachment:** `KPV2-XXXXXX-evidence.txt` with unabridged expected/actual and every sub-check.
- Secrets and personal data are masked before anything is written.

| Our severity | Bugzilla severity | Priority |
| ------------ | ----------------- | -------- |
| CRITICAL     | `critical`        | Highest  |
| HIGH         | `major`           | High     |
| MEDIUM       | `minor`           | Normal   |
| LOW          | `trivial`         | Low      |

`blocker` and `enhancement` are never used. Category comes from the validator: authentication, authorization and security checks are `Security`, performance checks `Performance`, everything else `Functional`.

## 7. Commands

```bash
npm run kpost    # dry run: prints exactly what would be filed, and to whom
npm run kpost:file       # files for real (BUGZILLA_DRY_RUN=false)

BUGZILLA_MAX_FILE=5 npm run kpost:file   # stage a rollout

npm run kpost      # one module at a time
npm run test:admin
npm run kmail
```

Every run writes `reports/REPORT.json` — its `bugs` object holds the accepted and rejected candidates (with reasons) and, when filing ran, what happened to each (including the assignee). The human-readable form is Part 2 of `reports/REPORT.md`.

## 8. CI

Shards never file. Each sharded job produces a blob report, and bugs are filed **once** from the merged report in the `merge-reports` job ([`merge.config.ts`](../merge.config.ts)) — otherwise two shards would race to file the same defect.

Set `BUGZILLA_URL` as a variable and `BUGZILLA_API_KEY` as a secret. Filing stays off until the `BUGZILLA_DRY_RUN` repository variable is set to `false`.

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
- **Prove dedupe on your own instance:** run `npm run kpost:file` twice. The second run must report `commented`, never `created`.
- **To stop filing immediately:** unset `BUGZILLA_API_KEY`, or set `BUGZILLA_DRY_RUN=true`.
- **Rotate the API key** if it has ever been pasted into a chat, ticket or log.
- **A ticket that is not a defect:** resolve it `INVALID` (or `WONTFIX`). The bench never re-files it.
- **Ownership changes** (a developer hands a module over): edit `ownership.config.ts`, and update the component defaults in Bugzilla. The drift test fails until both agree.
