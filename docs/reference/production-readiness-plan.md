# Production-readiness plan — from "a bench that runs" to "a bench whose verdict is trusted"

Written 2026-10-10 from a measured read of the repository, the generated ledgers and the last full
dry run (`REPORT-kpost-full-dry4-qatest-2026-10-10`). Hand-written; update the numbers when they
change and move this file to `archive/` when every exit criterion below is met.

**The mission (owner, 2026-10-10):** a production-grade test bench that covers every type of test,
follows the application's real flows, skips nothing silently, and finds every valid bug — then files
only valid bugs.

**What "production grade" means here, in checkable terms:**

1. Every run's verdict is trustworthy: a pass means the flow worked, a fail means a real defect, a
   skip names a reason that is either an owner decision or a provisioning gap, never a dead selector.
2. Every test type the application needs exists, runs under a product command, and is visible in a
   generated ledger (nothing is covered only in someone's head).
3. The structure mirrors the application: one folder per module on both the API and the UI side,
   one flow document per module, one page object per screen, and the same module names everywhere
   (specs, ownership config, Bugzilla components, docs).
4. The pipeline files once per product, never drips, never duplicates, and comments on every open bug
   in plain English on every run.
5. Operations are routine: preflight, dry run, file, read — on a calendar, after every deploy, with
   the numbers in section 6 trending the right way.

---

## 1. Where the bench stands today (measured)

### 1.1 Inventory

| Surface                         | Files | Tests (static) | Notes                                                                        |
| ------------------------------- | ----: | -------------: | ---------------------------------------------------------------------------- |
| API · KPost (`tests/api/kpost`) |   105 |            310 | 16 module folders; engine generates one test per endpoint × validator on top |
| API · KMail (`tests/api/kmail`) |    12 |             48 |                                                                              |
| API · Admin (`tests/api/admin`) |     6 |              7 | scope = the owner's PDF (38 definitions)                                     |
| UI · KPost (`tests/e2e`)        |   123 |            256 | flat folder; 3 browsers; 12-screen sweep × 9 checks                          |
| UI · Admin (`tests/e2e-admin`)  |     5 |             11 |                                                                              |
| Bench self-tests (`framework`)  |    35 |            233 | ledgers, ownership drift, payload audit, reporter, template drift            |

Endpoints: **446 documented** in the workbook, **353 registered and tested**, **122 run on the default
live pass** and **193 more** via the gated self-cleaning lifecycle flows; **43** are not driven on
live for a written, evidence-based reason (`docs/scope/blocked-endpoints-rationale.md`).

### 1.2 The last full KPost API dry run, in one table

| Measure                                    |   Value | Reading                                                                                                    |
| ------------------------------------------ | ------: | ---------------------------------------------------------------------------------------------------------- |
| Endpoints exercised                        |     169 | KPost API only, qatest accounts                                                                            |
| Checks generated                           |  22,294 |                                                                                                            |
| Checks that applied and ran                |  10,413 | pass rate **86%**                                                                                          |
| Skipped — not applicable to the endpoint   |   9,013 | by design (a GET has no body checks); fine                                                                 |
| Skipped — recoverable (needs a fixture/id) |   1,408 | **a gap to close**: ids, seeds, second principals                                                          |
| Skipped — blocked by an open defect        |   1,338 | correct behaviour; shrinks as bugs are fixed                                                               |
| Skipped — deliberate / environmental       | 96 / 23 | owner pauses and host blips                                                                                |
| AUTHORIZATION checks run                   |   **0** | all 2,320 skipped — the cross-account validator never had what it needs                                    |
| BUSINESS_RULE checks                       |   0 / 6 | six failed, none passed: the rule layer is thin at the engine level                                        |
| DATABASE checks                            |   1 / 6 | the engine's DB validators are thin; the 44 DB-guarded specs DO run (QA DB reachable, verified 2026-10-10) |
| Endpoints failing the quality gate         |     114 | mostly negative-input validators (data-type, null, empty body, XSS/injection)                              |

### 1.3 Test types — what exists, what is partial, what is missing

| Type                                                                                  | State             | Evidence / gap                                                                                  |
| ------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| Contract (schema from workbook)                                                       | **Built**         | `contract:*` pipeline, `response.schema`, payload audit                                         |
| API functional per endpoint                                                           | **Built**         | the engine: ~50 validators × every registered endpoint                                          |
| API flows along the app journey                                                       | **Built**         | `feature.spec.ts` / `*-workflow.spec.ts` per module, `*_LIFECYCLE` gated, self-cleaning         |
| Negative input / robustness                                                           | **Built**         | request.\* validators; 114 endpoints currently fail them (real findings)                        |
| Authentication                                                                        | **Built**         | missing/expired/aged token validators                                                           |
| Authorization (cross-account)                                                         | **Not running**   | 2,320 checks skipped; 12 hand-written BOLA/IDOR specs do exist in `security/`                   |
| Injection / XSS                                                                       | **Built**         | security validators + UI `*-security.spec.ts` (execution-based, dialog listener)                |
| Database assertions                                                                   | **Built**         | repositories, named validations and 44 DB-asserted specs; the QA DB is configured and reachable |
| Business rules (FRD)                                                                  | **Partial**       | ~110 of 165 FRs covered, ~25 GAP, ~30 out of scope (`requirements-frd.md`)                      |
| Performance (per-request)                                                             | **Built, paused** | validators run; load/soak absent; shared server = night-only by owner rule                      |
| Concurrency                                                                           | **Built, paused** | `CONCURRENCY_LIFECYCLE`; same rule                                                              |
| UI functional flows per module                                                        | **Built**         | 123 specs; business-tier specs (7) cannot run under the product command — see 2.1               |
| UI screen sweep (health, layout, console, images, DOM, security, content, perf, a11y) | **Built**         | 12 screens; the app has ~30 routes — the rest are reached by flow specs only                    |
| Accessibility (WCAG via axe)                                                          | **Built**         | per-screen sweep + dynamic-state specs; evidence overlays                                       |
| Cross-browser                                                                         | **Built**         | chromium / firefox / webkit; WebKit needs batching                                              |
| Responsive / viewport                                                                 | **Partial**       | `ui.layout` check; 3 specs set viewports; no declared viewport matrix                           |
| Visual regression                                                                     | **Minimal**       | one `visual.spec.ts`; no baseline discipline                                                    |
| Keyboard / focus                                                                      | **Minimal**       | one `keyboard.spec.ts`                                                                          |
| Internationalisation                                                                  | **Absent**        | the app ships English / Russian / Japanese; nothing switches language                           |
| Resilience (UI under API failure)                                                     | **Minimal**       | `home-api-handling.spec.ts` only                                                                |
| Session / token lifecycle (UI)                                                        | **Partial**       | login-session, cross-account, aged-token API validator                                          |
| Smoke                                                                                 | **Built**         | `VALIDATION_PROFILE=SMOKE`                                                                      |
| Admin UI                                                                              | **Partial**       | 5 specs; role-gating limits depth; host reachability varies                                     |

### 1.4 What is already production-grade and must be protected

- One validation defined once, applied everywhere; endpoint definitions say _what_, the engine says _how_.
- The filing pipeline: candidates → cascade consolidation → validity gate → run sanity gate → live
  dedupe → file with proof → status pass over every open bug → report. Built, tested, documented.
- Ownership declared once; a framework test fails on drift. Five Bugzilla products, five commands.
- Generated ledgers that cannot drift from the code (coverage, live endpoints, blocked set,
  component routing, payload audit, UI coverage).
- Safety that no flag can switch off: QA-identifier guard, OTP kill-switch, global/external side-effect blocks, Admin DB read-only.
- Preflight, env-template drift test, lint policy with a tracked debt list, CI quality gate.

### 1.5 What is not, in order of damage

1. **Silent skips that look like passes.** Found this week: a User Management test skipping for
   weeks on a changed placeholder; seven business-tier UI specs that the product command can never
   run (`QATEST_ONLY` removed their accounts while the command also set their enabling flag —
   FIXED later the same day: the switch now keeps the business tiers, see the decision log).
   The skip ledger (`docs/generated/skips.md`) counts 48 "retune" sites — "did not open on this
   build — needs a codegen re-tune" and its variants — across 19 specs, 22 of them in Contacts: each
   is either a dead selector or a real defect, and today nobody can tell which from the report.
2. **Authorization checks never run.** The single most valuable bug class on this platform (every
   module audit found IDOR/BOLA) is covered only by hand-written specs, not by the engine.
3. **Database validators thin at the engine level.** (Corrected 2026-10-10: the QA DB is reachable and
   the 44 DB-guarded specs run; the earlier "mostly off" reading came from a probe that mis-read a
   host carrying its port.) What remains: only a handful of engine-level DATABASE checks exist (1
   passed / 6 failed last run), and they are where silent-failure bugs (SUCCESS returned, nothing
   persisted) are caught — every write flow should end in a row assertion.
4. **Timing debt.** 115 fixed waits / forced clicks remain; each can produce a wrong verdict either way.
5. **Flat UI folder.** 123 files with a module prefix in the name instead of a module folder; the API
   side already has the right shape. Harder to see gaps, harder to route, harder to onboard.
6. **Screen registry covers 12 of ~30 routes.** Settings sub-panels, User Management, KPoster,
   Katchup sub-screens are exercised by flow specs but get no sweep checks and no a11y pass.
7. **Cross-cutting types are thin or absent**: visual, keyboard, i18n, responsive matrix, resilience.
8. **Owner pauses with no end date**: KDoc, performance, concurrency.

---

## 2. Target structure — the application flow as the spine

The bench already follows the journey `REGISTER → ACTIVATE → LOGIN → modules`. The target makes
that spine visible in every folder so a reader can ask "is Kall covered?" and find one place per layer.

```
tests/
  api/<product>/<module>/        contract wrappers · feature (lifecycle) · workflow (DB-asserted) · security
  e2e/<module>/                  functional · security · accessibility · (visual) — one folder per module ← CHANGE (today: flat)
  e2e/support/<module>.ts        shared navigation per screen, waits on screen state, no sleeps ← PATTERN (started: usermanagement)
  e2e-admin/<area>/              same shape for the Admin UI
  framework/                     ledgers + drift tests; a new ledger per layer added below
src/ui/screens.ts                every route in the app, with ready selectors and controls ← EXTEND 12 → all
src/config/ownership.config.ts   module → component → owner, the single naming authority
docs/modules/<module>-flow.md    one per module: states, codes, the flow, payloads, gating ← EXTEND to every module
docs/generated/*                 add: skip ledger, authz ledger, flow ledger (FR → spec), viewport/visual ledger
```

Layers, bottom to top, and the ledger that proves each:

| Layer | What it proves                                         | Ledger (generated)               |
| ----- | ------------------------------------------------------ | -------------------------------- |
| L0    | the bench itself is sound (self-tests, CI, preflight)  | `framework` run, `npm run check` |
| L1    | contract: every documented endpoint, right shape       | `coverage.md`, payload audit     |
| L2    | endpoint behaviour: auth, negative input, response     | `live-endpoints.md`              |
| L3    | module flows along the journey, self-cleaning          | **flow ledger** (new): FR → spec |
| L4    | authorization and abuse: stranger vs owner on every id | **authz ledger** (new)           |
| L5    | persistence: the row agrees with the response          | DB validation registry           |
| L6    | UI flows per module, three browsers                    | `ui-coverage.md` (extended)      |
| L7    | cross-cutting: a11y, visual, keyboard, viewport, i18n  | **ui-matrix ledger** (new)       |
| L8    | performance and concurrency (scheduled window)         | run report, thresholds config    |
| Pipe  | file once, dedupe, comment, close                      | `REPORT.md` bug section          |

Naming rule (already mostly true, make it total): the module id in a spec path, in `ownership.config.ts`,
in the Bugzilla component map and in `docs/modules/` is the **same word**. A framework test enforces it.

---

## 3. The plan — phases with exit criteria

Each phase ends only when its exit criterion is measured, not when the work "feels done". Phases 1
and 2 are the production-grade threshold; 3 to 5 are what keeps it there and widens it.

### Phase 0 — Decisions and inventory (this week; needs the owner)

Deliverables

- **Skip inventory** — DONE 2026-10-10: `docs/generated/skips.md`, written by
  `tests/framework/skip-ledger.spec.ts`; every `test.skip` site in one of five classes, and the build
  fails on an unclassifiable reason. 518 sites: 48 retune, 37 blocked by a defect, 236 provision,
  139 owner decision, 58 live condition.
- **Decisions recorded in the decision log** (the owner's call, not the bench's):
  1. Business-tier accounts for UI: dedicated qatest business accounts (recommended; S and M tier,
     bench-only) or allow the shared business accounts under a separate command.
  2. ~~`KPOST_QA` database connection~~ — VERIFIED 2026-10-10: configured, reachable, asserting. Nothing to do.
  3. KDoc/KOS: lift the pause or keep it, with a date to revisit.
  4. Performance and concurrency: a weekly night window with the kill-switch, or keep paused.
  5. Forgot-password spare account: re-provision (unblocks #821–824 and the OTP-adjacent flows).
  6. Admin API host reachability from the QA machine (timed out at the last preflight).
- File the Firefox User Management crash (React #327) by hand after the unfiltered duplicate check.

Exit: every skip has one of three labels; six decisions dated in the log.

### Phase 1 — Trust: no silent skips, no timing guesses (2–3 weeks of module sessions)

Deliverables

- The 48 "retune" skips re-checked live, one module at a time: each becomes a working test, a
  filed defect, or a dated owner-decision skip. Same pass clears that module's waits and forced
  clicks (115 → 0). Order by retune count then debt: Contacts 22, Profile 8, Settings 4 (+27 debt),
  Kall 3 (+13 debt), Signup/Login 4, Katchup (15 debt), Admin UI (10 debt), then the rest.
- **Skip policy, enforced by a framework test**: a `test.skip` reason must match a registered
  reason class (provision / owner-decision / live-condition); "needs a re-tune" is no longer a valid
  class — a selector that does not match is a failure.
- **Flaky policy**: a test that passed on retry counts as not clean (already true for resolve);
  extend to the report headline so flakes are visible per run.
- Business-tier UI specs running under their own product path (per the Phase 0 decision).

Exit: debt 0; zero "re-tune" skips; the skip ledger shows only provision / owner / live-condition;
a dry run of every product completes with the run-sanity gate green.

### Phase 2 — Coverage completeness by type (3–4 weeks)

Deliverables

- **Authorization engine coverage**: give the authz validators what they need (a second principal
  and a resource-ownership hint per endpoint definition, `ownedBy` / `foreignId`), so the 2,320
  skipped checks run. Keep the hand-written BOLA specs as the deep layer. Ledger: `authz.md`.
- **Database layer deepened**: the 44 DB-guarded specs already run; every
  write endpoint in a lifecycle flow gets at least one row assertion.
- **FRD gaps closed**: the ~25 GAP rows in `requirements-frd.md` become specs or dated out-of-scope
  entries; the Group-Messaging UI targeting (Post To All / Selected) is the first.
- **Business-rule layer at engine level**: the six failing BUSINESS_RULE checks triaged; rules move
  from comments into `src/business-rules/` with a spec each.
- **Screen registry to every route** (12 → all): sweep + a11y on every screen, with
  `PAUSED_SCREENS` as the only exclusion mechanism.
- **Admin UI depth**: the role-gating blocker resolved (a provisioned admin role) or recorded.

Exit: no test type in table 1.3 reads "Not running"; "Partial" rows name a dated reason or are Built;
`coverage.md` and the new ledgers regenerate clean; FRD coverage ≥ 150 of 165 or the remainder
dated out-of-scope.

### Phase 3 — Structure that mirrors the application (1–2 weeks, mechanical, low risk)

Deliverables

- `tests/e2e/` reorganised into `tests/e2e/<module>/` (same ids as `tests/api/kpost/<module>/`);
  `UI_FILING_SPECS` keyed on basenames still works; references rewritten by script as the docs
  reorg was; `ui-coverage.md` extended with module and FR columns.
- One `support/<module>.ts` per screen, following the User Management pattern; page objects in
  fixtures only compose these.
- `docs/modules/<module>-flow.md` for every module (today: Katchup, Kall, KMail, Admin); each
  states the flow, the state codes, the gated writes and the known defects.
- Naming-consistency framework test (spec path ↔ ownership ↔ component ↔ docs).

Exit: `ls tests/e2e` reads like the module list in CLAUDE.md §1; every module has a flow doc; the
naming test passes.

### Phase 4 — Cross-cutting test types (2–3 weeks, can interleave with 2 and 3)

Deliverables

- **Visual**: per-screen baselines per browser, stored under a gitignored path with a documented
  refresh command; a diff is a candidate only after an isolated re-run.
- **Keyboard and focus**: every primary flow reachable by keyboard (Tab order, Enter/Escape on modals).
- **Viewport matrix**: declared breakpoints (desktop, laptop, tablet, phone) for the screen sweep;
  the 1px layout rule applied to each.
- **i18n smoke**: switch to Russian and Japanese, sweep the 12 core screens for untranslated keys,
  overflow and broken layout.
- **Resilience**: for each module, the UI under a failing or slow API (route interception) must
  show an error state, never a blank screen or a crash.
- **Session lifecycle in the UI**: expiry, parallel login, logout everywhere.

Exit: a `ui-matrix.md` ledger lists screen × {browser, viewport, language, visual, keyboard} with a
status per cell; no cell is blank.

### Phase 5 — Operations and performance (ongoing)

Deliverables

- **Run calendar**: full dry run per product after every deploy; filing on the owner's go; a weekly
  status pass (`kpost:full:verify`) so every open bug carries a fresh comment.
- **Performance and concurrency** in the agreed night window with the kill-switch; thresholds in
  `src/config/thresholds` reviewed against measured baselines, not guesses.
- **Metrics in `REPORT.md` headline**: pass rate of applicable checks, skip count by class, flaky
  count, debt count, open bugs by product and age, bugs closed verified this run. Trend file kept
  under `reports/` history (gitignored) and summarised in the decision log monthly.
- **Nightly bench self-test** in CI (framework project, no live traffic) in addition to the static gate.

Exit: four consecutive deploy cycles run on the calendar with no manual intervention beyond the go/no-go.

---

## 4. Order of work and what it costs

| Order | Phase              | Depends on                       | Effort (focused sessions) |
| ----: | ------------------ | -------------------------------- | ------------------------: |
|     1 | 0 Decisions        | the owner                        |                         1 |
|     2 | 1 Trust            | business accounts, QA DB         |                     10–14 |
|     3 | 2 Coverage by type | Phase 1 skip policy, QA DB       |                     12–16 |
|     4 | 3 Structure        | nothing (mechanical)             |                       4–6 |
|     5 | 4 Cross-cutting    | Phase 3 folders, screen registry |                      8–12 |
|     6 | 5 Operations       | Phases 1–2                       |                   ongoing |

A "session" is one quiet-server working block with isolated live runs. Phases 3 and 4 can start in
parallel with 1 and 2 on days the server is busy, because they do not need live runs to progress.

---

## 5. Rules that make the plan hold

- A change to a test's behaviour is only kept after an isolated live run of that spec on the test deployment.
- A lint warning, a skip, or a flaky result is never cleared by hiding it; it is fixed, provisioned, or decided.
- Nothing is filed from a batch failure that did not reproduce alone; nothing is closed without a live replay.
- Every pause has an owner, a reason, and a revisit date in the decision log.
- The numbers in section 6 are regenerated by the bench, not typed by hand.

## 6. The scoreboard (regenerate each full run; targets are the production threshold)

| Metric                                                         |   2026-10-10 | Target                |
| -------------------------------------------------------------- | -----------: | --------------------- |
| Timing debt (waits + forced clicks)                            |          115 | 0                     |
| Skip sites in class "retune" (`skips.md`)                      |           48 | 0                     |
| Skip sites with no reason / unclassified                       |        0 / 0 | 0 / 0 (enforced)      |
| Business UI specs runnable by product cmd                      |       0 of 7 | 7 of 7                |
| AUTHORIZATION checks run per full run                          |            0 | all applicable        |
| Write flows ending in a row assertion                          | (unmeasured) | all gated write flows |
| Screens in the registry                                        |           12 | every route           |
| FRs covered / dated out-of-scope                               |    ~110 / 30 | ≥150 / rest dated     |
| Test types "Absent" or "Not running"                           |            2 | 0                     |
| Flaky tests per full run                                       | (unmeasured) | shown, trending to 0  |
| Open bench-filed bugs without a fresh comment after a full run |            0 | 0 (keep)              |
