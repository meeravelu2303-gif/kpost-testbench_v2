# KPOST Test Bench --- Master Autonomous Implementation Plan

## Purpose

This file is the long-running implementation contract for Claude Code.

The objective is to take the existing KPOST Test Bench from a mature
endpoint-validation framework to a production-grade
application-behaviour testing, defect-confirmation, deduplication, and
Bugzilla-reporting system.

Claude Code should use this file together with the repository itself as
the source of truth.

Implementation is continuous and phase-driven. Claude should not require
a human review after every phase when the next phase can be completed
safely from repository evidence and the rules below.

Architecture-changing decisions must remain conservative. If repository
code, documentation, or live evidence conflicts, preserve the conflict
and document it rather than inventing a resolution.

---

# 1. Non-Negotiable Mission

The Test Bench must eventually answer:

WHO → does WHAT → to WHICH resource → through WHICH application flow →
under WHICH preconditions → causing WHICH state transition → producing
WHICH side effects → validated by WHICH business rules → supported by
WHICH evidence → classified as WHICH failure → with WHICH confidence →
independently confirmed how → grouped/deduplicated how → and only then →
reported to Bugzilla.

The final system must not merely report HTTP failures.

A passing endpoint response is not proof of correct application
behaviour.

A failed assertion is not automatically an application defect.

A classifier result is not confirmation.

A confidence score is not truth.

A unique-looking failure is not automatically a unique bug.

Bugzilla filing must be the final consequence of a sufficiently
evidenced and independently confirmed application defect.

---

# 2. Absolute Rules

## Coverage

TEST EVERYTHING THAT THE SUPPORTED ENVIRONMENT CAN VALIDLY TEST.

Do not reduce coverage to improve pass rate.

Never: - delete tests because they are difficult; - weaken assertions; -
replace exact business checks with generic status checks; - change
expected statuses just to make tests pass; - add endpoint-specific
exceptions to suppress failures; - remove negative/security tests; -
replace endpoint tests with flow tests; - treat skipped tests as
acceptable permanent coverage.

A legitimate environment blocker may remain temporarily, but it must be
explicitly identified, evidence-backed, safety-controlled, recorded as
coverage debt/blocker, and given a recovery path.

Goal: zero unexplained skips and eventually zero supported-environment
blockers.

## Evidence

Every meaningful application-behaviour claim needs evidence.

Prefer: - response fields; - read-backs; - state observations; -
correlated resource IDs; - actor-specific observations; - database
evidence when legitimately available; - UI evidence; - before/after
observations; - side-effect evidence; - cleanup evidence.

Do not manufacture evidence from HTTP status alone, request
construction, UI dialog closure, literal true, a test title, an assumed
contract, or guessed database state.

## Requirements

Use the existing centralized Requirement Source Registry.

Do not create a second requirement system.

Do not silently resolve conflicting documents.

Preserve source, authority, status, conflicts, supersession, and
provenance.

Do not credit behavioural coverage merely because an endpoint has a
requirement ID. A flow must demonstrate the behaviour before the flow is
considered behavioural evidence.

## Architecture

Target direction:

Requirements → Flows → Actors → States → State Observation → State
Calibration → Test Data / Account Registry → Business Invariants → Flow
Execution → API / UI → Evidence → Failure Analysis → Confirmation →
Confidence → Reporting → Bugzilla

Existing endpoint validation remains a separate and important layer.

Do not make state definitions depend on validators, requirements depend
on execution, actors depend on Bugzilla, confidence depend directly on
Bugzilla, or Bugzilla determine test results.

Application state and Test Bench execution state are different concepts.

## Daily testing

Daily testing must continue while development continues.

Maintain a stable daily-test baseline.

New architecture must not make the stable daily Test Bench unusable.

Separate stable daily regression execution, architecture development,
and experimental/live-write execution.

## Safety

Never bypass: - live-write gates; - destructive gates; - environment
gates; - account allocation safety; - resource cleanup; - Bugzilla
dry-run/arming controls; - production restrictions; - credential
protection.

Do not turn safety controls off just to obtain coverage.

## Secrets

Never persist passwords, password hashes, tokens, cookies, session
secrets, authorization headers, OTP values, verification codes, API
keys, or private credentials.

Never place secrets into evidence, reports, canonical bug records, or
committed test data.

---

# 3. Already Implemented Architecture

Do not recreate these systems.

## Requirements

Implemented under `src/requirements/`: - source; - requirement; -
conflicts; - registry; - traceability; - index.

The registry preserves the existing canonical FR/NFR IDs and requirement
provenance.

Known documentation conflicts remain explicit.

## Flows

Implemented under `src/flows/`: - artifact; - flow; - validation; -
flow-run; - catalogue; - registry; - index.

Flow definitions are declarative. They describe actors, steps, actions,
channels, artifacts, bindings, requirements, and cleanup.

Do not put endpoint execution logic directly into flow definitions.

## Actors

Implemented under `src/actors/`: - role; - actor; - context; - index.

Current role vocabulary: - sender; - recipient; - copy-recipient; -
confidential-copy-recipient; - group-admin; - group-member; -
call-caller; - call-participant.

Do not invent roles without evidence.

AccountPool remains responsible for login/session allocation.
ActorContext determines which account plays which role.

## States

Implemented under `src/states/`.

Current narrow state model covers: - Katchup message; - Kall; - KMail
transaction.

State vocabulary deliberately preserves application representations and
conflicts.

Do not normalize conflicting representations without evidence.

Do not use Test Bench lifecycle statuses as application states.

## State Observation

Implemented under `src/state-observation/`.

It supports: - field-path extraction; - resource identity; - parent
identity; - PRESENT/NULL/ABSENT; - raw observed values; - matched state
definitions; - endpoint; - correlation; - run/test identity.

It must remain free of expected values, pass/fail verdicts, failure
classification, and Bugzilla logic.

## State calibration

Katchup sender-side read state was calibrated as status `0 → 2`, with
`readTime` becoming populated after recipient read.

A conflict remains about the exact mechanism/perspective: API
conversation-read evidence conflicts with the earlier UI-only mechanism
assumption.

Do not silently remove this conflict.

## Account Registry

Implemented under `src/test-data/accounts/`.

Persistent store: `test-data/accounts/accounts.jsonl`

Account Registry answers which test accounts exist and what their Test
Bench lifecycle is.

AccountPool answers which account/session slot may be used.

ActorContext answers which account is playing which role.

Do not merge these responsibilities.

Signup confirmation must be based on application evidence, not HTTP
success alone.

Signup accounts cannot currently be deleted by KPOST, so retirement is
distinct from cleanup.

---

# 4. Known Starting Issues

Re-check the current repository because Claude may already have fixed
some.

## Phase 4I-B known issues

1.  Four executability guards previously failed because of
    stale/over-broad logic:

    - signup scope;
    - dashboard endpoint live-cleared guard;
    - KMail `fetchMailType` false-positive identifier detection;
    - contacts `userTypeList` false-positive identifier detection.

2.  Admin UI environment configuration may use
    `https://adminmodule.kpostindia.com`, while documentation indicates
    the Admin UI host is `https://kpostadmin.kpostindia.com`.

3.  KMail deep/profile execution has module-scope AccountPool allocation
    problems caused by eager `currentSlot().principals(...)` calls in
    unrelated feature modules.

4.  About 55 registered endpoints previously had no generated validator
    matrix:

    - Group writes;
    - Kall writes;
    - Contacts writes;
    - KDiary writes;
    - KOS writes/AI;
    - Settings writes;
    - signup.

Do not blindly convert these into thousands of live destructive fuzz
cases.

5.  `npm run all` previously omitted the Admin suite.

6.  KDiary UI previously had an evidence-backed skip because the
    deployed UI did not expose the relevant route while API coverage
    existed.

7.  Destructive/deep execution is intentionally filtered by safety
    mechanisms. Do not globally unfilter it.

8.  Four framework skips are environment-valid and pass under mock. They
    are not automatically defects.

9.  Some generated endpoints are deliberately excluded because they end
    sessions or consume OTP.

10. Existing tests contain overclaims, including status-only assertions
    presented as business behaviour, UI dialog-close assertions
    presented as outcomes, incorrect cleanup claims, literal
    tautologies, and requirement tags that over-credit behavioural
    coverage.

Do not mass-fix all overclaims in one sweep. Repair them through
controlled evidence-based phases.

---

# 5. Phase Execution Protocol

Execute phases in order.

For each phase:

1.  Read this plan.
2.  Inspect current repository state.
3.  Determine whether the phase is already complete.
4.  If complete, verify its evidence and mark it complete.
5.  If incomplete, implement only the phase scope.
6.  Run required checks.
7.  Record files changed, tests added/changed, evidence, unresolved
    conflicts, blockers, live runs, resources created/cleaned, safety
    gates, and verification.
8.  Continue automatically to the next independent phase when safe.
9.  If a blocker affects only one branch, document it and continue with
    independent work.
10. STOP only when a safety decision, destructive/global action,
    unresolved architecture conflict, missing evidence, secret risk, or
    other explicit stop condition below requires human input.

Do not stop merely because a test fails. Investigate and classify it.

---

# 6. Phase 4I-B --- Test Execution Infrastructure Repair & API Coverage Recovery

## Objective

Repair execution infrastructure and recover reachable coverage without
weakening tests or safety.

Tasks:

### A. Fix the four known guard failures

Fix guard logic only. Do not suppress assertions, skip tests, or change
application expectations.

### B. Fix Admin UI configuration

Use verified documented environment configuration. Do not broaden host
allowlists merely to make a profile start.

### C. Fix KMail module-scope account allocation

Prefer lazy account/fixture resolution. Preserve AccountPool partition
invariants. Do not increase account counts just to hide the problem.

### D. Fix orchestration

If `npm run all` is intended to mean all major suites, include KPOST
API, KMail API, and Admin API while preserving safety filters.

### E. Missing endpoint inventory

Build an authoritative inventory of registered endpoints versus
contract, behavioural, flow, live, and mock coverage.

### F. Safe coverage recovery

For missing endpoints, add mock/contract/negative/security coverage
where safe. Add controlled live flow coverage where the endpoint is part
of an existing safe flow. Do not create thousands of uncontrolled live
writes.

### G. Destructive execution matrix

Document which commands execute read-only, safe writes, destructive
writes, account lifecycle, calibration, and UI writes.

### H. KDiary UI

Re-check whether the deployed application exposes the route. If not,
preserve the skip with evidence and document API/UI asymmetry.

Verification: - typecheck; - lint; - project check; - framework; - mock
framework; - affected API; - KMail; - Admin; - integration; - affected
UI when safely runnable.

---

# 7. Phase 5 --- Business Invariant Model

Create a centralized declarative business-rule/invariant layer under the
most appropriate existing architectural home.

Before creating a new directory, inspect the repository for an existing
suitable home.

Each invariant should identify, where supported: - business rule ID; -
source/provenance; - requirement IDs; - module; - actor perspective; -
preconditions; - observed states; - expected relationship; - evidence
requirements; - conflict status.

Do not invent rules.

Use evidence from BRD, PRD, SRS, FSD, module FRDs, documented business
rules, and explicitly marked observed/derived behaviour.

Initial families:

### Katchup

- sender/recipient visibility;
- read receipt transition;
- recall;
- edit;
- forward;
- copy;
- confidential copy;
- delete;
- important/save;
- vanish;
- permissions.

### Groups

- admin/member permissions;
- minimum-admin rule;
- membership visibility;
- messaging permissions.

### Kall

- caller/participant state;
- scheduling;
- rescheduling;
- cancel/decline/end;
- call logs.

### KMail

- recipients;
- delivery/read state;
- replies;
- confidential-copy visibility;
- sender/receiver deletion.

Unverified/conflicted rules must remain explicitly
unverified/conflicted.

---

# 8. Phase 6 --- Application Flow Execution Engine

Turn declarative flows into executable application-behaviour tests.

Keep flow definitions declarative.

Execution services/adapters should: 1. resolve actors; 2. authenticate; 3. execute API/UI actions; 4. capture evidence; 5. bind artifacts; 6.
correlate resources; 7. observe state; 8. validate preconditions; 9.
validate postconditions; 10. record side effects; 11. register cleanup
resources; 12. preserve actor perspective; 13. produce structured
FlowRun results.

Support API, UI, and mixed API/UI flows.

Do not create duplicate business flows just because API and UI are
different channels.

Blocked prerequisites must prevent false downstream evidence.

Keep execution statuses separate from FailureClass.

---

# 9. Phase 7 --- State Transition Validation

Use State Observation + Flow Execution + Business Invariants to validate
real application state transitions.

For each transition:

BEFORE → ACTION → AFTER → SIDE EFFECTS → BUSINESS RULE

Examples:

### Katchup read

Observe sender state before. Recipient reads. Observe sender state
after. Verify calibrated transition.

### Katchup recall

Verify sender and recipient perspectives, message identity,
recalled/deleted representation, and side effects.

### Katchup edit

Verify original message identity, changed content/state, recipient
observation, and documented metadata.

### Kall reschedule

Verify logical call identity, changed schedule, participant
preservation, and BR-C01 evidence while preserving the unresolved
conflict if it remains.

### KMail read/delivery

Verify transaction identity, recipient, delivery/read state, and read
time.

Do not treat HTTP 200 as a state transition.

---

# 10. Phase 8 --- Cross-Actor and Multi-Channel Coverage

Systematically cover: - sender → recipient; - sender → copy-recipient; -
sender → confidential-copy-recipient; - group-admin → group-member; -
caller → participant; - API actor → UI observer; - UI actor → API
observer.

Verify actor-specific visibility and state.

A sender seeing a receipt is not equivalent to a recipient seeing one.

An admin result is not equivalent to an end-user result.

---

# 11. Phase 9 --- Side-Effect Verification

Verify real side effects where reliable evidence exists: - unread
counts; - read receipts; - message lists; - group membership; - call
logs; - mail transaction status; - notification state; - important/save
state; - deletion visibility; - attachment associations; - audit
records; - derived counts.

Do not use fragile UI text as the only evidence when stronger state/API
evidence exists.

---

# 12. Phase 10 --- Failure Analysis Upgrade

Extend the existing failure-analysis framework to consume: - endpoint
evidence; - flow evidence; - actor context; - state observations; -
invariant results; - resource lifecycle; - requirement provenance; -
environment.

Distinguish: - transport/infrastructure; - authentication/session; -
authorization; - contract/schema; - input validation; - application
logic; - state transition; - business rule; - data consistency; - UI
behaviour; - test-bench defect; - environment; - unknown/indeterminate.

Do not classify an application bug from HTTP status alone.

Do not classify a downstream step when its prerequisite failed.

---

# 13. Phase 11 --- Independent Confirmation Engine

Create a separate confirmation stage.

For a detected defect: 1. identify exact resource; 2. repeat safely when
appropriate; 3. observe through an independent path; 4. compare
before/after state; 5. verify actor perspective; 6. verify business
invariant; 7. capture evidence.

Prefer an independent channel: - API action → UI observation; - UI
action → API observation; - sender action → recipient observation; -
mutation → read-back.

Do not simply repeat the same assertion.

---

# 14. Phase 12 --- Duplicate Detection and Canonical Defects

Prevent the same defect from being filed multiple times.

Use evidence such as: - module; - feature; - requirement; - flow; -
endpoint/action; - resource type; - actor relationship; - failure
category; - observable incorrect behaviour; - reproduction signature.

API/UI/actor variants can be grouped only when evidence supports
equivalence.

Do not merge merely because status codes or titles match.

Keep detection, confirmation, deduplication, and filing separate.

---

# 15. Phase 13 --- Confidence Gate

Keep the existing confidence gate shadow-only until evidence is mature.

Eventually confidence should consider: - requirement provenance; -
actor; - preconditions; - state before; - action evidence; - state
after; - business invariant; - reproducibility; - independent
confirmation; - environment reliability; - Test Bench integrity; -
duplicate relationship.

Final pipeline:

Observation → Classification → Confirmation → Deduplication → Confidence
→ Filing eligibility

Do not enforce confidence prematurely.

---

# 16. Phase 14 --- Bugzilla Integration

Connect Bugzilla only after confirmation, deduplication, and confidence
are trustworthy.

Only confirmed, non-duplicate application defects may be filed.

Never automatically file: - transport errors; - environment failures; -
Test Bench defects; - unknown/indeterminate findings; - unconfirmed
mismatches; - duplicates.

Assignment must use authoritative existing mapping. Never guess.

Bug records should contain: - concise title; - module; - requirement; -
flow; - actor; - preconditions; - reproduction; - expected; - actual; -
evidence; - state before/after; - environment; - confirmation
evidence; - canonical/duplicate identity.

Never include secrets.

---

# 17. Phase 15 --- Complete API Coverage

Create a coverage matrix for every registered endpoint:

---

Endpoint Contract Negative Security Live Flow State Business UI Confirmation
Rule Cross-check

---

---

Every cell must be COVERED, NOT_APPLICABLE with evidence, BLOCKED with
recovery path, or NOT_YET_COVERED.

Do not permanently use "not tested".

For unsafe live writes, use mock/contract coverage plus controlled
lifecycle coverage.

---

# 18. Phase 16 --- Complete UI Coverage

Audit every major user-visible flow.

Do not equate button click, dialog close, URL change, or input value
with successful business behaviour.

Verify outcomes through API/state observation where appropriate.

Examples: - send → recipient observes message; - delete → read-back
proves absence; - important → state/list proves it; - group create →
group exists and is cleaned; - Kall schedule → call record exists with
correct participants; - mail send → transaction state exists.

---

# 19. Phase 17 --- Resource and Cleanup Hardening

Every live flow that creates a resource must answer: - what was
created; - how it is identified; - who owns it; - how it is cleaned; -
what happens on partial failure; - what happens when cleanup fails.

Reuse Resource Ledger.

Do not create a parallel cleanup system.

If KPOST cannot delete an account/resource, do not claim CLEANED. Use
the correct retirement/lifecycle state.

---

# 20. Phase 18 --- Daily Regression Orchestrator

Daily sequence:

1.  environment preflight;
2.  account availability;
3.  API contract;
4.  negative/security;
5.  KPOST behavioural flows;
6.  KMail flows;
7.  Admin flows;
8.  UI flows;
9.  cross-actor;
10. state transitions;
11. business invariants;
12. failure analysis;
13. confirmation;
14. deduplication;
15. confidence;
16. reporting;
17. Bugzilla only for eligible confirmed defects.

Daily reports must include: - collected; - executed; - passed; -
failed; - skipped; - blocked; - N/A; - live writes; - resources
created/cleaned; - findings; - confirmed defects; - duplicates; -
indeterminate findings.

---

# 21. Phase 19 --- Regression After Developer Fixes

For every developer fix: 1. reproduce the original defect; 2. verify the
fix; 3. run the entire affected flow; 4. run related actor perspectives; 5. run related state transitions; 6. run adjacent business rules; 7. run
negative cases; 8. run regression cases; 9. check for new defects; 10.
verify cleanup.

A fix is not complete merely because the original assertion passes.

---

# 22. Phase 20 --- Production-Grade Defect Discovery

The final Test Bench should proactively discover defects through: -
contract violations; - negative input; - authorization; - state
transition violations; - business invariant violations; - cross-actor
visibility; - data consistency; - UI/API disagreement; - lifecycle
failures; - resource leakage; - safe concurrency; - regression; -
unexpected state transitions.

Every discovered defect still requires evidence and confirmation before
Bugzilla.

---

# 23. Progress/Handoff File

Maintain:

`docs/TEST-BENCH-AUTONOMOUS-PROGRESS.md`

Record: - current phase; - completed phases; - in-progress phase; -
blocked phases; - files changed; - tests added/changed/removed; -
coverage; - collected/executed/passed/failed/skipped/blocked/N/A; - live
profiles and writes; - resources created/cleaned/outstanding; - Test
Bench defects; - environment failures; - application failures; -
indeterminate findings; - confirmed defects; - duplicates; - unresolved
conflicts; - safety gates; - exact next phase.

If anything is removed, explain why.

This is the handoff mechanism if Claude stops or the session is
restarted.

---

# 24. Phase Completion Record

At the end of every phase, write:

```text
PHASE: <number/name>
STATUS: COMPLETE | PARTIAL | BLOCKED

OBJECTIVE:
<what the phase intended to achieve>

IMPLEMENTED:
<exact implementation>

FILES CHANGED:
<paths>

TESTS:
<tests added/changed>

VERIFICATION:
<typecheck/lint/check/framework/mock/live/etc.>

LIVE EXECUTION:
<none or exact details>

RESOURCES:
<created/cleaned/outstanding>

FINDINGS:
<important findings>

CONFLICTS:
<unresolved conflicts>

BLOCKERS:
<exact blockers and evidence>

SAFETY:
<gates preserved>

COVERAGE IMPACT:
<before → after>

NEXT:
<next phase>
```

Never report "all good" without evidence.

---

# 25. Stop Conditions

Request human input only when: 1. destructive/global authorization is
required; 2. a live test could create permanent/unmanaged data; 3. a
documentation conflict must be resolved rather than preserved; 4. a core
existing system would need deletion/replacement; 5. a security boundary
would need weakening; 6. production access/modification is required; 7.
a credential/secret issue is discovered; 8. Bugzilla assignment would
require guessing; 9. application evidence is insufficient and proceeding
would require invention; 10. repository divergence makes this plan
unsafe without re-audit.

Do not stop merely because: - tests fail; - a bug is discovered; - a
test needs repair; - a mock test fails; - a phase has many findings.

Investigate, classify, repair, and continue when safe.

---

# 26. Anti-Patterns

Never: - replace exact assertions with generic 2xx/3xx checks; - change
`toBe(200)` to `<600` to reduce failures; - catch assertion errors to
hide failures; - convert failures to skips; - delete failing tests; -
delete difficult endpoints; - remove negative tests; - disable live
safety globally; - disable cleanup; - create a second account pool; -
create a second requirement registry; - create a second state
observation engine; - duplicate endpoint execution infrastructure; -
make Bugzilla determine test results; - file directly from raw test
failures; - guess developer assignments; - infer business rules from
test titles; - infer application state from HTTP status; - treat dialog
closure as business success; - use literal booleans as evidence; - treat
test names as proof; - silently resolve contradictory documentation; -
silently normalize conflicting state representations; - generate
uncontrolled live-write fuzz suites; - claim cleanup when resources
still exist.

---

# 27. Priority Order

When choosing work:

1.  Test Bench safety/correctness defects.
2.  Execution blockers preventing valid coverage.
3.  Missing contract/API coverage.
4.  Business invariant model.
5.  Flow execution.
6.  State-transition validation.
7.  Cross-actor verification.
8.  Side-effect validation.
9.  Failure classification.
10. Independent confirmation.
11. Duplicate detection.
12. Confidence enforcement.
13. Bugzilla automation.
14. Broad regression hardening.
15. Optimization/refactoring.

Do not prioritize visual cleanup over correctness.

Do not prioritize elegance over evidence quality.

Do not prioritize pass rate over defect discovery.

---

# 28. Final Acceptance Criteria

The project is complete only when the Test Bench can reliably:

## Coverage

- cover all supported API endpoints through appropriate
  contract/negative/security/flow layers;
- cover major application flows;
- cover supported UI flows;
- cover cross-actor behaviour;
- cover state transitions;
- cover business invariants;
- explain every skip/block/N/A.

## Evidence

- correlate actions to resources;
- observe before/after state;
- preserve actor perspective;
- capture side effects;
- preserve provenance.

## Failure analysis

- distinguish Test Bench/environment/application failures;
- prevent false positives from failed prerequisites;
- preserve indeterminate results when evidence is insufficient.

## Confirmation

- independently reproduce and verify application defects.

## Deduplication

- group API/UI/actor variants of the same defect when justified;
- avoid duplicate Bugzilla records.

## Confidence

- require sufficient evidence before final eligibility.

## Bugzilla

- only confirmed, non-duplicate application defects are eligible;
- assignments use authoritative mappings;
- no secrets are filed.

## Safety

- live writes remain controlled;
- resources are tracked;
- cleanup is verified;
- permanent account/resource creation is explicit.

## Daily operation

- repeated daily regression is practical;
- new defects can be discovered automatically;
- developer fixes can be regression-tested;
- reports are reproducible.

---

# 29. Core Principle

Do not optimize this project for:

"How can we make all tests pass?"

Optimize it for:

"How can we make the Test Bench trustworthy enough that a failure means
something?"

A genuine application failure is a successful discovery.

A false green result is a Test Bench failure.

The final product is not the number of passing tests.

The final product is this trustworthy chain:

**Requirement → Flow → Actor → Action → Resource → State → Business Rule
→ Evidence → Failure → Confirmation → Deduplication → Confidence →
Bugzilla.**

Continue through the phases until the acceptance criteria are met, while
preserving all useful test layers and all safety controls.
