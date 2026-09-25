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
| `kmail` | 70 | 62 | 8 | 89% ✅ done 2026-09-25 (8 recorded gaps, see below) |
| `kpost/profile` | 45 | 32 | 13 | 71% ✅ done 2026-09-24 (10 permanently by design, 3 real gaps) |
| `admin` | 38 | 29 | 9 | 76% |
| `kpost/katchup` | 36 | 24 | 12 | 67% ⚠️ blocked 2026-09-24, see note |
| `kpost/common` | 33 | 28 | 5 | 85% ✅ done 2026-09-24 |
| `kpost/kall` | 20 | 20 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/kos` | 18 | 17 | 1 | 94% ✅ done 2026-09-24 |
| `kpost/contacts` | 16 | 16 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/signup-login` | 14 | 11 | 3 | 79% ✅ done 2026-09-24 |
| `kpost/kdiary` | 14 | 13 | 1 | 93% ✅ done 2026-09-24 (1 recorded gap) |
| `kpost/admin` | 12 | 0 | 12 | **0%** |
| `kpost/group` | 11 | 11 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/settings` | 7 | 7 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/aws` | 4 | 4 | 0 | 100% ✅ done 2026-09-24 |
| `kpost/dashboard` | 3 | 3 | 0 | 100% ✅ done 2026-09-24 |
| **Total (real KPost/KMail/Admin surface)** | **341** | **281** | **60** | **82%** |

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

### 3. `kmail` — ✅ done (2026-09-25): 60→62/70, 8 recorded gaps

Originally went 15→60 rich (21%→86%) on 2026-09-24 across `feature.spec.ts`, `reads-workflow.spec.ts`,
`signature-letterhead-workflow.spec.ts`, `manage-workflow.spec.ts`. Revisited 2026-09-25 specifically
to close as many of the 10 recorded gaps as could honestly be closed. Highlights from the original pass:

**New defect found and filed while re-verifying the module 2026-09-25**: `kmail-reply-not-req-receiver`
(`POST /common/replyNotRequiredByReceiver/`) 500s reproducibly reading back a mail the caller just
sent, inside the *existing* `feature.spec.ts` kmailID-keyed-read loop. That loop's own comment assumed
any 5xx there "files via the flow-finding pipeline" — false for this one: the read is authorized via
`allowLiveRead` (`destructive: false`), and the engine's auto-filing only tracks `allowLiveWrite`-
authorized 5xxs, so this genuine crash was going completely unfiled despite being caught by the
assertion every run. Fixed by adding explicit `recordBusinessRuleViolation` filing inside the loop, so
every endpoint it reads is actually covered by the safety net, not just the destructive ones. Filed as
**#603** [KP-843C72], HIGH, KMail API — confirmed reproducible (not caused by this session's other
changes; re-verified with them stashed out) and cleanly deduping on a second run.

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

**2 of the original 10 gaps closed 2026-09-25**:
- `kmail-sig-company` — `QA_COMPANY_NAME` is now set in `.env` to `Nebius Solutions`, confirmed live
  via `common-company-details` authenticated AS the `business-m` principal itself (co 242) — genuinely
  owner-confirmed via the account's own data, not invented. `saveOrUpdateMailSignatureCompanyData` now
  has a real, passing test (write → read back → assert exact match on `business-m`).
- `kmail-reference-content` — the identifier-guard half is fixed: `referencekmailid`/`referencemails`
  are now exempted as runtime-scoped KMail ids (the same class `kmailid`/`kallid` already were),
  verified against the guard's own 25-test regression suite. A real mail is now sent and its real
  `kmailID` fed to the endpoint live — but the exact request shape remains Unknown/Requires
  Clarification: every shape tried (`{referenceMails:[id]}` as number and string, `{referenceKmailID:
  id}`, `{kmailIDs:[id]}`, `{kmailIds:[id]}`, a raw `[id]` array body, and both as query params) 400s
  with a generic Spring deserialization failure. Recorded with a real id now available whenever the
  correct shape is confirmed — not worked around by guessing further.

**Re-investigated, found to still be blocked (no change)**:
- `kmail-postbox-contacts` / `kmail-draft-multipart` — re-confirmed 404 "Not Found" live 2026-09-25;
  routes still not deployed on this test build.
- `kmail-delete-letterhead` — re-checked with NEW evidence: `getLetterHead` marks the only letterhead
  `"default":"Y"` and its assets sit at a generic S3 path (`letterHead/LHH2.png`), pointing toward a
  shared system default rather than something this account uploaded — strengthening, not resolving,
  the original ownership concern. No registered endpoint creates a new letterhead to safely delete
  instead.
- `kmail-clear-status` / `kmail-clear-all-status` / `kmail-post-bulk` — tried several additional field
  names and value shapes (`kmailStatusFlag` as a string/enum-name, `statusType`, `status`, `valueFor`,
  and alternate recipient-list keys for `post-bulk`); all either 400 identically to the existing
  Unknown/Requires Clarification finding or fail JSON deserialization entirely. Still genuinely
  unresolvable without the real contract from the dev.
- `kmail-bulk-status` — stays blocked transitively by `kmail-post-bulk`.
- `kmail-credentials` — sensitive (returns account credentials), deliberately not driven on live; a
  policy decision, not something further investigation changes.
- `kmail-download-thumbnail` / `kmail-media-streaming` / `kmail-download-attachment` — still need a
  real attachment uuid from an actual file upload; that lifecycle doesn't exist for KMail (the same
  class of gap `katchup`'s own attachment trio hit this session, independently confirmed unresolvable
  there too).

### 4. `kpost/common` — ✅ done (2026-09-24): 6→28/33
**Methodology correction first**: the original 6/33 estimate was itself measured wrong. This
module's 6 OTP endpoints (`common-send-otp`, `common-validate-otp`, etc.) are richly tested — just
from `tests/api/kpost/signup-login/otp-signup-lifecycle.spec.ts`, not from within `common`'s own
test directory. The per-module audit script only searched each module's own folder for rich-file
matches, missing legitimate cross-module coverage. Fixed by searching the whole `tests/api` tree
for every module from here on; worth a retroactive spot-check on earlier "done" modules if time
allows, since the same blind spot could apply anywhere a business flow lives in a sibling module.

Highlights of the real 0-business-rule-tests gap found underneath that correction (still 27
generic-only once OTP was properly counted, confirming Phase 1's original instinct that this module
needed real duplicate-prevention testing):

- `common-mobile-no-exist` (and its in-company sibling) asked with BOTH a known-absent and a
  known-existing number — the actual true/false duplicate-detection logic verified, not assumed.
- **Real cross-endpoint data-consistency defect found and filed**: `getCompanyDetails`,
  `getCompanyDetailsByAdmin` and `getCompanyDetailsByMobileNoAndproductId` all answer the identical
  underlying question (which company does this mobile number belong to) and agree on `companyID` —
  but disagree on `countryID` (1 vs 0) for the exact same company in the same run. Filed as **#595**
  and **#596** (HIGH) via `recordBusinessRuleViolation`, since it's a 2xx-but-inconsistent-data
  defect the engine's own validators cannot see.
- **Real defect found and auto-filed** (deduped to an existing tracked ticket):
  `common-save-enquiry-details` 500s deterministically (`ConstraintViolationException`) on its own
  fully documented default payload — reproduced twice.
- Two more `qa-identifier-guard.ts` false-positive fixes, same class as `searchMessage` earlier:
  `maximummemberscount` (a capacity number, not a member id) — both verified against the guard's own
  25-test regression suite before and after.
- **5 recorded gaps**, all deliberately excluded by design, not workarounds: the company-logo trio
  (`COMPANY_ADMIN`-gated, and the endpoint definitions' own extensive prior investigation already
  declined to upload a real logo on a reference-only token without explicit authorization),
  `common-update-flutter-app-version` (`sideEffect: 'global'`, controls every mobile client's
  install prompt), and `common-save-unsubscriber-details` (404, route not deployed on this build).

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
the module (they all need a fresh send to chain from). Since this is a 4xx (not 5xx), the engine's
automatic write-flow filing doesn't pick it up by design (see `flow-finding.ts`) — filed manually via
`recordBusinessRuleViolation` in a new, permanent, ungated `send-regression.spec.ts` (mirroring
KMail's own `auth-regression.spec.ts`), which reproduced it cleanly and filed **Bug #594 [KP-4EB0BB]
(HIGH, KPost API)**. That spec stays in the suite and will show green the moment the fix lands,
signalling the rest of the `KATCHUP_LIFECYCLE` suite is safe to trust again. The 12 still-generic
endpoints are recorded as explicit gaps in `needs-id-workflow.spec.ts`, each citing its specific
blocker (this outage, a 404-undeployed-route, or "no id-minting endpoint found" for the
share/reference reads) — not worked around with a fabricated id. **Module resumes once sends work
again.**

**Confidence downgraded 2026-09-24**: a user-captured payload sent to the LIVE application
(`devapi2.kpostindia.com`) succeeded with an equivalent shape. This bench targets
`testingapi.kpostindia.com` — a separate, disposable test-DB environment — for every send. Re-ran
the exact devapi2-captured shape against testingapi (including `groupFlag` as a boolean and
`actualMessage` as the real Quill-Delta JSON string, neither of which `sendShape()`'s default uses);
still 400, from a different receiver and from a self-send alike, with both QA accounts resolving
normally on testingapi via other reads. So the 400 is confirmed on testingapi specifically, not on
devapi2/production. #594 was amended with this finding so it isn't chased as a production issue; see
`send-regression.spec.ts`'s updated docstring for the full trail.

### 7. `kpost/signup-login` — ✅ done (2026-09-24): 4→11/14

**A confirmed CRITICAL regression found and filed**: `adminUserLogin`'s own definition documented a
prior investigation (BUSINESS_M/L → 200, BUSINESS_S → 403 "Not A Admin"). Live-verified again: ALL
THREE tiers now answer `500 "Unexpected error occurred"` — reproduced twice with the endpoint's own
default payload. Every medium/large business admin is locked out of the admin login gateway, not
just the small-tier one the tier check intentionally excludes. Filed as **#598** [KP-A04E2F],
CRITICAL, and kept red permanently by `admin-login-regression.spec.ts` (same pattern as `katchup`'s
`send-regression.spec.ts`), so it re-files/re-confirms every run until fixed.

**Two of the module's own definitions were stale, corrected during this pass**:
- `generateJWTokens`'s comment claimed testingapi's login "does not expose a `refreshToken` where the
  chain can read it". False — it does, but only on a login that runs on its own device id, not the
  shared cached session every other test reuses (a different device's token). Once driven from a
  dedicated login, the endpoint is fully testable and turned out to enforce a real, undocumented
  business rule: **redeeming a refresh token is session-scoped** — it succeeds only when the caller
  is authorized with THAT SAME login's own access token, and is refused (401) when authorized with a
  *different*, even currently-valid, session of the same account. `auth-profile.ts`'s comment on the
  `business-m` principal also asserted `adminUserLogin answers 403` for it — superseded by the #598
  regression above; both comments now point at the current, live-verified reality.

**Methodology note carried over from `common`**: logging in again for an account invalidates that
account's previous session immediately, server-side — confirmed by watching the shared cached
principal's token 401 on its very next call after an unrelated fresh login on a brand-new device.
The engine's token cache only re-logs-in once a cached JWT's own expiry passes, so it has no way to
detect an early server-side invalidation; poisoning the shared token would 401 every later test in
the run (`workers: 1`, one cache per worker). The two tests here that need a second login run it
against `personal-5`, a configured-but-otherwise-unreferenced principal, authorized by its own
literal token rather than through the engine's cache — so nothing shared is ever touched.

**3 recorded gaps**, all deliberately excluded by design: `signup-login-admin-registration`
(OTP-dependent, `sideEffect: 'global'`, creates an unreleasable company tenant, and no reserved
identity is configured for it — reusing the personal-signup identity risks collision), and
`signup-login-logout-all-devices` / `signup-login-set-access-code` (both `sideEffect: 'global'` —
ending every session or rewriting a live credential with no way to restore it), matching the
declines already documented on each endpoint's own definition.

### 8. `kpost/contacts` — ✅ done (2026-09-24): 9→16/16

**A stale default request fixed, not a product bug**: `getSearchDetails`'s own default payload asked
for `requestType: 'areaName'` with `provienceName`/`state`/`city` all empty, on the assumption
(recorded in its own comment) that an area lookup ignores those fields. Live-verified: it does not —
the server 400s that with "Missing required fields for requestType 'areaName'", so the endpoint's
own baseline call always failed every run (already visible as a `response.status-code` failure in
the generic suite, filed nowhere since it's a config/contract gap, not a product defect). Traced the
REAL cascade: `country` -> `provienceName` (a ZONE, e.g. "Southern Zone", not a state) -> `state` ->
`city` -> `areaName`, each level requiring the ones above it populated. Fixed the default in
`read.api.ts` (now `provienceName`, the only level valid with just `country`) and drove the full
chain end to end in `contacts-reference-workflow.spec.ts`, confirming the baseline check now passes.

**Real business-rule tests added**:
- `globalSearch` verified to enforce every filter it is given (`userTypeList`, `countryList`), not
  just the free-text search term — checked across all 534 results for a broad query, zero violations.
- `myUnknownKatchupContacts`, `myGroups`, `myUnknownGroups`, `getImportedPhoneContacts` — ownership
  (every row belongs to the caller) and no-duplicate-row data-quality checks, all clean on live data.
- `contacts-block` → `getBlockContactDetails` → unblock, a clean cross-endpoint chain: blocking makes
  the contact appear in the block list, unblocking removes it, restoring state afterward.

**Deliberately NOT re-tested**: whether `myContacts` still lists a contact after `deleteContact`
reports success — that exact failure mode (delete reports success but leaves the row live,
`delete_status` unmoved) is already covered precisely, against the raw DB flag, by the existing
`contacts-workflow.spec.ts`. Confirmed live while investigating this module (a controlled delete
still left the account in `myContacts`) — not a new finding, so not re-filed.

### 9. `kpost/kall` — ✅ done (2026-09-24): 14→20/20

**Confirmed defect: `contactInfo` never resolves real data.** `POST /v2/kall/contactInfo/` returns an
envelope of all-null/empty fields (`{"kpostID":null,"contactID":null,"firstName":null,…}`, HTTP 200
"SUCCESS") for every input tried in the same test: a real, restored (non-deleted), actively-in-call
contact, the caller's own account, `kallID: null`, and a real `kallID` from a call placed seconds
earlier. `kallDashboard` and `kallInfo`, queried for the exact same call in the same test, correctly
return full details — the data exists and other reads see it; `contactInfo` alone never does. Filed
via `recordBusinessRuleViolation` as **#599** [KP-FC6594], HIGH, KPost API.

**Real cross-endpoint chains added** for all 6 previously generic-only reads: a placed call surfaces
in `kallDashboard` and `kallInfo` (matching `kallID`); a call scheduled for later today surfaces in
`todayKoolKall`; a repeating call surfaces in `fetchScheduledRepeatKall` from its start date;
`frequentKallContacts` checked for well-formed, non-duplicated rows; `kallInfo` confirmed to report
no rows (not a crash or leak) for a contact with no call history.

**Investigation note**: two full-module live runs were accidentally launched concurrently against the
same account during this pass. They interfered with each other (one run's cleanup step raced the
other's in-flight call), producing inconsistent results — the `contactInfo` finding above and the
pre-existing `BR-C01` reschedule issue each looked different across the two runs. Neither concurrent
run's output was trusted; a clean, isolated re-run confirmed the `contactInfo` finding reproduces
reliably and everything else in the module is unaffected.

### 10. `kpost/kdiary` — ✅ done (2026-09-24): 10→13/14

**Two stale request payloads fixed, not product bugs**: `saveReport`'s and `editReport`'s bodies were
both inferred (the workbook documents neither) and both wrong. `saveReport` sent `report` for the
text field — live-verified 2026-09-24: the server silently accepts it (200) but the saved row's
`taskReport` column stays null, confirmed against `getTodayReport` immediately after; the real field
is `taskReport`, matching the key every read response already returns it under. `editReport` sent
`eventID` as the target id — the server 400s "Report id is required"; it needs the REPORT's own `id`
(from `saveReport`/`getTodayReport`), not the event's id. Fixed both in `write.api.ts` and in
`feature.spec.ts`'s own hand-built payloads (which had the same two bugs, so the write lifecycle's
report steps were silently no-ops before this).

**Real cross-endpoint chains added**: an event created for today surfaces in both
`getTodaySchedules` and `getEventSelectedDate` (queried for today's date); saving a report for today
is reflected by `getTodayReport` under a real, matching report id.

**1 recorded gap**: `kdiary-get-event-date` — the endpoint definition's own investigation already
found no frontend caller for this route (the app uses `getEvents` + `getEventSelectedDate` instead)
and that it 500s "Value must not be null" for every payload shape tried, curl-verified 2026-09-19.
That stands; the real payload needs confirming with the dev before this can be driven live without
risking a false CRITICAL on a route nobody calls.

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
