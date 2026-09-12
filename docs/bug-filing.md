# Automatic Bugzilla filing

Failures found by this bench become Bugzilla tickets automatically — **valid** tickets, and never duplicates.

Bugzilla has no delete, only resolve. A wrong ticket costs a person's attention permanently, so the design is conservative at every step: dry run by default, two validity gates before anything is filed, and a live dedupe search before every create.

> **Target instance:** `BUGZILLA_URL` (Bugzilla 5.2). Products: `KPost API` for API defects, `KPost UI` for browser defects.

## Contents

1. [The flow](#1-the-flow)
2. [Configuration](#2-configuration)
3. [What may become a ticket: the two gates](#3-what-may-become-a-ticket-the-two-gates)
4. [How duplicates are prevented](#4-how-duplicates-are-prevented)
5. [What a ticket looks like](#5-what-a-ticket-looks-like)
6. [Routing: products, components, severity](#6-routing-products-components-severity)
7. [Commands](#7-commands)
8. [CI](#8-ci)
9. [Verified against the live instance](#9-verified-against-the-live-instance)
10. [Operating it](#10-operating-it)

## 1. The flow

```
Playwright run
   │  validation reports (attachments)  +  failed browser tests
   ▼
RUN GATE ........... did this run actually run? (collapsed run → file nothing)
   ▼
Candidates ......... built only from evidence the run produced
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
                       nothing found      → create + attach evidence
                       search failed      → file nothing
   ▼
reports/bugs/{candidates,filing}.json + console summary
```

Implementation: [`src/bug-tracker/`](../src/bug-tracker/) with the reporter in [`src/reporting/bugzilla-reporter.ts`](../src/reporting/bugzilla-reporter.ts). Nothing in this path can fail a run or change its exit code.

## 2. Configuration

All of it is environment-driven ([`.env.example`](../.env.example), validated in [`src/config/env.ts`](../src/config/env.ts)). With `BUGZILLA_URL` or `BUGZILLA_API_KEY` unset, the reporter says so in one line and files nothing.

| Variable                         | Default                        | Purpose                                                                           |
| -------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `BUGZILLA_URL`                   | —                              | REST root, e.g. `http://192.168.0.50/rest`                                        |
| `BUGZILLA_API_KEY`               | —                              | API key. Sent as the `api_key` query parameter (this instance ignores the header) |
| `BUGZILLA_DRY_RUN`               | `true`                         | **Default is a dry run.** Set `false` to file for real                            |
| `BUGZILLA_PRODUCT`               | `KPost API`                    | Product for API defects                                                           |
| `BUGZILLA_UI_PRODUCT`            | `KPost UI`                     | Product for browser defects                                                       |
| `BUGZILLA_VERSION`               | `unspecified`                  | Version field; falls back to a real version of the product                        |
| `BUGZILLA_FALLBACK_COMPONENT`    | `kpost-webservice-application` | Used when an area maps to no component                                            |
| `BUGZILLA_UI_FALLBACK_COMPONENT` | `General`                      | Same, for the UI product                                                          |
| `BUGZILLA_MIN_SEVERITY`          | `MEDIUM`                       | Lowest severity that may become a ticket                                          |
| `BUGZILLA_MAX_FILE`              | `0`                            | Staged rollout: file at most N per run (0 = no cap)                               |
| `BUGZILLA_FILE_UI_FAILURES`      | `true`                         | Also file browser test failures                                                   |

The key is a secret: keep it in `.env` (git-ignored) or a CI secret. It is never logged, never written into a ticket, and never committed.

## 3. What may become a ticket: the two gates

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
- the endpoint **throttled our run** (429) — that is the server working correctly, not a defect. A _missing_ rate limit is the opposite case and still files,
- it **claims exposure or bypass but the server refused the request** (401/403) — a refusal cannot evidence a leak,
- it **claims identifiers are enumerable but the response was 404** — nothing resolved,
- it carries no expected/actual evidence, so the ticket would not be actionable.

Only `FAILED` validations become candidates. A `WARNING` is not a defect and a `SKIPPED` check means the framework did not verify anything. Flaky tests (passed on retry) are not filed either — unstable evidence makes a ticket nobody can act on.

Every rejection is printed and written to `reports/bugs/candidates.json`. A gate nobody can see is a gate nobody can correct.

## 4. How duplicates are prevented

Each defect gets a **stable identity** — `KPV2-XXXXXX`, a hash of the endpoint, the check and the _normalised_ failure message. Normalising is what makes dedupe work: correlation IDs, generated e-mails, UUIDs, ports and durations change every run and would otherwise mint a new id each night ([`bug-fingerprint.ts`](../src/bug-tracker/bug-fingerprint.ts)).

The id is carried as `[KPV2-XXXXXX]` in the ticket summary, and every run searches for it — in summaries and on whiteboards — before deciding what to do:

| Found                                                 | Action                  | Why                                                                                  |
| ----------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| An **open** ticket                                    | Comment "reproduced"    | The team already tracks it                                                           |
| Resolved `INVALID`/`WONTFIX`/`WORKSFORME`/`DUPLICATE` | **Skip forever**        | A human judged it; re-filing overrides that judgement nightly                        |
| Resolved otherwise (e.g. `FIXED`)                     | **Reopen** the original | A regression belongs on its ticket, not on a new number                              |
| An untagged **open** ticket describing the same fault | Comment + tag it        | Adopts tickets filed by a human or the previous bench, so we never file a second one |
| Nothing                                               | Create, attach evidence | Genuinely new                                                                        |
| **The search failed**                                 | File nothing            | A transient error must never mint a duplicate                                        |

The same fault on several browsers or several tests is merged into one ticket that records the count and lists the browsers.

## 5. What a ticket looks like

- **Summary:** `[KPV2-A1B2C3] POST /users: expected 400/422, got 500` — trimmed to Bugzilla's 255-character limit with the tag intact.
- **Whiteboard:** `[cat:Security]`, plus `[browser:chromium,webkit]` for UI defects. This exact format is a contract with the BUGZILLA-UI repo, which parses it into a category filter.
- **Description:** line-anchored (`Classification:`, `Category:`, `Representative endpoint:`, `Module:`, `Expected:`, `Actual:`, `Repro:`, `Owner:`, `Environment:`, `Run date:`) so the Bug Tracker UI renders a structured report. It includes the **correlation ID**, so one request can be traced from the ticket into the application logs.
- **Attachment:** `KPV2-XXXXXX-evidence.txt` with the unabridged expected/actual and all sub-checks.
- **Assignee:** never set. Each component's default assignee owns its tickets, and the server mints the `KPA-###` alias itself — a client-chosen alias only collides with it.
- Secrets and personal data are masked before anything is written.

## 6. Routing: products, components, severity

API defects route by endpoint tag; UI defects by spec path ([`bugzilla.config.ts`](../src/config/bugzilla.config.ts)):

```ts
export const API_COMPONENT_BY_TAG = {
  auth: 'Authentication V2',
  users: 'User Profile V2',
  companies: 'Company Administration',
  dictionary: 'Common Reference Data & Utilities V2',
  platform: 'kpost-webservice-application',
};
```

Adding an API area is one line here. Before anything is filed, the product, component and version are checked against the live instance; an unknown component falls back to the product's catch-all rather than losing the ticket (Bugzilla refuses a create with an unknown component).

| Our severity | Bugzilla severity | Priority |
| ------------ | ----------------- | -------- |
| CRITICAL     | `critical`        | Highest  |
| HIGH         | `major`           | High     |
| MEDIUM       | `minor`           | Normal   |
| LOW          | `trivial`         | Low      |

`blocker` and `enhancement` are never used: `blocker` is Bugzilla's term for something blocking _our_ work, and nothing here is a feature request. Category comes from the validator: authentication, authorization and security checks are `Security`, performance checks are `Performance`, everything else is `Functional`.

## 7. Commands

```bash
npm run bugs:preview    # dry run: prints exactly what would be filed, writes nothing
npm run bugs:file       # files for real (BUGZILLA_DRY_RUN=false)

# stage a rollout: file a handful, inspect them, then run again and confirm it comments
BUGZILLA_MAX_FILE=5 npm run bugs:file

npm test                # any run files too, but only when BUGZILLA_DRY_RUN=false
```

Every run writes `reports/bugs/candidates.json` (accepted and rejected, with reasons) and `reports/bugs/filing.json` (what happened to each one).

## 8. CI

Shards never file. Each sharded job produces a blob report, and bugs are filed **once** from the merged report in the `merge-reports` job ([`merge.config.ts`](../merge.config.ts)) — otherwise two shards would race to file the same defect.

Set `BUGZILLA_URL` as a variable and `BUGZILLA_API_KEY` as a secret. Filing stays off until `BUGZILLA_DRY_RUN` is set to `false` (a repository variable), so turning it on is a deliberate, reviewable change.

## 9. Verified against the live instance

The whole path was proven end to end against Bugzilla 5.2 on 2026-09-12, with one deliberately
marked verification ticket:

| Step                      | Result                                                                                                                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run 1 — file              | **Created bug 102** in `KPost API` / `kpost-webservice-application`, auto-assigned to the component's default assignee, whiteboard `[cat:Functional]`, summary tagged `[KPV2-LIVE01]`, description rendered from the anchors, `KPV2-LIVE01-evidence.txt` attached |
| Run 2 — same defect again | **Commented** on bug 102. Created 0 — no duplicate                                                                                                                                                                                                                |
| Human triage              | Bug 102 resolved **INVALID**                                                                                                                                                                                                                                      |
| Run 3 — same defect again | **judged-skip**: "bug 102 is closed as INVALID — a human judged this not a defect". No write of any kind                                                                                                                                                          |

The product went from 101 to 102 bugs: one ticket for the whole exercise, and it is closed.

Two things worth knowing about this instance:

- The API key authenticates **only as the `api_key` query parameter**. Sent as an
  `X-BUGZILLA-API-KEY` header the request is treated as anonymous, and searches then return
  nothing — which would make every run file duplicates. The client always uses the query parameter.
- It did **not** mint a `KPA-###` alias for the new bug (bugs 1–101 carry one). Nothing depends on
  the alias: tickets are identified by their bug id and by our `[KPV2-XXXXXX]` tag.

## 10. Operating it

- **Start in dry run.** Read `reports/bugs/candidates.json`, confirm the tickets are ones you would file by hand, then lift the flag — ideally with `BUGZILLA_MAX_FILE=5` first.
- **Prove dedupe on your own instance:** run `npm run bugs:file` twice. The second run must report `commented`, never `created`.
- **To stop filing immediately:** unset `BUGZILLA_API_KEY`, or set `BUGZILLA_DRY_RUN=true`.
- **Rotate the API key** if it has ever been pasted into a chat, ticket or log. The bench reads it from the environment only.
- **A ticket that is not a defect:** resolve it `INVALID` (or `WONTFIX`). The bench never re-files it — that is what makes triage permanent.
- **Tuning what files:** raise `BUGZILLA_MIN_SEVERITY` to reduce volume; extend the rules in [`validity-gate.ts`](../src/bug-tracker/validity-gate.ts) when a class of false positive appears, and add a test for it in [`tests/framework/bug-tracker.spec.ts`](../tests/framework/bug-tracker.spec.ts).
