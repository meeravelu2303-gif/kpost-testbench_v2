# Test Bench — autonomous implementation progress

**Handoff file** for `KPOST-Test-Bench-Master-Autonomous-Implementation-Plan.md` §23. Hand-written;
it records what each phase actually did, with evidence. If a session stops, start here.

Newest phase last. Every phase ends with the §24 completion record.

---

## Phase index

| Phase | Name                                                    | Status                            |
| ----- | ------------------------------------------------------- | --------------------------------- |
| 3     | Actor model foundation                                  | COMPLETE                          |
| 4A–4D | State discovery / model / observation / calibration     | COMPLETE                          |
| 4D-B  | Test account registry                                   | COMPLETE                          |
| 4F    | Architecture / duplication / hygiene audit              | COMPLETE                          |
| 4G    | Tier 0 test-correctness repair                          | COMPLETE                          |
| 4H    | Architecture boundary & hygiene review                  | COMPLETE                          |
| 4I    | Test executability & skip elimination                   | COMPLETE                          |
| 4I-B  | Execution infrastructure repair & API coverage recovery | COMPLETE                          |
| 5     | Business invariant model                                | COMPLETE                          |
| 5B    | Safety-control correctness: the real-host signal        | COMPLETE                          |
| 5C    | A refused probe is inconclusive, never a finding        | COMPLETE                          |
| 6     | Application flow execution engine                       | COMPLETE                          |
| 7     | State transition validation                             | COMPLETE                          |
| 8     | Cross-actor and multi-channel coverage                  | COMPLETE                          |
| 9     | Side-effect verification                                | COMPLETE                          |
| 10    | Failure analysis upgrade                                | COMPLETE                          |
| 11    | Independent confirmation engine                         | COMPLETE                          |
| 12    | Duplicate detection and canonical defects               | COMPLETE                          |
| 13    | Confidence gate (shadow-only, deliberately)             | COMPLETE                          |
| 14    | Bugzilla integration                                    | GATED                             |
| 15    | Complete API coverage                                   | COMPLETE                          |
| 16    | Complete UI coverage                                    | IN PROGRESS                       |
| BE    | Backend/API bug preparation (owner-requested)           | COMPLETE — awaiting manual filing |
| 17–20 | Cleanup, orchestration, regression, discovery           | NOT STARTED                       |

Phases 3–4H are recorded in `CLAUDE.md` §8 (the repository's decision log) and are verified from the
code, the guards and the git history rather than re-derived here.

---

## Standing safety posture (unchanged by every phase below)

- `TEST_ENV=production` arms the endpoint allowlist, the validator allowlist and the QA-identifier
  guard. No phase has weakened any of them.
- SMS/OTP kill-switch is the first check in `destructiveBlockReason`; no flag overrides it.
- `resolveDryRun` means Bugzilla filing can only be armed by the command, never by `.env`.
- `WRITE_FUZZ` opens `sideEffect: data` writes only, and only with `TEST_DB_MODE`.
- No phase has filed a bug, armed filing, or changed Bugzilla behaviour.

---

## PHASE: 4I — Test executability & skip elimination

STATUS: COMPLETE

OBJECTIVE
Find every mechanism preventing an intended test from executing, classify it, remove the blocker
where safe, and give every remaining blocker evidence and a recovery path.

IMPLEMENTED
Six suppression mechanisms found; `test.skip` was only one of them.

1. **Suite tag filter — 135 tests.** Every API command greps `@<suite>-api`. `tagsFor` adds that tag
   to GENERATED cases automatically, so only hand-written specs needed it, and 28 of them had none.
   `npm run kpost` therefore set nine `*_LIFECYCLE=true` flags and then grep-removed every spec that
   reads them. Fixed by adding the suite tag through Playwright's `{ tag }` options form — never the
   title, so no `TC-…` id changed.
2. **`@destructive` over-tagging hid the whole `integration` project.** Its four endpoints are all
   `mockFixture: true`, which `endpoint-executor.ts:270` routes to the mock's base URL regardless of
   suite or `TEST_ENV`, so it could not reach a live deployment. Tag removed; replaced with the
   repository's own `test.skip(!env.MOCK_API)` idiom; `integration` added to the `mock` profile.
3. **4 framework skips** — need the bundled mock server; run under the `mock` profile (verified).
4. **1 unconditional skip** — KDiary UI, application-side (see Phase 4I-B §H).
5. **~90 lifecycle/account gates** — working as intended; each satisfied by its own command.
6. **Deliberate generator exclusions** — `session-ending`, `otp-consume`; both already guarded.

FILES CHANGED
`config/run-profiles.json`; 30 api specs (tag only); `tests/integration/user-lifecycle.spec.ts`;
new `tests/framework/test-executability.spec.ts`.

TESTS
+5 framework guards (suite tags, generator tags, project reachability, profile/project agreement,
integration gating). Guard 1 immediately caught a spec my manual sweep had missed.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · framework 701 pass / 4 skip ·
framework+integration under `MOCK_API=true` **716 pass / 0 skip** · integration 1 pass ·
api module-coverage guards 73 pass / **4 fail** (surfaced, not suppressed — repaired in 4I-B).

LIVE EXECUTION
None.

RESOURCES
None created; none outstanding.

FINDINGS
`npm run kpost` 4,470 → 4,590 collected; `npm run kmail` 1,680 → 1,695; api tests matched by no
suite grep 135 → 0; `integration` 0 → 1. Four previously-invisible guard failures exposed.

CONFLICTS
None introduced.

BLOCKERS
`bench --profile <any test profile>` refused to start (host guard) and `--profile kmail` failed at
spec load (AccountPool) — both carried into 4I-B and fixed there.

SAFETY
All gates preserved; no live write enabled.

COVERAGE IMPACT
Declared 11,281 → 11,286. Reachable-by-a-command API tests +135.

NEXT
Phase 4I-B.

---

## PHASE: 4I-B — Execution infrastructure repair & API coverage recovery

STATUS: COMPLETE

OBJECTIVE
Master plan §6 A–H: repair the four exposed guard failures, the Admin UI configuration, the KMail
module-scope account allocation and the `all` orchestration; inventory missing endpoint coverage;
recover it only where safe; document the destructive execution matrix; re-check KDiary.

IMPLEMENTED

**A — four guard failures.** Two were stale guards asserting decisions that had been reversed, and
they had never run:

- _signup scope_ — asserted the five registration ids were ABSENT; signup was re-added on
  2026-09-19 (`signup-login/index.ts:17-21` says so). Replaced with the property the guard was
  really protecting, stated directly and more strictly: both account-minting writes must be
  `otpDependent: 'requires'` + `destructive` + `sideEffect: 'global'` + never `productionSafe`, and
  the three availability lookups must stay non-destructive.
- _dashboard live-cleared_ — asserted all three endpoints `productionSafe`;
  `dashboard-home-new-msgs` was deliberately demoted to `needs-id` (null markers 500 the backend, so
  a standalone run would file a false CRITICAL). The demotion is now PINNED rather than erased.

Two were QA-identifier over-matches refusing CLEARED LIVE READS before they were sent:

- `body.fetchMailType: 'A'` — which VIEW of a mail thread to fetch; same class as the already-exempt
  `kmailType` in the same payload.
- `body.userTypeList: ['personal']` — the LIST form of `userType`, exempt since before the first
  live run as "an account TIER, not an account". Its siblings `languageList`/`countryList` carry no
  identifier token and were never checked, which is how the singular/plural asymmetry hid.

Both are exact-key entries in `NOT_A_RESOURCE`; the guard's pattern, array handling and tenant
checks are untouched.

**B — Admin UI host.** `.env` held `https://adminmodule.kpostindia.com` — the Admin **API** host
under the **UI** variable. Measured: the documented UI host `kpostadmin.kpostindia.com` is ALSO
refused, because it is the production admin UI and no test deployment of it is known. `TEST_HOST`
was not widened. `.env` left empty exactly as `.env.example` prescribes. All 11 profiles now load.

**C — KMail module-scope allocation.** `katchup/feature.spec.ts:31` resolved four accounts at module
scope; the `kmail` profile allocates two, correctly. Playwright loads every spec before `--grep`
selects any, so the whole profile collected nothing. Fixed with `slotPrincipals(n)` — read-only
forwarding views that run the identical `currentSlot().principals(n)` call on first property access.
Neither the account count nor the partition invariant was touched.

**D — `all` orchestration.** `npm run all` ran `kpost kmail ui` while documented as "Everything".
Now `kpost kmail admin ui`, composing the existing `admin` command unchanged.

**E/G — inventory and execution matrix.** `tests/framework/endpoint-execution-matrix.spec.ts`
generates `docs/ENDPOINT-EXECUTION-MATRIX.md` from the registry, the generator calls the specs
actually make, the endpoint ids the flow specs actually name, and the run-profile registry.

**F — safe coverage recovery.** Three `productionSafe` signup availability READS had no generated
case since signup was restored. New `signup.spec.ts` adds them;
`excludeTags: ['mints-account']` keeps the two registration writes out — they create a permanent
account (and a permanent tenant) KPOST cannot delete.

**H — KDiary.** See FINDINGS.

FILES CHANGED
`src/validation-engine/qa-identifier-guard.ts`, `src/test-data/index.ts`,
`src/api/definitions/kpost/signup-login/signup.api.ts`, `config/run-profiles.json`, `package.json`,
`docs/COMMANDS.md`, `.env` (git-ignored; backup `.env.bak-4ib`), 3 lifecycle specs (1 line each),
`tests/api/kpost/{signup-login,dashboard}/coverage.spec.ts`, `tests/e2e/kdiary.spec.ts` (comment).
New: `src/test-data/lazy-principals.ts`, `tests/api/kpost/signup-login/signup.spec.ts`,
`tests/framework/endpoint-execution-matrix.spec.ts`.

TESTS
+7 lazy-principal guards, +2 QA-identifier regression guards, +1 `all`-composition guard,
+4 endpoint-execution-matrix guards. Two stale guards rewritten (stronger, not weaker).

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings · `npm run check` PASS · framework 711 pass / 4 skip ·
framework+integration (mock) 716 pass / 0 skip · api module-coverage **77/77** (was 73/4) ·
all 11 run profiles load · endpoint matrix 4/4.

LIVE EXECUTION
The three recovered signup availability READS against `testingapi` (already `productionSafe`,
filing forced to dry-run): **30 passed, 88 skipped, 0 failed**. One Admin endpoint probed to
identify the host blocker: `apiRequestContext.fetch: Timeout 10000ms` → `http://192.168.0.38:9595`.
No write of any kind.

RESOURCES
None created; none outstanding; no cleanup required.

FINDINGS

- The gap was **64**, not the 55 reported in Phase 4I (`341 − 286` double-counted the 9 mock
  fixtures; the correct arithmetic is `341 − 277`). Now **0 NOT_YET_COVERED**: 289 contract,
  174 flow, 5 documented exclusions, 2 BLOCKED.
- **KDiary UI is intentionally unavailable**, verified against the frontend source in four
  independent places: `MenuRoutes.js:490`, the right-rail `<Diary />` in all three Katchup variants,
  and both `containers/Header.js` nav entries — every one commented out. Recovery condition recorded
  in the spec. API coverage intact (9/9).
- **`production-guard`'s `realHost` disagrees with the executor's `targetsRealHost`.** The guard
  looks only at the `MOCK_API` flag; the executor also checks whether the suite base URL still points
  at a module host. With `MOCK_API=true` and `KPOST_API_BASE_URL` set — what `bench --profile mock`
  produces — the SMS/OTP kill-switch's real-host condition is `false` while requests still go to
  testingapi. Today the `productionSafe` gate still blocks them because `TEST_ENV=production`; with
  `TEST_ENV=local` both would be off. **Reported, not patched** — it is a safety control and the
  change deserves its own review.
- **`note` never reaches the registry.** A `KpostEndpointConfig` field `buildDefinition` does not
  copy onto `EndpointDefinition`, despite its doc-comment saying "for the report".
- The KDiary **write** describe is gated only on `KDIARY_UI_LIFECYCLE`, which `npm run ui` sets, so
  it executes and fails on the absent panel. Extending the blocker to it would be turning a failure
  into a skip, which the plan forbids — left failing, flagged for the owner.

CONFLICTS
The Phase 4A/4B Katchup read-perspective conflict remains preserved and untouched.

BLOCKERS

- Admin API host `192.168.0.38:9595` unreachable from this machine (environment).
- `group-download-image` / `group-download-full-image`: non-destructive GETs keyed by a runtime group
  id. `liveWriteAuthorized` (`production-guard.ts:166-171`) requires `destructive === true`, so
  `allowLiveWrite` cannot authorise a READ. Recovery: an authorised-read concept. Declaring a GET
  destructive to borrow the write path would misstate the endpoint and was deliberately not done.
- No test deployment of the Admin/HR-Setup UI; `admin-ui`'s 8 tests stay gated.

SAFETY
No gate weakened. The two identifier exemptions are exact-key and evidence-backed; the tenant field
in the same payload is still refused (asserted).

COVERAGE IMPACT
`npm run kpost` 4,590 → 4,731. Registered endpoints with no execution layer: 64 → **0**
(289 contract / 174 flow / 5 N-A / 2 blocked).

NEXT
Phase 5 — business invariant model.

---

## PHASE: 5 — Business invariant model

STATUS: COMPLETE

OBJECTIVE
Master plan §7: a centralized DECLARATIVE business-rule/invariant layer, in an existing
architectural home, carrying rule id, provenance, requirement ids, module, actor perspective,
preconditions, observed states, expected relationship, evidence requirements and conflict status —
without inventing a rule and without resolving a conflict.

IMPLEMENTED

**Home.** `src/business-rules/invariants/`, beside the existing `business-rule.ts` rather than a new
top-level directory. `business-rule.ts` is an EXECUTABLE endpoint-scoped check bound to the
validation engine; it is untouched. The invariants sub-module imports no engine, no validator, no
reporter and no bug-tracker — asserted by a guard — because an invariant that depended on the
machinery meant to verify it could not be used to judge that machinery.

**46 invariants**, transcribed from `docs/business-rules.md` (itself extracted from the six module
FRDs + BRD/SRS/PRD/FSD). Nothing was invented and nothing was inferred from a test name.

**The status rule is the substance.** `VERIFIED` and `PARTIAL` must NAME a repository path that
exists on disk; `PARTIAL` must also say what is missing; `OUT_OF_SCOPE` must say why. That is what
stops this catalogue becoming what it replaced — a list of rules everyone assumes are covered. It
caught one of my own entries immediately: `NFR-SEC01` originally cited "the engine authentication
validators", a description rather than a checkable path, and now cites
`src/validators/authentication/missing-token.validator.ts`.

**Vocabulary is validated against the real registries** through injected predicates
(`InvariantVocabulary`), the same dependency-injection the requirements layer uses in
`traceability.ts`: every requirement id must be known to the Requirement Source Registry, every
actor to the actor model, every state to the state catalogue, every endpoint to the API registry.

FILES CHANGED
New: `src/business-rules/invariants/{invariant,registry,index}.ts` and
`catalogue/{katchup,group,kall,kmail,platform,cross-cutting}.ts`;
`tests/framework/business-invariants.spec.ts`; generated `docs/BUSINESS-INVARIANTS.md`.
Changed: `docs/business-rules.md` (three rule ids normalised — `FR-GC-delete` →
`BR-GC-DELETE-EMPTY`, `FR-KD-002 org-scope`/`search` → `FR-KD-002-ORG-SCOPE`/`-SEARCH` — plus the
stale guard filename it referenced); `.prettierignore` (the two generated docs).

TESTS
+10 framework guards: model validity against the real vocabularies; module coverage; id shape and
uniqueness; **every VERIFIED/PARTIAL claim points at a file that exists**; no rule credited to a
requirement id; every documented conflict survives with both positions stated; no engine/validator/
Bugzilla import; no executable check in the layer; the document cannot name a rule the registry
lacks; the generated report.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline restored) · `npm run check` PASS ·
framework 725 pass / 4 skip (729 collected) · framework+integration under `MOCK_API=true`
**730 pass / 0 skip** · api module-coverage 77/77 · all 11 run profiles load.

LIVE EXECUTION
None. The layer is declarative and contacts nothing.

RESOURCES
None created; none outstanding.

FINDINGS

- `docs/business-rules.md` claimed a guard — `tests/framework/business-rules-coverage.spec.ts` —
  that **did not exist**. The document's own promise that "a rule here that is unmapped fails the
  run" had never been true. It is now, under the new filename.
- Measured status of the 46: **11 VERIFIED · 14 PARTIAL · 18 TO_DO · 3 OUT_OF_SCOPE**, and **6 carry
  an unresolved conflict**. The PARTIAL entries are the interesting ones — most are rules where the
  bench drives the action and asserts acceptance but never checks the constraint (member counts,
  priority read-back, subject immutability, the sole-admin refusal).
- The rules a product breaks quietly are almost all TO_DO: recall-only-before-read,
  recall-not-on-copies, the disappearing-message flag being immutable after send, minimum-admin on
  demote, single-To on KMail.
- `BR-C01` is VERIFIED **and believed violated on live**. That pair is the point of the layer:
  status measures the bench, not the product.

CONFLICTS
Six preserved, none resolved: `BR-C01` (CONF-KALL-BR-C01), `BR-KU-RECEIPTS` and `BR-X01`
(CONF-KATCHUP-READ-PERSPECTIVE), `FR-GM-014` (server-side vs UI-only enforcement unconfirmed),
`BR-SL-ACTIVATE` (BR-S01 requires activation; no activation endpoint exists in 356 documented rows),
`BR-GC-DELETE-EMPTY` (observed on live, in no FRD — possibly a defect rather than a rule).

BLOCKERS
None for this phase. Three rules are OUT_OF_SCOPE with recorded reasons (`BR-SL-ACTIVATE`,
`BR-SL-PWD`, `BR-KM-EXTERNAL`) — each needs an owner decision, not a bench one.

SAFETY
Nothing executed, nothing gated changed. The layer cannot reach a host: it has no client.

COVERAGE IMPACT
Business rules with a typed, machine-checked declaration: 0 → **46**. Rules whose coverage claim is
now mechanically verified against a file on disk: 0 → **25** (11 VERIFIED + 14 PARTIAL).

NEXT
Phase 5B (below), then Phase 6.

---

## PHASE: 5B — Safety-control correctness: the real-host signal

STATUS: COMPLETE

OBJECTIVE
Master plan §27 ranks "Test Bench safety/correctness defects" first, above new features. Phase 4I-B
found one and reported rather than patched it; this closes it. The change STRENGTHENS a control, so
it is not the security-boundary weakening that §25 reserves for human authorisation.

IMPLEMENTED
The SMS/OTP kill-switch asks "can this request reach a real host?". It was being given
`env.MOCK_API`, which answers a different question.

`targetsRealHost` (`endpoint-executor.ts:103`) is
`!(env.MOCK_API && suite.baseUrl === env.API_BASE_URL)` — `MOCK_API=true` only redirects a suite
whose base URL FELL BACK to the mock's. Every KPost suite takes its own module host from `.env`, so
with `MOCK_API=true` and `KPOST_API_BASE_URL` set — exactly what `bench --profile mock` produces —
the flag said "mock" while the request still went to testingapi. The comment at the call site
already claimed it threaded "the mock/real-host signal"; the value did not.

One-line fix at the call site: `mockApi: !targetsRealHost(endpoint)`. The guard function itself was
correct and is unchanged — it was being told the wrong thing. Both controls now answer the same
question the same way: `assertQaOwnedIdentifiers` already used `targetsRealHost`.

Strictly stricter. `MOCK_API=false` → unchanged. A true mock run → unchanged. Mock fixtures →
unchanged. The only behaviour change is the case that was wrong.

FILES CHANGED
`src/validation-engine/endpoint-executor.ts` (the call site + why),
`src/validation-engine/production-guard.ts` (the `mockApi` doc comment now states what the field
means and that the flag alone is the weaker answer), `tests/framework/live-safety.spec.ts`.

TESTS
+3 guards: `targetsRealHost` is true for a configured module host and false for a mock fixture; a
SOURCE guard that the executor passes `!targetsRealHost(endpoint)` and not `env.MOCK_API` (the
defect was a call site, not a function); and an OTP sender stays blocked on a reachable host under
every flag while still clearing against the bundled mock.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings · `npm run check` PASS · live-safety 29/29 ·
framework 728 pass / 4 skip · framework+integration (mock) **733 pass / 0 skip** ·
api module-coverage 77/77.

LIVE EXECUTION
None.

RESOURCES
None.

FINDINGS
The `productionSafe` gate was covering for this: it blocked those endpoints anyway while
`TEST_ENV=production`. A second control compensating for a wrong answer in the first is exactly the
arrangement that fails silently the day the first condition changes — here, a `TEST_ENV=local` mock
run with module hosts configured.

CONFLICTS
None.

BLOCKERS
None.

SAFETY
A control was tightened, never relaxed. No gate, flag or allowlist was opened.

COVERAGE IMPACT
None (no test added or removed from any suite); 3 new framework guards.

NEXT
Phase 5C, then Phase 6.

---

## BLOCKER RE-CHECK — 2026-09-21

Re-tested rather than inherited. A blocker in an older report is not evidence of a current one.

| Blocker                                   | Previous                   | Re-tested                                                                                                                               | Now                                 |
| ----------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Admin API host `http://192.168.0.38:9595` | unreachable (10s timeouts) | `http=403` in **0.13 s**; the suite authenticates (`valid COMPANY_ADMIN token accepted`, 200 in 65 ms)                                  | **RESOLVED**                        |
| Admin UI deployment                       | no test deployment known   | `https://kpostadmin.kpostindia.com/` answers **200** — but it is the PRODUCTION admin UI, which `assertTargetAllowed` refuses by design | **STILL BLOCKED, reason sharpened** |

The Admin UI was re-tested **independently**: the API being back says nothing about the UI.
Reachability is not the blocker and never was — the blocker is that the only known Admin/HR-Setup UI
deployment is production, and pointing the bench at it is exactly what the target guard exists to
prevent. `ADMIN_UI_BASE_URL` stays empty; `admin-ui`'s 8 tests stay gated. **Owner action:** a test
deployment of the Admin UI, or an explicit decision.

**Admin API executed after the re-check** (`VALIDATION_PROFILE=FULL`, `TEST_DB_MODE=true`, filing
dry-run, no `ADMIN_LIFECYCLE` so no writes): 12 collected, **9 executed and found defects**, 3
correctly skipped (`needs-id` reads the production guard blocks). The 9 are the documented Admin
classes — missing CSP/referrer/HSTS, the auth filter answering 403 with a plain-text body instead of
401 with the JSON envelope, and input validation not enforced (`companyId` missing or null → 200).
Genuine application findings, not bench defects. Nothing was filed.

---

## PHASE: 5C — A refused probe is inconclusive, never a finding

STATUS: COMPLETE

OBJECTIVE
The Admin re-check surfaced a Test Bench correctness defect of the exact class master plan §2 and
§26 forbid: the bench manufacturing a defect from its own safety control. Fixed before starting
Phase 6, per §27 priority 1.

IMPLEMENTED
The mutating validators rewrite every field, id fields included — `request.data-type` turns
`companyId: "242"` into a number, `security.injection` into a SQL tautology. Those name a company we
do not own, so the QA-identifier guard refuses to send them and throws `ProductionSafetyError`.

That throw propagated out of `runProbes`, and the engine reported `validator error: …` → **FAILED**.
On the Admin suite that was three CRITICAL/HIGH "findings" per endpoint, built entirely from the
bench's own refusal, feeding the same candidate pipeline as a real defect.

`runProbes` now catches **only** `ProductionSafetyError`, per probe, and records that case as
SKIPPED with the reason — precisely as it already treats a throttled (429) probe, and for the same
stated reason: an outcome the bench caused teaches nothing about the API. The guard is unchanged and
still refuses. A transport error is deliberately NOT caught: that is a real observation about the
host and must still be judged.

**It recovered coverage as well as removing false findings.** The throw used to abort the whole
validator on its first refused case. `security.injection` on `admin-workplace-location-all` went
from `FAILED: validator error` to **`PASSED: 2 injection cases passed`** — two probes that could be
sent safely had never run at all.

FILES CHANGED
`src/validation-engine/probe.ts`; `tests/framework/bench-hardening.spec.ts`.

TESTS
+2 guards: a safety refusal is SKIPPED, carries its reason, and records no request to reproduce
(nothing was sent); a transport error still propagates and is judged.

VERIFICATION
typecheck 0 · bench-hardening 10/10 · verified against the live Admin host: `request.data-type` and
`security.xss` now SKIPPED-with-reason, `security.injection` now PASSED with 2 real cases.

LIVE EXECUTION
The Admin API read matrix, twice (before and after the fix), filing dry-run. Reads only — no
`ADMIN_LIFECYCLE`, no write, no new permission.

RESOURCES
None created.

FINDINGS
A refusal by a safety control was being counted as an application defect. The severity classes
involved (CRITICAL injection, HIGH data-type/XSS) are precisely the ones a reviewer trusts most.

CONFLICTS
None.

BLOCKERS
None.

SAFETY
The QA-identifier guard is byte-identical and still refuses every unowned identifier. Only the
REPORTING of its refusal changed.

COVERAGE IMPACT
False findings removed and previously-unreachable probe cases recovered on every endpoint whose
payload carries a business identifier.

NEXT
Phase 6.

---

## PHASE: 6 — Application flow execution engine

STATUS: COMPLETE

OBJECTIVE
Master plan §8: turn declarative flows into executed ones, without turning `FlowDefinition` into a
second endpoint-execution system and without duplicating a contract, an account pool, a ledger or an
executor.

IMPLEMENTED

**The boundary.** A new sibling module `src/flow-execution/`, not an addition to `src/flows/` —
that layer states in its own header that it "is not a workflow engine: it executes nothing", and
putting an executor inside it would force a business description to import the validation engine. So
execution depends on flows; flows know nothing of execution, and a guard asserts that direction.

    FlowDefinition  →  FlowExecutionEngine  →  StepAction  →  existing EndpointExecutor / UI

**`StepAction` — the provider contract.** A `FlowStep` names an endpoint id and nothing else. The
adapter is what decides what to send and what the response means, and it is handed the EXISTING
infrastructure to do it: the injected `EndpointExecutor` and `CleanupCoordinator`. The engine is
generic over both, precisely so it cannot construct either. Registration is per `(action, channel)`,
which is what lets one business flow be driven through the API in one run and the UI in another
without the definition changing.

**The engine.** Walks the steps in order and, per step: checks the DECLARED artifact dependencies
first (a blocked step leaves no trace of having been attempted — no account touched, no session
minted), selects the binding for the channel, resolves the actor through the run's own
`ActorContext`, calls the action, records the outcome, and publishes artifacts only for a PASSED
step. It refuses to execute an invalid flow, reusing the existing `assertValidFlow` rather than
defining a second set of rules.

**Execution status is never a failure class.** `PASSED · FAILED · BLOCKED · SKIPPED`, from the
existing `FlowStepStatus`. No `FailureClass` anywhere.

**Blocking follows the declared dependency, never step order** — a step that consumes nothing is
independent by definition, and inventing an implicit ordering dependency would be the engine
asserting a business relationship the flow author never stated.

**A safety refusal is SKIPPED, not FAILED** — the same conclusion Phase 5C reached for probes.
Recognising it is injected (`isSafetyRefusal`), so the execution layer never imports the validation
engine to find out what a safety error looks like.

**`prepare` hook.** The one thing the caller must do that the engine cannot: bind this run's actors
to accounts. Choosing an account needs slots, tiers and session exclusivity — that is `AccountPool`,
and an engine with an opinion on it would be a second account pool by another name.

**Real application coverage.** `tests/api/kpost/katchup/flow.spec.ts` drives the existing catalogue
flow with real API adapters. The send payload comes from `sendShape`, the endpoint definition's own
exported factory — the same one `lifecycle.spec.ts` uses — so no contract is duplicated. It asserts
the thing an endpoint test cannot: **the RECIPIENT, in their own session, sees the message the
SENDER sent.** `lifecycle.spec.ts` and `feature.spec.ts` are untouched and still run.

FILES CHANGED
New: `src/flow-execution/{engine,step-action,index}.ts`,
`tests/framework/flow-execution.spec.ts`, `tests/api/kpost/katchup/flow.spec.ts`.
No existing file was modified.

TESTS
+25 framework guards, all synthetic (no network): successful flow · failed prerequisite · blocked
downstream · artifact publication and consumption · a failed step publishes nothing · only steps
that ran may be treated as evidence · blocking follows the declared dependency · actor resolution
(same role → same participant) · an undeclared role refuses to execute · API binding · UI binding ·
a skipped prerequisite blocks its dependants · duplicate registration refused · safety-refusal
handling · a throwing action fails its step and the run continues · observations and correlation ids
carried but never interpreted · resource registration · determinism · no module-level state ·
report-safe summary · two architectural boundary guards. Plus 1 live application-flow test.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · `npm run check` PASS ·
framework **755 pass / 4 skip** (was 728) · framework+integration under `MOCK_API=true`
**760 pass / 0 skip** · api module-coverage 77/77 · flow-execution guards 25/25.

LIVE EXECUTION
The Katchup flow, once, on `testingapi`, gated by the existing `KATCHUP_LIFECYCLE`, filing dry-run:

    PASSED   authenticate-sender          [signup-login-user-login]   200
    PASSED   authenticate-recipient       [signup-login-user-login]   200 (a different account)
    PASSED   send-message                 [katchup-send-message]      msgID 811474
    PASSED   recipient-observes-message   [katchup-conversation]      the recipient's own read
    SKIPPED  recipient-reads-message      — no endpoint marks a 1:1 message read
    SKIPPED  sender-observes-read-receipt — no 1:1 read-receipt endpoint exists

No new permission: one message between two accounts the bench owns, on the path the owner already
authorised. Evidence captured for all five exchanges with credentials masked.

RESOURCES
1 registered, 1 attempted, **1 cleaned, 0 failed** — the message was deleted (200). Nothing
outstanding.

FINDINGS

- **Direct evidence for CONF-KATCHUP-READ-PERSPECTIVE.** The message from the first flow run
  (msgID 811473) reads back with `status: 2` and `readTime` populated, having been read by nothing
  but the recipient's API conversation call. That is the Phase 4D calibration's finding reproduced
  through a flow: the API read itself performs the read transition, contradicting the Phase 4B model
  recording the mechanism as UI. Recorded, not resolved — it is Phase 7's to act on.
- **BR-KU-DELETE-OWN behaved as documented.** After the sender deleted 811473, the recipient's
  conversation still contained it. Consistent with the rule that deleting removes a message from the
  deleter's view only. A consistency check, not a defect.
- The two FR-K07 steps skipped with the definition's own reasons, so the gap the flow model recorded
  in Phase 2B is now visible in an execution report rather than only in a comment.

CONFLICTS
CONF-KATCHUP-READ-PERSPECTIVE is now supported by flow evidence as well as calibration evidence.
Still preserved, still unresolved.

BLOCKERS
None for this phase. The UI channel is implemented and guarded but not yet driven live — the UI
adapters are Phase 8's work, and the Admin UI has no test deployment (see the blocker re-check).

SAFETY
The engine sets no flag and cannot reach one: `allowLiveWrite` is set by the adapter, exactly as
today's lifecycle specs set it, and every request goes through the injected executor so the
production guard, the SMS/OTP kill-switch and the QA-identifier guard apply unchanged. A guard
asserts the execution layer contains no `new EndpointExecutor`, no request builder, no account pool
and no HTTP call of its own.

COVERAGE IMPACT
A new test LAYER, not a replacement: endpoint/contract tests are untouched and still run. One real
application-behaviour flow is now executed with cross-actor evidence. Framework guards 728 → 755.

NEXT
Phase 7.

---

## PHASE: 7 — State transition validation

STATUS: COMPLETE (Katchup read; Kall and KMail transitions remain)

OBJECTIVE
Master plan §9: validate real `BEFORE → ACTION → AFTER` transitions using State Observation, Flow
Execution and the Business Invariant model, without treating HTTP 200 as a state transition and
without silently resolving an existing conflict.

IMPLEMENTED

**`src/state-transition/`** — the narrowest layer in the chain and deliberately so. Phase 4C
observes with no expectation; Phase 4B declares a documented change; neither can say whether a
change OCCURRED, because that needs two observations and a declaration together. `checkTransition`
compares them and stops.

    OCCURRED | NOT_OCCURRED | INDETERMINATE

No pass, no fail, no severity, no failure class, no confidence — a spec turns the outcome into an
assertion. **`INDETERMINATE` is what earns the layer its keep**, and it is returned for every case
where the evidence cannot support an answer: the after-state unobserved, the before-state
unobserved, the resource not in the declared FROM state to begin with, the model missing a state the
transition names, or a cross-field comparison that would compare two different facts. A transition
whose before-state was never observed did not fail, and a bench that cannot say so manufactures
defects out of missing evidence.

Identity is required throughout: an observation for a different resource is not evidence, which
preserves Phase 4C's refusal to attribute an unidentified row.

Comparison is `String(observed) === declared`, done here rather than by normalising the observation
— the model declares `rawValue: '2'` from a JSON-keyed contract while a live response returns `2`,
and Phase 4C's rule that an observed value is never coerced is worth more than the convenience.
Only PRIMITIVES compare: an object in a state field is not a value the model describes, and
stringifying one could only ever be wrong.

**`tests/api/kpost/katchup/state-transition.spec.ts`** — the first real transition validated. It
observes the sender's own view, drives exactly ONE action between the observations (the recipient
opens the conversation), observes again, and checks `katchup.message.read`. The precondition is
asserted rather than assumed: a freshly sent message must NOT already be read, or the rest of the
test would be meaningless.

FILES CHANGED
New: `src/state-transition/{check,index}.ts`, `tests/framework/state-transition.spec.ts`,
`tests/api/kpost/katchup/state-transition.spec.ts`.
Changed: `src/business-rules/invariants/catalogue/katchup.ts` (BR-KU-RECEIPTS now cites the
transition spec and states the narrower remaining gap).

TESTS
+12 framework guards, all pure, built on the REAL Phase 4C extractor rather than a mock of it:
OCCURRED on 0 → 2 · correct resource selected from a multi-row conversation · NOT_OCCURRED when
unchanged · NOT_OCCURRED when it moved somewhere else (and says where) · five INDETERMINATE cases ·
no verdict/severity/defect/confidence field on the outcome · no engine/validator/failure-analysis/
Bugzilla import · determinism and a report-safe summary. Plus 1 live transition test.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · `npm run check` PASS ·
framework **767 pass / 4 skip** (was 755) · framework+integration under `MOCK_API=true`
**772 pass / 0 skip** · api module-coverage 77/77 · business-invariant guards 10/10 · 7 profiles load.

LIVE EXECUTION
The read transition, once, on `testingapi`, gated by the existing `KATCHUP_LIFECYCLE`, dry-run:

    msgID 811475 sent  →  BEFORE: not read (precondition asserted)
                       →  ACTION: the recipient opens the conversation
                       →  AFTER:  "status" moved to 2
    OCCURRED  katchup.message.read [811475]

RESOURCES
1 registered, **1 cleaned, 0 failed**. Nothing outstanding.

FINDINGS

- **FR-K07 / BR-KU-RECEIPTS is verified as a real transition for the first time.** Every previous
  check read a receipt endpoint back and asserted it answered — which cannot distinguish "the
  receipt appeared because the recipient read it" from "the receipt was already there". The
  invariant's `gap` was narrowed to what actually remains: the PER-MEMBER group case.
- **CONF-KATCHUP-READ-PERSPECTIVE now has direct, reproducible evidence.** The model declares the
  mechanism as `UI` ("no endpoint marks a 1:1 Katchup message read"); driving the API conversation
  read produced OCCURRED. The API read performs the transition. Recorded as a test annotation and
  left unresolved — one more observation does not settle whether that is the intended mechanism or
  an accident of the implementation, and that is the owner's question.

CONFLICTS
CONF-KATCHUP-READ-PERSPECTIVE — now supported by calibration evidence, flow evidence and a
transition check. Still preserved, still unresolved, and now reported by the test that exercises it.

BLOCKERS
Kall and KMail transitions are not yet validated. Kall's `connected` state is unreachable headlessly
(no second WebRTC peer), so its log transitions stay blocked; the KMail delivery/read transition is
reachable and is the next candidate.

SAFETY
Nothing gated changed. One message, two accounts the bench owns, on the path the owner already
authorised; `allowLiveWrite` set only by the spec, as every lifecycle spec does.

COVERAGE IMPACT
Business rules verified by a real before/after transition: 0 → **1**. Framework guards 755 → 767.

NEXT
Phase 8.

---

## PHASE: 8 — Cross-actor and multi-channel coverage

STATUS: COMPLETE (all six actor/channel pairs verified live; the visible-Copy INCREMENT within the
confidential-copy pair is blocked by an account configuration gap, recorded below)

OBJECTIVE
Master plan §10: expand the proven sender → recipient model into the remaining documented actor
relationships and the API/UI observation pairs, with actor-specific evidence rather than a single
generic "the resource exists" assertion.

IMPLEMENTED

**`tests/api/support/cross-actor.ts`** — the one helper the layer needed. Every observation carries
the ROLE that made it, the ACCOUNT (by pool key — never a username, never a credential), the
endpoint, the correlation id and the Phase 4C observations. A report can then say which actor saw
what without naming a real login, which a framework guard asserts.

**Confidential copy (requirements 1–2)** — `tests/api/kpost/katchup/cross-actor.spec.ts`.
The existing security test asserts only that other recipients cannot SEE the confidential recipient.
That is half a test: absence of a leak is trivially satisfied by a message nobody received, so
"hidden" and "never delivered" are indistinguishable and the weaker one passes. This asserts both
halves — delivery to the TO recipient AND to the confidential recipient, then concealment.

**Group admin → member (requirement 3)** — `tests/api/kpost/group/cross-actor.spec.ts`. The existing
lifecycle drives create → add → … entirely as the ADMIN and asserts `status < 600`. This asserts the
membership from the MEMBER's own session: their own `myGroups` read must contain the group, by
`groupID`.

**Caller → participant (requirement 4)** — `tests/api/kpost/kall/cross-actor.spec.ts`. Everything
before connection is real and testable: a scheduled call must appear in the PARTICIPANT's own Kool
Kall list, by `kallID`. Nothing fakes a peer.

**API ↔ UI (requirements 5–6)** — `tests/e2e/cross-channel.spec.ts`. A channel proves nothing about
itself: an API test that reads back through the same API cannot distinguish delivery from an API
consistently reporting its own writes, and a UI test that sees a bubble appear cannot distinguish
delivery from optimistic local rendering. Both directions assert the RESOURCE through the OTHER
channel.

**Authorised read (§13)** — a new `allowLiveRead`, deliberately a SEPARATE capability from
`allowLiveWrite` rather than a widening of it. It requires `destructive !== true`, so it can never
unlock a write by construction; requires `sideEffect: data`; sits below the SMS/OTP kill-switch;
leaves the QA-identifier guard armed; and the engine never sets it. It clears the `productionSafe`
gate and nothing else. Declaring a GET destructive to borrow the write path was considered and
rejected — it would misstate the endpoint and leave a read one flag from write authorization.

FILES CHANGED
New: `tests/api/support/cross-actor.ts`, `tests/api/kpost/{katchup,group,kall}/cross-actor.spec.ts`,
`tests/e2e/cross-channel.spec.ts`, `tests/framework/cross-actor.spec.ts`.
Changed: `src/validation-engine/production-guard.ts` and `endpoint-executor.ts` (`allowLiveRead`),
`tests/framework/live-safety.spec.ts` (+4 guards).

TESTS
+11 cross-actor framework guards (role resolution, distinct roles, several participants of one role,
undeclared role refused, no shared state between runs, perspective preserved, pool-key-only
reporting, the same resource observed differently by different actors, documented row key, and two
guards that every cross-actor spec correlates on a documented identity and registers what it
creates), **+3 cross-channel session guards** (every API call authenticates as A; the only browser
state opened is B's; the default `page` fixture is never taken) and +4 authorised-read guards.
Plus 5 live application tests.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · `npm run check` PASS ·
framework **785 pass / 4 skip** (was 767) · framework+integration under `MOCK_API=true`
**790 pass / 0 skip**.

LIVE EXECUTION (all gated, dry-run filing, accounts the bench owns)

| Flow                                 | Result |
| ------------------------------------ | ------ |
| Katchup confidential copy (3 actors) | PASS   |
| Group admin → member                 | PASS   |
| Kall caller → participant            | PASS   |
| API → UI (browser observes)          | PASS   |
| UI → API (browser acts)              | PASS   |

RESOURCES
Every live flow registered what it created before asserting. Katchup messages, one group and one
scheduled call — all cleaned by the ledger (`cleaned: 1, failed: 0` per run). Nothing outstanding.

FINDINGS

- **Only four of the six configured session accounts authenticate.** Measured directly:
  `personal`, `victim`, `personal-3` and `personal-5` log in; **`personal-4` and `personal-6` answer
  `Invalid Credential`** (HTTP 200, the documented login defect). The bench uses one `QA_PASSWORD`
  and those two accounts do not share it. Slot 0's FOURTH position is `personal-4`, so **every
  four-account flow is broken by a non-authenticating account** — including the existing
  `feature.spec.ts` confidential-copy test, which has been silently degraded. **Remediation:** set
  those two accounts' passwords to `QA_PASSWORD`, or add per-account password support. Until then
  the visible-Copy-versus-confidential-Copy distinction cannot be driven, and it is recorded as
  coverage debt rather than left unproven in silence.
- **A copies message creates ONE ROW PER RECIPIENT, each with its own `msgID`.** Measured: the
  sender's response carried 811492 while the confidential recipient's own view carried 811491. The
  identity that links them is `sharedMessageId`, byte-identical across all three rows. This matters
  beyond this test: correlating a copies message on `msgID` reports a FALSE ABSENCE, and correlating
  on the subject proves only that some message with that text exists. My first assertion made
  exactly that mistake and looked like an application defect until it was measured.
- **NFR-SEC02 is honoured, with field-level evidence.** The TO recipient's own row carries
  `hiddenContactList: []` — the confidential recipient is stripped from their copy — while the
  confidential recipient's own row names them. The concealment is filtered per actor, not emptied
  for everyone, and the test asserts both so a product that simply dropped the list would fail.
- **A BENCH DEFECT, not a product one: an API login silently kills the browser session of the same
  account.** KPOST allows ONE active session per account, so authenticating as A through the API
  displaces A's saved browser state. The page does not error and does not redirect to `/login` — it
  renders its conversation list as an empty skeleton forever (`21 Unopened Messages`, zero rows),
  which reads exactly like a product defect and cost two full debugging rounds before the page
  snapshot showed it. Fixed structurally rather than by a wait: **the browser is never driven as an
  account the API authenticates as.** Account A is the API's identity in both directions; account
  B's saved state is the only browser identity; nothing logs in as B through the API. Three
  framework guards pin it. Worth carrying into Phase 11: a confirmation run that re-authenticates
  will invalidate any browser session it shares an account with.
- **`katchup-two-session.spec.ts` is adjacent to the same trap.** It makes no API calls of its own,
  so it is correct in isolation, but it drives account A's browser — so any API test that logs in as
  A earlier in the same run degrades it. Recorded, not changed: `npm run ui` runs UI-only today.
- **A body-wide leak check is unsound for a conversation read.** A conversation carries the whole
  thread, so checking the entire response for an address matches EARLIER messages. It did, on the
  first run. Both leak checks are now scoped to the row for this `sharedMessageId`.

CONFLICTS
None introduced. The six existing conflicts are untouched.

BLOCKERS

- **Visible-Copy vs Confidential-Copy** needs a fourth authenticating account (above). The
  confidential-copy PAIR itself is covered; it is the visible-versus-confidential contrast that is not.
- **The UI composer cannot be reached for a stranger.** `openComposerFor` finds the conversation by
  `[id=<kpostId>]`, a row that exists only once there is traffic between the two accounts. The
  cross-channel test therefore seeds one API message as a declared PRECONDITION, then drives a real
  UI send. Not a product defect — an entry-point the bench cannot reach cold.
- **Kall `connected`** and therefore the call-log transitions FR-KL-008/009 need a second WebRTC
  peer, which this environment cannot provide. Everything before connection is covered.
- **Admin UI** — unchanged: no test deployment exists.

SAFETY
No gate weakened. `allowLiveRead` is strictly narrower than `allowLiveWrite` and cannot unlock a
write by construction, which a guard asserts. Every live write used the existing per-call
`allowLiveWrite` on the existing gated paths.

COVERAGE IMPACT
Actor pairs with live cross-actor evidence: 1 → **4** (sender→recipient, sender→confidential-copy,
group-admin→group-member, caller→participant), plus **both** API↔UI directions, now passing.
Framework guards 767 → **785**.

NEXT
Phase 9 — side-effect verification (master plan §11).

---

## PHASE: 9 — Side-effect verification

STATUS: COMPLETE — and it found two application defects on its first live run, in two different
modules, with the same shape.

OBJECTIVE
Master plan §11: verify that the CONSEQUENCE of an action landed, wherever reliable state/API
evidence exists, rather than stopping at the action being accepted.

WHY THIS IS A DIFFERENT QUESTION FROM PHASE 7
Phase 7 asks whether a RESOURCE reached a declared state ("is this message read?"). A side effect is
the consequence somewhere else — the recipient's count, the member's own group list. A message can be
correctly stored, correctly returned, and correctly marked read while the count the recipient's client
renders never moves. No assertion about the message itself can see that.

IMPLEMENTED

**`src/side-effects/`** — `checkSideEffect(evidence, expectation)` over
`OBSERVED | NOT_OBSERVED | INDETERMINATE`. Pure, and deliberately carries no pass, no severity and no
confidence — the same boundary Phase 7 keeps, so a spec (and later the confidence gate) owns the
verdict. Expectations are `{delta}`, `{becomes}` or `{changes: true}`.

**The rule the layer exists to enforce: assert the DELTA, never the absolute value.** These QA
accounts are shared and never empty — the recipient's count was 67 and the member's group list 16 when
this was written. An absolute assertion is false on the first run and then gets "repaired" by
loosening it to `toBeGreaterThan(0)`, which passes for any number and tests nothing. Measuring before
and after keeps the assertion exact AND independent of whatever else is in the account. A guard proves
the same delta holds at baselines 0, 21 and 4097.

**Unmeasured is never unchanged.** A missing before or after is INDETERMINATE, and a delta over a
non-number is refused rather than coerced — `"21" - "20"` is 1 in JavaScript, so an API that started
returning counts as strings would silently keep passing, and `null - null` is 0, so a delta of 0 would
"hold" over two values nobody measured.

FILES CHANGED
New: `src/side-effects/{check.ts,index.ts}`, `tests/framework/side-effects.spec.ts`,
`tests/api/kpost/katchup/side-effect.spec.ts`, `tests/api/kpost/group/side-effect.spec.ts`.

TESTS
+15 framework guards (delta at any baseline, wrong-amount fails, negative delta, missing before/after,
string and NaN counts refused, flag `becomes`, unspecified `changes`, no verdict fields, correlation
ids preserved, no credential in a summary line) and 2 live application tests.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · `npm run check` PASS ·
framework **800 pass / 4 skip**.

LIVE EXECUTION (gated, dry-run filing, accounts the bench owns)

| Side effect                              | Result                               |
| ---------------------------------------- | ------------------------------------ |
| Katchup: recipient count on send         | OBSERVED (+1) — correct              |
| Katchup: recipient count on recall       | **NOT_OBSERVED (0, expected −1)**    |
| Group: member's own group count on add   | OBSERVED (+1) — correct              |
| Group: member still listed after removal | **still listed after a 200 removal** |

RESOURCES
Every flow registered what it created before asserting; messages and groups cleaned by the ledger.
See the second finding for why the product retains a group the ledger successfully deleted.

FINDINGS — both reproduced across consecutive runs, neither filed (master plan §12–§14 own filing)

- **A recalled message leaves the recipient's list but not their count.** Measured three times
  (67→68, 68→69, and again). The recall is accepted (200) and BR-K03 IS upheld — the recipient's own
  conversation read no longer contains the msgID, which this test asserts and which passes. But
  `messageCountBetweenSenderAndReceiver` does not come down. So **the count contradicts the list the
  same actor just read**: the recipient is told there are N messages while only N−1 can be opened.
  The cross-check against the list is what makes this interpretable — "the count did not move" alone
  would be ambiguous, because a count that deliberately included recalled tombstones would behave the
  same way and be correct. Corroborating: the baseline climbed by one per run even though the ledger
  deleted each message, so the count appears **monotonic**.
- **A removed group member keeps the group in their own list.** groupID 4196 and again 4197 remained
  in the member's `myGroups` read after the admin's removal returned 200. Verified by PRESENCE, not
  only by the count, and the envelope was measured first to rule out the obvious innocent explanation:
  with a null `lastfetchDate` the response is the FULL list and carries only `group_added` and
  `group_updated` — **there is no `group_removed` channel**, so remaining in `group_added` is the
  only thing the endpoint can mean. Corroborating: the member's baseline climbed 16→17→18→19→20 across
  runs although every group was removed AND deleted, so the list appears to shed nothing.
  **CORRECTED BY PHASE 11.** This entry originally called the finding a confidentiality failure, on
  the reasoning that a member who still lists a group still sees its traffic. Phase 11 measured that
  independently and it is **wrong**: a message sent to the group after the removal does NOT reach the
  removed member. The delivery boundary closes. What remains is a stale list entry — a real defect,
  but a data-consistency one, not an access one. The overstated claim is left visible here rather than
  edited away, because the point of the confirmation stage is that it caught it.
- **The two share a shape**, in different modules: the derived view grows on an ADD and never shrinks
  on a WITHDRAWAL. Whether that is one root cause or two is exactly the judgement Phase 12 (canonical
  defects) exists to make, and it is recorded here rather than decided now. The master plan is
  explicit that variants may be grouped only when evidence supports equivalence, and it does not yet.

CONFLICTS
None introduced.

BLOCKERS
None. Read receipts, mail transaction status and attachment associations are further side effects with
reliable evidence; they are coverage still to add, not blockers.

SAFETY
No gate weakened. Both live specs stay behind their existing `*_LIFECYCLE` flags, write through the
existing per-call `allowLiveWrite`, and register every resource with the ledger before any assertion
can fail. The two failing tests are left FAILING: a genuine application failure is a successful
discovery, and converting either into a skip or a `<600` status check is the anti-pattern the master
plan forbids.

COVERAGE IMPACT
Side-effect classes with live evidence: 0 → 2 (derived message count, derived membership list).
Framework guards 785 → **800**.

NEXT
Phase 10 — failure analysis upgrade (master plan §12). The two findings above are its first real
input, and both are already carrying the evidence it needs: endpoint, actor, before/after state,
correlation ids and an independent cross-check.

---

## PHASE: 10 — Failure analysis upgrade

STATUS: COMPLETE

OBJECTIVE
Master plan §12: make the failure analysis consume flow, actor, state, invariant, resource and
requirement evidence, and distinguish the categories it lists — while obeying two prohibitions it
states outright: **do not classify an application bug from HTTP status alone**, and **do not classify
a downstream step when its prerequisite failed**.

APPROACH — EXTENDED, NOT REPLACED
A substantial analysis layer already existed (~3 000 lines: a 7-class classifier, an evidence
journal, origin attribution, reachability, and a confidence gate that answers ELIGIBLE /
NOT_ELIGIBLE / INDETERMINATE with named factors and no numeric score). Replacing a core
architectural system is a master-plan stop condition, and there was no reason to: the plan's list of
categories maps onto the existing TWO-AXIS model — `FailureClass` (who is responsible) ×
`ViolationType` (which dimension was violated). Everything below is additive, and **all 800
pre-existing framework guards still pass unchanged**, which is the evidence that no existing verdict
moved.

IMPLEMENTED

**The dimensions that were collapsing.** `authentication.*` and `authorization.*` both resolved to
`SECURITY`, so "the caller was not who they claimed" and "the caller was not allowed to do that" —
different defects, different owners, different fixes — were indistinguishable in every report. They
are now their own dimensions, and `STATE_TRANSITION`, `SIDE_EFFECT`, `DATA_CONSISTENCY` and
`UI_BEHAVIOUR` were added for the Phase 7 / Phase 9 / UI evidence that previously had nowhere to go.

**Safe for Bugzilla, checked rather than assumed.** A bug fingerprint is
`endpointId | validatorName | message` (`bug-fingerprint.ts`); `violationType` is not part of it.
So refining a dimension cannot orphan an existing ticket or duplicate one — the exact trap the
2026-09-17 product-scoped-dedup entry in the decision log records, checked before the change rather
than discovered after it.

**The prerequisite rule.** `FailureInput` gained an optional `flowStep`, and a rule sits with the
other BLOCKED rules: a step whose DECLARED prerequisite failed classifies `BLOCKED` /
`FLOW_PREREQUISITE_FAILED`, naming the step that actually failed. It is deliberately narrower than
"something earlier went wrong" — it fires only on a declared artifact dependency, the same one the
flow engine blocks on, so an unrelated failure elsewhere in the flow cannot silence a real finding.

**Unmeasured is never a defect, at this layer too.** Phase 9 refuses to judge a delta whose before or
after was never measured. Without a rule here that refusal was undone one layer later: the exchange
is application-attributed, so the contract-violation rule would have reported a defect on the
strength of a measurement nobody took. `INDETERMINATE` now classifies `INSUFFICIENT_EVIDENCE`,
while `NOT_OBSERVED` / `NOT_OCCURRED` deliberately falls through to the ordinary application rule —
the application WAS measured and did not do the thing, which needs no special pleading.

**Provenance.** Actor role and pool KEY, flow and step id, transition and side-effect outcome,
invariant id and requirement ids now travel on every decision — present only when supplied, so
nothing is invented, and a guard asserts no credential reaches the record.

**The gate.** `AUTHENTICATION` and `AUTHORIZATION` share the `SECURITY` branch on purpose: the
classification question and the evidence question are different, and the evidence answer is
identical for all three (request VALUES are never recorded, by design), so every existing verdict
stays byte-identical while the report gains the distinction. The four new dimensions get branches
that answer INDETERMINATE and name precisely what is missing — for transitions and side effects that
is CARRIAGE, not evidence: Phase 7 and Phase 9 produce the record, the observation does not yet hold
it. Saying ELIGIBLE there would mean the gate had verified something it never saw.

FILES CHANGED
`src/failure-analysis/classification.ts` (6 violation types, 6 reason codes, version 3.3.1 → 3.4.0),
`classifier.ts` (`FailureInput` + 6 optional evidence fields, 3 new rules, provenance on every
decision), `confidence.ts` (4 gate reason codes), `confidence-gate.ts` (new dimension branches).
New: `tests/framework/failure-analysis-evidence.spec.ts`.

TESTS
+15 guards: the prerequisite rule fires, names the blocking step, and — the negative case that gives
it meaning — does NOT fire on the same evidence without a failed prerequisite; INDETERMINATE
transitions and side effects are INSUFFICIENT_EVIDENCE while measured ones stay defects; a 503 from
an intermediary is not a defect (same status, different origin, different answer); authentication,
authorization and security are three dimensions; every dimension in the vocabulary is reachable from
a real validator name, so none is decorative; provenance reaches the record, carries no credential,
and is absent when not supplied.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · `npm run check` PASS ·
framework **815 pass / 4 skip** (was 800). No live execution — every rule is a pure function.

FINDINGS
None new. This phase is the machinery that will classify the two Phase 9 findings; it does not
re-judge them, and neither has been filed.

CONFLICTS
None introduced.

BLOCKERS
None. The honest gap this phase documents rather than hides: the transition and side-effect records
exist in the TESTS but are not yet carried on the observation, so the gate answers INDETERMINATE for
those dimensions. Carrying them is Phase 11 work, and the gate now names exactly which fields it
needs.

SAFETY
No gate weakened, no filing behaviour changed, nothing connected to Bugzilla. The classifier still
decides nothing about filing.

COVERAGE IMPACT
Violation dimensions 10 → 16; classifier reason codes 19 → 25; gate reason codes 24 → 28.
Framework guards 800 → **815**.

NEXT
Phase 11 — independent confirmation engine (master plan §13).

---

## PHASE: 11 — Independent confirmation engine

STATUS: COMPLETE — and on its first live use it **overturned one of the Phase 9 findings**, which is
the best possible evidence that the stage is doing its job.

OBJECTIVE
Master plan §13: a SEPARATE confirmation stage that re-observes a detected behaviour through an
independent path, with the prohibition stated in one line — _do not simply repeat the same
assertion._

WHY A SEPARATE STAGE
A detection that also confirms itself cannot tell a product defect from a bench mistake, because the
same code produced both answers. Re-running a failing check repeats the same request through the same
client, reads it with the same parser and applies the same expectation, so it reproduces every
mistake the first run could have made — and returns the same answer with more confidence attached.

IMPLEMENTED

**`src/confirmation/`** — pure, and it observes nothing. A spec makes the observations and hands in
what it saw, exactly as the state-transition and side-effect layers work. That is a safety property,
not a style choice: if this layer could send a request it could repeat a write, and every gate the
executor enforces would have a second door. A guard asserts its whole public surface is pure
functions over data.

**Independence is structural.** A channel is a triple — surface, actor, endpoint — and a
confirmation is independent if it differs in any one of them, because each breaks a distinct shared
assumption: a UI observation shares neither the request builder nor the parser nor the session; a
different actor shares neither session nor permissions; a different endpoint at least does not share
the first one's handler. Strength is an ordinal label (`STRONGEST` / `STRONG` / `WEAK` / `NONE`),
never a score — a number invites a threshold, a threshold invites tuning it until the queue looks
right, and a tuned number cannot say WHICH assumption was broken.

**Independence is decided before the observation is read**, so a same-path observation can never
reach `CONFIRMED` however emphatically it agrees. A guard runs all three agreement values through an
identical channel and asserts all three are INDETERMINATE.

**Three outcomes.** `CONFIRMED` / `NOT_REPRODUCED` / `INDETERMINATE`, with the same boundary the
earlier layers keep: "we could not look" and "we looked and it was fine" are different facts, and
collapsing them would discard a real finding whenever the confirming path happened to be unavailable.
`NOT_REPRODUCED` says in as many words that the detection is in doubt and must not be reported as a
defect on the original observation alone.

FILES CHANGED
New: `src/confirmation/{channel.ts,confirm.ts,index.ts}`,
`tests/framework/confirmation.spec.ts`, `tests/api/kpost/group/confirmation.spec.ts`.
Changed: `tests/api/kpost/group/side-effect.spec.ts` (impact claim removed — see below).

TESTS
+12 framework guards and 1 live independent confirmation.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · `npm run check` PASS ·
framework **827 pass / 4 skip**.

LIVE EXECUTION — the first real confirmation, and its result

The Phase 9 membership finding was detected through `contacts-my-groups`. Re-reading that endpoint
would have asked the same question again, so the confirmation asked a DIFFERENT module the
consequential version of it:

> can a removed member still read traffic sent to the group AFTER their removal?

A message sent after the removal is content they have no claim to under any reading. Measured on
live: group created, member removed (200), msgID **811541** sent to the group addressed to the
remaining membership only, then the removed member's own `katchup-conversation` read.

**Result: NOT_REPRODUCED.** Their read returns the group's membership system messages (811539
"added", 811540 "Removed") but **not 811541**. The delivery boundary closes.

FINDINGS — one CORRECTION, and one finding narrowed

- **The Phase 9 group finding was overstated, and this caught it.** That entry called the stale
  membership a confidentiality failure, reasoning that a member who still lists a group still sees
  its traffic. That reasoning was never measured, and it is wrong. The finding survives — a member
  removed with a 200 still holds the group in their own list, and the list sheds nothing across runs
  — but it is a **data-consistency** defect, not an access one. The Phase 9 entry now carries the
  correction, and the overstated sentence is left visible there rather than edited away, because the
  whole point of this stage is that it caught it. The assertion message in
  `group/side-effect.spec.ts` was rewritten for the same reason: a failure message that claims an
  impact the bench measured to be absent would mislead whoever reads it.
- **The Katchup count finding is untouched** and still stands: it was already confirmed by a second,
  independent read (the recipient's own list) at the moment it was detected, which is the same
  `WEAK` shape of independence — a different endpoint, same actor, same surface.
- Nothing has been filed. Filing remains Phase 12–14 work.

CONFLICTS
None introduced. One resolved: the Phase 9 impact claim, resolved by measurement rather than by
judgement.

BLOCKERS
None. The honest gap: confirmations are written per-finding by a spec today. A confirmation PLANNER
that proposes the independent channel automatically from a classified observation is the natural
next step, and it needs the transition and side-effect records to be carried on the observation —
the same carriage Phase 10's gate already names as missing.

SAFETY
No gate weakened. The confirmation module cannot send anything. The one live confirming observation
is a READ made as the member — the bench looks at what the product shows that account and changes
nothing. Both resources registered and cleaned (`cleaned: 2, failed: 0`).

COVERAGE IMPACT
Framework guards 815 → **827**. Findings independently confirmed: 1 examined, 1 overturned.

NEXT
Phase 12 — duplicate detection and canonical defects (master plan §14).

---

## PHASE: 12 — Duplicate detection and canonical defects

STATUS: COMPLETE

OBJECTIVE
Master plan §14: stop one fault being filed several times, group API/UI/actor variants **only when
evidence supports equivalence**, keep detection, confirmation, deduplication and filing separate,
and obey the prohibition stated outright — _do not merge merely because status codes or titles
match._

THE ASYMMETRY EVERY RULE RESTS ON

    a wrong SPLIT   two tickets for one fault — noisy, visible, cheap to fix
    a wrong MERGE   a real fault hidden inside a ticket somebody already closed — invisible

They are not equally bad, so the rules are not symmetric. Equivalence must be POSITIVELY supported;
anything short of that is `UNDECIDED`, which files separately and leaves both faults visible.

IMPLEMENTED

**`src/canonical-defect/`** — identity is a set of named dimensions (module, feature, action,
resource kind, actor relationship, failure category, observable behaviour), and nothing in the module
reads a title, a message or a status code. A guard asserts that on the type itself rather than
trusting review. `observableBehaviour` is the load-bearing dimension: a short structural phrase for
what is actually wrong ("derived-count-not-decremented-on-withdrawal"), so two findings that agree on
everything else and differ there are two defects.

**`variant` is deliberately NOT part of identity** — it is exactly what a defect may differ in
while staying one defect, which is the whole reason grouping exists. `flowId` is excluded for the
same reason: one fault can be reached by several flows.

**Why this is separate from the bug fingerprint, and why the fingerprint is untouched.**
`bug-fingerprint.ts` answers a narrower question — has THIS check on THIS endpoint been filed
before? — by hashing `endpointId | validatorName | message`. It cannot answer whether an API
finding and a UI finding are two views of one defect, because those differ in endpoint and message by
construction. So this phase adds a second, coarser question and changes no tag, which means no filed
ticket can be orphaned or duplicated by it.

**`UNDECIDED` costs a merge.** A pair missing module, action or observable behaviour on either side
is not grouped, and a guard asserts the grouping actually splits them — otherwise the refusal to
guess would be a comment rather than a rule.

**The canonical key is readable, not a hash.** Shorter would be easy; auditable matters more here
than anywhere, because a wrong merge is the failure that never surfaces again.

FILES CHANGED
New: `src/canonical-defect/{identity.ts,equivalence.ts,index.ts}`,
`tests/framework/canonical-defect.spec.ts`.

TESTS
+15 guards, including two built on the REAL Phase 9 findings rather than invented examples.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · `npm run check` PASS ·
framework **842 pass / 4 skip**. No live execution — the whole phase is pure reasoning over recorded
evidence.

THE DECISION IT WAS BUILT TO MAKE, AND THE ANSWER

Phase 9 recorded that its two findings "share a shape, in different modules: the derived view grows
on an ADD and never shrinks on a WITHDRAWAL", and explicitly deferred whether that is one root cause
or two. This phase answers it: **two canonical defects.** They agree on `observableBehaviour` —
the resemblance is real — and disagree on module, action and resource kind, which is where a fault
lives. Grouping them would have put a Group-side fault inside a Katchup ticket, and if
that ticket were closed the second fault would never surface again. Both stay visible, and two guards
pin it so a later "tidy-up" cannot merge them.

FINDINGS
None new. This phase counts defects; it does not detect them.

CONFLICTS
None introduced.

BLOCKERS
None. The honest gap: identities are constructed by hand in the specs today. Deriving a
`DefectIdentity` automatically from a classified observation needs the same carriage Phase 10 and
Phase 11 already name as missing — the transition, side-effect and actor records on the observation.

SAFETY
No gate weakened, no fingerprint changed, nothing connected to Bugzilla. Filing is still not armed.

COVERAGE IMPACT
Framework guards 827 → **842**.

NEXT
Phase 13 — confidence gate (master plan §15).

---

## PHASE: 13 — Confidence gate

STATUS: COMPLETE — and most of what it delivers is a refusal to act.

OBJECTIVE
Master plan §15, which is unusual in that most of its instruction is restraint:

> Keep the existing confidence gate shadow-only until evidence is mature. … Do not enforce
> confidence prematurely.

and it names the pipeline: Observation → Classification → Confirmation → Deduplication → Confidence →
Filing eligibility.

WHAT WAS ALREADY TRUE, AND CHECKED RATHER THAN ASSUMED
The gate was already shadow-only: its consumers are `reporting/confidence-{divergence,journal,
reporter}.ts` and nothing else. **`src/bug-tracker` does not reference it at all** — no filing
decision reads a confidence verdict. That was verified by reading the imports, not inferred from the
design.

IMPLEMENTED

**Two new factors, recorded and NOT enforced.** `independentlyConfirmed` (Phase 11) and
`distinctCanonicalDefect` (Phase 12) are now computed on every decision so a shadow run can measure
how often each is actually available on real traffic — which is exactly the "until evidence is
mature" the phase asks for. A guard asserts **no rule branches on either** (`factors.<name>` is read
zero times in the gate), so recording them cannot quietly become enforcing them.

**The two defaults point in opposite directions, on purpose.**
`independentlyConfirmed` is conservative: anything but an explicit `CONFIRMED` is false, because
"never attempted" and "did not reproduce" are both "not evidence FOR a defect".
`distinctCanonicalDefect` defaults to TRUE when no duplicate analysis exists, because treating an
unexamined finding as already-known would SUPPRESS it — and suppressing an unexamined finding is the
one mistake this whole architecture is built to avoid. Over-reporting is visible and cheap; silent
suppression is not.

**The structural guard that keeps it shadow-only.** `src/bug-tracker` may not reference the
confidence gate or the canonical-defect grouping. While the wire does not exist, no edit can arm
confidence by accident — a rule that cannot be reached cannot be enforced early.

**And a guard that the stages stay separate**, each in its own module in the plan's order, plus one
asserting that confirmation and deduplication cannot send a request. That last one is a SAFETY
property, not a stylistic one: if either could reach the network it could repeat a write, and every
gate the executor enforces would have a second door.

FILES CHANGED
`src/failure-analysis/confidence.ts` (2 factors, 2 optional evidence carriers on
`ConfidenceInput`), `confidence-gate.ts` (2 pure helpers, factors assembled).
New: `tests/framework/confidence-shadow.spec.ts`.

TESTS
+7 guards. Three of them failed on first run and **the guards were wrong, not the code** — one named
a filer file that does not exist (`bug-filer.ts`; it is `bugzilla-filer.ts`), one matched the whole
`failure-analysis` barrel instead of the gate's own exports, and one matched the word
`EndpointExecutor` inside a COMMENT that exists to explain the very boundary being tested. The
third is worth keeping in mind: a guard that trips on its own explanation teaches everyone to stop
explaining things, so it now strips comments before scanning code.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · `npm run check` PASS ·
framework **849 pass / 4 skip**. No live execution — the whole phase is pure.

FINDINGS
None. This phase decides nothing.

CONFLICTS
None introduced.

BLOCKERS
None. The gate stays shadow-only by instruction, not because anything is missing. Arming it is a
later decision and needs the shadow run's evidence first.

SAFETY
No gate weakened; filing still unarmed and still unable to read a confidence verdict.

COVERAGE IMPACT
Confidence factors 10 → 12. Framework guards 842 → **849**.

NEXT
Phase 14 — Bugzilla integration (master plan §16). **This is the first phase that can write to a
developer's queue, so it is the right place to pause for the owner.** Filing must stay dry-run until
explicitly armed, an assignee must never be guessed, and nothing may be filed from a raw failed test
— all three are standing instructions in this session's brief.

---

## PHASE: 14 — Bugzilla integration

STATUS: **GATED — not started, deliberately.** Its own precondition is not met, and Phase 13 is the
reason.

THE GATE, IN THE PLAN'S OWN WORDS

> Connect Bugzilla only after confirmation, deduplication, and confidence are trustworthy.

- **Confirmation** — built and proven (Phase 11). On its first live use it overturned a finding.
- **Deduplication** — built and proven (Phase 12).
- **Confidence** — **shadow-only, by instruction.** Phase 15 of the plan says "keep the existing
  confidence gate shadow-only until evidence is mature" and "do not enforce confidence prematurely".
  It has never run against a full live corpus, so nobody yet knows how often its factors are actually
  available. That is not a defect in the gate; it is the maturity the plan asks to wait for.

Two of three preconditions hold. The third is deliberately unmet, so connecting Bugzilla now would
mean overriding an explicit instruction in order to satisfy the phase that follows it.

WHAT WOULD HAVE TO HAPPEN FIRST (the shortest honest path)

1. Run the shadow pipeline over a full live corpus (`npm run kpost`, `kmail`, `admin`, dry) and
   read `confidence-divergence`: how often is each factor available, and where does the gate
   disagree with the classifier?
2. Decide, with the owner, which `INDETERMINATE` dimensions are acceptable to file on. Today
   STATE_TRANSITION, SIDE_EFFECT, DATA_CONSISTENCY and UI_BEHAVIOUR all answer INDETERMINATE for want
   of CARRIAGE — the records exist in the tests but are not on the observation (Phase 10 names the
   exact fields).
3. Carry those records onto the observation, so the gate can re-witness what the specs already assert.
4. Only then wire filing, and only for `CONFIRMED` + `distinct` + `APP_DEFECT`.

THE TWO FINDINGS WAITING, AND WHY NEITHER HAS BEEN FILED

Both are real, both reproduced, neither filed — filing is a later stage and is not armed:

| Finding                                                  | Confirmed?              | Canonical |
| -------------------------------------------------------- | ----------------------- | --------- |
| Recall removes the message but not the recipient's count | yes, second read (WEAK) | distinct  |
| A removed group member keeps the group in their own list | yes, and NARROWED       | distinct  |

The second is the one to read carefully: Phase 9 called it a confidentiality failure, and Phase 11
measured that claim independently and **disproved it** — post-removal group traffic does not reach
the removed member. Had filing been armed at Phase 9, a developer would have received a
confidentiality ticket that was wrong about its own impact. That is the clearest possible argument
for the ordering the plan insists on, and it is why this phase stays gated rather than being argued
around.

ALSO REQUIRED BEFORE ANY FILING, AND NOT YET DONE
Assignment must use the authoritative existing mapping (`src/config/ownership.config.ts`, reconciled
against live Bugzilla by a framework test) and **never be guessed** — a standing instruction in this
session's brief and a stop condition in the plan. The 9 Admin API findings carried over from §12 of
the brief are in the same position: recorded, unfiled, awaiting this pipeline.

SAFETY
Nothing was connected. `BUGZILLA_DRY_RUN` remains the default, filing is armed only by the `:file`
commands, and `src/bug-tracker` still cannot read a confidence verdict or a canonical defect — a
Phase 13 guard enforces that structurally.

NEXT
Phases 15–17 (complete API coverage, complete UI coverage, resource/cleanup hardening) are
**independent of this gate** and can proceed without it. Phase 15 is the natural next step: 64
registered endpoints have no generated tests, measured in Phase 4I-B.

---

## PHASE: 15 — Complete API coverage

STATUS: COMPLETE

OBJECTIVE
Master plan §17: an authoritative coverage matrix over every registered endpoint, with no
unexplained gaps — and explicitly NOT thousands of uncontrolled live-write tests.

THE NUMBER, RECOMPUTED RATHER THAN REUSED

The brief cites ~64 endpoints without generated tests. **Measured from the current repository, that
number is now 0.** It was real when Phase 4I found it and has since been closed:

|                                |         Count |
| ------------------------------ | ------------: |
| Registered endpoints           |       **350** |
| Generated validator cases      |           289 |
| Driven by a hand-written flow  |           175 |
| Flow only (no generated cases) |            59 |
| Documented exclusions          |             5 |
| **Blocked**                    | **0** (was 2) |
| **NOT_YET_COVERED**            |         **0** |

289 + 59 + 2 accounted for the 350 before this phase; the 2 are now closed, so every endpoint reaches
an execution layer. The brief's instruction not to assume "no generated test" means "untested" was
the right caution: 59 endpoints are covered behaviourally by a flow and would look uncovered to a
generator-only count.

WHAT WAS ACTUALLY MISSING — the other dimensions

The old matrix measured three things (contract, flow, live). The plan asks for ten, and the gaps are
there, not in execution:

| Dimension                                      | Covered | of 350 |
| ---------------------------------------------- | ------: | -----: |
| A schema is held (contract declared)           |     279 |        |
| Generated validator cases                      |     289 |        |
| Negative / input-validation probes             |     289 |        |
| Auth + security probes                         |     251 |        |
| Named by a business invariant                  |      39 |        |
| …and that invariant declares observed states   |      13 |        |
| Cross-checked by a UI spec                     |       6 |        |
| Observed by a cross-actor or confirmation spec |      10 |        |

They are deliberately NOT summed into a score: a percentage lets a strong dimension hide a missing
one, which is the exact failure the matrix exists to prevent.

IMPLEMENTED

**The matrix generator extended from 3 dimensions to 10**, with the full column set the brief asks
for plus a REASON column, so no status is unexplained. Business-rule and state coverage are read from
the **invariant registry** (`appliesTo`, `observedStates`), never from a test title or a filename —
otherwise the matrix would reward naming a file well rather than declaring a rule. `appliesTo` is
already registry-validated, so a typo cannot masquerade as coverage.

**Live coverage is three-valued** (`default` / `gated` / `—`) rather than a tick, because "never
runs live" and "runs live only behind its lifecycle flag" are very different claims and a boolean
flatters the second into the first.

**The 2 blocked endpoints are CLOSED — the debt was paid, not reclassified.**
`group-download-image` and `group-download-full-image` are GETs keyed by a runtime group id. Their
recorded recovery path was "an authorised-read concept (the read equivalent of `allowLiveWrite`)".
Phase 8 built exactly that, so the group lifecycle now drives both with `allowLiveRead`, against the
image it sets and before it removes it. The entries were **deleted** from
`BLOCKED_BY_ARCHITECTURE` rather than moved to `DOCUMENTED_EXCLUSIONS`, because "not applicable"
ends a conversation that here was genuinely finished.

FILES CHANGED
`tests/framework/endpoint-execution-matrix.spec.ts` (10 dimensions, reason column, blockers cleared,
+4 guards), `tests/api/kpost/group/feature.spec.ts` (the two downloads, `readAs` helper),
`docs/ENDPOINT-EXECUTION-MATRIX.md` (regenerated).

TESTS
+4 framework guards: every endpoint carries an actionable reason; a documented exclusion is genuinely
outside the generated matrix (a stale exclusion is worse than none — each names a real hazard, so one
that starts being generated means the hazard is live); an endpoint cleared for live is actually
executed by something (`productionSafe` is permission, not coverage); the blocked list and the
reported statuses agree.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · framework **853 pass / 4 skip**.

LIVE EXECUTION
Group lifecycle re-run on live with the two downloads. Both **answer 204**. Resources cleaned.

FINDINGS

- **NEW: `group-admin-access` answers HTTP 500** —
  `"Make user as Admin or remove Admin in an Existing Group failed"` — on a client-reachable path
  where a 4xx belongs. This is also why the existing FR-GM-012/013 promote/demote test fails; that
  failure was **pre-existing and had not been recorded**, and running the lifecycle live surfaced the
  cause. Same class as the Kall scheduled-call 500s already in the decision log. Recorded, not filed.
- **The image downloads are covered, but BOUNDED, and the record says which.** Both answer 204
  because `group-update-image` sends only the groupKpostID — uploading a real file is the documented
  attachment-upload gap. So what is proven is that the endpoints are REACHED with a real runtime id
  and answer correctly for a group with no image. Fetching actual image bytes still needs that gap
  closed, and the assertion is `< 500` rather than pretending otherwise.

CONFLICTS
None. The four earlier findings (Katchup count, group membership, the bench session-displacement
defect, and the disproven confidentiality classification) are untouched and still recorded.

BLOCKERS
None new, and one removed. The scoped ones stand: Admin UI deployment, Kall `connected`,
the visible-vs-confidential Copy account, KDiary UI, the non-contact UI composer.

SAFETY
No gate weakened and no fuzz added. `allowLiveRead` requires `destructive !== true`, so it cannot
unlock a write by construction — a Phase 8 guard asserts that. Phase 14 remains GATED: nothing here
touched filing.

COVERAGE IMPACT
Blocked endpoints 2 → **0**; NOT_YET_COVERED 0 → 0 (held); matrix dimensions 3 → **10**.
Framework guards 849 → **853**.

NEXT
Phase 16 — complete UI coverage (master plan §18).

---

## PHASE: 16 (partial) — UI evidence, and what it exposed

STATUS: IN PROGRESS — paused at the owner's direction to finish the backend bug package first.

**The rule (master plan §18):** do not equate a button click, a closed dialog, a URL change or an
input value with successful business behaviour. The reason is circularity — every one of those is
produced by the same client that would be wrong if the feature were broken.

**`tests/framework/ui-evidence.spec.ts`** audits every gated UI WRITE spec for the strongest
evidence it carries and writes `docs/UI-EVIDENCE-AUDIT.md`. Measured: **18 UI write specs, 4
carrying outcome evidence.** The rest are recorded as evidence DEBT, each with the path to closing
it. `katchup-actions.spec.ts` was the clearest case — Delete, Save and Copy each asserted only that
a menu or dialog closed.

**The enabler — `tests/e2e/support/api-evidence.ts`.** The reason most UI flows proved themselves
through the UI was not laziness: KPOST allows ONE session per account, so an API read-back logs in
again and displaces the very browser session under test (the Phase 8 defect, which presents as a
list that never fills). `observeAsBrowser` borrows the browser's OWN token via
`auth: { header }`, so no second session is created and the strongest evidence becomes available to
any UI spec. Every safety control still applies — it goes through `EndpointExecutor.send` unchanged.

**FINDING — an entire UI write spec had been failing on live and nobody knew.** All four tests in
`katchup-actions.spec.ts` failed at their first step: the composer is reached through a conversation
row keyed by kpostID, which exists only once there is traffic between the two accounts. Not a product
defect. Fixed with a declared, seeded precondition (using the browser's own token, so no
displacement) that is skipped when the row already exists. **Live: 4 failed / 5 passed → 1 failed /
8 passed**, and Delete now proves absence on the SERVER rather than by a closing dialog. The
remaining failure is a login flake (the country list failing to load leaves the id field disabled),
not a product defect.

---

## PHASE: BE — Backend / API bug preparation (owner-requested)

STATUS: COMPLETE. **Nothing was filed, assigned, commented on or closed.** Bugzilla was not written
to. The package is `reports/bugs/BACKEND-BUG-MANIFEST.md`.

OBJECTIVE
Produce the smallest defensible set of independently supported, canonical, backend-owned defects
genuinely ready for MANUAL filing — and stop at that boundary.

THE NARROWING, WHICH IS WHERE THE WORK IS

| Stage                                      | Count |
| ------------------------------------------ | ----: |
| Classified observations                    |   482 |
| Classified APP_DEFECT                      |   392 |
| Shadow confidence gate ELIGIBLE            |    38 |
| Survived live re-verification (2026-09-21) |    14 |
| After removing bench-payload artefacts     |     8 |
| **Canonical backend defects ready**        | **4** |

TWO REDUCTIONS THAT WOULD OTHERWISE HAVE REACHED A DEVELOPER

- **24 findings no longer reproduce.** All 16 `response.error-format` findings on
  `common-designation`, `common-languages` and `common-postal-pincode` now PASS against the
  current build. They were real on 2026-09-20 and are not real today. This is why the brief's
  instruction not to trust historical findings was right.
- **6 were the bench's own empty request.** The profile image/attachment 500s come from
  `sendTo(id, {})`, which never runs the request factory — a bench defect already in `CLAUDE.md`.
  Those endpoints are multipart uploads that received no body at all.

READY FOR MANUAL FILING — all `KPost API` → Jaganathan Murthy, from the authoritative mapping

| ID        | Defect                                                  | Component                            | Ownership           |
| --------- | ------------------------------------------------------- | ------------------------------------ | ------------------- |
| CD-BE-001 | `getTotalCountByDate` 500s on every well-formed request | Common Reference Data & Utilities V2 | BACKEND_API         |
| CD-BE-002 | `msStatus` returns a bare string, not JSON              | Common Reference Data & Utilities V2 | BACKEND_CONTRACT    |
| CD-BE-003 | recall clears the recipient's list but not their count  | Katchup Messaging V2                 | BACKEND_PERSISTENCE |
| CD-BE-004 | a removed group member keeps the group in their list    | Contacts Directory V2                | BACKEND_PERSISTENCE |

CD-BE-001 is the strongest: the SAME endpoint answers a correct 400 to a malformed body and 500 to a
well-formed one, so routing and parsing work and the handler itself faults. The 500 body is a generic
`"Unexpected error occurred"` — the documented signature of a real crash, as opposed to a
`"X is required"` field error, which signals a bench payload gap.

**CD-BE-004 carries a scope correction:** it was first recorded as a confidentiality failure. That was
measured independently and disproved — post-removal group traffic does not reach the removed member.
It is a data-consistency defect and must not be filed as an access-control one.

NOT MERGED, DELIBERATELY: CD-BE-003 and CD-BE-004 share a shape (a derived view grows on an add and
never shrinks on a withdrawal) in two modules. Merging would put a Group fault inside a Katchup
ticket; if that ticket were closed the second would never surface again.

ASSIGNMENT
Authoritative. `src/config/ownership.config.ts` gives product + component + owner, and a framework
test reconciles it against the live Bugzilla component defaults. Components resolved per endpoint
from `docs/COMPONENT-ROUTING.md`. **No assignee was guessed, and none had to be.**

GATES VERIFIED, NONE WEAKENED
Dry-run default, the `.env`-cannot-arm-filing rule, the validity gate, cascade consolidation,
component routing, ownership reconciliation, secret redaction, and the Phase 13 guard that
`src/bug-tracker` cannot read a confidence verdict — **35 filing-gate guards pass**. Confidence
remains shadow-only; it was not promoted to production filing.

VERIFICATION
typecheck 0 · lint 0 errors / 32 warnings (baseline) · framework **857 pass / 4 skip** ·
live re-verification of the common module (read-only, dry-run).

NEW FINDING RECORDED, NOT FILED
`group-admin-access` returns **500** — `"Make user as Admin or remove Admin in an Existing Group
failed"`. It is also why the FR-GM-012/013 promote/demote test fails, a failure that had not been
recorded. Seen once; it needs a second independent run before it is fileable, so it sits in section C.

REMAINING BLOCKERS
The input-validation class (107 findings) is the most likely to become fileable, and the fix is a
Test Bench one: record the mutation kind and field NAME — never the value — on the request evidence.

NEXT
Owner review of `reports/bugs/BACKEND-BUG-MANIFEST.md`, then `npm run kpost` (preview) and
`npm run kpost:file` (files). Phases 16–20 resume after that.
