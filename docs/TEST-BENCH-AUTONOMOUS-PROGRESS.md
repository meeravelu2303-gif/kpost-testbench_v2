# Test Bench — autonomous implementation progress

**Handoff file** for `KPOST-Test-Bench-Master-Autonomous-Implementation-Plan.md` §23. Hand-written;
it records what each phase actually did, with evidence. If a session stops, start here.

Newest phase last. Every phase ends with the §24 completion record.

---

## Phase index

| Phase | Name                                                    | Status      |
| ----- | ------------------------------------------------------- | ----------- |
| 3     | Actor model foundation                                  | COMPLETE    |
| 4A–4D | State discovery / model / observation / calibration     | COMPLETE    |
| 4D-B  | Test account registry                                   | COMPLETE    |
| 4F    | Architecture / duplication / hygiene audit              | COMPLETE    |
| 4G    | Tier 0 test-correctness repair                          | COMPLETE    |
| 4H    | Architecture boundary & hygiene review                  | COMPLETE    |
| 4I    | Test executability & skip elimination                   | COMPLETE    |
| 4I-B  | Execution infrastructure repair & API coverage recovery | COMPLETE    |
| 5     | Business invariant model                                | COMPLETE    |
| 5B    | Safety-control correctness: the real-host signal        | COMPLETE    |
| 5C    | A refused probe is inconclusive, never a finding        | COMPLETE    |
| 6     | Application flow execution engine                       | NOT STARTED |

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
Phase 6 — application flow execution engine (master plan §8).
