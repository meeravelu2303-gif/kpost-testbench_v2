# Production-grade run — every API test type + full UI e2e

The single, complete way to exercise the KPost + KMail application: the whole API test-type matrix on
every endpoint, and the whole UI e2e surface. This is the operator guide for the `prodgrade:*`
commands; the deep detail of what each layer does lives in `docs/RUN-COMMANDS.md`,
`docs/validation-framework.md` and the §8 decision log in `CLAUDE.md`.

## What "production-grade" means here

- **API — every test type, every endpoint.** The engine applies every central validator to every
  registered KPost + KMail endpoint automatically (status, response schema, the four auth-token
  probes, injection, XSS, sensitive-data, performance, and the full request-fuzzer family — null,
  data-type, boundary, enum, empty, required, unknown-fields, invalid-payload, malformed-json,
  method-not-allowed, unsupported-media-type, empty-body), plus each endpoint's business rules and DB
  checks. `TEST_DB_MODE=true` turns the full fuzz/attack matrix on for **reads** (safe on the test
  DB); the `*_LIFECYCLE` gates drive the **write** flows through their self-cleaning lifecycles.
- **UI — every screen + every feature flow.** The deep screen sweep (JS crash / broken asset / render
  budget / responsive / a11y / content) over every route, plus every gated feature flow
  (compose/recall, actions, two-session receipts, copies, KMail send, Kall schedule, Settings, Group,
  Contacts, KDiary, Profile), driven by the `*_UI_LIFECYCLE` gates.
- **Valid bugs only.** Every finding passes the validity gate, is deduped build-independently, is
  consolidated (systemic faults → one ticket), and — on a `:file` run — new valid bugs are filed while
  already-fixed ones are auto-resolved. Payloads are verified correct so a wrong body never files a
  false bug (see "Payload correctness" below).

## Target and the safety controls that stay armed

The target is the **disposable automation test database** `https://testingapi.kpostindia.com`
(`.env`: `KPOST_API_BASE_URL`), KMail on `kmail5.kpostindia.com`. Regardless of any flag:

- **SMS/OTP kill-switch** — no OTP/SMS/email is ever sent to a real host, in any mode.
- **QA-identifier guard** — no request may name a record outside our QA accounts.
- **`external` / `global` writes stay blocked on the live host** (account provisioning, another user's
  password, app version) — `WRITE_FUZZ` opens **only** `data`-side-effect writes on the test DB.

## The commands

Default is **preview** (dry-run: runs everything, writes the report, files nothing). The `:file`
variant arms Bugzilla filing + auto-resolve. Run from the repo root.

| Command                              | What it runs                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run prodgrade:preview`          | **Everything, dry-run** — the API matrix then the UI e2e (two invocations; see note).                                                |
| `npm run prodgrade:file`             | Everything, **filing valid bugs + auto-resolving fixed ones**.                                                                       |
| `npm run prodgrade:api:preview`      | API only: full read matrix (`TEST_DB_MODE`) + write lifecycles, KPost + KMail, dry-run.                                              |
| `npm run prodgrade:api:file`         | API only, filing + auto-resolve.                                                                                                     |
| `npm run prodgrade:api:deep:preview` | API + **deep write-fuzzing** (`WRITE_FUZZ`): the fuzz/attack matrix on `data` **writes** too — persists junk, test DB only. Dry-run. |
| `npm run prodgrade:api:deep:file`    | API deep write-fuzz, filing + auto-resolve.                                                                                          |
| `npm run prodgrade:ui:preview`       | UI e2e only: every screen + every feature flow, dry-run.                                                                             |
| `npm run prodgrade:ui:file`          | UI e2e, filing UI bugs (with proof screenshots/videos).                                                                              |

**Why API and UI are separate invocations.** The UI seeds a browser session for the QA account; an
API run that logs in as the same account displaces that single session, after which the UI specs
safely **skip** (they never false-fail — the session guard sends them to `SKIP`, not a bug). So
`prodgrade:preview` runs the API pass, then the UI pass, each producing its own consolidated report.
Run them at different times / accounts for maximum UI coverage.

### Recommended progression

1. `npm run check` — typecheck + lint + format must be clean.
2. `npm run test:framework` — the guards (payload audit, frontend-verified payloads, coverage ledger,
   routing, live-safety) must be green.
3. `npm run prodgrade:api:preview` → read `reports/REPORT.md` (execution health + bugs). Confirm the
   findings are real before filing.
4. `npm run prodgrade:ui:preview` → read the UI section of the report.
5. When satisfied: `npm run prodgrade:api:file` and `npm run prodgrade:ui:file` (or the deep tier on
   the disposable DB: `npm run prodgrade:api:deep:file`).

## Reading the results

Every run writes exactly two files — **one Markdown and one JSON** — nothing else:

- **`reports/REPORT.md`** — the single human report, in two parts: **Part 1 execution health**
  (endpoints tested, pass/fail/skip/warn per module + per UI project, worst endpoint first) and
  **Part 2 the bug report** (distinct valid defects, filed-by-developer, and the findings NOT filed
  with the reason; on a `:file` run, also what was auto-resolved). No duplicate rows.
- **`reports/REPORT.json`** — the structured companion (run summary + quality gate + the `bugs`
  object with every candidate, the filing outcome and the resolve summary).

## Payload correctness (why findings are trustworthy)

A wrong/incomplete request body files a false bug (and, on the shared DB, can contaminate another
endpoint). Two guards keep every payload honest, both in `npm run test:framework`:

- **`tests/framework/payload-audit.spec.ts`** — every endpoint sends every field the workbook
  documents in its request _example_. A `productionSafe` endpoint that under-sends fails the build.
- **`tests/framework/frontend-payload.spec.ts`** — for endpoints the workbook documents no body for,
  the field set is pinned to what the **real KPost/KMail frontend** sends (and, for routes the
  frontend never calls, the backend controller/DTO). Verified against source on 2026-09-18; a later
  edit that drops or renames a field fails the build.
