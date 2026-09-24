# API coverage depth — Phase 1 (existing-coverage audit)

Companion to `docs/COVERAGE.md`. That ledger answers "does a test exist for this endpoint?" (349/446
documented endpoints — 350 by direct registry count, off by one from a documentation-vs-registration
edge case not yet reconciled). This document answers the deeper question the coverage-depth audit was
asked for: **for a REGISTERED endpoint, does it get anything beyond the generic 50-auto-validator
sweep (auth, authz, request/negative-input, response/schema, security, common data-quality,
concurrency, performance), or does it also have a hand-written business-rule/functional-flow test?**
An endpoint can be "tested" per COVERAGE.md and still have zero assertions about what the endpoint is
*supposed to do* beyond "didn't crash, matched its schema, rejected garbage input, enforced auth."

**Do not assume a test existing means the endpoint is covered.** This document exists because that
assumption was checked and found false for just over half the registry.

## Resolved: the systemic ceiling on ~49 "needs-id" reads (`allowLiveRead`, added 2026-09-24)

While closing individual module gaps (dashboard, kos, group), the same architectural wall came up
three times: an Unknown/blocked "needs-id" read (`destructive: false`, no `productionSafe`) stayed
untestable on live **even when a lifecycle flow in the same test minted a real id for it**
(`group-download-image` after creating a real group+image; `kos-get-document` after creating a real
doc). The reason was in `src/validation-engine/production-guard.ts`'s `destructiveBlockReason()`:
its only live unlock, `allowLiveWrite`, was gated to `endpoint.destructive === true`
(`liveWriteAuthorized`/`writeFuzzAuthorized` both require it) — a non-destructive read had no
equivalent unlock at all, regardless of how the id was obtained.

A full registry sweep found **49 endpoints** (28 `kpost-api`, 14 `kmail-api`, 7 `admin-api` — about
14% of the whole registry) matching this exact shape — dependency-driven reads that Phase 4
explicitly asks for ("if an endpoint depends on another endpoint... create the required test flow
rather than testing it in isolation"): attachment/thumbnail downloads keyed by a uuid a sibling write
just minted, doc/session reads keyed by an id a create endpoint just returned, and similar.

**Fixed**, with owner sign-off, by adding `allowLiveRead` to `SafetyFlags`/`destructiveBlockReason()`
in `production-guard.ts` and threading it through `EndpointExecutor.SendOptions` — scoped exactly
like `allowLiveWrite`: `destructive !== true` (reads only) + `sideEffect: 'data'` only
(`external`/`global` and OTP still refused unconditionally), set per-call by an owner-approved feature
spec, never by the engine. Regression-tested in `tests/framework/live-safety.spec.ts` (unlocks a
needs-id read; does NOT unlock a write, a global-side-effect read, or an OTP-dependent endpoint).
Verified end to end on `dashboard-home-new-msgs` (fed a real marker from `homeDashboardMsgs`, live
200 in place of the documented null-marker 500) and `group-download-image`/`group-download-full-image`
(read back immediately after the same flow's `group-update-image`, live `GROUP_LIFECYCLE=true` run).

The remaining ~46 affected endpoints (mostly in `kmail`, `kpost/katchup`, `admin`, `kpost/kall`,
`kpost/kdiary`, `kpost/signup-login`) are not yet converted — the framework now supports it, but each
one still needs its own dependency-flow test written as that module is reached.

## Methodology

1. **Ground truth for "what's registered"**: the live `apiRegistry` (from `@api/definitions/index`),
   dumped via a throwaway Playwright spec, not regex over source files. An earlier regex-based pass
   undercounted `kmail` by 55 endpoints because `read.api.ts` defines endpoints through positional-
   argument factory helpers (`getRead(id, path, ...)`) rather than `defineKmailEndpoint({ id: '...' })`
   object literals — regex anchored on `id:` never saw them. Every one of the registry's 350 ids was
   then traced back to the exact definitions file that contains its literal (0 unmatched), so the
   module bucketing below is exact, not inferred.
2. **"API business-rule/flow tested"**: the endpoint's id literal appears in `tests/api/**` (filtered
   to files named `*feature*`, `*workflow*`, `*lifecycle*`, `*manage*`, `*security*`,
   `*domain-policy*`, `*login-flow*`, `*otp-*`, `*session*`, excluding the generic `coverage.spec.ts`/
   `read.spec.ts`) or anywhere in `tests/integration/**`.
3. **Deliberately excluded from "rich"**: `tests/framework/**` — those specs test the bench's own
   tooling (concurrency harness, validation engine, bug tracker), not product business rules, even
   though they reference real endpoint ids as fixtures.
4. **UI-only tests** (`tests/e2e/**`, `tests/e2e-admin/**`) were checked too: none of them reference
   endpoint id literals directly (they drive the page and assert screen/DB state), so they don't
   currently register as coverage for any specific endpoint id by this method. That's a gap in the
   *method*, not a claim that the UI specs assert nothing — it means this document cannot yet credit a
   UI-driven cross-layer check for a specific endpoint. This is also moot for now: UI test work is
   paused per current direction.
5. Raw per-module id lists are in `coverage-depth-raw.local.json` (git-ignored scratch — see cleanup
   note at the end).

## Summary

| Module | Registered | API-rich | Generic-only | Depth |
| --- | ---: | ---: | ---: | ---: |
| `kmail` | 70 | 60 | 10 | 86% ✅ done 2026-09-24 (10 recorded gaps, see below) |
| `kpost/profile` | 45 | 32 | 13 | 71% ✅ done 2026-09-24 (10 permanently by design, 3 real gaps) |
| `admin` | 38 | 29 | 9 | 76% |
| `kpost/katchup` | 36 | 24 | 12 | 67% ⚠️ blocked 2026-09-24, see note |
| `kpost/common` | 33 | 6 | 27 | 18% |
| `kpost/kall` | 20 | 14 | 6 | 70% |
| `kpost/kos` | 18 | 17 | 1 | 94% ✅ done 2026-09-24 |
| `kpost/contacts` | 16 | 9 | 7 | 56% |
| `kpost/signup-login` | 14 | 4 | 10 | 29% |
| `kpost/kdiary` | 14 | 10 | 4 | 71% |
| `kpost/admin` | 12 | 0 | 12 | **0%** |
| `kpost/group` | 11 | 11 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/settings` | 7 | 7 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/aws` | 4 | 4 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/dashboard` | 3 | 3 | 0 | 100% ✅ done 2026-09-24 |
| **Total (real KPost/KMail/Admin surface)** | **341** | **234** | **107** | **69%** |

**Excluded from the table above — bench-internal scaffolding, not KPost product endpoints**
(`users`, `auth`, `companies`, `dictionary`, `health` — 9 endpoints): every one of these carries
`mockFixture: true` in its definition. They run against the bench's own bundled mock server and exist
to test the VALIDATION ENGINE ITSELF (auth/authz/schema/negative-input machinery, the concurrency
harness, the bug-tracker pipeline) — `tests/framework/*.spec.ts`, `tests/integration/user-lifecycle.spec.ts`,
and the per-module contract-suite specs already exercise them for that purpose. There is no real
KPost backend behind `/users`, `/users/{id}` etc. to have a "business rule" about, so writing
product-style business-rule tests against them would assert nothing real. Originally miscounted as
part of the "KPost API" gap (see the corrected total above, which excludes them) — corrected
2026-09-24 before any work was done against them.

## Priority gaps (ordered by risk, for Phase 2–4 planning)

### 1. `kpost/admin` — 0/12, zero business-rule coverage
Business-tier admin actions with real state-mutation semantics (terminate user, reset password,
hold/release, backup-admin create/remove, role update, bank/company detail updates) — exactly the
class of endpoint Phase 4 calls out ("role-based behavior, permission rules, record ownership rules").
Currently only the generic 50-validator sweep runs against these.

```
admin-user-management-details, admin-bank-and-company-details, admin-kpostid-designation-suggestion,
admin-display-name-suggestion, admin-adding-user-by-admin, admin-terminate-user, admin-reset-password,
admin-hold-or-release, admin-create-remove-backup-admin, admin-update-company-details,
admin-update-bank-account, admin-update-role
```
Note: this module is `needs-business` per `docs/COVERAGE.md` (needs a business company with members)
— any Phase 2–4 work here needs that fixture data first.

### 2. `kpost/dashboard` — ✅ done (2026-09-24)
`tests/api/kpost/dashboard/feature.spec.ts`. `dashboard-home-msgs` and `dashboard-katchup-msg` are
live-verified: the batch's `firstMsgID`/`lastMsgID` ordering invariant, the `katchup` array's
newest-first ordering, and — the real cross-endpoint finding — that both endpoints report the
*identical* recent-activity window (same markers, same message ids) for the same account, so they are
one underlying query surfaced twice, not two independently-drifting reads. `dashboard-home-new-msgs`
could not be given a live business-rule test: it is `destructive: false` with no `productionSafe`
flag, and the engine's safety gate (`destructiveBlockReason`) only grants a live-write unlock
(`allowLiveWrite`) to `destructive: true` endpoints — there is no equivalent unlock for a
non-destructive "needs-id" read. Recorded as a skipped, explicitly-reasoned placeholder test rather
than worked around or left silently absent.

### 3. `kmail` — ✅ done (2026-09-24): 60/70, 10 recorded gaps
Went from 15→60 rich (21%→86%) across `feature.spec.ts`, `reads-workflow.spec.ts`,
`signature-letterhead-workflow.spec.ts`, `manage-workflow.spec.ts`. Highlights:

- **Prerequisite finding**: `testkmail.kpostindia.com`'s long-standing 401-on-every-token regression
  (`auth-regression.spec.ts`, `KMAIL_AUTH_FIXED` gate) is fixed — verified live across 3 accounts
  before starting this module. `KMAIL_AUTH_FIXED=true` was already set in `.env`.
- Fixed a real, reproducible bug in the *existing* settings-writes test: it created a saluation and
  instant-reply every run and never deleted either, permanently accumulating junk on the shared QA
  account. Replaced with a unique-marker create→read-back→verify-on-digital-signature→delete flow.
- Fixed a real request-shape bug in the (gated, not-yet-run) `kmail-ai-assist`-adjacent
  `kmail-sig-full` test path and separately in the pre-existing kos AI test (see kos section above).
- **Two real, live-confirmed backend defects found and auto-filed**: `kmail-sig-full` 500s (not 400)
  when `companyData` is omitted; `kmail-unopened-count` 500s deterministically for every account
  (`SQLGrammarException: could not extract ResultSet`) — not a flake, reproduced across 2 accounts.
- **Recorded gaps (10, each with an explicit skipped test and reason — none silently missing)**:
  `kmail-postbox-contacts` / `kmail-draft-multipart` (404, route not deployed on this test build);
  `kmail-credentials` (sensitive, deliberately not driven on live per its own definition);
  `kmail-sig-company` (needs `QA_COMPANY_NAME` in `.env`, not currently configured — a real value is
  required, a fabricated one would be exactly the danger `qa-identifier-guard.ts` exists to prevent);
  `kmail-clear-status` / `kmail-clear-all-status` / `kmail-post-bulk` (Unknown/Requires Clarification
  — consistent 400s with no diagnosable detail using the endpoint's own default shape);
  `kmail-bulk-status` (blocked transitively by `kmail-post-bulk`); `kmail-reference-content` (the
  natural way to get a real id — replying to our own mail — is refused by the qa-identifier-guard's
  `referenceKmailID` pattern, which has no runtime-scoped exemption the way `kallIds`/`groupID` do);
  `kmail-download-thumbnail` / `kmail-media-streaming` / `kmail-download-attachment` (need a real
  attachment uuid from an actual file upload — that lifecycle doesn't exist for KMail yet);
  `kmail-delete-letterhead` (only one letterhead exists on this account and whether it's personal or
  a shared system template is unconfirmed — deleting it to test would risk destroying shared state).

### 4. `kpost/common` — 27/33 generic-only
Reference-data and company-identity endpoints: company logo upload/download/remove, company-details
lookups by admin/mobile/product, domain/unique-name generation and existence checks, enquiry/
unsubscribe capture. Several of these (`common-unique-name-exist`, `common-generate-domain-and-unique-name`,
`common-mobile-no-exist-in-company`) look like exactly the kind of "business-rule validation" /
"duplicate prevention" Phase 4 asks for and currently get none.

### 5. `kpost/profile` — ✅ done (2026-09-24): 32/45, 13 recorded gaps
Went from 18→32 rich (40%→71%) across `feature.spec.ts`, `reads-workflow.spec.ts`,
`device-workflow.spec.ts`. Highlights:

- **User-reported workbook correction (fixed at the source, not worked around)**: the user directly
  confirmed `GET /v2/profile/fetchUserDetails/` takes NO payload — token only — while the workbook
  documented POST with `{kpostID, countryID}`. Traced to `KPOST API (6).xlsx`, KatchupAPI!L2 (a
  literal `"GET METHOD"` cell, matching the workbook's own established convention, replaces the
  wrong payload). While fixing it, found the SAME payload was also bleeding into
  `/v2/profile/fetchUserDetails/` from a second, unrelated row (K3) that combines two different
  service URLs in one cell — split out, confirmed against the real, working
  `signup-login-fetch-user-details` (`POST /v2/signupLogin/fetchUserDetails/`) definition that the
  payload actually belongs to. Contract regenerated (`npm run contract:excel`); the phantom
  `POST /v2/profile/fetchUserDetails/` OpenAPI operation is gone. Every other cell in the 8-sheet
  workbook verified byte-identical before promoting the fix (diffed old vs. new programmatically).
  This also retroactively explains a 500 ("A valid kpostID and countryID is required") found earlier
  this session and originally logged as a possible new backend regression — it wasn't one; it was
  the endpoint definition's now-removed `contractMethod: 'POST'` override, downstream of the same
  wrong workbook data.
- **Real, previously-silent bug found and fixed**: the existing "education record" test read
  `collegeDetails` from `getUserProfileUsingKpostID`'s response as if it were an array to search for
  the just-saved record's id — but that field is a JSON-encoded **string** (`collegeDetailsAsJson` is
  the actual parsed array). `Array.isArray(string)` is always false, so the id was always
  `undefined` and `profile-delete-college` was **never actually reached** — a passing test that
  never exercised its own cleanup step. Fixed, and confirmed by the cleanup it had been silently
  skipping: **25 leftover "QA Bench College" records** had accumulated on the shared QA account
  across however many prior runs; all deleted once the fix let the delete path run for real.
- Fixed the same "empty string flagged as an unowned identifier" issue found earlier with KMail
  (`kmail-sig-full`/`kmail-add-od-contact`) in `profile-advanced-search`'s own endpoint definition —
  `mobileNumber: ''` was blocking ANY live run of this productionSafe-flagged endpoint outright.
- Retired a stale finding: `profile-get-languages`'s definition claimed "GET→405, POST→500, no
  working verb works" — re-verified twice live, both verbs now answer 200. What's still real and
  now asserted: the language list itself is empty (`data: []`), recorded as Unknown/Requires
  Clarification rather than a defect.
- **Recorded gaps (13, each with an explicit skipped test and reason)**: 10 are **permanently
  architecturally excluded by design**, not real gaps — OTP senders (SMS kill-switch),
  session-destroyers (`setDeviceAs*`/`updateDeviceAs*`, blocked even on a confirmed OTP test
  gateway), and global credential/account changes (`changePassword`, `deactivateAccount`, would
  lock the suite out of its own QA account mid-run). The remaining 3 are real, closable gaps:
  `profile-save-other-activity` has no matching delete endpoint anywhere in the module (saving a
  real record live would permanently pollute the account, the same class of bug just fixed for
  KMail's saluation/instant-reply leak); `profile-save-experience`/`profile-delete-experience` need
  `QA_COMPANY_NAME` configured in `.env` (only `QA_COMPANY_NAME_ABSENT` exists today) — same
  unconfigured-identity-field gap as `kmail-sig-company`.

### 6. `kpost/katchup` — ⚠️ 15→24/36 (2026-09-24), then blocked mid-module by a live outage
Highlights before the blocker hit:

- Added `searchmessage` to `qa-identifier-guard.ts`'s `NOT_A_RESOURCE` — the exact same class of
  false positive as `actualmessage`/`kmailcontent` already exempted there (a free-text search query,
  not a record identifier), confirmed against the guard's own regression suite (25/25 still pass).
- `katchup-forward-backtrack` wired to a real forwarded msgID from the existing
  `katchup-forward-message-new` call in the "send variants" test (previously only asserted "doesn't
  5xx"; now the id it returns is captured and fed forward via `allowLiveRead`).
- 7 plain reads (`katchup-unopened-count`, `-unopened-total-count`, `-frequent-contacts`,
  `-message-count`, `-search-subject`, `-filter-message`, `-all-report-msg`) given real
  business-rule assertions, including a genuine cross-check (`getUnopenedMessagesCount`'s
  `msgsCount` is asserted to equal the sum of its own `resultList` entries — the field would be an
  easy one to silently break by summing the wrong column).
- **Two live, currently-reproducing findings, not confidently one endpoint's own bug**:
  `katchup-search-message` and `katchup-filter-message` both time out well past 10s (retried at
  20s/25s, consistently) — soft-asserted so they're reported rather than blocking the file, left for
  the engine's own 3-pass reproduction gate to judge rather than hand-classified as a single
  endpoint's defect, since the same intermittency also hit `katchup-unopened-total-count` once.

**Then blocked**: mid-session, `katchup-send-message` — the single most basic, most-depended-on
write in the entire module, unchanged from its long-working default shape — started answering 400
`{"data":[],"status":"FAILURE"}` with no diagnosable message. Verified this is not something this
session's changes caused: reproduced with the endpoint's pure, zero-override default payload, from
two different accounts. This blocks every remaining needs-message-id/needs-attachment endpoint in
the module (they all need a fresh send to chain from), and reopened an existing tracked defect via
this session's own test runs. The 12 still-generic endpoints are recorded as explicit gaps in
`needs-id-workflow.spec.ts`, each citing its specific blocker (this outage, a 404-undeployed-route,
or "no id-minting endpoint found" for the share/reference reads) — not worked around with a
fabricated id. **Module resumes once sends work again.**

### 7. `kpost/signup-login` — 10/14 generic-only
`signup-login-admin-user-login`, `signup-login-admin-registration`, `signup-login-generate-jwt`,
`signup-login-active-session`, `signup-login-logout-all-devices`, `signup-login-set-access-code` —
session/token lifecycle endpoints, which is exactly the "token/session validation" category Phase 2
calls out by name.

### Smaller gaps
`kpost/contacts` (7), `kpost/kall` (6, mostly read/info endpoints).

## What this document does NOT yet claim

"API-rich" above means *at least one* business-rule/flow assertion exists — it is a presence check,
not a completeness check. An endpoint counted as API-rich may still be missing individual Phase 2/3/4
scenarios (boundary values, specific negative-input shapes, a particular state transition). Auditing
scenario-level completeness *within* the 156 API-rich endpoints is the next layer of Phase 1 and has
not been done yet — this document only separates "has a business-rule test at all" from "generic-only."

No business rules have been fabricated for any endpoint listed above; where a rule isn't yet known
from code/contract/behavior, it should be recorded `Unknown / Requires Clarification` when Phase 2-4
work reaches that endpoint, per the standing instruction.

## Cleanup note

This audit used throwaway tooling not meant to stay in the repo: `tests/framework/_dump-registry.local.spec.ts`,
`registry-dump.local.json`, `coverage-depth-raw.local.json`, and `coverage-depth3/4/5.local.cjs` in the
repo root. These are removed after this document is written; regenerate them the same way if the
registry changes enough to need a re-audit.
